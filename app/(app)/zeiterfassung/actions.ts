"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { ausJson, pausenabzug, runde } from "@/lib/rules/zeitregeln";
import { requireMe } from "@/lib/session";
import { viennaClock } from "@/lib/time";

export type ActionState = { error: string | null; ok: string | null };

const bookingSchema = z
  .object({
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Datum fehlt."),
    from: z.string().regex(/^\d{2}:\d{2}$/, "Beginn fehlt."),
    to: z.string().regex(/^\d{2}:\d{2}$/, "Ende fehlt."),
    kind: z.enum(["work", "travel", "break", "errand", "training", "leave_comp"]),
    jobId: z.string().uuid().nullable(),
    userId: z.string().uuid(),
    note: z.string().max(500).nullable(),
  })
  .refine((v) => v.to > v.from, {
    message: "Das Ende muss nach dem Beginn liegen.",
    path: ["to"],
  });

/*
 * Zeitbuchung anlegen.
 *
 * duration_min wird NICHT übergeben — das ist eine Generated Column in der
 * Datenbank (CLAUDE.md Abschnitt 5.3). Käme die Dauer vom Client, könnte sich
 * jeder seine Stunden selbst schreiben.
 */
export async function createTimeEntry(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const me = await requireMe();

  const parsed = bookingSchema.safeParse({
    day: formData.get("day"),
    from: formData.get("from"),
    to: formData.get("to"),
    kind: formData.get("kind"),
    jobId: emptyToNull(formData.get("jobId")),
    userId: formData.get("userId") || me.id,
    note: emptyToNull(formData.get("note")),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Eingabe unvollständig.", ok: null };
  }

  const { day, from, to, kind, jobId, userId, note } = parsed.data;

  // Fremde Zeiten buchen darf nur, wer zeiterfassung schreiben darf.
  // Die Datenbank prüft das über die Policy zusätzlich.
  if (userId !== me.id && me.perms.zeiterfassung !== "write") {
    return { error: "Keine Berechtigung, für andere zu buchen.", ok: null };
  }

  const supabase = await createClient();

  const { data: firma } = await supabase
    .from("company")
    .select("time_settings")
    .eq("id", me.companyId)
    .maybeSingle();

  const regeln = ausJson(firma?.time_settings);

  const beginn = viennaClock(day, from);
  const rohMin = Math.round(
    (viennaClock(day, to).getTime() - beginn.getTime()) / 60000,
  );

  /*
   * Runden verändert das Ende, nicht den Beginn: der Arbeitstag hat
   * angefangen, wann er angefangen hat. Die gerundete Dauer steht danach
   * in duration_min, das die Datenbank selbst rechnet — der Client
   * bestimmt sie nach wie vor nicht (CLAUDE.md 5.3).
   */
  const gerundet = runde(rohMin, regeln);
  const ende = new Date(beginn.getTime() + gerundet * 60000);

  /*
   * Der Pausenabzug greift nur bei Arbeit. Eine Fahrt oder eine Schulung
   * bekommt keine Pause abgezogen, und eine gebuchte Pause schon gar nicht.
   * Angerechnet werden Pausen, die am selben Tag ohnehin gestempelt sind —
   * wer sich ausstempelt, zahlt sie nicht ein zweites Mal.
   */
  let autoPause = 0;
  if (kind === "work") {
    const { data: pausen } = await supabase
      .from("time_entry")
      .select("duration_min")
      .eq("user_id", userId)
      .eq("kind", "break")
      .gte("started_at", viennaClock(day, "00:00").toISOString())
      .lt("started_at", viennaClock(day, "23:59").toISOString());

    const gebucht = (pausen ?? []).reduce(
      (sum, p) => sum + Number(p.duration_min ?? 0),
      0,
    );
    autoPause = pausenabzug(gerundet, gebucht, regeln).abzugMin;
  }

  const { error } = await supabase.from("time_entry").insert({
    company_id: me.companyId,
    user_id: userId,
    vorgang_id: jobId,
    kind,
    started_at: beginn.toISOString(),
    ended_at: ende.toISOString(),
    auto_break_min: autoPause,
    note,
    status: "booked",
    created_by: me.id,
  });

  if (error) return { error: mapDbError(error.message), ok: null };

  revalidatePath("/zeiterfassung");
  revalidatePath("/stundenkonto");
  if (jobId) revalidatePath(`/vorgaenge/${jobId}`);

  /*
   * Was die Regeln verändert haben, steht in der Rückmeldung. Eine
   * Rundung, die stillschweigend Minuten wegnimmt, ist der schnellste Weg
   * zu einem Streit über den Stundenzettel.
   */
  const hinweise: string[] = [];
  if (gerundet !== rohMin) {
    hinweise.push(`auf ${regeln.rundungMin} Minuten gerundet`);
  }
  if (autoPause > 0) {
    hinweise.push(`${autoPause} Minuten Pause abgezogen`);
  }

  return {
    error: null,
    ok:
      hinweise.length > 0
        ? `Buchung gespeichert — ${hinweise.join(", ")}.`
        : "Buchung gespeichert.",
  };
}

const deleteSchema = z.object({ id: z.string().uuid() });

export async function deleteTimeEntry(formData: FormData): Promise<void> {
  const me = await requireMe();
  const parsed = deleteSchema.safeParse({ id: formData.get("id") });
  if (!parsed.success) return;

  const supabase = await createClient();
  // Genehmigte Buchungen werden nicht gelöscht — dafür gibt es die
  // Korrektur über time_correction (CLAUDE.md Abschnitt 5.4).
  await supabase
    .from("time_entry")
    .delete()
    .eq("id", parsed.data.id)
    .eq("user_id", me.id)
    .eq("status", "booked");

  revalidatePath("/zeiterfassung");
  revalidatePath("/stundenkonto");
}

function emptyToNull(v: FormDataEntryValue | null): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  return s === "" ? null : s;
}

function mapDbError(message: string): string {
  if (message.includes("time_entry_check")) {
    return "Das Ende muss nach dem Beginn liegen.";
  }
  if (message.includes("row-level security")) {
    return "Keine Berechtigung für diese Buchung.";
  }
  return `Speichern fehlgeschlagen: ${message}`;
}
