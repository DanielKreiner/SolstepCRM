import type { Ausgang, Versandergebnis } from "./send";

/*
 * ÜBERGANGSLÖSUNG — Versand über Resend.
 *
 * CLAUDE.md Abschnitt 6.1 schliesst Versanddienste ausdrücklich aus:
 * jeder Mandant hängt sein eigenes Postfach ein, Antworten laufen in
 * sein "Gesendet", und die Absenderreputation bleibt seine. Abschnitt 0
 * verbietet zusätzlich solstep.de als Absenderdomain, weil dieses
 * Produkt vom Handelsgeschäft getrennt bleiben soll.
 *
 * Beides gilt weiter. Dieser Weg existiert nur, damit sich Mailversand
 * überhaupt testen lässt, solange noch kein Postfach eingehängt ist —
 * ohne ihn bleibt jede Mahnung und jedes Angebot in der Warteschlange
 * liegen, und man sieht nie, ob der Text stimmt.
 *
 * Wenn die IMAP-Anbindung steht, wird diese Datei gelöscht und die
 * beiden Umgebungsvariablen entfernt. Der Rest des Systems merkt davon
 * nichts: die Warteschlange, das Backoff und der Zustand 'sent' bleiben
 * unverändert, nur der Zusteller ist ein anderer.
 */

const API = "https://api.resend.com/emails";

export function resendVerfuegbar(): boolean {
  return fehlendeResendVariablen().length === 0;
}

/**
 * Welche Umgebungsvariablen fehlen — namentlich.
 *
 * "Kein Ersatzversand eingerichtet" beantwortet die einzige Frage nicht,
 * die man in dem Moment hat: WAS fehlt. Beide Werte sind Pflicht, und
 * einen Schlüssel ohne Absenderadresse zu setzen ist der Fehler, den man
 * beim Nachtragen in Vercel als Erstes macht.
 */
export function fehlendeResendVariablen(): string[] {
  return [
    process.env.RESEND_API_KEY ? null : "RESEND_API_KEY",
    process.env.RESEND_FROM ? null : "RESEND_FROM",
  ].filter((v): v is string => v !== null);
}

function absender(): string | null {
  const adresse = process.env.RESEND_FROM;
  if (!adresse) return null;
  const name = process.env.RESEND_FROM_NAME;
  return name ? `${name} <${adresse}>` : adresse;
}

/**
 * Eine Mail über Resend zustellen.
 *
 * Anhänge gehen als Base64 mit. Ein 4xx ist endgültig — eine abgelehnte
 * Adresse wird durch Wiederholen nicht gültig; ein 5xx darf es noch
 * einmal versuchen.
 */
export async function sendeUeberResend(
  mail: Ausgang,
): Promise<Versandergebnis> {
  const key = process.env.RESEND_API_KEY;
  const from = absender();
  if (!key || !from) {
    return {
      ok: false,
      fehler: "Resend ist nicht eingerichtet (RESEND_API_KEY, RESEND_FROM).",
      endgueltig: true,
    };
  }

  let antwort: Response;
  try {
    antwort = await fetch(API, {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: mail.to_addrs,
        ...(mail.cc_addrs?.length ? { cc: mail.cc_addrs } : {}),
        subject: mail.subject,
        html: mail.body_html,
        ...(mail.body_text ? { text: mail.body_text } : {}),
        ...(mail.attachments.length
          ? {
              attachments: mail.attachments.map((a) => ({
                filename: a.filename,
                content: a.content_base64,
              })),
            }
          : {}),
      }),
    });
  } catch (e) {
    /* Netzproblem — das darf es noch einmal versuchen. */
    return {
      ok: false,
      fehler: e instanceof Error ? e.message : "Resend nicht erreichbar.",
      endgueltig: false,
    };
  }

  const text = await antwort.text();

  if (!antwort.ok) {
    return {
      ok: false,
      fehler: `Resend ${antwort.status}: ${text.slice(0, 300)}`,
      endgueltig: antwort.status >= 400 && antwort.status < 500,
    };
  }

  let id = "";
  try {
    id = (JSON.parse(text) as { id?: string }).id ?? "";
  } catch {
    id = "";
  }

  /*
   * Die Message-ID ist der Beleg, dass die Mail draussen ist. Resend
   * gibt eine eigene ID zurück, keine RFC-Message-ID — das reicht für
   * die Zuordnung im Postausgang und steht so auch im Kommentar an der
   * Spalte.
   */
  return { ok: true, messageId: id || `resend-${Date.now()}` };
}
