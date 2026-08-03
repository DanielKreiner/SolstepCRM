"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  checkRoster,
  DEFAULT_RULES,
  type Absence,
  type Shift,
} from "@/lib/rules/worktime";
import { offenePflichtGates, type Gate, type GateStatus } from "@/lib/vorgang/modell";
import { requireMe } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { viennaClock } from "@/lib/time";

export type TerminStatus = { error: string | null; ok: string | null };

/**
 * Terminierung — der Übergang nach `montage`.
 *
 * Sie passiert IM Vorgang, nicht in einem Planungsmodul: wer terminiert,
 * hat gerade den Kunden am Telefon und die Gates vor Augen. Das
 * Planungsboard ist danach nur eine zweite Ansicht derselben Termine.
 */

const terminSchema = z.object({
  vorgangId: z.string().uuid(),
  vonDatum: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Startdatum fehlt."),
  vonZeit: z.string().regex(/^\d{2}:\d{2}$/).optional().default("07:00"),
  bisDatum: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enddatum fehlt."),
  bisZeit: z.string().regex(/^\d{2}:\d{2}$/).optional().default("16:00"),
  team: z.string().optional().default(""),
  subText: z.string().trim().max(200).optional().default(""),
  notiz: z.string().trim().max(500).optional().default(""),
});

export async function montageTerminieren(
  _prev: TerminStatus,
  formData: FormData,
): Promise<TerminStatus> {
  const me = await requireMe();
  if (me.perms.pipelines !== "write") {
    return { error: "Für die Terminierung fehlt deiner Rolle das Schreibrecht.", ok: null };
  }
  if (me.company.status !== "active") {
    return { error: "Der Zugang ist derzeit nur lesend.", ok: null };
  }

  /*
   * Mehrfachauswahl kommt als wiederholtes Feld, nicht als ein Wert.
   * Object.fromEntries würde alle bis auf den letzten verschlucken.
   */
  const teamIds = formData
    .getAll("team")
    .map(String)
    .filter((v) => v.length > 0);

  const parsed = terminSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Eingabe fehlt.", ok: null };
  }
  const d = parsed.data;

  const von = viennaClock(d.vonDatum, d.vonZeit);
  const bis = viennaClock(d.bisDatum, d.bisZeit);
  if (bis.getTime() <= von.getTime()) {
    return { error: "Das Ende liegt vor dem Beginn.", ok: null };
  }

  const supabase = await createClient();

  const { data: v } = await supabase
    .from("vorgang")
    .select("id, number, phase")
    .eq("id", d.vorgangId)
    .maybeSingle();

  if (!v) return { error: "Vorgang nicht gefunden.", ok: null };

  /*
   * Die Gate-Prüfung steht hier und nicht nur am Knopf. Ein deaktivierter
   * Knopf ist eine Anzeige, keine Absicherung — und die Terminierung ist
   * der Punkt, an dem Material bestellt und Leute eingeplant werden.
   */
  const { data: gRoh } = await supabase
    .from("vorgang_gate")
    .select("key, label, status, blocking")
    .eq("vorgang_id", d.vorgangId);

  const gates: Gate[] = ((gRoh ?? []) as unknown as {
    key: string;
    label: string;
    status: GateStatus;
    blocking: boolean;
  }[]).map((g) => ({ ...g }));

  const offen = offenePflichtGates(gates);
  if (offen.length > 0) {
    return {
      error: `Terminierung blockiert. Offen: ${offen.map((g) => g.label).join(", ")}.`,
      ok: null,
    };
  }

  const { data: termin, error } = await supabase
    .from("vorgang_termin")
    .insert({
      company_id: me.companyId,
      vorgang_id: d.vorgangId,
      art: "montage",
      von: von.toISOString(),
      bis: bis.toISOString(),
      sub_text: d.subText || null,
      notiz: d.notiz || null,
      created_by: me.id,
    })
    .select("id")
    .single();

  if (error || !termin) {
    return { error: `Terminierung fehlgeschlagen: ${error?.message}`, ok: null };
  }

  if (teamIds.length > 0) {
    await supabase.from("vorgang_termin_person").insert(
      teamIds.map((uid) => ({
        termin_id: termin.id as string,
        user_id: uid,
        company_id: me.companyId,
      })),
    );
  }

  const gefunden = await konflikte(supabase, teamIds, von, bis, termin.id as string);

  if (v.phase === "beauftragt") {
    await supabase
      .from("vorgang")
      .update({
        phase: "montage",
        phase_seit: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", d.vorgangId);
  }

  await supabase.from("vorgang_event").insert({
    company_id: me.companyId,
    vorgang_id: d.vorgangId,
    typ: "termin",
    titel: "Montage terminiert",
    body: [
      `${d.vonDatum} ${d.vonZeit} bis ${d.bisDatum} ${d.bisZeit}.`,
      teamIds.length > 0 ? `${teamIds.length} Personen eingeteilt.` : "Noch niemand eingeteilt.",
      d.subText ? `Sub: ${d.subText}.` : "",
      d.notiz,
    ]
      .filter(Boolean)
      .join(" "),
    payload: { termin_id: termin.id, konflikte: gefunden },
    created_by: me.id,
  });

  revalidatePath(`/vorgaenge/${d.vorgangId}`);
  revalidatePath("/vorgaenge");
  revalidatePath("/planung");

  return {
    error: null,
    ok:
      gefunden.length > 0
        ? `Terminiert. Achtung — ${gefunden.join(" · ")}`
        : "Terminiert.",
  };
}

/** Termin verschieben — aus dem Vorgang oder aus dem Planungsboard. */
const verschiebenSchema = z.object({
  terminId: z.string().uuid(),
  vonDatum: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  vonZeit: z.string().regex(/^\d{2}:\d{2}$/).optional().default("07:00"),
  bisDatum: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  bisZeit: z.string().regex(/^\d{2}:\d{2}$/).optional().default("16:00"),
});

export async function terminVerschieben(
  _prev: TerminStatus,
  formData: FormData,
): Promise<TerminStatus> {
  const me = await requireMe();
  if (me.perms.pipelines !== "write") {
    return { error: "Keine Berechtigung.", ok: null };
  }

  const parsed = verschiebenSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Eingabe fehlt.", ok: null };
  }
  const d = parsed.data;

  const von = viennaClock(d.vonDatum, d.vonZeit);
  const bis = viennaClock(d.bisDatum, d.bisZeit);
  if (bis.getTime() <= von.getTime()) {
    return { error: "Das Ende liegt vor dem Beginn.", ok: null };
  }

  const supabase = await createClient();
  const { data: alt } = await supabase
    .from("vorgang_termin")
    .select("id, vorgang_id, von, bis")
    .eq("id", d.terminId)
    .maybeSingle();

  if (!alt) return { error: "Termin nicht gefunden.", ok: null };

  const { error } = await supabase
    .from("vorgang_termin")
    .update({ von: von.toISOString(), bis: bis.toISOString() })
    .eq("id", d.terminId);

  if (error) return { error: `Verschieben fehlgeschlagen: ${error.message}`, ok: null };

  await supabase.from("vorgang_event").insert({
    company_id: me.companyId,
    vorgang_id: alt.vorgang_id as string,
    typ: "termin",
    titel: "Termin verschoben",
    body: `Neu: ${d.vonDatum} ${d.vonZeit} bis ${d.bisDatum} ${d.bisZeit}.`,
    created_by: me.id,
  });

  revalidatePath(`/vorgaenge/${alt.vorgang_id as string}`);
  revalidatePath("/planung");
  return { error: null, ok: "Verschoben." };
}

