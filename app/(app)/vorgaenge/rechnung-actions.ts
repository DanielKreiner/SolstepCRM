"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { anzahlung, summen } from "@/lib/vorgang/modell";
import { requireMe } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

export type RechnungStatus = { error: string | null; ok: string | null };

/**
 * Rechnungen am Vorgang — Anzahlung, Schluss, Zahlung.
 *
 * Kein Fibu-Modul (Briefing Abschnitt 8). Was hier entsteht, ist ein
 * Dokument mit Betrag, Fälligkeit und drei Zuständen:
 * entwurf → versendet → bezahlt. Alles Weitere macht die Buchhaltung.
 */

type Zugang =
  | { ok: true; me: Awaited<ReturnType<typeof requireMe>> }
  | { ok: false; status: RechnungStatus };

async function zugang(): Promise<Zugang> {
  const me = await requireMe();
  if (me.perms.rechnungen !== "write") {
    return {
      ok: false,
      status: { error: "Für Rechnungen fehlt deiner Rolle das Schreibrecht.", ok: null },
    };
  }
  if (me.company.status !== "active") {
    return { ok: false, status: { error: "Der Zugang ist derzeit nur lesend.", ok: null } };
  }
  return { ok: true, me };
}

function frisch(vorgangId: string): void {
  revalidatePath(`/vorgaenge/${vorgangId}`);
  revalidatePath("/offene-posten");
  revalidatePath("/vorgaenge");
}

/* ------------------------------------------------- SCHLUSSRECHNUNG */

const schlussSchema = z.object({ vorgangId: z.string().uuid() });

/**
 * Schlussrechnung: Auftragswert minus Anzahlung.
 *
 * Die Positionen kommen aus der angenommenen Fassung, nicht aus dem
 * lebenden Entwurf — sonst rechnet die Schlussrechnung etwas ab, das nie
 * beauftragt war.
 */
export async function schlussrechnungErstellen(
  _prev: RechnungStatus,
  formData: FormData,
): Promise<RechnungStatus> {
  const z1 = await zugang();
  if (!z1.ok) return z1.status;

  const parsed = schlussSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Eingabe fehlt.", ok: null };
  const { vorgangId } = parsed.data;

  const supabase = await createClient();

  const { data: v } = await supabase
    .from("vorgang")
    .select("id, number, phase, anzahlung_prozent")
    .eq("id", vorgangId)
    .maybeSingle();

  if (!v) return { error: "Vorgang nicht gefunden.", ok: null };
  if (v.phase !== "abschluss" && v.phase !== "montage") {
    return {
      error: "Eine Schlussrechnung gibt es erst, wenn die Montage läuft oder fertig ist.",
      ok: null,
    };
  }

  const { data: schonDa } = await supabase
    .from("vorgang_dokument")
    .select("id, nummer")
    .eq("vorgang_id", vorgangId)
    .eq("typ", "schlussrechnung")
    .maybeSingle();

  if (schonDa) {
    return {
      error: null,
      ok: `Schlussrechnung ${schonDa.nummer as string} besteht bereits.`,
    };
  }

  /* Die eingefrorene Fassung: das ist der Auftrag. */
  const { data: ab } = await supabase
    .from("vorgang_dokument")
    .select("id")
    .eq("vorgang_id", vorgangId)
    .eq("typ", "ab")
    .maybeSingle();

  if (!ab) {
    return { error: "Ohne Auftragsbestätigung gibt es keinen Auftragswert.", ok: null };
  }

  const { data: posRoh } = await supabase
    .from("vorgang_position")
    .select("menge, ep_netto, ust_satz, kalk_stunden, kalk_ek, ist_material")
    .eq("dokument_id", ab.id);

  const s = summen(
    ((posRoh ?? []) as unknown as {
      menge: string;
      ep_netto: string;
      ust_satz: string;
      kalk_stunden: string | null;
      kalk_ek: string | null;
      ist_material: boolean;
    }[]).map((p) => ({
      menge: Number(p.menge),
      epNetto: Number(p.ep_netto),
      ustSatz: Number(p.ust_satz),
      kalkStunden: p.kalk_stunden === null ? null : Number(p.kalk_stunden),
      kalkEk: p.kalk_ek === null ? null : Number(p.kalk_ek),
      istMaterial: p.ist_material,
    })),
  );

  /*
   * Abgezogen wird die tatsächlich gestellte Anzahlung, nicht der
   * Prozentsatz von heute. Ändert jemand nachträglich die 30 auf 40, darf
   * die Schlussrechnung nicht plötzlich zu wenig fordern.
   */
  const { data: anz } = await supabase
    .from("vorgang_dokument")
    .select("betrag_brutto")
    .eq("vorgang_id", vorgangId)
    .eq("typ", "anzahlungsrechnung")
    .maybeSingle();

  const anzahlungBrutto = anz?.betrag_brutto
    ? Number(anz.betrag_brutto)
    : anzahlung(s.brutto, Number(v.anzahlung_prozent)).anzahlungBrutto;

  const rest = Math.round((s.brutto - anzahlungBrutto) * 100) / 100;
  if (rest <= 0) {
    return {
      error: "Die Anzahlung deckt den Auftragswert bereits ab — keine Schlussrechnung nötig.",
      ok: null,
    };
  }

  const { data: nr } = await supabase.rpc("next_number", {
    p_company: z1.me.companyId,
    p_kind: "invoice",
  });
  if (typeof nr !== "string") {
    return { error: "Nummer konnte nicht vergeben werden.", ok: null };
  }

  const faellig = new Date();
  faellig.setDate(faellig.getDate() + 14);

  const { data: dok, error } = await supabase
    .from("vorgang_dokument")
    .insert({
      company_id: z1.me.companyId,
      vorgang_id: vorgangId,
      typ: "schlussrechnung",
      nummer: nr,
      dateiname: `Schlussrechnung ${nr}.pdf`,
      betrag_netto: Math.round((rest / 1.2) * 100) / 100,
      betrag_brutto: rest,
      status: "entwurf",
      faellig_am: faellig.toISOString().slice(0, 10),
      created_by: z1.me.id,
    })
    .select("id")
    .single();

  if (error || !dok) {
    return { error: `Anlegen fehlgeschlagen: ${error?.message}`, ok: null };
  }

  await supabase.from("vorgang_event").insert({
    company_id: z1.me.companyId,
    vorgang_id: vorgangId,
    typ: "rechnung",
    titel: `Schlussrechnung ${nr} erstellt`,
    body: `${fmt(s.brutto)} brutto minus Anzahlung ${fmt(anzahlungBrutto)} = ${fmt(rest)}. Zahlungsziel 14 Tage.`,
    dokument_id: dok.id,
    created_by: z1.me.id,
  });

  frisch(vorgangId);
  return { error: null, ok: `Schlussrechnung ${nr} über ${fmt(rest)} erstellt.` };
}

