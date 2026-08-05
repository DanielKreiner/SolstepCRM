import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PHASE_LABEL, type Phase } from "@/lib/vorgang/modell";

/**
 * Die Phase zieht mit, wenn die Arbeit sie überholt hat.
 *
 * Vorher musste jemand im Überblick einen Knopf drücken, obwohl die
 * Sache längst erledigt war: die Aufnahme war abgeschlossen, das
 * Angebot verschickt — und der Vorgang stand trotzdem eine Phase
 * zurück. Zwei Wahrheiten über denselben Vorgang, und die im Board
 * angezeigte war die falsche.
 *
 * Deshalb hier: wer die Arbeit tut, schiebt die Phase mit. Nur vorwärts
 * und nur aus den erwarteten Ausgangsphasen — ein Vorgang, der schon in
 * Montage ist, springt nicht zurück ins Angebot, bloss weil jemand das
 * Angebots-PDF noch einmal verschickt.
 *
 * Was NICHT hier passiert: die Annahme durch den Kunden. Die bleibt ein
 * ausdrücklicher Klick, weil sie eine Kaskade auslöst — Auftrag,
 * Anzahlungsrechnung, Materialliste, Gates. So etwas darf kein
 * Nebeneffekt sein.
 */
export async function phaseMitziehen(
  supabase: SupabaseClient,
  d: {
    companyId: string;
    vorgangId: string;
    userId: string;
    /** Nur aus diesen Phasen heraus wird geschoben. */
    aus: Phase[];
    nach: Phase;
    /** Was im Verlauf steht — der Grund, nicht der Vorgang. */
    grund: string;
  },
): Promise<void> {
  const { data: v } = await supabase
    .from("vorgang")
    .select("phase")
    .eq("id", d.vorgangId)
    .maybeSingle();

  const jetzt = v?.phase as Phase | undefined;
  if (!jetzt || !d.aus.includes(jetzt)) return;

  const { error } = await supabase
    .from("vorgang")
    .update({
      phase: d.nach,
      phase_seit: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", d.vorgangId)
    /*
     * Noch einmal gegen die Ausgangsphase: zwischen Lesen und Schreiben
     * kann jemand anderes den Vorgang bewegt haben, und dann wäre dieser
     * Schritt ein stiller Rückschritt.
     */
    .eq("phase", jetzt);

  if (error) return;

  await supabase.from("vorgang_event").insert({
    company_id: d.companyId,
    vorgang_id: d.vorgangId,
    typ: "phase_wechsel",
    titel: `Phase → ${PHASE_LABEL[d.nach]}`,
    body: d.grund,
    payload: { von: jetzt, nach: d.nach, automatisch: true },
    created_by: d.userId,
  });
}
