import { runCron } from "@/lib/cron";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * Microsoft-Graph-Subscriptions erneuern (CLAUDE.md 6.2).
 *
 * Change-Notification-Subscriptions laufen nach höchstens 4230 Minuten ab —
 * knapp unter drei Tagen. Der Lauf alle zwölf Stunden erneuert alles, was
 * in den nächsten 24 Stunden abläuft. Der Puffer ist Absicht: fällt ein
 * Lauf aus, ist noch einer übrig, bevor der Kunde keine Mails mehr bekommt.
 *
 * Ohne konfigurierte Entra-App ruht der Job. Die Integration ist optional,
 * und die App muss ohne sie vollständig laufen.
 */
const PUFFER_STUNDEN = 24;

export async function GET(request: Request) {
  return runCron(request, "graph-renew", async (admin) => {
    if (!process.env.MS_CLIENT_ID || !process.env.MS_CLIENT_SECRET) {
      return { erneuert: 0, hinweis: "Microsoft Entra ist nicht konfiguriert." };
    }

    const grenze = new Date();
    grenze.setHours(grenze.getHours() + PUFFER_STUNDEN);

    const { data: konten } = await admin
      .from("mail_account")
      .select("id, address, company_id, subscription_id, subscription_expires_at")
      .eq("provider", "microsoft")
      .not("subscription_id", "is", null)
      .lte("subscription_expires_at", grenze.toISOString());

    if (!konten?.length) return { erneuert: 0 };

    const { erneuereSubscription } = await import("@/lib/graph/subscriptions");
    const ergebnis: { konto: string; ok: boolean; fehler?: string }[] = [];

    for (const konto of konten) {
      try {
        const neuesEnde = await erneuereSubscription(admin, konto.id as string);
        await admin
          .from("mail_account")
          .update({ subscription_expires_at: neuesEnde })
          .eq("id", konto.id);
        ergebnis.push({ konto: konto.address as string, ok: true });
      } catch (e) {
        const meldung = e instanceof Error ? e.message : "Erneuerung fehlgeschlagen";
        await admin
          .from("mail_account")
          .update({ last_error: meldung })
          .eq("id", konto.id);
        ergebnis.push({ konto: konto.address as string, ok: false, fehler: meldung });
      }
    }

    return { erneuert: ergebnis.filter((e) => e.ok).length, ergebnis };
  });
}
