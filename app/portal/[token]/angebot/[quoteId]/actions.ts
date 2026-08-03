"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { portalToggleOption, resolvePortal } from "@/lib/portal/data";

/**
 * Optionale Erweiterung an- oder abwählen.
 *
 * Das einzige, was ein Kunde an einem Angebot ändern darf. Die Prüfung —
 * gehört die Position zu seinem Angebot, ist sie überhaupt wählbar, ist
 * das Angebot noch offen — liegt in lib/portal/data.ts, wo die gesamte
 * Mandantentrennung dieses Pfades sitzt.
 */
export async function optionUmschalten(
  token: string,
  itemId: string,
  gewaehlt: boolean,
): Promise<{ ok: boolean; grund?: string }> {
  const parsed = z
    .object({
      token: z.string().min(10),
      itemId: z.string().uuid(),
      gewaehlt: z.boolean(),
    })
    .safeParse({ token, itemId, gewaehlt });

  if (!parsed.success) return { ok: false, grund: "Eingabe fehlt." };

  const session = await resolvePortal(parsed.data.token);
  if (!session) return { ok: false, grund: "Der Zugang ist abgelaufen." };

  const ergebnis = await portalToggleOption(
    session,
    parsed.data.itemId,
    parsed.data.gewaehlt,
  );

  if (ergebnis.ok) {
    revalidatePath(`/portal/${parsed.data.token}`, "layout");
  }
  return ergebnis;
}
