"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireMe } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

export type MarkeState = { error: string | null; ok: string | null };

/*
 * Erscheinungsbild des Betriebs.
 *
 * Logo, Akzentfarbe und Fusszeile landen in company.pdf_settings — laut
 * CLAUDE.md 6.4 die Ablage für das Firmenlayout. Mail und PDF lesen
 * dieselbe Stelle: eine Marke, eine Ablage.
 */

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

const BUCKET = "branding";

/* Was in einer Mail zuverlässig ankommt. SVG bewusst nicht: Outlook
 * zeigt es nicht, und es kann Skripte tragen. */
const ERLAUBT = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_BYTES = 2 * 1024 * 1024;

const markeSchema = z.object({
  akzent: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, "Bitte eine Farbe wie #E8952B.")
    .optional()
    .or(z.literal("")),
  fusszeile: z.string().trim().max(200).optional().default(""),
});

export async function markeSpeichern(
  _prev: MarkeState,
  formData: FormData,
): Promise<MarkeState> {
  const z1 = await zugang();
  if (!z1.ok) return z1.status;

  const parsed = markeSchema.safeParse({
    akzent: formData.get("akzent") ?? "",
    fusszeile: formData.get("fusszeile") ?? "",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Eingabe fehlt.", ok: null };
  }

  const supabase = await createClient();
  const { data: firma } = await supabase
    .from("company")
    .select("pdf_settings")
    .eq("id", z1.me.companyId)
    .maybeSingle();

  const bisher = (firma?.pdf_settings ?? {}) as Record<string, unknown>;
  const neu: Record<string, unknown> = { ...bisher };

  neu.akzent = parsed.data.akzent || null;
  neu.fusszeile = parsed.data.fusszeile || null;

  /* Logo, falls eines mitkommt. Ohne Datei bleibt das alte stehen. */
  const datei = formData.get("logo");
  if (datei instanceof File && datei.size > 0) {
    if (!ERLAUBT.has(datei.type)) {
      return { error: "Nur PNG, JPG oder WEBP — SVG zeigt Outlook nicht an.", ok: null };
    }
    if (datei.size > MAX_BYTES) {
      return { error: "Das Logo ist grösser als 2 MB.", ok: null };
    }

    const endung = datei.type.split("/")[1] === "jpeg" ? "jpg" : datei.type.split("/")[1];
    const pfad = `${z1.me.companyId}/logo/${crypto.randomUUID()}.${endung}`;

    const { error: hoch } = await supabase.storage
      .from(BUCKET)
      .upload(pfad, new Uint8Array(await datei.arrayBuffer()), {
        contentType: datei.type,
        upsert: false,
      });

    if (hoch) return { error: `Hochladen fehlgeschlagen: ${hoch.message}`, ok: null };

    const { data: oeffentlich } = supabase.storage.from(BUCKET).getPublicUrl(pfad);
    neu.logo_url = oeffentlich.publicUrl;
    neu.logo_pfad = pfad;

    /*
     * Das alte Logo wegräumen. Sonst sammelt sich bei jedem Feinschliff
     * am Briefkopf eine weitere Datei im Kontingent des Mandanten an.
     */
    if (typeof bisher.logo_pfad === "string" && bisher.logo_pfad) {
      await supabase.storage.from(BUCKET).remove([bisher.logo_pfad]);
    }
  }

  /*
   * Mit .select() prüfen, ob wirklich eine Zeile geschrieben wurde: ein
   * UPDATE, das an einer Policy vorbeiläuft, meldet keinen Fehler.
   */
  const { data: geschrieben, error } = await supabase
    .from("company")
    .update({ pdf_settings: neu })
    .eq("id", z1.me.companyId)
    .select("id");

  if (error) return { error: `Speichern fehlgeschlagen: ${error.message}`, ok: null };
  if (!geschrieben?.length) {
    return {
      error: "Nicht gespeichert — die Firmendaten sind für deinen Zugang schreibgeschützt.",
      ok: null,
    };
  }

  revalidatePath("/einstellungen");
  return { error: null, ok: "Gespeichert. Neue Mails gehen damit raus." };
}

export async function logoEntfernen(
  _prev: MarkeState,
  _formData: FormData,
): Promise<MarkeState> {
  const z1 = await zugang();
  if (!z1.ok) return z1.status;

  const supabase = await createClient();
  const { data: firma } = await supabase
    .from("company")
    .select("pdf_settings")
    .eq("id", z1.me.companyId)
    .maybeSingle();

  const bisher = (firma?.pdf_settings ?? {}) as Record<string, unknown>;
  if (typeof bisher.logo_pfad === "string" && bisher.logo_pfad) {
    await supabase.storage.from(BUCKET).remove([bisher.logo_pfad]);
  }

  const { error } = await supabase
    .from("company")
    .update({ pdf_settings: { ...bisher, logo_url: null, logo_pfad: null } })
    .eq("id", z1.me.companyId);

  if (error) return { error: `Fehlgeschlagen: ${error.message}`, ok: null };

  revalidatePath("/einstellungen");
  return { error: null, ok: "Logo entfernt. Mails tragen wieder den Firmennamen." };
}
