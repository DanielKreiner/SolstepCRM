"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireMe } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { ANBIETER } from "@/lib/planer/anbieter";
import { ZOOM_GRENZEN } from "@/lib/planer/geo";

export type PlanerState = { error: string | null; ok: string | null; id?: string };

/*
 * Schreiben am Planer.
 *
 * Der Rechtecheck steht hier zusätzlich zur RLS-Policy — nicht statt
 * ihrer. Die Policy ist die Grenze, das hier ist die verständliche
 * Fehlermeldung: ohne sie bekäme die Bauleitung bei fehlendem Recht
 * einen leeren Datenbankfehler statt eines Satzes.
 */
async function zugang() {
  const me = await requireMe();
  if (me.perms.planer !== "write") {
    return {
      ok: false as const,
      status: { error: "Zum Planen fehlt die Berechtigung.", ok: null },
    };
  }
  return { ok: true as const, me };
}

const anlegenSchema = z.object({
  name: z.string().trim().min(1, "Ohne Namen findet das Projekt später niemand.").max(120),
  adresse: z.string().trim().max(240).optional().default(""),
  lat: z.coerce.number().min(-85.05112878).max(85.05112878),
  lon: z.coerce.number().min(-180).max(180),
});

export async function projektAnlegen(_prev: PlanerState, formData: FormData): Promise<PlanerState> {
  const z1 = await zugang();
  if (!z1.ok) return z1.status;

  const geprueft = anlegenSchema.safeParse({
    name: formData.get("name"),
    adresse: formData.get("adresse"),
    lat: formData.get("lat"),
    lon: formData.get("lon"),
  });
  if (!geprueft.success) {
    return { error: geprueft.error.issues[0]?.message ?? "Eingabe unvollständig.", ok: null };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("planer_projekt")
    .insert({
      company_id: z1.me.companyId,
      name: geprueft.data.name,
      adresse: geprueft.data.adresse || null,
      ursprung_lat: geprueft.data.lat,
      ursprung_lon: geprueft.data.lon,
      erstellt_von: z1.me.id,
    })
    .select("id")
    .single();

  if (error || !data) return { error: "Projekt konnte nicht angelegt werden.", ok: null };

  revalidatePath("/planer");
  return { error: null, ok: "Projekt angelegt.", id: (data as { id: string }).id };
}

const ANBIETER_IDS = ANBIETER.map((a) => a.id) as [string, ...string[]];

const ansichtSchema = z.object({
  id: z.string().uuid(),
  anbieter: z.enum(ANBIETER_IDS),
  zoom: z.coerce.number().min(ZOOM_GRENZEN.min).max(ZOOM_GRENZEN.max),
});

/**
 * Zuletzt gesehener Ausschnitt. Autosave ruft das gedrosselt auf, damit
 * ein Projekt dort aufgeht, wo es verlassen wurde.
 *
 * Bewusst ohne revalidatePath: das läuft im Hintergrund während des
 * Planens, ein Seitenneuaufbau würde die Leinwand mitten im Zoomen
 * zurücksetzen.
 */
export async function ansichtMerken(daten: {
  id: string;
  anbieter: string;
  zoom: number;
}): Promise<{ ok: boolean }> {
  const z1 = await zugang();
  if (!z1.ok) return { ok: false };

  const geprueft = ansichtSchema.safeParse(daten);
  if (!geprueft.success) return { ok: false };

  const supabase = await createClient();
  const { error } = await supabase
    .from("planer_projekt")
    .update({ anbieter: geprueft.data.anbieter, zoom: geprueft.data.zoom })
    .eq("id", geprueft.data.id);

  return { ok: !error };
}

export async function projektLoeschen(_prev: PlanerState, formData: FormData): Promise<PlanerState> {
  const z1 = await zugang();
  if (!z1.ok) return z1.status;

  const id = z.string().uuid().safeParse(formData.get("id"));
  if (!id.success) return { error: "Projekt nicht gefunden.", ok: null };

  const supabase = await createClient();
  const { error } = await supabase.from("planer_projekt").delete().eq("id", id.data);
  if (error) return { error: "Projekt konnte nicht gelöscht werden.", ok: null };

  revalidatePath("/planer");
  return { error: null, ok: "Projekt gelöscht." };
}
