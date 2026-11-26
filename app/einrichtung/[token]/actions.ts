"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  BUCKET_UNTERLAGEN as BUCKET,
  pfadName,
  pruefeUnterlage,
} from "@/lib/dateien/unterlagen";
import { einrichtungSession, linkPunkt } from "@/lib/einrichtung/zugang";
import { createAdminClient } from "@/lib/supabase/admin";

/*
 * Antworten über den Einrichtungslink — ohne Anmeldung.
 *
 * Jede Aktion hier bekommt den Token als ersten Parameter, serverseitig
 * gebunden, und prüft ihn selbst. Es gibt keine Session und damit kein
 * RLS: Was nicht in dieser Datei geprüft wird, ist nicht geprüft.
 *
 * Drei Dinge gelten in jeder Funktion:
 *   1. Token auflösen, sonst Abbruch — auch beim Schreiben, nicht nur
 *      beim Anzeigen der Seite.
 *   2. Die Punkt-Kennung aus dem Formular gegen den Mandanten des Tokens
 *      prüfen. Sie kommt vom Besucher und könnte auf einen fremden Punkt
 *      zeigen.
 *   3. Nur die Felder schreiben, die zu einer Antwort gehören. Keine
 *      Statusspielchen, kein company_id aus dem Formular.
 */

export type LinkState = { error: string | null; ok: string | null };

const ABGELAUFEN: LinkState = {
  error: "Dieser Link gilt nicht mehr. Bitte einen neuen anfordern.",
  ok: null,
};
const ZU_SCHNELL: LinkState = {
  error: "Zu viele Anfragen in kurzer Zeit. Bitte einen Moment warten.",
  ok: null,
};
const NUR_LESEN: LinkState = {
  error: "Der Zugang ist derzeit nur lesend.",
  ok: null,
};

async function sitzung(token: string) {
  const s = await einrichtungSession(token);
  if (s === "ungueltig") return { ok: false as const, status: ABGELAUFEN };
  if (s === "zu-viele") return { ok: false as const, status: ZU_SCHNELL };
  if (!s.schreibbar) return { ok: false as const, status: NUR_LESEN };
  return { ok: true as const, s };
}

const antwortSchema = z.object({
  id: z.string().uuid(),
  wert: z.string().trim().max(4000).optional().default(""),
  anmerkung: z.string().trim().max(1000).optional().default(""),
});

export async function linkSpeichern(
  token: string,
  _prev: LinkState,
  formData: FormData,
): Promise<LinkState> {
  const z1 = await sitzung(token);
  if (!z1.ok) return z1.status;

  const mehrfach = formData
    .getAll("wahl")
    .map((v) => String(v).trim())
    .filter(Boolean);

  const parsed = antwortSchema.safeParse({
    id: formData.get("id"),
    wert: mehrfach.length > 0 ? mehrfach.join(", ") : (formData.get("wert") ?? ""),
    anmerkung: formData.get("anmerkung") ?? "",
  });
  if (!parsed.success) return { error: "Eingabe fehlt.", ok: null };
  const d = parsed.data;

  const punkt = await linkPunkt(z1.s.companyId, d.id);
  if (!punkt) return { error: "Dieser Punkt gehört nicht zu diesem Link.", ok: null };

  const admin = createAdminClient();
  const istDatei = punkt.art === "datei";
  const beantwortet = d.wert.length > 0;

  const { error } = await admin
    .from("einrichtung_punkt")
    .update(
      istDatei
        ? { anmerkung: d.anmerkung || null }
        : {
            wert: d.wert || null,
            anmerkung: d.anmerkung || null,
            status: beantwortet ? "beantwortet" : "offen",
            beantwortet_am: beantwortet ? new Date().toISOString() : null,
            beantwortet_von: null,
            beantwortet_extern: beantwortet,
          },
    )
    .eq("company_id", z1.s.companyId)
    .eq("id", d.id);

  if (error) return { error: "Speichern fehlgeschlagen.", ok: null };

  revalidatePath(`/einrichtung/${token}`);
  revalidatePath("/einstellungen");
  return { error: null, ok: "Gespeichert." };
}

export async function linkEntfaellt(
  token: string,
  _prev: LinkState,
  formData: FormData,
): Promise<LinkState> {
  const z1 = await sitzung(token);
  if (!z1.ok) return z1.status;

  const parsed = z
    .object({ id: z.string().uuid(), zurueck: z.string().optional() })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Der Punkt ist nicht mehr da.", ok: null };

  const punkt = await linkPunkt(z1.s.companyId, parsed.data.id);
  if (!punkt) return { error: "Dieser Punkt gehört nicht zu diesem Link.", ok: null };

  const zurueck = parsed.data.zurueck === "ja";
  const admin = createAdminClient();

  const { error } = await admin
    .from("einrichtung_punkt")
    .update(
      zurueck
        ? { status: "offen", beantwortet_am: null, beantwortet_extern: false }
        : {
            status: "entfaellt",
            beantwortet_am: new Date().toISOString(),
            beantwortet_von: null,
            beantwortet_extern: true,
          },
    )
    .eq("company_id", z1.s.companyId)
    .eq("id", parsed.data.id);

  if (error) return { error: "Ändern fehlgeschlagen.", ok: null };

  revalidatePath(`/einrichtung/${token}`);
  revalidatePath("/einstellungen");
  return { error: null, ok: zurueck ? "Wieder offen." : "Als nicht nötig vermerkt." };
}

