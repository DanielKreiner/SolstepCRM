"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { AktionsStatus } from "@/components/ui/Formular";
import { pruefeSpanne } from "@/lib/zeiten/regeln";
import { requireMe } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { addDays, endOfViennaDay, startOfViennaDay } from "@/lib/time";

/*
 * Das Zeiten-Modul des Büros.
 *
 * Zeit entsteht auf genau zwei Wegen: gestempelt am Einsatz oder hier
 * nacherfasst. Der freie Dialog mit Person, Art und Uhrzeit ohne
 * Einsatzbezug ist weg — eine Zeit ohne Einsatz gehört niemandem, und
 * die Art kommt immer vom Einsatz.
 */

async function zugang() {
  const me = await requireMe();
  if (me.perms.zeiterfassung !== "write") {
    return {
      ok: false as const,
      status: { error: "Für Zeiten fehlt deiner Rolle das Schreibrecht.", ok: null },
    };
  }
  return { ok: true as const, me };
}

function frisch() {
  revalidatePath("/zeiten");
  revalidatePath("/m/zeiten");
}

/** Bestehende Zeiten einer Person am Tag — Grundlage der Überlappungsprüfung. */
async function spannenAmTag(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
  tag: string,
  ausser?: string,
): Promise<{ von: string; bis: string | null }[]> {
  const { data } = await supabase
    .from("time_entry")
    .select("id, started_at, ended_at")
    .eq("user_id", userId)
    .neq("status", "replaced")
    .gte("started_at", startOfViennaDay(tag).toISOString())
    .lte("started_at", endOfViennaDay(tag).toISOString());

  return ((data ?? []) as { id: string; started_at: string; ended_at: string | null }[])
    .filter((z) => z.id !== ausser)
    .map((z) => ({ von: z.started_at, bis: z.ended_at }));
}

/**
 * Nacherfassung für vergessenes Stempeln.
 *
 * Der Einsatz ist Pflicht. Gibt es keinen, legt die Mitarbeiter-App
 * einen internen an — hier wird aus der Liste des Tages gewählt.
 */
export async function nacherfassen(
  _prev: AktionsStatus,
  formData: FormData,
): Promise<AktionsStatus> {
  const z1 = await zugang();
  if (!z1.ok) return z1.status;

  const parsed = z
    .object({
      userId: z.string().uuid(),
      einsatzId: z.string().uuid(),
      tag: z.string().min(10),
      von: z.string().min(4),
      bis: z.string().min(4),
    })
    .safeParse(Object.fromEntries(formData));

  if (!parsed.success) {
    return { error: "Bitte Person, Einsatz und Uhrzeiten angeben.", ok: null };
  }
  const d = parsed.data;

  const von = viennaZeitpunkt(d.tag, d.von);
  const bis = viennaZeitpunkt(d.tag, d.bis);

  const supabase = await createClient();
  const bestehend = await spannenAmTag(supabase, d.userId, d.tag);

  const pruefung = pruefeSpanne(
    { von, bis, jetzt: new Date().toISOString(), inZukunftErlaubt: true },
    bestehend,
  );
  if (!pruefung.ok) return { error: pruefung.grund, ok: null };

  const { data: einsatz } = await supabase
    .from("einsatz")
    .select("id, vorgang_id")
    .eq("id", d.einsatzId)
    .maybeSingle();
  if (!einsatz) return { error: "Einsatz nicht gefunden.", ok: null };

  const dauer = Math.round(
    (new Date(bis).getTime() - new Date(von).getTime()) / 60_000,
  );

  const { error } = await supabase.from("time_entry").insert({
    company_id: z1.me.companyId,
    user_id: d.userId,
    einsatz_id: einsatz.id,
    vorgang_id: einsatz.vorgang_id,
    kind: "work",
    started_at: von,
    ended_at: bis,
    status: "booked",
    quelle: "manuell",
    auto_break_min: dauer >= 360 ? 30 : 0,
    created_by: z1.me.id,
  });

  if (error) return { error: `Nacherfassen fehlgeschlagen: ${error.message}`, ok: null };

  frisch();
  return { error: null, ok: "Zeit nachgetragen." };
}

