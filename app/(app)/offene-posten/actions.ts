"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { mahnungAusloesen } from "@/lib/mahnung";
import { requireMe } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

export type MahnStatus = { error: string | null; ok: string | null };

const schema = z.object({ dokumentId: z.string().uuid() });

/*
 * Mahnen von Hand.
 *
 * Dasselbe wie der nächtliche Lauf, nur früher. Der Rechteschutz läuft
 * über den RLS-Client: wer den Beleg damit nicht lesen kann, darf ihn
 * auch nicht mahnen. Erst danach übernimmt der Service-Role-Client, weil
 * mail_outbox und mail_account für authenticated gesperrt sind.
 */
export async function jetztMahnen(
  _prev: MahnStatus,
  formData: FormData,
): Promise<MahnStatus> {
  const me = await requireMe();
  if (me.perms.rechnungen !== "write") {
    return { error: "Für Mahnungen fehlt deiner Rolle das Schreibrecht.", ok: null };
  }

  const parsed = schema.safeParse({ dokumentId: formData.get("dokumentId") });
  if (!parsed.success) return { error: "Beleg fehlt.", ok: null };

  /*
   * Erst unter RLS nachsehen, ob diese Rolle den Beleg überhaupt sieht.
   * Die Policy auf vorgang_dokument versteckt Rechnungen vor Rollen ohne
   * Rechnungsrecht (0025) — ohne diese Probe könnte eine Bauleitung über
   * eine geratene ID eine Mahnung auslösen.
   */
  const supabase = await createClient();
  const { data: sichtbar } = await supabase
    .from("vorgang_dokument")
    .select("id, vorgang_id")
    .eq("id", parsed.data.dokumentId)
    .maybeSingle();

  if (!sichtbar) return { error: "Beleg nicht gefunden.", ok: null };

  const ergebnis = await mahnungAusloesen(me.companyId, parsed.data.dokumentId);

  revalidatePath("/offene-posten");
  revalidatePath(`/vorgaenge/${sichtbar.vorgang_id as string}`);

  return ergebnis.ok
    ? { error: null, ok: `${ergebnis.stufe.label} an den Kunden geschickt.` }
    : { error: ergebnis.grund, ok: null };
}

const aussetzenSchema = z.object({
  dokumentId: z.string().uuid(),
  aktiv: z.enum(["ja", "nein"]),
});

/**
 * Mahnlauf für eine Rechnung anhalten oder wieder aufnehmen.
 *
 * Die Rechnung bleibt offen und in der Liste — ausgesetzt heisst nicht
 * erledigt. Wer eine Ratenzahlung vereinbart hat, will nur nicht, dass
 * die Software am nächsten Morgen weitermahnt.
 */
export async function mahnlaufSetzen(
  _prev: MahnStatus,
  formData: FormData,
): Promise<MahnStatus> {
  const me = await requireMe();
  if (me.perms.rechnungen !== "write") {
    return { error: "Für Mahnungen fehlt deiner Rolle das Schreibrecht.", ok: null };
  }

  const parsed = aussetzenSchema.safeParse({
    dokumentId: formData.get("dokumentId"),
    aktiv: formData.get("aktiv"),
  });
  if (!parsed.success) return { error: "Eingabe fehlt.", ok: null };

  const supabase = await createClient();
  const { error } = await supabase
    .from("vorgang_dokument")
    .update({ mahnung_aktiv: parsed.data.aktiv === "ja" })
    .eq("id", parsed.data.dokumentId);

  if (error) return { error: `Speichern fehlgeschlagen: ${error.message}`, ok: null };

  revalidatePath("/offene-posten");
  return {
    error: null,
    ok:
      parsed.data.aktiv === "ja"
        ? "Mahnlauf wieder aufgenommen."
        : "Mahnlauf für diese Rechnung ausgesetzt.",
  };
}
