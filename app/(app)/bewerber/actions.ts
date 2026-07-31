"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireMe } from "@/lib/session";
import { STUFEN } from "@/lib/applicants";

export type ApplicantState = { error: string | null; ok: string | null };

const addSchema = z.object({
  name: z.string().trim().min(2, "Name fehlt.").max(80),
  position: z.string().trim().min(2, "Position fehlt.").max(80),
  email: z.string().trim().email("E-Mail ist ungültig.").nullable(),
  phone: z.string().trim().max(40).nullable(),
});

export async function addApplicant(
  _prev: ApplicantState,
  formData: FormData,
): Promise<ApplicantState> {
  const me = await requireMe();
  if (me.perms.mitarbeiter !== "write") {
    return { error: "Keine Berechtigung für Bewerber.", ok: null };
  }

  const parsed = addSchema.safeParse({
    name: formData.get("name"),
    position: formData.get("position"),
    email: (formData.get("email") as string) || null,
    phone: (formData.get("phone") as string) || null,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Eingabe fehlt.", ok: null };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("applicant").insert({
    company_id: me.companyId,
    name: parsed.data.name,
    position: parsed.data.position,
    email: parsed.data.email,
    phone: parsed.data.phone,
    stage: "neu",
  });

  if (error) return { error: `Anlegen fehlgeschlagen: ${error.message}`, ok: null };

  revalidatePath("/bewerber");
  return { error: null, ok: `${parsed.data.name} aufgenommen.` };
}

const moveSchema = z.object({
  applicantId: z.string().uuid(),
  stage: z.enum(STUFEN),
});

export async function moveApplicant(
  _prev: ApplicantState,
  formData: FormData,
): Promise<ApplicantState> {
  const me = await requireMe();
  if (me.perms.mitarbeiter !== "write") {
    return { error: "Keine Berechtigung für Bewerber.", ok: null };
  }

  const parsed = moveSchema.safeParse({
    applicantId: formData.get("applicantId"),
    stage: formData.get("stage"),
  });
  if (!parsed.success) return { error: "Ungültige Stufe.", ok: null };

  const supabase = await createClient();
  const { error } = await supabase
    .from("applicant")
    .update({ stage: parsed.data.stage })
    .eq("id", parsed.data.applicantId);

  if (error) return { error: `Speichern fehlgeschlagen: ${error.message}`, ok: null };

  revalidatePath("/bewerber");
  return { error: null, ok: "Verschoben." };
}