/**
 * Eine signierte Adresse zum Hochladen.
 *
 * Der Pfad entsteht hier und nie im Browser. Käme er von dort, zeigte er
 * mit einer geänderten Zeile in einen fremden Mandantenordner — und es
 * gibt auf diesem Weg keine Storage-Policy, die das noch abfinge, weil
 * der Service-Role-Client an RLS vorbeigeht.
 */
export async function linkDateiZiel(
  token: string,
  punktId: string,
  dateiname: string,
  mime: string,
  groesse: number,
): Promise<{ pfad: string; token: string } | { fehler: string }> {
  const z1 = await sitzung(token);
  if (!z1.ok) return { fehler: z1.status.error ?? "Kein Zugriff." };

  const id = z.string().uuid().safeParse(punktId);
  if (!id.success) return { fehler: "Der Punkt ist nicht mehr da." };

  const name = z.string().trim().min(1).max(200).safeParse(dateiname);
  if (!name.success) return { fehler: "Die Datei hat keinen brauchbaren Namen." };

  const pruefung = pruefeUnterlage(mime, groesse, name.data);
  if (!pruefung.ok) return { fehler: pruefung.grund };

  const punkt = await linkPunkt(z1.s.companyId, id.data);
  if (!punkt) return { fehler: "Dieser Punkt gehört nicht zu diesem Link." };

  const pfad = `${z1.s.companyId}/einrichtung/${id.data}/${randomUUID()}-${pfadName(
    name.data,
    pruefung.endung,
  )}`;

  const admin = createAdminClient();
  const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(pfad);
  if (error || !data) return { fehler: "Der Upload liess sich nicht vorbereiten." };

  return { pfad: data.path, token: data.token };
}

export async function linkDateiVermerken(
  token: string,
  daten: {
    punktId: string;
    pfad: string;
    dateiname: string;
    mime: string;
    groesse: number;
  },
): Promise<LinkState> {
  const z1 = await sitzung(token);
  if (!z1.ok) return z1.status;

  const parsed = z
    .object({
      punktId: z.string().uuid(),
      pfad: z.string().min(10).max(400),
      dateiname: z.string().trim().min(1).max(200),
      mime: z.string().max(120).optional().default(""),
      groesse: z.number().int().min(1),
    })
    .safeParse(daten);
  if (!parsed.success) return { error: "Angaben zur Datei fehlen.", ok: null };
  const d = parsed.data;

  if (!d.pfad.startsWith(`${z1.s.companyId}/einrichtung/${d.punktId}/`)) {
    return { error: "Der Dateipfad passt nicht zum Punkt.", ok: null };
  }

  const punkt = await linkPunkt(z1.s.companyId, d.punktId);
  if (!punkt) return { error: "Dieser Punkt gehört nicht zu diesem Link.", ok: null };

  const admin = createAdminClient();

  const { error } = await admin.from("einrichtung_datei").insert({
    company_id: z1.s.companyId,
    punkt_id: d.punktId,
    dateiname: d.dateiname,
    storage_path: d.pfad,
    mime: d.mime || null,
    groesse_bytes: d.groesse,
  });
  if (error) return { error: "Vermerken fehlgeschlagen.", ok: null };

  await admin
    .from("einrichtung_punkt")
    .update({
      status: "beantwortet",
      beantwortet_am: new Date().toISOString(),
      beantwortet_von: null,
      beantwortet_extern: true,
    })
    .eq("company_id", z1.s.companyId)
    .eq("id", d.punktId);

  revalidatePath(`/einrichtung/${token}`);
  revalidatePath("/einstellungen");
  return { error: null, ok: `„${d.dateiname}" liegt bei.` };
}

/**
 * Eine Datei wieder entfernen.
 *
 * Nur, solange niemand im Betrieb sie schon angesehen hat? Nein — wer
 * den Link hat, hat die Datei hochgeladen und darf sie auch ersetzen.
 * Eine falsche Datei, die nicht mehr weggeht, ist schlimmer: dann liegen
 * zwei da und niemand weiss, welche gilt.
 */
export async function linkDateiEntfernen(
  token: string,
  _prev: LinkState,
  formData: FormData,
): Promise<LinkState> {
  const z1 = await sitzung(token);
  if (!z1.ok) return z1.status;

  const id = z.string().uuid().safeParse(formData.get("id"));
  if (!id.success) return { error: "Die Datei ist nicht mehr da.", ok: null };

  const admin = createAdminClient();

  const { data: datei } = await admin
    .from("einrichtung_datei")
    .select("id, punkt_id, dateiname, storage_path")
    .eq("company_id", z1.s.companyId)
    .eq("id", id.data)
    .maybeSingle();

  if (!datei) return { error: "Die Datei ist nicht mehr da.", ok: null };

  const { error } = await admin
    .from("einrichtung_datei")
    .delete()
    .eq("company_id", z1.s.companyId)
    .eq("id", id.data);
  if (error) return { error: "Entfernen fehlgeschlagen.", ok: null };

  await admin.storage.from(BUCKET).remove([datei.storage_path as string]);

  const { count } = await admin
    .from("einrichtung_datei")
    .select("id", { count: "exact", head: true })
    .eq("punkt_id", datei.punkt_id as string);

  if ((count ?? 0) === 0) {
    await admin
      .from("einrichtung_punkt")
      .update({ status: "offen", beantwortet_am: null, beantwortet_extern: false })
      .eq("company_id", z1.s.companyId)
      .eq("id", datei.punkt_id as string);
  }

  revalidatePath(`/einrichtung/${token}`);
  revalidatePath("/einstellungen");
  return { error: null, ok: `„${datei.dateiname as string}" entfernt.` };
}
