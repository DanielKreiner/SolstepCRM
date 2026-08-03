"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { resolvePortal } from "@/lib/portal/data";
import { portalVorgangAnnehmen } from "@/lib/portal/vorgang";

export type PortalVorgangState = { error: string | null; ok: string | null };

const schema = z.object({
  token: z.string().min(10),
  vorgangId: z.string().uuid(),
  name: z.string().trim().min(2, "Bitte Ihren Namen eintragen."),
});

/**
 * Der Kunde nimmt sein Angebot an.
 *
 * Name, Zeitpunkt und IP werden als Nachweis festgehalten. Ausgelöst wird
 * dieselbe Kaskade wie im Backoffice — sonst hätte ein im Portal
 * angenommenes Angebot keinen Auftrag, und genau das ist beim alten
 * Modell schon einmal passiert.
 */
export async function vorgangAnnehmen(
  _prev: PortalVorgangState,
  formData: FormData,
): Promise<PortalVorgangState> {
  const parsed = schema.safeParse({
    token: formData.get("token"),
    vorgangId: formData.get("vorgangId"),
    name: formData.get("name"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Eingabe fehlt.", ok: null };
  }

  const session = await resolvePortal(parsed.data.token);
  if (!session) return { error: "Der Zugang ist abgelaufen.", ok: null };

  const kopf = await headers();
  const ip =
    kopf.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    kopf.get("x-real-ip") ??
    null;

  const ergebnis = await portalVorgangAnnehmen(
    session,
    parsed.data.vorgangId,
    parsed.data.name,
    ip,
  );

  if (!ergebnis.ok) return { error: ergebnis.meldung, ok: null };

  revalidatePath(`/portal/${parsed.data.token}`, "layout");
  return {
    error: null,
    ok: "Danke. Wir haben Ihre Zusage erfasst und melden uns wegen des Termins.",
  };
}
