"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireMe } from "@/lib/session";

export type AbsenceState = { error: string | null; ok: string | null };

const KIND_LABEL: Record<string, string> = {
  vacation: "Urlaub",
  sick: "Krankenstand",
  leave_comp: "Zeitausgleich",
  care: "Pflegefreistellung",
  school: "Schulung",
  special: "Sonderurlaub",
};

const requestSchema = z
  .object({
    userId: z.string().uuid(),
    kind: z.enum(["vacation", "sick", "leave_comp", "care", "school", "special"]),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Von-Datum fehlt."),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Bis-Datum fehlt."),
    halfDay: z.string().optional(),
    note: z.string().trim().max(300).nullable(),
  })
  .refine((v) => v.to >= v.from, {
    message: "Das Ende darf nicht vor dem Beginn liegen.",
    path: ["to"],
  });

/*
 * Abwesenheit beantragen.
 *
 * Krankenstand ist ein Gesundheitsdatum nach Art. 9 DSGVO. Es gibt deshalb
 * kein Feld für den Grund — nur die Art (CLAUDE.md 12.b). Die Notiz ist
 * bewusst optional und für organisatorische Hinweise gedacht; bei Krankenstand
 * wird sie gar nicht erst angeboten.
 */
export async function requestAbsence(
  _prev: AbsenceState,
  formData: FormData,
): Promise<AbsenceState> {
  const me = await requireMe();

  const parsed = requestSchema.safeParse({
    userId: formData.get("userId") || me.id,
    kind: formData.get("kind"),
    from: formData.get("from"),
    to: formData.get("to"),
    halfDay: formData.get("halfDay") ?? undefined,
    note: (formData.get("note") as string) || null,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Eingabe fehlt.", ok: null };
  }

  if (parsed.data.userId !== me.id && me.perms.mitarbeiter !== "write") {
    return { error: "Keine Berechtigung, für andere zu beantragen.", ok: null };
  }

  const supabase = await createClient();

  // Überschneidung mit einer bestehenden Abwesenheit derselben Person.
  const { data: kollision } = await supabase
    .from("absence")
    .select("id, from_date, to_date, kind")
    .eq("user_id", parsed.data.userId)
    .neq("status", "rejected")
    .lte("from_date", parsed.data.to)
    .gte("to_date", parsed.data.from);

  if ((kollision ?? []).length > 0) {
    const k = kollision![0]!;
    return {
      error: `Überschneidet sich mit ${KIND_LABEL[k.kind as string] ?? k.kind} vom ${k.from_date as string} bis ${k.to_date as string}.`,
      ok: null,
    };
  }

  const { error } = await supabase.from("absence").insert({
    company_id: me.companyId,
    user_id: parsed.data.userId,
    kind: parsed.data.kind,
    from_date: parsed.data.from,
    to_date: parsed.data.to,
    half_day: parsed.data.halfDay === "ja",
    // Krankenstand wird gemeldet, nicht beantragt — er gilt sofort.
    status: parsed.data.kind === "sick" ? "approved" : "requested",
    note: parsed.data.kind === "sick" ? null : parsed.data.note,
    ...(parsed.data.kind === "sick"
      ? { decided_at: new Date().toISOString() }
      : {}),
  });

  if (error) return { error: `Antrag fehlgeschlagen: ${error.message}`, ok: null };

  revalidatePath("/abwesenheiten");
  revalidatePath("/planung");

  return {
    error: null,
    ok:
      parsed.data.kind === "sick"
        ? "Krankenstand erfasst."
        : "Antrag eingereicht.",
  };
}

const decideSchema = z.object({
  absenceId: z.string().uuid(),
  entscheidung: z.enum(["approved", "rejected"]),
});

export async function decideAbsence(
  _prev: AbsenceState,
  formData: FormData,
): Promise<AbsenceState> {
  const me = await requireMe();
  if (me.perms.mitarbeiter !== "write") {
    return { error: "Keine Berechtigung zu entscheiden.", ok: null };
  }

  const parsed = decideSchema.safeParse({
    absenceId: formData.get("absenceId"),
    entscheidung: formData.get("entscheidung"),
  });
  if (!parsed.success) return { error: "Ungültige Entscheidung.", ok: null };

  const supabase = await createClient();
  const { error } = await supabase
    .from("absence")
    .update({
      status: parsed.data.entscheidung,
      approver_id: me.id,
      decided_at: new Date().toISOString(),
    })
    .eq("id", parsed.data.absenceId)
    .eq("status", "requested");

  if (error) return { error: `Entscheidung fehlgeschlagen: ${error.message}`, ok: null };

  revalidatePath("/abwesenheiten");
  revalidatePath("/planung");
  return {
    error: null,
    ok: parsed.data.entscheidung === "approved" ? "Genehmigt." : "Abgelehnt.",
  };
}