/* -------------------------------------------------------- VERSENDEN */

const versandSchema = z.object({
  vorgangId: z.string().uuid(),
  dokumentId: z.string().uuid(),
});

export async function rechnungVersenden(
  _prev: RechnungStatus,
  formData: FormData,
): Promise<RechnungStatus> {
  const z1 = await zugang();
  if (!z1.ok) return z1.status;

  const parsed = versandSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Eingabe fehlt.", ok: null };
  const d = parsed.data;

  const supabase = await createClient();
  const { data: dok } = await supabase
    .from("vorgang_dokument")
    .select("id, typ, nummer, status, betrag_brutto")
    .eq("id", d.dokumentId)
    .eq("vorgang_id", d.vorgangId)
    .maybeSingle();

  if (!dok) return { error: "Dokument nicht gefunden.", ok: null };
  if (dok.status !== "entwurf") {
    return { error: `Der Beleg ist bereits ${dok.status as string}.`, ok: null };
  }

  const { error } = await supabase
    .from("vorgang_dokument")
    .update({ status: "versendet" })
    .eq("id", d.dokumentId);

  if (error) return { error: `Versand fehlgeschlagen: ${error.message}`, ok: null };

  await supabase.from("vorgang_event").insert({
    company_id: z1.me.companyId,
    vorgang_id: d.vorgangId,
    typ: "rechnung",
    titel: `${dok.nummer as string} versendet`,
    body: `${fmt(Number(dok.betrag_brutto ?? 0))} brutto an den Kunden.`,
    dokument_id: dok.id,
    created_by: z1.me.id,
  });

  frisch(d.vorgangId);
  return { error: null, ok: "Als versendet vermerkt." };
}

/* ---------------------------------------------------------- ZAHLUNG */

const zahlungSchema = z.object({
  vorgangId: z.string().uuid(),
  dokumentId: z.string().uuid(),
  bezahltAm: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Datum fehlt."),
  betrag: z.coerce.number().min(0).optional(),
});

/**
 * Zahlung erfassen.
 *
 * Datum und Betrag, mehr nicht. Eine Teilzahlung wird als solche
 * vermerkt, aber der Beleg bleibt offen — sonst verschwindet ein
 * Restbetrag aus der Offene-Posten-Liste, den noch jemand eintreiben muss.
 */
