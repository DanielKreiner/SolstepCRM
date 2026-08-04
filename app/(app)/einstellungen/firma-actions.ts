"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireMe } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

export type FirmaState = { error: string | null; ok: string | null };

/*
 * Die Firmendaten des Mandanten.
 *
 * Was hier steht, landet auf jedem Beleg und in jeder Fusszeile. Einige
 * Felder sind keine Kür: Firma, Rechtsform, Sitz, Firmenbuch- bzw.
 * Handelsregisternummer und das Gericht gehören nach § 14 UGB und
 * § 35a GmbHG auf jeden Geschäftsbrief, die UID zusätzlich auf jede
 * Rechnung.
 *
 * Bewusst NICHT hier: Tarif, Sitzplätze, Speicherkontingent und Status.
 * Die gehören dem Betreiber, und die Spaltenrechte aus 0023/0049 lassen
 * sie auch gar nicht durch.
 */

const schema = z.object({
  name: z.string().trim().min(2, "Der Firmenname fehlt.").max(160),
  rechtsform: z.string().trim().max(60).optional().default(""),
  address: z.string().trim().max(160).optional().default(""),
  zip: z.string().trim().max(12).optional().default(""),
  city: z.string().trim().max(80).optional().default(""),
  country: z.string().trim().max(60).optional().default(""),
  uid_nr: z.string().trim().max(30).optional().default(""),
  firmenbuch_nr: z.string().trim().max(40).optional().default(""),
  firmenbuch_gericht: z.string().trim().max(80).optional().default(""),
  email: z
    .string()
    .trim()
    .max(120)
    .refine((v) => v === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), {
      message: "Das ist keine Mailadresse.",
    })
    .optional()
    .default(""),
  phone: z.string().trim().max(40).optional().default(""),
  website: z.string().trim().max(120).optional().default(""),
  iban: z.string().trim().max(40).optional().default(""),
  bic: z.string().trim().max(20).optional().default(""),
});

export async function firmendatenSpeichern(
  _prev: FirmaState,
  formData: FormData,
): Promise<FirmaState> {
  const me = await requireMe();
  if (me.perms.einstellungen !== "write") {
    return { error: "Keine Berechtigung für Einstellungen.", ok: null };
  }
  if (me.company.status !== "active") {
    return { error: "Der Zugang ist derzeit nur lesend.", ok: null };
  }

  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Eingabe fehlt.", ok: null };
  }
  const d = parsed.data;

  /* Leerstring heisst „nicht angegeben" und nicht „leerer Text". */
  const leer = (v: string) => (v === "" ? null : v);

  const supabase = await createClient();
  const { data: geschrieben, error } = await supabase
    .from("company")
    .update({
      name: d.name,
      rechtsform: leer(d.rechtsform),
      address: leer(d.address),
      zip: leer(d.zip),
      city: leer(d.city),
      country: leer(d.country),
      uid_nr: leer(d.uid_nr),
      firmenbuch_nr: leer(d.firmenbuch_nr),
      firmenbuch_gericht: leer(d.firmenbuch_gericht),
      email: leer(d.email),
      phone: leer(d.phone),
      website: leer(d.website),
      iban: leer(d.iban),
      bic: leer(d.bic),
    })
    .eq("id", me.companyId)
    .select("id");

  if (error) return { error: `Speichern fehlgeschlagen: ${error.message}`, ok: null };

  /*
   * Mit .select() geprüft, ob wirklich eine Zeile geschrieben wurde: ein
   * UPDATE, das an einer Policy vorbeiläuft, meldet keinen Fehler — es
   * trifft null Zeilen, und der Nutzer sähe Erfolg für nichts.
   */
  if (!geschrieben?.length) {
    return {
      error: "Nicht gespeichert — die Firmendaten sind für deinen Zugang schreibgeschützt.",
      ok: null,
    };
  }

  /* Der Name steht in der Seitenleiste, die Daten auf jedem Beleg. */
  revalidatePath("/", "layout");

  const fehlt = [
    !d.firmenbuch_nr ? "Firmenbuchnummer" : null,
    !d.uid_nr ? "UID" : null,
    !d.address || !d.city ? "Anschrift" : null,
  ].filter(Boolean);

  return {
    error: null,
    ok: fehlt.length
      ? `Gespeichert. Für vollständige Belege fehlt noch: ${fehlt.join(", ")}.`
      : "Gespeichert. Die Daten stehen ab sofort auf allen Belegen.",
  };
}
