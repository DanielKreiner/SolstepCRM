"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { KIND_TABLE, isKind } from "@/lib/pipeline";
import { createClient } from "@/lib/supabase/server";
import { requireMe } from "@/lib/session";

const schema = z.object({
  kind: z.string().refine(isKind, "Unbekannte Pipeline."),
  cardId: z.string().uuid(),
  phaseId: z.string().uuid(),
});

export type MoveResult = { ok: boolean; error: string | null };

/*
 * Phasenwechsel durch Ziehen einer Karte.
 *
 * Geschrieben wird auf die Fachtabelle, nicht auf die View — die View ist nur
 * ein Lesefenster. Die Zielphase wird gegen die Pipeline geprüft, sonst könnte
 * ein manipulierter Aufruf einen Auftrag in eine Vertriebsphase schieben.
 */
export async function moveCard(
  kind: string,
  cardId: string,
  phaseId: string,
): Promise<MoveResult> {
  const me = await requireMe();

  const parsed = schema.safeParse({ kind, cardId, phaseId });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Ungültig." };
  }

  if (me.perms.pipelines !== "write") {
    return { ok: false, error: "Keine Berechtigung, Phasen zu ändern." };
  }

  const supabase = await createClient();

  // Gehört die Zielphase zu genau dieser Pipeline dieses Mandanten?
  const { data: phase } = await supabase
    .from("pipeline_phase")
    .select("id, label, pipeline:pipeline_id ( kind )")
    .eq("id", parsed.data.phaseId)
    .maybeSingle();

  const phaseKind = (phase?.pipeline as unknown as { kind: string } | null)?.kind;
  if (!phase || phaseKind !== parsed.data.kind) {
    return { ok: false, error: "Zielphase gehört nicht zu dieser Pipeline." };
  }

  const table = KIND_TABLE[parsed.data.kind];
  const { error } = await supabase
    .from(table)
    .update({ phase_id: parsed.data.phaseId })
    .eq("id", parsed.data.cardId);

  if (error) {
    return { ok: false, error: `Phasenwechsel fehlgeschlagen: ${error.message}` };
  }

  revalidatePath(`/pipelines/${parsed.data.kind}`);
  revalidatePath("/cockpit");
  if (parsed.data.kind === "projekte") {
    revalidatePath(`/auftraege/${parsed.data.cardId}`);
    revalidatePath("/auftraege");
  }

  return { ok: true, error: null };
}