/**
 * Eine Woche abschliessen.
 *
 * Erst genehmigte Zeiten zählen in den Saldo. Der Abschluss ist der
 * Moment, in dem jemand hinschaut — danach ist die Zahl verbindlich.
 */
export async function wocheGenehmigen(
  _prev: AktionsStatus,
  formData: FormData,
): Promise<AktionsStatus> {
  const z1 = await zugang();
  if (!z1.ok) return z1.status;

  const parsed = z
    .object({ userId: z.string().uuid(), montag: z.string().min(10) })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Eingabe fehlt.", ok: null };

  const supabase = await createClient();
  const von = startOfViennaDay(parsed.data.montag).toISOString();
  const bis = endOfViennaDay(addDays(parsed.data.montag, 6)).toISOString();

  /*
   * Laufende Zeiten bleiben aussen vor: eine Woche, in der noch jemand
   * eingestempelt ist, ist nicht abgeschlossen.
   */
  const { error } = await supabase
    .from("time_entry")
    .update({ status: "approved" })
    .eq("user_id", parsed.data.userId)
    .eq("status", "booked")
    .gte("started_at", von)
    .lte("started_at", bis);

  if (error) return { error: `Genehmigen fehlgeschlagen: ${error.message}`, ok: null };

  frisch();
  return { error: null, ok: "Woche genehmigt." };
}

/**
 * Eine Zeit korrigieren.
 *
 * Nie überschreiben: die alte Zeile bleibt als „ersetzt" stehen, die
 * neue verweist auf sie. Wer später fragt, warum aus sieben Stunden
 * acht wurden, sieht beides und die Begründung.
 */
export async function korrigieren(
  _prev: AktionsStatus,
  formData: FormData,
): Promise<AktionsStatus> {
  const z1 = await zugang();
  if (!z1.ok) return z1.status;

  const parsed = z
    .object({
      entryId: z.string().uuid(),
      von: z.string().min(4),
      bis: z.string().min(4),
      grund: z.string().trim().min(3, "Ohne Begründung wird nicht korrigiert."),
      /*
       * Nur der Genehmigungsweg setzt das. Wer einen Antrag genehmigt,
       * hat genau diese Uhrzeiten gerade angesehen — die Ersatzbuchung
       * noch einmal in den Wochenabschluss zu schicken, würde die eben
       * erteilte Freigabe still wieder einkassieren. Missbrauchen liesse
       * sich das Feld nur mit demselben Recht, das auch zum Genehmigen
       * berechtigt.
       */
      genehmigt: z.enum(["ja"]).optional(),
    })
    .safeParse(Object.fromEntries(formData));

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Eingabe fehlt.", ok: null };
  }
  const d = parsed.data;

  const supabase = await createClient();
  const { data: alt } = await supabase
    .from("time_entry")
    .select("id, user_id, einsatz_id, vorgang_id, kind, started_at")
    .eq("id", d.entryId)
    .maybeSingle();

  if (!alt) return { error: "Zeit nicht gefunden.", ok: null };

  const tag = (alt.started_at as string).slice(0, 10);
  const von = viennaZeitpunkt(tag, d.von);
  const bis = viennaZeitpunkt(tag, d.bis);

  const bestehend = await spannenAmTag(
    supabase,
    alt.user_id as string,
    tag,
    alt.id as string,
  );

  const pruefung = pruefeSpanne(
    { von, bis, jetzt: new Date().toISOString(), inZukunftErlaubt: true },
    bestehend,
  );
  if (!pruefung.ok) return { error: pruefung.grund, ok: null };

  const dauer = Math.round(
    (new Date(bis).getTime() - new Date(von).getTime()) / 60_000,
  );

  const { error: neuFehler } = await supabase.from("time_entry").insert({
    company_id: z1.me.companyId,
    user_id: alt.user_id,
    einsatz_id: alt.einsatz_id,
    vorgang_id: alt.vorgang_id,
    kind: alt.kind,
    started_at: von,
    ended_at: bis,
    status: d.genehmigt === "ja" ? "approved" : "booked",
    quelle: "korrektur",
    auto_break_min: dauer >= 360 ? 30 : 0,
    replaces_id: alt.id,
    note: d.grund,
    created_by: z1.me.id,
  });

  if (neuFehler) {
    return { error: `Korrektur fehlgeschlagen: ${neuFehler.message}`, ok: null };
  }

  await supabase
    .from("time_entry")
    .update({ status: "replaced" })
    .eq("id", alt.id);

  frisch();
  return { error: null, ok: "Korrigiert. Die alte Zeit bleibt sichtbar." };
}

