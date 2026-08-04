"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireMe } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

export type StoppStatus = { error: string | null; ok: string | null };

/*
 * Die Stopps eines Servicetags.
 *
 * Reihenfolge von Hand, Fahrzeit nur angezeigt — keine Optimierung
 * (Briefing 4). Ein PV-Betrieb fährt morgens auf eine Baustelle und
 * bleibt den Tag dort; der Servicetag mit mehreren Adressen ist die
 * Ausnahme, und dafür ist Routenplanung der falsche Kampf. Wer die
 * Gegend kennt, sortiert besser als ein Algorithmus ohne Kontext.
 */

async function zugang() {
  const me = await requireMe();
  if (me.perms.pipelines !== "write") {
    return {
      ok: false as const,
      status: { error: "Für die Planung fehlt deiner Rolle das Schreibrecht.", ok: null },
    };
  }
  if (me.company.status !== "active") {
    return {
      ok: false as const,
      status: { error: "Der Zugang ist derzeit nur lesend.", ok: null },
    };
  }
  return { ok: true as const, me };
}

const neuSchema = z.object({
  einsatzId: z.string().uuid(),
  name: z.string().trim().min(2, "Bitte den Stopp benennen.").max(120),
  adresse: z.string().trim().max(200).optional().default(""),
  uhrzeit: z.string().trim().max(5).optional().default(""),
});

export async function stoppAnlegen(
  _prev: StoppStatus,
  formData: FormData,
): Promise<StoppStatus> {
  const z1 = await zugang();
  if (!z1.ok) return z1.status;

  const parsed = neuSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Eingabe fehlt.", ok: null };
  }
  const d = parsed.data;

  const supabase = await createClient();
  const { data: letzter } = await supabase
    .from("einsatz_stopp")
    .select("sort")
    .eq("einsatz_id", d.einsatzId)
    .order("sort", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await supabase.from("einsatz_stopp").insert({
    company_id: z1.me.companyId,
    einsatz_id: d.einsatzId,
    name: d.name,
    adresse: d.adresse || null,
    uhrzeit: d.uhrzeit || null,
    sort: ((letzter?.sort as number | undefined) ?? 0) + 10,
  });

  if (error) return { error: `Anlegen fehlgeschlagen: ${error.message}`, ok: null };

  revalidatePath("/planung");
  return { error: null, ok: "Stopp ergänzt." };
}

export async function stoppWeg(
  _prev: StoppStatus,
  formData: FormData,
): Promise<StoppStatus> {
  const z1 = await zugang();
  if (!z1.ok) return z1.status;

  const id = z.string().uuid().safeParse(formData.get("stoppId"));
  if (!id.success) return { error: "Stopp fehlt.", ok: null };

  const supabase = await createClient();
  const { error } = await supabase.from("einsatz_stopp").delete().eq("id", id.data);
  if (error) return { error: `Löschen fehlgeschlagen: ${error.message}`, ok: null };

  revalidatePath("/planung");
  return { error: null, ok: "Stopp entfernt." };
}

/**
 * Einen Stopp um eine Stelle verschieben.
 *
 * Zwei Pfeile statt Ziehen: die Liste hat drei bis sechs Einträge und
 * wird einmal am Tag angefasst. Mit der Tastatur geht es so ohnehin
 * besser, und auf dem Tablet trifft ein Pfeil sicherer als ein Griff.
 */
export async function stoppSchieben(
  _prev: StoppStatus,
  formData: FormData,
): Promise<StoppStatus> {
  const z1 = await zugang();
  if (!z1.ok) return z1.status;

  const parsed = z
    .object({
      stoppId: z.string().uuid(),
      richtung: z.enum(["hoch", "runter"]),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Eingabe fehlt.", ok: null };
  const d = parsed.data;

  const supabase = await createClient();
  const { data: stopp } = await supabase
    .from("einsatz_stopp")
    .select("id, einsatz_id, sort")
    .eq("id", d.stoppId)
    .maybeSingle();

  if (!stopp) return { error: "Stopp nicht gefunden.", ok: null };

  const hoch = d.richtung === "hoch";
  const { data: nachbar } = await supabase
    .from("einsatz_stopp")
    .select("id, sort")
    .eq("einsatz_id", stopp.einsatz_id as string)
    [hoch ? "lt" : "gt"]("sort", stopp.sort as number)
    .order("sort", { ascending: !hoch })
    .limit(1)
    .maybeSingle();

  if (!nachbar) return { error: null, ok: "Steht schon ganz aussen." };

  /* Tauschen statt neu durchzählen — betrifft genau zwei Zeilen. */
  await supabase
    .from("einsatz_stopp")
    .update({ sort: nachbar.sort as number })
    .eq("id", stopp.id as string);
  await supabase
    .from("einsatz_stopp")
    .update({ sort: stopp.sort as number })
    .eq("id", nachbar.id as string);

  revalidatePath("/planung");
  return { error: null, ok: "Verschoben." };
}
