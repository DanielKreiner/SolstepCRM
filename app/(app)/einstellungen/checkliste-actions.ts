"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireMe } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

export type ChecklisteState = { error: string | null; ok: string | null };

/*
 * Die Checkliste für die Aufnahme vor Ort — als Stammdatum des Betriebs.
 *
 * Jeder Betrieb schaut vor Ort auf etwas anderes: der eine baut nur auf
 * Ziegel, der nächste hat Blechdächer und braucht die Falzbreite. Eine
 * feste Liste im Code wäre für die Hälfte der Betriebe falsch.
 */

export const TYPEN = [
  ["haken", "Abhaken"],
  ["text", "Textangabe"],
  ["zahl", "Zahl"],
  ["foto", "Foto"],
  ["datei", "Datei"],
] as const;

async function zugang() {
  const me = await requireMe();
  if (me.perms.einstellungen !== "write") {
    return {
      ok: false as const,
      status: { error: "Keine Berechtigung für Einstellungen.", ok: null },
    };
  }
  return { ok: true as const, me };
}

const punktSchema = z.object({
  vorlageId: z.string().uuid(),
  label: z.string().trim().min(2, "Bitte den Punkt benennen.").max(120),
  hinweis: z.string().trim().max(300).optional().default(""),
  typ: z.enum(["haken", "text", "zahl", "foto", "datei"]),
  pflicht: z.enum(["ja", "nein"]).optional().default("nein"),
});

export async function punktAnlegen(
  _prev: ChecklisteState,
  formData: FormData,
): Promise<ChecklisteState> {
  const z1 = await zugang();
  if (!z1.ok) return z1.status;

  const parsed = punktSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Eingabe fehlt.", ok: null };
  }
  const d = parsed.data;

  const supabase = await createClient();

  /* Ans Ende, in Zehnerschritten — damit später etwas dazwischenpasst. */
  const { data: letzter } = await supabase
    .from("checkliste_punkt_vorlage")
    .select("sort")
    .eq("vorlage_id", d.vorlageId)
    .order("sort", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await supabase.from("checkliste_punkt_vorlage").insert({
    company_id: z1.me.companyId,
    vorlage_id: d.vorlageId,
    label: d.label,
    hinweis: d.hinweis || null,
    typ: d.typ,
    pflicht: d.pflicht === "ja",
    sort: ((letzter?.sort as number | undefined) ?? 0) + 10,
  });

  if (error) return { error: `Anlegen fehlgeschlagen: ${error.message}`, ok: null };

  revalidatePath("/einstellungen");
  return { error: null, ok: "Punkt angelegt." };
}

const aendernSchema = punktSchema.omit({ vorlageId: true }).extend({
  punktId: z.string().uuid(),
});

export async function punktAendern(
  _prev: ChecklisteState,
  formData: FormData,
): Promise<ChecklisteState> {
  const z1 = await zugang();
  if (!z1.ok) return z1.status;

  const parsed = aendernSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Eingabe fehlt.", ok: null };
  }
  const d = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase
    .from("checkliste_punkt_vorlage")
    .update({
      label: d.label,
      hinweis: d.hinweis || null,
      typ: d.typ,
      pflicht: d.pflicht === "ja",
    })
    .eq("id", d.punktId);

  if (error) return { error: `Speichern fehlgeschlagen: ${error.message}`, ok: null };

  revalidatePath("/einstellungen");
  return {
    error: null,
    /*
     * Ehrlich sagen, was die Änderung nicht tut: bereits durchgeführte
     * Aufnahmen bleiben, wie sie waren (Punkte werden kopiert, nicht
     * verknüpft). Sonst sucht jemand die Änderung im laufenden Vorgang.
     */
    ok: "Gespeichert — gilt ab der nächsten Aufnahme.",
  };
}

export async function punktLoeschen(
  _prev: ChecklisteState,
  formData: FormData,
): Promise<ChecklisteState> {
  const z1 = await zugang();
  if (!z1.ok) return z1.status;

  const id = z.string().uuid().safeParse(formData.get("punktId"));
  if (!id.success) return { error: "Punkt fehlt.", ok: null };

  const supabase = await createClient();
  const { error } = await supabase
    .from("checkliste_punkt_vorlage")
    .delete()
    .eq("id", id.data);

  if (error) return { error: `Löschen fehlgeschlagen: ${error.message}`, ok: null };

  revalidatePath("/einstellungen");
  return { error: null, ok: "Punkt entfernt." };
}

const schiebenSchema = z.object({
  punktId: z.string().uuid(),
  richtung: z.enum(["hoch", "runter"]),
});

/**
 * Reihenfolge ändern.
 *
 * Zwei Knöpfe statt Ziehen: die Liste steht in den Einstellungen und
 * wird selten angefasst — für die zwei Klicks im Jahr lohnt kein
 * Drag&Drop, und mit Tastatur geht es ohnehin besser.
 */
export async function punktSchieben(
  _prev: ChecklisteState,
  formData: FormData,
): Promise<ChecklisteState> {
  const z1 = await zugang();
  if (!z1.ok) return z1.status;

  const parsed = schiebenSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Eingabe fehlt.", ok: null };
  const d = parsed.data;

  const supabase = await createClient();
  const { data: punkt } = await supabase
    .from("checkliste_punkt_vorlage")
    .select("id, vorlage_id, sort")
    .eq("id", d.punktId)
    .maybeSingle();

  if (!punkt) return { error: "Punkt nicht gefunden.", ok: null };

  const hoch = d.richtung === "hoch";
  const { data: nachbar } = await supabase
    .from("checkliste_punkt_vorlage")
    .select("id, sort")
    .eq("vorlage_id", punkt.vorlage_id as string)
    [hoch ? "lt" : "gt"]("sort", punkt.sort as number)
    .order("sort", { ascending: !hoch })
    .limit(1)
    .maybeSingle();

  if (!nachbar) return { error: null, ok: "Steht schon ganz aussen." };

  /* Tauschen, nicht neu durchzählen — betrifft genau zwei Zeilen. */
  await supabase
    .from("checkliste_punkt_vorlage")
    .update({ sort: nachbar.sort as number })
    .eq("id", punkt.id as string);
  await supabase
    .from("checkliste_punkt_vorlage")
    .update({ sort: punkt.sort as number })
    .eq("id", nachbar.id as string);

  revalidatePath("/einstellungen");
  return { error: null, ok: "Verschoben." };
}
