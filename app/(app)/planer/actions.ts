"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireMe } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { ANBIETER } from "@/lib/planer/anbieter";
import { ZOOM_GRENZEN } from "@/lib/planer/geo";
import { planSchema } from "@/lib/planer/plan";

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

/**
 * Den Planungsstand sichern.
 *
 * Geprüft wird mit demselben Schema wie beim Lesen: was hier hineinkommt,
 * stammt aus dem Browser und ist damit nichts, worauf man sich verlässt.
 * Ein Dokument mit halber Geometrie wäre zwar gültiges jsonb, würde aber
 * beim nächsten Öffnen als leerer Plan gelesen — der Kunde hätte seine
 * Dachflächen verloren, ohne dass irgendwo ein Fehler stand.
 *
 * Ohne revalidatePath: das läuft im Hintergrund während des Planens, ein
 * Seitenneuaufbau würde die Leinwand mitten im Zeichnen zurücksetzen.
 */
export async function planSpeichern(daten: { id: string; plan: unknown }): Promise<{ ok: boolean }> {
  const z1 = await zugang();
  if (!z1.ok) return { ok: false };

  const id = z.string().uuid().safeParse(daten.id);
  const plan = planSchema.safeParse(daten.plan);
  if (!id.success || !plan.success) return { ok: false };

  const supabase = await createClient();
  const { error } = await supabase
    .from("planer_projekt")
    .update({ plan: plan.data })
    .eq("id", id.data);

  return { ok: !error };
}

/* ── Drohnenfoto (Briefing 2.3) ──────────────────────────────────── */

const BUCKET = "planer-fotos";
/** Was ein Browser zuverlässig als Bild dekodiert. */
const FOTO_TYPEN = new Set(["image/jpeg", "image/png", "image/webp"]);
/** Drohnenaufnahmen sind gross; 25 MB decken 48-Megapixel-Bilder ab. */
const FOTO_MAX = 25 * 1024 * 1024;

export async function fotoHochladen(_prev: PlanerState, formData: FormData): Promise<PlanerState> {
  const z1 = await zugang();
  if (!z1.ok) return z1.status;

  const id = z.string().uuid().safeParse(formData.get("id"));
  if (!id.success) return { error: "Projekt nicht gefunden.", ok: null };

  const datei = formData.get("foto");
  if (!(datei instanceof File) || datei.size === 0) return { error: "Keine Datei gewählt.", ok: null };
  if (!FOTO_TYPEN.has(datei.type)) {
    return { error: "Nur JPEG, PNG oder WebP.", ok: null };
  }
  if (datei.size > FOTO_MAX) {
    return { error: "Höchstens 25 MB. Das Foto vorher verkleinern.", ok: null };
  }

  const breite = Number(formData.get("breite"));
  const hoehe = Number(formData.get("hoehe"));
  if (!Number.isInteger(breite) || !Number.isInteger(hoehe) || breite < 1 || hoehe < 1) {
    return { error: "Bildmasse fehlen.", ok: null };
  }

  const supabase = await createClient();
  const endung = (datei.name.split(".").pop() ?? "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
  const pfad = `${z1.me.companyId}/${id.data}/foto.${endung || "jpg"}`;

  const { error: hochladen } = await supabase.storage
    .from(BUCKET)
    .upload(pfad, new Uint8Array(await datei.arrayBuffer()), {
      contentType: datei.type,
      upsert: true,
    });
  if (hochladen) return { error: "Hochladen fehlgeschlagen.", ok: null };

  /*
   * Kalibrierfaktor bewusst auf null: ein frisch hochgeladenes Foto hat
   * keinen bekannten Massstab. Jede Länge daraus wäre geraten, und ein
   * geratener Massstab ist schlimmer als gar keiner — er sieht aus wie
   * eine Messung.
   */
  const { error } = await supabase
    .from("planer_projekt")
    .update({
      foto_pfad: pfad,
      foto_breite: breite,
      foto_hoehe: hoehe,
      foto_meter_pro_pixel: null,
    })
    .eq("id", id.data);
  if (error) return { error: "Foto konnte nicht gespeichert werden.", ok: null };

  revalidatePath(`/planer/${id.data}`);
  return { error: null, ok: "Foto hochgeladen — jetzt kalibrieren." };
}

/**
 * Massstab setzen.
 *
 * `faktor` ist das Verhältnis zwischen neuem und altem Massstab. Beim
 * Nachkalibrieren wandert damit auf Wunsch die gesamte Geometrie mit:
 * wer nachträglich merkt, dass die Referenzstrecke falsch war, will
 * nicht jede Dachkante neu ziehen (Briefing 2.3).
 */
export async function fotoKalibrieren(daten: {
  id: string;
  meterProPixel: number;
  geometrieSkalieren: boolean;
  faktor: number;
}): Promise<{ ok: boolean }> {
  const z1 = await zugang();
  if (!z1.ok) return { ok: false };

  const geprueft = z
    .object({
      id: z.string().uuid(),
      // 1 mm bis 10 m je Bildpunkt — alles ausserhalb ist ein Vertipper.
      meterProPixel: z.number().positive().min(0.001).max(10),
      geometrieSkalieren: z.boolean(),
      faktor: z.number().positive().min(0.001).max(1000),
    })
    .safeParse(daten);
  if (!geprueft.success) return { ok: false };

  const supabase = await createClient();
  const felder: Record<string, unknown> = {
    foto_meter_pro_pixel: geprueft.data.meterProPixel,
  };

  if (geprueft.data.geometrieSkalieren) {
    const { data } = await supabase
      .from("planer_projekt")
      .select("plan")
      .eq("id", geprueft.data.id)
      .maybeSingle();
    const alt = planSchema.safeParse((data as { plan: unknown } | null)?.plan);
    if (alt.success) {
      const f = geprueft.data.faktor;
      felder.plan = {
        ...alt.data,
        flaechen: alt.data.flaechen.map((flaeche) => ({
          ...flaeche,
          punkte: flaeche.punkte.map((p) => ({ x: p.x * f, y: p.y * f })),
          hindernisse: flaeche.hindernisse.map((h) => ({
            ...h,
            punkte: h.punkte.map((p) => ({ x: p.x * f, y: p.y * f })),
            abstand: h.abstand,
          })),
        })),
      };
    }
  }

  const { error } = await supabase.from("planer_projekt").update(felder).eq("id", geprueft.data.id);
  return { ok: !error };
}

export async function fotoEntfernen(_prev: PlanerState, formData: FormData): Promise<PlanerState> {
  const z1 = await zugang();
  if (!z1.ok) return z1.status;

  const id = z.string().uuid().safeParse(formData.get("id"));
  if (!id.success) return { error: "Projekt nicht gefunden.", ok: null };

  const supabase = await createClient();
  const { data } = await supabase
    .from("planer_projekt")
    .select("foto_pfad")
    .eq("id", id.data)
    .maybeSingle();

  const pfad = (data as { foto_pfad: string | null } | null)?.foto_pfad;
  if (pfad) await supabase.storage.from(BUCKET).remove([pfad]);

  await supabase
    .from("planer_projekt")
    .update({ foto_pfad: null, foto_breite: null, foto_hoehe: null, foto_meter_pro_pixel: null })
    .eq("id", id.data);

  revalidatePath(`/planer/${id.data}`);
  return { error: null, ok: "Foto entfernt — es gilt wieder die Karte." };
}
