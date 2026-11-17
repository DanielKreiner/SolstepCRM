"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireMe } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

/*
 * Den Startwert eines Nummernkreises setzen.
 *
 * Die eigentliche Arbeit macht `public.set_number_start` (0076). Hier
 * steht bewusst keine Prüfung noch einmal: `doc_counter` ist für
 * angemeldete Sitzungen gesperrt (0072), und die Regel — anheben ja,
 * senken nie — gehört in die Datenbank, wo sie auch für einen zweiten
 * Aufrufer gilt. Diese Aktion reicht nur durch und übersetzt das
 * Ergebnis in einen Satz.
 */

export type NummernkreisState = { error: string | null; ok: string | null };

const schema = z.object({
  kind: z.enum(["vorgang", "invoice", "ticket", "purchase_order"]),
  naechste: z.coerce
    .number()
    .int("Bitte eine ganze Zahl eintragen.")
    .min(1, "Die Nummer muss mindestens 1 sein.")
    .max(999999, "Die Nummer ist zu gross."),
  jahr: z.coerce.number().int().min(2000).max(2100),
});

export async function nummernkreisSetzen(
  _prev: NummernkreisState,
  formData: FormData,
): Promise<NummernkreisState> {
  const me = await requireMe();
  if (me.perms.einstellungen !== "write") {
    return { error: "Keine Berechtigung für Einstellungen.", ok: null };
  }

  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Eingabe fehlt.", ok: null };
  }
  const d = parsed.data;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("set_number_start", {
    p_kind: d.kind,
    p_next: d.naechste,
    p_year: d.jahr,
  });

  if (error) {
    /*
     * Die Funktion wirft deutschen Klartext ("Nummer 12 ist bereits
     * vergeben … Die nächste freie Nummer ist 189."). Den zeigen wir
     * unverändert — er sagt genau, was zu tun ist.
     */
    return { error: error.message, ok: null };
  }

  revalidatePath("/einstellungen");
  return {
    error: null,
    ok: `Der nächste Beleg bekommt die Nummer ${String(data)}.`,
  };
}
