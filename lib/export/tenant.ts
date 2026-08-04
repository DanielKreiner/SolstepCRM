import "server-only";
import { zipSync, strToU8 } from "fflate";
import { createAdminClient } from "@/lib/supabase/admin";

/*
 * Vollständiger Selfservice-Export eines Mandanten (CLAUDE.md 12.a "Exit").
 *
 * DSGVO-Pflicht und Verkaufsargument zugleich: „du kommst jederzeit wieder
 * raus" nimmt bei Handwerksbetrieben eine echte Kaufhürde weg.
 *
 * CSV je Tabelle plus alle Dateien aus dem Storage. Bewusst CSV und nicht
 * ein eigenes Format — der Steuerberater und der Nachfolgeanbieter können
 * beide damit umgehen.
 *
 * Service-Role, weil der Export vollständig sein muss: er enthält auch
 * Personalakten und Rechnungen, die der auslösende Nutzer im Alltag nicht
 * alle sehen darf. Deshalb darf ihn nur die Geschäftsführung anstoßen —
 * das prüft die Server Action, nicht dieses Modul.
 */

/** Tabellen im Export. Reihenfolge = Lesereihenfolge für einen Menschen. */
const TABELLEN = [
  "company",
  "location",
  "app_user",
  "role_permission",
  "qualification",
  "customer",
  "contact_activity",
  "plant",
  "supplier",
  "article",
  "article_alias",
  "article_supplier",
  "pipeline",
  "pipeline_phase",
  "vorgang",
  "vorgang_position",
  "vorgang_gate",
  "vorgang_event",
  "vorgang_dokument",
  "vorgang_termin",
  "vorgang_termin_person",
  "vorgang_nachricht",
  "vorgang_anfrage",
  "vorgang_anhang",
  "gate_template",
  "job_document",
  "stock_move",
  "stock_reservation",
  "purchase_order",
  "purchase_order_item",
  /* Material und Lager. */
  "lagerort",
  "lagerbewegung",
  "artikel_stueckliste",
  "vanstock_regel",
  "vorgang_bedarf",
  "bestellung",
  "bestellposition",
  "bestellung_dokument",
  "seriennummer",
  "time_entry",
  "time_correction",
  "time_account_move",
  "absence",
  "roster_publication",
  "service_ticket",
  "mail_message",
  "mail_attachment",
  "chat_channel",
  "chat_message",
  "applicant",
  "notification",
  "audit_log",
] as const;

/*
 * Nicht im Export: mail_account.secret_enc und portal_access.token_hash.
 * Das eine ist ein fremdes Postfachpasswort, das andere ein Zugangstoken —
 * beides gehört nicht in eine Datei, die per Mail weitergereicht wird.
 */
const AUSGESCHLOSSENE_SPALTEN: Record<string, string[]> = {
  mail_account: ["secret_enc"],
  portal_access: ["token_hash", "pin_hash"],
};

export type ExportErgebnis = {
  dateiname: string;
  daten: Uint8Array;
  tabellen: { name: string; zeilen: number }[];
  dateien: number;
  uebersprungen: string[];
};

