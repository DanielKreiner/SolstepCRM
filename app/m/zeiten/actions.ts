"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { AktionsStatus } from "@/components/ui/Formular";
import { requireMe } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

/*
 * Korrektur beantragen.
 *
 * Der Mitarbeiter ändert seine Zeit nicht selbst — er sagt, was falsch
 * ist und warum. Entschieden wird im Büro. Das ist keine Bevormundung:
 * eine Zeit, die sich nachträglich still ändern lässt, ist als Nachweis
 * wertlos.
 */
export async function korrekturBeantragen(
  _prev: AktionsStatus,
  formData: FormData,
): Promise<AktionsStatus> {
  const me = await requireMe();

  const parsed = z
    .object({
      entryId: z.string().uuid(),
      von: z.string().min(4),
      bis: z.string().min(4),
      grund: z
        .string()
        .trim()
        .min(5, "Schreib kurz, was nicht stimmt — sonst kann das Büro nicht entscheiden."),
    })
    .safeParse(Object.fromEntries(formData));

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Eingabe fehlt.", ok: null };
  }
  const d = parsed.data;

  const supabase = await createClient();

  /* Nur die eigene Zeit — fremde gehen niemanden etwas an. */
  const { data: eintrag } = await supabase
    .from("time_entry")
    .select("id, user_id, status")
    .eq("id", d.entryId)
    .maybeSingle();

  if (!eintrag || eintrag.user_id !== me.id) {
    return { error: "Diese Zeit gehört dir nicht.", ok: null };
  }
  if (eintrag.status === "replaced") {
    return { error: "Diese Zeit wurde bereits ersetzt.", ok: null };
  }

  const { count } = await supabase
    .from("time_correction")
    .select("id", { count: "exact", head: true })
    .eq("time_entry_id", d.entryId)
    .eq("status", "requested");

  if ((count ?? 0) > 0) {
    return { error: "Für diese Zeit läuft schon ein Antrag.", ok: null };
  }

  const { error } = await supabase.from("time_correction").insert({
    company_id: me.companyId,
    time_entry_id: d.entryId,
    user_id: me.id,
    requested_change_json: { von: d.von, bis: d.bis },
    reason: d.grund,
    status: "requested",
  });

  if (error) return { error: `Antrag fehlgeschlagen: ${error.message}`, ok: null };

  revalidatePath("/m/zeiten");
  revalidatePath("/zeiten");
  return { error: null, ok: "Antrag ist beim Büro." };
}
