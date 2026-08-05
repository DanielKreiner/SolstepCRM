import { minutenSchluessel, runCron } from "@/lib/cron";
import { zustellen } from "@/lib/mail/zustellen";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * Der Versandlauf ist das Netz, nicht der Weg.
 *
 * Wer im Backoffice auf „senden" drückt, bekommt die Zustellung sofort —
 * zwei Minuten Wartezeit sind im Alltag Unsinn. Hier läuft nur noch
 * nach, was beim ersten Anlauf nicht durchging: der Anbieter war kurz
 * weg, das Postfach hakte, der Rechner ist mitten im Versand
 * abgestürzt. Ohne diesen Lauf verschwände so eine Mahnung still.
 *
 * Backoff und Aufgabe nach fünf Versuchen stecken in lib/mail/zustellen
 * — dieselbe Funktion, die auch der Sofortversand benutzt.
 */
const BATCH = 25;

export async function GET(request: Request) {
  return runCron(
    request,
    "mail-send",
    async (admin) => {
      const jetzt = new Date().toISOString();

      const { data: warteschlange } = await admin
        .from("mail_outbox")
        .select("id")
        .eq("status", "queued")
        .lte("send_after", jetzt)
        .order("created_at")
        .limit(BATCH);

      if (!warteschlange?.length) return { gesendet: 0, offen: 0 };

      let gesendet = 0;
      let gescheitert = 0;

      for (const zeile of warteschlange) {
        const ergebnis = await zustellen(admin, zeile.id as string);
        if (ergebnis.gesendet) gesendet++;
        else gescheitert++;
      }

      const { count: offen } = await admin
        .from("mail_outbox")
        .select("id", { count: "exact", head: true })
        .eq("status", "queued");

      return { gesendet, gescheitert, offen: offen ?? 0 };
    },
    { runKey: minutenSchluessel("mail-send", 2) },
  );
}