export async function exportiereMandant(
  companyId: string,
): Promise<ExportErgebnis> {
  const admin = createAdminClient();

  const { data: company } = await admin
    .from("company")
    .select("name")
    .eq("id", companyId)
    .maybeSingle();

  const inhalt: Record<string, Uint8Array> = {};
  const tabellen: { name: string; zeilen: number }[] = [];
  const uebersprungen: string[] = [];

  for (const tabelle of TABELLEN) {
    const spalte = tabelle === "company" ? "id" : "company_id";
    const { data, error } = await admin
      .from(tabelle)
      .select("*")
      .eq(spalte, companyId);

    if (error) {
      uebersprungen.push(`${tabelle}: ${error.message}`);
      continue;
    }

    const zeilen = (data ?? []).map((z) => {
      const kopie = { ...(z as Record<string, unknown>) };
      for (const weg of AUSGESCHLOSSENE_SPALTEN[tabelle] ?? []) delete kopie[weg];
      return kopie;
    });

    inhalt[`daten/${tabelle}.csv`] = strToU8(alsCsv(zeilen));
    tabellen.push({ name: tabelle, zeilen: zeilen.length });
  }

  // --- Dateien aus dem Storage ---
  let dateien = 0;
  const { data: dokumente } = await admin
    .from("job_document")
    .select("bucket, path, filename")
    .eq("company_id", companyId);

  for (const d of dokumente ?? []) {
    const { data: datei, error } = await admin.storage
      .from(d.bucket as string)
      .download(d.path as string);

    if (error || !datei) {
      uebersprungen.push(`${d.path as string}: nicht lesbar`);
      continue;
    }

    const bytes = new Uint8Array(await datei.arrayBuffer());
    // Pfad im Archiv ohne die Mandanten-UUID — die steht schon im Dateinamen
    // des Archivs und macht die Struktur nur unlesbar.
    const relativ = String(d.path).replace(`${companyId}/`, "");
    inhalt[`dateien/${relativ}`] = bytes;
    dateien++;
  }

  inhalt["LIESMICH.txt"] = strToU8(liesmich(company?.name as string, tabellen, dateien));

  const stempel = new Date().toISOString().slice(0, 10);
  const sauber = (company?.name as string | undefined)
    ?.replace(/[^\w]+/g, "-")
    .replace(/-+$/, "")
    .toLowerCase();

  return {
    dateiname: `export-${sauber ?? companyId}-${stempel}.zip`,
    // mtime fix: sonst hängt die Prüfsumme des Archivs an der Uhrzeit.
    daten: zipSync(inhalt, { level: 6, mtime: new Date("2020-01-01") }),
    tabellen,
    dateien,
    uebersprungen,
  };
}

function alsCsv(zeilen: Record<string, unknown>[]): string {
  if (zeilen.length === 0) return "﻿";

  const spalten = [...new Set(zeilen.flatMap((z) => Object.keys(z)))];
  const kopf = spalten.join(";");

  const inhalt = zeilen.map((z) =>
    spalten
      .map((s) => {
        const wert = z[s];
        if (wert === null || wert === undefined) return "";
        if (typeof wert === "object") return feld(JSON.stringify(wert));
        if (typeof wert === "number") return String(wert).replace(".", ",");
        return feld(String(wert));
      })
      .join(";"),
  );

  return `﻿${[kopf, ...inhalt].join("\r\n")}\r\n`;
}

function feld(v: string): string {
  return /[;"\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function liesmich(
  name: string | undefined,
  tabellen: { name: string; zeilen: number }[],
  dateien: number,
): string {
  const zeilen = tabellen.reduce((s, t) => s + t.zeilen, 0);
  return [
    `Datenexport ${name ?? ""}`,
    `Erstellt am ${new Date().toLocaleString("de-AT")}`,
    "",
    "Inhalt",
    `  daten/    ${tabellen.length} CSV-Dateien mit zusammen ${zeilen} Zeilen`,
    `  dateien/  ${dateien} hinterlegte Dokumente und Fotos`,
    "",
    "Format der CSV-Dateien",
    "  Trennzeichen Semikolon, Dezimaltrennzeichen Komma, Kodierung UTF-8",
    "  mit BOM. So öffnet Excel sie unter Windows ohne Nacharbeit.",
    "",
    "Nicht enthalten",
    "  Die Zugangsdaten des eingehängten Postfachs und die Tokens der",
    "  Kundenportale. Beides sind Geheimnisse, die nicht in eine Datei",
    "  gehören, die weitergereicht wird.",
    "",
    "Beziehungen zwischen den Dateien laufen über die id-Spalten.",
    "",
    ...tabellen.map((t) => `  ${t.name.padEnd(24)} ${t.zeilen}`),
  ].join("\n");
}