/**
 * Wer ist im Zeitraum schon eingeteilt?
 *
 * Gibt Namen zurück, keine Wahrheit: die Entscheidung trifft der Betrieb.
 */
/*
 * Konfliktprüfung beim Terminieren.
 *
 * Bis zum Umbau lief die Arbeitszeitprüfung an der Freigabe des
 * Dienstplans in der Einsatzplanung. Die gibt es nicht mehr — terminiert
 * wird im Vorgang. Die Regeln wandern deshalb hierher, statt mit dem
 * Screen zu verschwinden: Ruhezeit und Höchstarbeitszeit sind keine
 * Komfortfunktion, sondern Haftung des Betriebs (CLAUDE.md Abschnitt 10,
 * ArbZG/AZG).
 *
 * Gemeldet, nicht geblockt (Briefing Abschnitt 7). Ein Betrieb weiss
 * manchmal selbst am besten, dass zwei Baustellen an einem Tag gehen —
 * aber er soll es bewusst tun und die Meldung im Vorgang stehen haben.
 */
async function konflikte(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userIds: string[],
  von: Date,
  bis: Date,
  ausserTermin: string,
): Promise<string[]> {
  if (userIds.length === 0) return [];

  const [{ data: zuordnungen }, { data: leute }, { data: abwesend }] =
    await Promise.all([
      supabase
        .from("vorgang_termin_person")
        .select("user_id, user:user_id ( name ), termin:termin_id ( id, von, bis )")
        .in("user_id", userIds),
      supabase.from("app_user").select("id, name").in("id", userIds),
      supabase
        .from("absence")
        .select("user_id, from_date, to_date, kind")
        .eq("status", "approved")
        .in("user_id", userIds),
    ]);

  const namen = new Map(
    (leute ?? []).map((u) => [u.id as string, u.name as string]),
  );

  const schichten: Shift[] = [];
  const meldungen: string[] = [];

  for (const z of (zuordnungen ?? []) as unknown as {
    user_id: string;
    user: { name: string } | null;
    termin: { id: string; von: string; bis: string } | null;
  }[]) {
    if (!z.termin || z.termin.id === ausserTermin) continue;
    schichten.push({
      id: z.termin.id,
      userId: z.user_id,
      start: z.termin.von,
      end: z.termin.bis,
    });
  }

  /* Der neue Termin gilt für jede eingeteilte Person. */
  for (const uid of userIds) {
    schichten.push({
      id: `neu-${uid}`,
      userId: uid,
      start: von.toISOString(),
      end: bis.toISOString(),
    });
  }

  const abwesenheiten: Absence[] = ((abwesend ?? []) as unknown as {
    user_id: string;
    from_date: string;
    to_date: string;
    kind: string;
  }[]).map((a) => ({
    userId: a.user_id,
    from: a.from_date,
    to: a.to_date,
    kind: a.kind,
  }));

  for (const k of checkRoster(schichten, DEFAULT_RULES, abwesenheiten)) {
    /* Nur was den neuen Termin betrifft — alte Verstösse sind alte Meldungen. */
    if (!k.shiftIds.some((id) => id.startsWith("neu-"))) continue;
    meldungen.push(`${namen.get(k.userId) ?? "Jemand"}: ${k.message}`);
  }

  return meldungen;
}
