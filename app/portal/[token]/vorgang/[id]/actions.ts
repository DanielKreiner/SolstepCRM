"use server";

/** Nur echte UUIDs weiterreichen — der Rest ist Tippfehler oder Angriff. */
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  /*
   * Die Auswahl kommt als Liste von IDs aus dem Formular. Geprüft wird
   * sie nicht hier, sondern beim Schreiben: dort trifft eine geratene
   * fremde ID nichts, weil auf vorgang_id und optional eingeschränkt wird.
   */
  const ids = (wert: FormDataEntryValue | null): string[] =>
    typeof wert === "string"
      ? wert.split(",").map((x) => x.trim()).filter((x) => UUID.test(x))
      : [];

  const ergebnis = await portalVorgangAnnehmen(
    session,
    parsed.data.vorgangId,
    parsed.data.name,
    ip,
    {
      optionen: ids(formData.get("gewaehlteOptionen")),
      upgrades: ids(formData.get("gewaehlteUpgrades")),
      /* „positionId:artikelId" — welches Produkt der Kunde gewählt hat. */
      kategorieUpgrades: ids(formData.get("kategorieUpgrades")),
    },
  );

  if (!ergebnis.ok) return { error: ergebnis.meldung, ok: null };

  revalidatePath(`/portal/${parsed.data.token}`, "layout");
  return {
    error: null,
    ok: "Danke. Wir haben Ihre Zusage erfasst und melden uns wegen des Termins.",
  };
}
