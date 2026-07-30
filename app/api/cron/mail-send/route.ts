import { minutenSchluessel, runCron } from "@/lib/cron";
import {
  MAX_VERSUCHE,
  naechsterVersuch,
  sendeUeberKonto,
  type Ausgang,
  type MailKonto,
} from "@/lib/mail/send";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * Versandlauf, alle zwei Minuten (CLAUDE.md 6.1).
 *
 * Alles geht über mail_outbox, nie direkt. Fehler erhöhen attempts und
 * verschieben send_after mit exponentiellem Backoff; nach fünf Versuchen
 * gilt der Versand als gescheitert und der Betrieb wird benachrichtigt.
 *
 * Ohne eingerichtetes Postfach passiert nichts — die Integration ist
 * optional, und dann ruht der Job, statt Fehler zu produzieren.
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
        .select("*")
        .eq("status", "queued")
        .lte("send_after", jetzt)
        .order("created_at")
        .limit(BATCH);

      if (!warteschlange?.length) return { gesendet: 0, offen: 0 };

      let gesendet = 0;
      let gescheitert = 0;

      for (const zeile of warteschlange) {
        // Als 'sending' markieren, damit ein überlappender Lauf nicht
        // dieselbe Mail ein zweites Mal verschickt.
        const { data: reserviert } = await admin
          .from("mail_outbox")
          .update({ status: "sending" })
          .eq("id", zeile.id)
          .eq("status", "queued")
          .select("id");

        if ((reserviert ?? []).length === 0) continue;

        const { data: konto } = await admin
          .from("mail_account")
          .select(
            "id, provider, address, display_name, smtp_host, smtp_port, smtp_secure, username, sent_folder, secret_enc",
          )
          .eq("id", zeile.mail_account_id)
          .maybeSingle();

        if (!konto) {
          await admin
            .from("mail_outbox")
            .update({ status: "failed", last_error: "Postfach fehlt." })
            .eq("id", zeile.id);
          gescheitert++;
          continue;
        }

        const ergebnis = await sendeUeberKonto(
          konto as unknown as MailKonto,
          zeile as unknown as Ausgang,
        );

        if (ergebnis.ok) {
          await admin
            .from("mail_outbox")
            .update({
              status: "sent",
              sent_at: new Date().toISOString(),
              message_id: ergebnis.messageId,
              last_error: null,
            })
            .eq("id", zeile.id);
          gesendet++;
          continue;
        }

        const versuche = Number(zeile.attempts ?? 0) + 1;
        const aufgeben = ergebnis.endgueltig || versuche >= MAX_VERSUCHE;

        await admin
          .from("mail_outbox")
          .update({
            status: aufgeben ? "failed" : "queued",
            attempts: versuche,
            last_error: ergebnis.fehler,
            send_after: aufgeben
              ? zeile.send_after
              : naechsterVersuch(versuche).toISOString(),
          })
          .eq("id", zeile.id);

        if (aufgeben) {
          gescheitert++;
          const { data: fuehrung } = await admin
            .from("app_user")
            .select("id")
            .eq("company_id", zeile.company_id)
            .eq("active", true)
            .in("role", ["gf", "buero"]);

          for (const u of fuehrung ?? []) {
            await admin.from("notification").insert({
              company_id: zeile.company_id,
              user_id: u.id,
              kind: "mail_failed",
              title: `Mail konnte nicht gesendet werden`,
              body: `${zeile.subject as string} — ${ergebnis.fehler}`,
              link: "/einstellungen",
            });
          }
        }
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