/** Über einen Korrekturantrag entscheiden. */
export async function antragEntscheiden(
  _prev: AktionsStatus,
  formData: FormData,
): Promise<AktionsStatus> {
  const z1 = await zugang();
  if (!z1.ok) return z1.status;

  const parsed = z
    .object({
      antragId: z.string().uuid(),
      entscheidung: z.enum(["genehmigen", "ablehnen"]),
      kommentar: z.string().trim().max(300).optional().default(""),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Eingabe fehlt.", ok: null };

  const supabase = await createClient();
  const { data: antrag } = await supabase
    .from("time_correction")
    .select("id, time_entry_id, requested_change_json, reason, status")
    .eq("id", parsed.data.antragId)
    .maybeSingle();

  if (!antrag) return { error: "Antrag nicht gefunden.", ok: null };
  if (antrag.status !== "requested") {
    return { error: "Über den Antrag wurde schon entschieden.", ok: null };
  }

  if (parsed.data.entscheidung === "ablehnen") {
    await supabase
      .from("time_correction")
      .update({
        status: "rejected",
        approver_id: z1.me.id,
        approver_comment: parsed.data.kommentar || null,
        decided_at: new Date().toISOString(),
      })
      .eq("id", antrag.id);

    frisch();
    return { error: null, ok: "Antrag abgelehnt." };
  }

  /* Genehmigen heisst: die Korrektur wirklich durchführen. */
  const wunsch = (antrag.requested_change_json ?? {}) as {
    von?: string;
    bis?: string;
  };
  if (!wunsch.von || !wunsch.bis) {
    return { error: "Dem Antrag fehlen die neuen Uhrzeiten.", ok: null };
  }

  const daten = new FormData();
  daten.set("entryId", antrag.time_entry_id as string);
  daten.set("von", wunsch.von);
  daten.set("bis", wunsch.bis);
  daten.set("grund", (antrag.reason as string) ?? "Antrag genehmigt");
  daten.set("genehmigt", "ja");

  const ergebnis = await korrigieren({ error: null, ok: null }, daten);
  if (ergebnis.error) return ergebnis;

  await supabase
    .from("time_correction")
    .update({
      status: "approved",
      approver_id: z1.me.id,
      approver_comment: parsed.data.kommentar || null,
      decided_at: new Date().toISOString(),
    })
    .eq("id", antrag.id);

  frisch();
  return { error: null, ok: "Antrag genehmigt und Zeit korrigiert." };
}

/** „08:30" an einem Tag als Zeitpunkt in Ortszeit. */
function viennaZeitpunkt(tag: string, hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const probe = new Date(`${tag}T12:00:00Z`);
  const wien = new Date(
    probe.toLocaleString("en-US", { timeZone: "Europe/Vienna" }),
  );
  const versatzMin = Math.round((wien.getTime() - probe.getTime()) / 60000);

  const d = new Date(`${tag}T00:00:00Z`);
  d.setUTCMinutes(d.getUTCMinutes() + (h ?? 0) * 60 + (m ?? 0) - versatzMin);
  return d.toISOString();
}
