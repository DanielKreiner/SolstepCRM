import nodemailer from "nodemailer";
import { ausBytea, entschluesseln } from "./crypto";

/*
 * Versand über das Postfach des Mandanten (CLAUDE.md 6.1).
 *
 * Kein Versanddienst. Der Preis dafür ist, dass es kein Zustellereignis
 * gibt — deshalb heißt der Endzustand hier 'sent' und nicht 'delivered'.
 *
 * Frei von Next-Abhängigkeiten, damit derselbe Code später in einem
 * Dauerworker laufen kann.
 */

export type MailKonto = {
  id: string;
  provider: "imap" | "microsoft";
  address: string;
  display_name: string | null;
  smtp_host: string | null;
  smtp_port: number | null;
  smtp_secure: boolean | null;
  username: string | null;
  sent_folder: string | null;
  secret_enc: unknown;
};

export type Ausgang = {
  id: string;
  to_addrs: string[];
  cc_addrs: string[] | null;
  subject: string;
  body_html: string;
  body_text: string | null;
  attachments: { filename: string; content_base64: string; mime?: string }[];
  attempts: number;
};

export type Versandergebnis =
  | { ok: true; messageId: string }
  | { ok: false; fehler: string; endgueltig: boolean };

/**
 * Backoff nach CLAUDE.md 6.1: 2, 10, 60, 300 Minuten, danach endgültig
 * gescheitert. Absichtlich steigend — ein Postfach, das gerade dicht ist,
 * wird durch schnelles Nachfassen nicht schneller wieder frei.
 */
const BACKOFF_MIN = [2, 10, 60, 300];
export const MAX_VERSUCHE = 5;

export function naechsterVersuch(versuche: number): Date {
  const minuten = BACKOFF_MIN[Math.min(versuche, BACKOFF_MIN.length - 1)] ?? 300;
  const d = new Date();
  d.setMinutes(d.getMinutes() + minuten);
  return d;
}

export async function sendeUeberKonto(
  konto: MailKonto,
  mail: Ausgang,
): Promise<Versandergebnis> {
  if (konto.provider === "microsoft") {
    // Für M365 ist SMTP Basic Auth tot (CLAUDE.md 6.1). Graph kommt separat.
    return {
      ok: false,
      fehler: "Microsoft-Konten versenden über Graph, nicht über SMTP.",
      endgueltig: true,
    };
  }

  const paket = ausBytea(konto.secret_enc);
  if (!paket || !konto.smtp_host || !konto.username) {
    return {
      ok: false,
      fehler: "Postfach ist nicht vollständig eingerichtet.",
      endgueltig: true,
    };
  }

  let passwort: string;
  try {
    passwort = entschluesseln(paket);
  } catch {
    // Falscher MAIL_CRED_KEY oder verändertes Chiffrat. Kein Retry —
    // das wird ohne Eingriff nie funktionieren.
    return {
      ok: false,
      fehler: "Zugangsdaten nicht entschlüsselbar.",
      endgueltig: true,
    };
  }

  const transport = nodemailer.createTransport({
    host: konto.smtp_host,
    port: konto.smtp_port ?? 587,
    secure: konto.smtp_secure ?? false,
    auth: { user: konto.username, pass: passwort },
  });

  try {
    const info = await transport.sendMail({
      from: konto.display_name
        ? { name: konto.display_name, address: konto.address }
        : konto.address,
      to: mail.to_addrs,
      cc: mail.cc_addrs ?? undefined,
      subject: mail.subject,
      html: mail.body_html,
      text: mail.body_text ?? undefined,
      attachments: mail.attachments.map((a) => ({
        filename: a.filename,
        content: Buffer.from(a.content_base64, "base64"),
        contentType: a.mime,
      })),
    });

    return { ok: true, messageId: info.messageId };
  } catch (e) {
    const meldung = e instanceof Error ? e.message : "Versand fehlgeschlagen";
    // Authentifizierungsfehler wiederholen sich nicht von selbst.
    const endgueltig = /auth|credential|535|534/i.test(meldung);
    return { ok: false, fehler: meldung, endgueltig };
  } finally {
    transport.close();
  }
}
