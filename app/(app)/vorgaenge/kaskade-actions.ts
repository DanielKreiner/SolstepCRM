"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { kaskadeAusloesen } from "@/lib/vorgang/kaskade";
import { requireMe } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

export type KaskadeStatus = { error: string | null; ok: string | null };

/**
 * „Angebot angenommen" — die Kaskade.
 *
 * Ein Dialog, vier Antworten, und daraus entsteht alles Weitere von
 * selbst: Auftragsbestätigung, Anzahlungsrechnung, Materialbedarfsliste,
 * sechs Gates und die Soll-Werte für die spätere Nachkalkulation.
 *
 * Nichts davon erfordert erneutes Eintippen von Positionen. Das ist der
 * wichtigste Abnahmetest des ganzen Umbaus (Briefing Abschnitt 5.2) —
 * denn genau hier lag bisher die Doppelarbeit, die den Betrieb Zeit
 * gekostet hat.
 */

const annahmeSchema = z.object({
  vorgangId: z.string().uuid(),
  anzahlungProzent: z.coerce.number().min(0).max(100),
  wunschZeitraum: z.string().trim().max(80).optional().default(""),
  geruest: z.enum(["ja", "nein"]),
  sub: z.enum(["ja", "nein"]),
});

export async function angebotAngenommen(
  _prev: KaskadeStatus,
  formData: FormData,
): Promise<KaskadeStatus> {
  const me = await requireMe();
  if (me.perms.pipelines !== "write" || me.perms.angebote !== "write") {
    return {
      error: "Für die Auftragsauslösung fehlt deiner Rolle das Schreibrecht.",
      ok: null,
    };
  }
  if (me.company.status !== "active") {
    return { error: "Der Zugang ist derzeit nur lesend.", ok: null };
  }

  const parsed = annahmeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Eingabe fehlt.", ok: null };
  }
  const d = parsed.data;

  const supabase = await createClient();

  const ergebnis = await kaskadeAusloesen(supabase, {
    vorgangId: d.vorgangId,
    companyId: me.companyId,
    userId: me.id,
    anzahlungProzent: d.anzahlungProzent,
    wunschZeitraum: d.wunschZeitraum,
    geruest: d.geruest,
    sub: d.sub,
    quelle: "backoffice",
  });

  if (!ergebnis.ok) return { error: ergebnis.grund, ok: null };

  revalidatePath(`/vorgaenge/${d.vorgangId}`);
  revalidatePath("/vorgaenge");
  revalidatePath("/cockpit");

  return { error: null, ok: ergebnis.meldung };
}
