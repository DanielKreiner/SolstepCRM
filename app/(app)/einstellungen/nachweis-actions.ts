"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireMe } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

/*
 * Der Katalog der Qualifikationen und Nachweise.
 *
 * Zwei Dinge in einer Liste, weil vieles beides ist: Ein Staplerschein
 * ist eine Fähigkeit für die Einsatzplanung UND ein Zertifikat mit
 * Ablauf. Das Kennzeichen `nachweis` sagt nur, ob am Mitarbeiter ein
 * Ablaufdatum dazugehört.
 */

export type NachweisState = { error: string | null; ok: string | null };

async function zugang() {
  const me = await requireMe();
  if (me.perms.einstellungen !== "write") {
    return {
      ok: false as const,
      status: { error: "Keine Berechtigung für Einstellungen.", ok: null },
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

/*
 * Der Schlüssel steht in `app_user.qualifikationen` und in
 * `einsatz.benoetigte_qualifikationen` — beides Textfelder. Er wird
 * deshalb aus dem Label abgeleitet und danach nie wieder geändert: Eine
 * Umbenennung des Schlüssels würde jede Zuordnung verwaisen lassen, ohne
 * dass es jemand merkt. Das Label darf sich ändern, so oft man will.
 */
function schluesselAus(label: string): string {
  return label
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

const neuSchema = z.object({
  label: z.string().trim().min(2, "Bitte den Nachweis benennen.").max(80),
  nachweis: z.enum(["ja", "nein"]).optional().default("nein"),
});

export async function nachweisAnlegen(
  _prev: NachweisState,
  formData: FormData,
): Promise<NachweisState> {
  const z1 = await zugang();
  if (!z1.ok) return z1.status;

  const parsed = neuSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Eingabe fehlt.", ok: null };
  }
  const d = parsed.data;
  const schluessel = schluesselAus(d.label);

  if (!schluessel) {
    return { error: "Aus dieser Bezeichnung lässt sich kein Schlüssel bilden.", ok: null };
  }

  const supabase = await createClient();

  const { data: letzter } = await supabase
    .from("qualifikation")
    .select("sort")
    .order("sort", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await supabase.from("qualifikation").insert({
    company_id: z1.me.companyId,
    schluessel,
    label: d.label,
    nachweis: d.nachweis === "ja",
    sort: Number(letzter?.sort ?? 0) + 10,
  });

  if (error) {
    if (/duplicate key|unique/i.test(error.message)) {
      return { error: `„${d.label}" gibt es schon im Katalog.`, ok: null };
    }
    return { error: `Anlegen fehlgeschlagen: ${error.message}`, ok: null };
  }

  revalidatePath("/einstellungen");
  revalidatePath("/planung");
  revalidatePath("/mitarbeiter");
  return { error: null, ok: `„${d.label}" angelegt.` };
}

const aendernSchema = z.object({
  id: z.string().uuid(),
  label: z.string().trim().min(2, "Bitte den Nachweis benennen.").max(80),
  nachweis: z.enum(["ja", "nein"]).optional().default("nein"),
});

export async function nachweisSpeichern(
  _prev: NachweisState,
  formData: FormData,
): Promise<NachweisState> {
  const z1 = await zugang();
  if (!z1.ok) return z1.status;

  const parsed = aendernSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Eingabe fehlt.", ok: null };
  }
  const d = parsed.data;

  const supabase = await createClient();

  /*
   * Nur Label und Kennzeichen. Der Schlüssel bleibt, wie er ist — er
   * steht in den Textfeldern der Mitarbeiter und der Einsätze.
   */
  const { error } = await supabase
    .from("qualifikation")
    .update({ label: d.label, nachweis: d.nachweis === "ja" })
    .eq("id", d.id);

  if (error) return { error: `Speichern fehlgeschlagen: ${error.message}`, ok: null };

  revalidatePath("/einstellungen");
  revalidatePath("/planung");
  revalidatePath("/mitarbeiter");
  return { error: null, ok: "Gespeichert." };
}

export async function nachweisEntfernen(
  _prev: NachweisState,
  formData: FormData,
): Promise<NachweisState> {
  const z1 = await zugang();
  if (!z1.ok) return z1.status;

  const id = z.string().uuid().safeParse(formData.get("id"));
  if (!id.success) return { error: "Eintrag nicht gefunden.", ok: null };

  const supabase = await createClient();

  const { data: eintrag } = await supabase
    .from("qualifikation")
    .select("schluessel, label")
    .eq("id", id.data)
    .maybeSingle();

  if (!eintrag) return { error: "Eintrag nicht gefunden.", ok: null };

  /*
   * Nicht entfernen, solange ihn jemand trägt. `app_user.qualifikationen`
   * ist ein Textfeld ohne Fremdschlüssel — die Datenbank würde den
   * Eintrag anstandslos löschen und beim Mitarbeiter ein Schlagwort
   * stehen lassen, das es nicht mehr gibt. Die Einsatzplanung sucht
   * danach und findet niemanden mehr.
   */
  const { data: traeger } = await supabase
    .from("app_user")
    .select("name")
    .contains("qualifikationen", [eintrag.schluessel as string]);

  if (traeger && traeger.length > 0) {
    const namen = traeger
      .slice(0, 3)
      .map((t) => t.name as string)
      .join(", ");
    const rest = traeger.length > 3 ? ` und ${traeger.length - 3} weitere` : "";
    return {
      error: `„${eintrag.label as string}" ist noch zugeordnet: ${namen}${rest}. Bitte zuerst dort entfernen.`,
      ok: null,
    };
  }

  const { error } = await supabase.from("qualifikation").delete().eq("id", id.data);
  if (error) return { error: `Entfernen fehlgeschlagen: ${error.message}`, ok: null };

  revalidatePath("/einstellungen");
  revalidatePath("/planung");
  revalidatePath("/mitarbeiter");
  return { error: null, ok: `„${eintrag.label as string}" entfernt.` };
}
