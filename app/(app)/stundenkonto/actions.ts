"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireMe } from "@/lib/session";
import { viennaClock } from "@/lib/time";

export type CorrectionState = { error: string | null; ok: string | null };

const requestSchema = z
  .object({
    entryId: z.string().uuid(),
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    from: z.string().regex(/^\d{2}:\d{2}$/, "Beginn fehlt."),
    to: z.string().regex(/^\d{2}:\d{2}$/, "Ende fehlt."),
    reason: z.string().trim().min(5, "Bitte kurz begründen."),
  })
  .refine((v) => v.to > v.from, {
    message: "Das Ende muss nach dem Beginn liegen.",
    path: ["to"],
  });

/*
 * Zeitkorrektur beantragen.
 *
 * CLAUDE.md 5.4: Korrekturen überschreiben nie. Der Antrag legt nur einen
 * time_correction-Datensatz an. Erst die Genehmigung erzeugt einen neuen
 * time_entry mit replaces_id, und der alte wird auf 'replaced' gesetzt —
 * nicht gelöscht. Eine Arbeitszeitaufzeichnung, die sich rückwirkend
 * spurlos ändern lässt, ist keine.
 */
export async function requestCorrection(
  _prev: CorrectionState,
  formData: FormData,
): Promise<CorrectionState> {
  const me = await requireMe();

  const parsed = requestSchema.safeParse({
    entryId: formData.get("entryId"),
    day: formData.get("day"),
    from: formData.get("from"),
    to: formData.get("to"),
    reason: formData.get("reason"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Eingabe fehlt.", ok: null };
  }

  const supabase = await createClient();

  const { data: entry } = await supabase
    .from("time_entry")
    .select("id, user_id, status")
    .eq("id", parsed.data.entryId)
    .maybeSingle();

  if (!entry) return { error: "Buchung nicht gefunden.", ok: null };
  if (entry.status === "replaced") {
    return { error: "Diese Buchung wurde bereits ersetzt.", ok: null };
  }

  const { error } = await supabase.from("time_correction").insert({
    company_id: me.companyId,
    time_entry_id: entry.id,
    user_id: me.id,
    requested_change_json: {
      started_at: viennaClock(parsed.data.day, parsed.data.from).toISOString(),
      ended_at: viennaClock(parsed.data.day, parsed.data.to).toISOString(),
    },
    reason: parsed.data.reason,
  });

  if (error) return { error: `Antrag fehlgeschlagen: ${error.message}`, ok: null };

  revalidatePath("/stundenkonto");
  return { error: null, ok: "Korrektur beantragt." };
}

const decideSchema = z.object({
  correctionId: z.string().uuid(),
  entscheidung: z.enum(["approved", "rejected"]),
  kommentar: z.string().trim().max(300).optional(),
});

export async function decideCorrection(
  _prev: CorrectionState,
  formData: FormData,
): Promise<CorrectionState> {
  const me = await requireMe();
  if (me.perms.zeiterfassung !== "write") {
    return { error: "Keine Berechtigung zu entscheiden.", ok: null };
  }

  const parsed = decideSchema.safeParse({
    correctionId: formData.get("correctionId"),
    entscheidung: formData.get("entscheidung"),
    kommentar: formData.get("kommentar") ?? undefined,
  });
  if (!parsed.success) return { error: "Ungültige Entscheidung.", ok: null };

  const supabase = await createClient();

  const { data: korrektur } = await supabase
    .from("time_correction")
    .select("id, time_entry_id, requested_change_json, status")
    .eq("id", parsed.data.correctionId)
    .maybeSingle();

  if (!korrektur) return { error: "Korrektur nicht gefunden.", ok: null };
  if (korrektur.status !== "requested") {
    return { error: "Über diese Korrektur wurde bereits entschieden.", ok: null };
  }

  const entscheiden = async () =>
    supabase
      .from("time_correction")
      .update({
        status: parsed.data.entscheidung,
        approver_id: me.id,
        approver_comment: parsed.data.kommentar || null,
        decided_at: new Date().toISOString(),
      })
      .eq("id", korrektur.id);

  if (parsed.data.entscheidung === "rejected") {
    const { error } = await entscheiden();
    if (error) return { error: `Entscheidung: ${error.message}`, ok: null };
    revalidatePath("/stundenkonto");
    return { error: null, ok: "Korrektur abgelehnt. Die Buchung bleibt." };
  }

  /*
   * Erst arbeiten, dann genehmigen.
   *
   * Andersherum stünde nach einem Fehler eine Korrektur auf "genehmigt", ohne
   * dass sich an der Zeitaufzeichnung etwas geändert hätte — und niemand
   * würde es merken. Genau das ist beim ersten Durchlauf passiert.
   */
  const { data: alt, error: selErr } = await supabase
    .from("time_entry")
    .select("id, company_id, user_id, vorgang_id, kind, note")
    .eq("id", korrektur.time_entry_id)
    .maybeSingle();

  if (selErr || !alt) {
    return {
      error: `Die ursprüngliche Buchung ist nicht lesbar${selErr ? `: ${selErr.message}` : "."}`,
      ok: null,
    };
  }

  const aenderung = korrektur.requested_change_json as {
    started_at: string;
    ended_at: string;
  };

  const { error: insErr } = await supabase.from("time_entry").insert({
    company_id: alt.company_id,
    user_id: alt.user_id,
    vorgang_id: alt.vorgang_id,
    kind: alt.kind,
    started_at: aenderung.started_at,
    ended_at: aenderung.ended_at,
    note: alt.note,
    status: "approved",
    replaces_id: alt.id,
    created_by: me.id,
  });

  if (insErr) {
    return { error: `Neue Buchung fehlgeschlagen: ${insErr.message}`, ok: null };
  }

  const { data: ersetzt, error: updErr } = await supabase
    .from("time_entry")
    .update({ status: "replaced" })
    .eq("id", alt.id)
    .select("id");

  if (updErr || (ersetzt ?? []).length === 0) {
    return {
      error: `Die alte Buchung konnte nicht auf ersetzt gesetzt werden${updErr ? `: ${updErr.message}` : "."}`,
      ok: null,
    };
  }

  const { error: decErr } = await entscheiden();
  if (decErr) return { error: `Entscheidung: ${decErr.message}`, ok: null };

  revalidatePath("/stundenkonto");
  revalidatePath("/zeiterfassung");
  return {
    error: null,
    ok: "Korrektur genehmigt. Die alte Buchung bleibt als ersetzt erhalten.",
  };
}
