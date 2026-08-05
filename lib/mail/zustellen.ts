import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  fehlendeResendVariablen,
  resendVerfuegbar,
  sendeUeberResend,
} from "@/lib/mail/resend";
import {
  MAX_VERSUCHE,
  naechsterVersuch,
  sendeUeberKonto,
  type Ausgang,
  type MailKonto,
} from "@/lib/mail/send";

/**
 * Eine Mail aus der Warteschlange zustellen.
 *
 * Die Warteschlange bleibt — sie ist der Grund, warum keine Mahnung
 * verschwindet, wenn der Anbieter gerade nicht erreichbar ist. Aber
 * warten muss dafür niemand: wer auf „Angebot senden" drückt, will,
 * dass es rausgeht, und nicht in zwei Minuten. Deshalb versucht der
 * Versand sofort zuzustellen, und der Cron ist nur noch das Netz
 * darunter — für alles, was beim ersten Anlauf nicht klappt.
 *
 * Dieselbe Funktion nutzt der Cron. Zwei Zustellwege wären zwei
 * Auslegungen davon, wann eine Mail als gescheitert gilt.
 */
export async function zustellen(
  admin: SupabaseClient,
  outboxId: string,
): Promise<{ gesendet: boolean; fehler?: string }> {
  /*
   * Auf 'sending' setzen und nur weitermachen, wenn genau diese Zeile
   * dabei umgesprungen ist — sonst schickt ein gleichzeitig laufender
   * Cron dieselbe Mail ein zweites Mal.
   */
  const { data: reserviert } = await admin
    .from("mail_outbox")
    .update({ status: "sending" })
    .eq("id", outboxId)
    .eq("status", "queued")
    .select("*");

  const zeile = (reserviert ?? [])[0];
  if (!zeile) return { gesendet: false, fehler: "Wird gerade schon gesendet." };

  const { data: konto } = zeile.mail_account_id
    ? await admin
        .from("mail_account")
        .select(
          "id, provider, address, display_name, smtp_host, smtp_port, smtp_secure, username, sent_folder, secret_enc",
        )
        .eq("id", zeile.mail_account_id)
        .maybeSingle()
    : { data: null };

  /*
   * Ohne eingehängtes Postfach übernimmt der Übergangsweg über Resend.
   * Er verschwindet mit der IMAP-Anbindung; bis dahin bliebe jede Mail
   * sonst ungesendet liegen.
   */
  if (!konto && !resendVerfuegbar()) {
    const fehlt = fehlendeResendVariablen().join(" und ");
    const grund =
      `Kein Postfach eingehängt, und der Ersatzversand ist unvollständig: ` +
      `${fehlt} ${fehlendeResendVariablen().length === 1 ? "fehlt" : "fehlen"}. ` +
      `Beide Werte müssen in der Umgebung stehen — ein Schlüssel ohne ` +
      `Absenderadresse reicht nicht.`;

    await admin
      .from("mail_outbox")
      .update({ status: "failed", last_error: grund })
      .eq("id", zeile.id);
    return { gesendet: false, fehler: grund };
  }

  let ergebnis = konto
    ? await sendeUeberKonto(konto as unknown as MailKonto, zeile as unknown as Ausgang)
    : await sendeUeberResend(zeile as unknown as Ausgang);

  /*
   * Ein Postfach, dessen Zugangsdaten sich nicht mehr öffnen lassen, ist
   * kaputt und bleibt es ohne Eingriff. Dann darf es nicht auch noch
   * jede Mail mit sich reissen: das Konto wird stillgelegt, und diese
   * eine Mail geht über den Ersatzweg raus.
   */
  if (konto && !ergebnis.ok && ergebnis.fehler.includes("entschlüsselbar")) {
    await admin
      .from("mail_account")
      .update({
        status: "auth_error",
        last_error:
          "Zugangsdaten lassen sich nicht mehr entschlüsseln. Bitte das Postfach in den Einstellungen neu verbinden.",
      })
      .eq("id", konto.id as string);

    if (resendVerfuegbar()) {
      ergebnis = await sendeUeberResend(zeile as unknown as Ausgang);
    }
  }

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
    return { gesendet: true };
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
        title: "Mail konnte nicht gesendet werden",
        body: `${zeile.subject as string} — ${ergebnis.fehler}`,
        link: "/einstellungen",
      });
    }
  }

  return { gesendet: false, fehler: ergebnis.fehler };
}