export async function zahlungErfassen(
  _prev: RechnungStatus,
  formData: FormData,
): Promise<RechnungStatus> {
  const z1 = await zugang();
  if (!z1.ok) return z1.status;

  const parsed = zahlungSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Eingabe fehlt.", ok: null };
  }
  const d = parsed.data;

  const supabase = await createClient();
  const { data: dok } = await supabase
    .from("vorgang_dokument")
    .select("id, nummer, status, betrag_brutto")
    .eq("id", d.dokumentId)
    .eq("vorgang_id", d.vorgangId)
    .maybeSingle();

  if (!dok) return { error: "Beleg nicht gefunden.", ok: null };
  if (dok.status === "bezahlt") {
    return { error: null, ok: "Der Beleg ist bereits als bezahlt vermerkt." };
  }

  const soll = Number(dok.betrag_brutto ?? 0);
  const gezahlt = d.betrag ?? soll;
  const vollstaendig = gezahlt >= soll - 0.005;

  const { error } = await supabase
    .from("vorgang_dokument")
    .update({
      status: vollstaendig ? "bezahlt" : "versendet",
      bezahlt_am: vollstaendig ? d.bezahltAm : null,
    })
    .eq("id", d.dokumentId);

  if (error) return { error: `Fehlgeschlagen: ${error.message}`, ok: null };

  await supabase.from("vorgang_event").insert({
    company_id: z1.me.companyId,
    vorgang_id: d.vorgangId,
    typ: "zahlung",
    titel: vollstaendig
      ? `Zahlung erfasst — ${dok.nummer as string}`
      : `Teilzahlung erfasst — ${dok.nummer as string}`,
    body: vollstaendig
      ? `${fmt(gezahlt)} am ${d.bezahltAm}.`
      : `${fmt(gezahlt)} von ${fmt(soll)} am ${d.bezahltAm}. Der Beleg bleibt offen.`,
    dokument_id: dok.id,
    created_by: z1.me.id,
  });

  frisch(d.vorgangId);
  return {
    error: null,
    ok: vollstaendig
      ? "Zahlung erfasst."
      : `Teilzahlung vermerkt. Offen bleiben ${fmt(soll - gezahlt)}.`,
  };
}

/* ----------------------------------------------------- ABSCHLIESSEN */

/**
 * Vorgang abschliessen.
 *
 * Nur wenn nichts mehr offen ist. Ein abgeschlossener Vorgang mit
 * unbezahlter Rechnung verschwindet aus dem Blick und fällt erst beim
 * Jahresabschluss auf.
 */
export async function vorgangAbschliessen(
  _prev: RechnungStatus,
  formData: FormData,
): Promise<RechnungStatus> {
  const me = await requireMe();
  if (me.perms.pipelines !== "write") {
    return { error: "Keine Berechtigung.", ok: null };
  }

  const parsed = schlussSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Eingabe fehlt.", ok: null };
  const { vorgangId } = parsed.data;

  const supabase = await createClient();

  const { data: offen } = await supabase
    .from("vorgang_dokument")
    .select("nummer, status")
    .eq("vorgang_id", vorgangId)
    .in("typ", ["anzahlungsrechnung", "schlussrechnung"])
    .neq("status", "bezahlt");

  if ((offen ?? []).length > 0) {
    return {
      error: `Noch offen: ${(offen ?? [])
        .map((o) => o.nummer as string)
        .join(", ")}. Zuerst die Zahlung erfassen.`,
      ok: null,
    };
  }

  const { data: gates } = await supabase
    .from("vorgang_gate")
    .select("label, status")
    .eq("vorgang_id", vorgangId)
    .not("status", "in", "(erledigt,nicht_noetig)");

  await supabase.from("vorgang_event").insert({
    company_id: me.companyId,
    vorgang_id: vorgangId,
    typ: "phase_wechsel",
    titel: "Vorgang abgeschlossen",
    body:
      (gates ?? []).length > 0
        ? `Keine offenen Rechnungen. Noch offene Gates: ${(gates ?? [])
            .map((g) => g.label as string)
            .join(", ")}.`
        : "Keine offenen Gates, keine offenen Rechnungen.",
    created_by: me.id,
  });

  await supabase
    .from("vorgang")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", vorgangId);

  frisch(vorgangId);
  return { error: null, ok: "Vorgang abgeschlossen." };
}

function fmt(n: number): string {
  return `${n.toLocaleString("de-AT", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} €`;
}
