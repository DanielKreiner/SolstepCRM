/*
 * Mailstatus eines Angebots.
 *
 * Die Vorlage zeigt in der Angebotsliste eine Spalte "Mail-Status" mit
 * Pille und Klartextzeile darunter: "geöffnet / 3× geöffnet",
 * "still / seit 8 Tagen", "angenommen / digital signiert".
 *
 * Der Status steht nirgends als Feld — er ergibt sich aus den Ereignissen
 * in quote_event. Genau so gehört es auch: quote.status ist der fachliche
 * Zustand, der Mailstatus die Beobachtung. Ein Angebot kann fachlich
 * "gesendet" sein und beobachtet "3× geöffnet".
 *
 * Wichtig für die Ehrlichkeit der Anzeige (CLAUDE.md 6.1): es gibt kein
 * "zugestellt". Ohne Versanddienst kennt das System keine Zustellbestätigung.
 * Der stärkste positive Beleg ist eine Öffnung, der stärkste überhaupt die
 * Antwort des Kunden.
 */

export type MailStatus =
  | "entwurf"
  | "gesendet"
  | "geoeffnet"
  | "still"
  | "angenommen"
  | "verloren"
  | "abgelaufen";

export type QuoteEvent = {
  kind: string;
  created_at: string;
};

export type MailStatusErgebnis = {
  status: MailStatus;
  /** Beschriftung der Pille. */
  label: string;
  /** Klartextzeile darunter — ohne sie sagt die Pille zu wenig. */
  detail: string;
  ton: "neutral" | "doing" | "waiting" | "done" | "warn" | "crit";
};

/** Ab wann ein gesendetes, geöffnetes Angebot als "still" gilt. */
const STILL_AB_TAGEN = 7;

export function mailStatus(
  quote: {
    status: string;
    sent_at: string | null;
    accepted_at: string | null;
    valid_until: string | null;
  },
  events: QuoteEvent[],
  heute: string,
): MailStatusErgebnis {
  if (quote.accepted_at || quote.status === "accepted") {
    return {
      status: "angenommen",
      label: "angenommen",
      detail: "digital signiert",
      ton: "done",
    };
  }

  if (quote.status === "lost") {
    return {
      status: "verloren",
      label: "verloren",
      detail: "nicht beauftragt",
      ton: "neutral",
    };
  }

  if (!quote.sent_at && quote.status === "draft") {
    return {
      status: "entwurf",
      label: "Entwurf",
      detail: "nicht gesendet",
      ton: "neutral",
    };
  }

  if (quote.valid_until && quote.valid_until < heute) {
    return {
      status: "abgelaufen",
      label: "abgelaufen",
      detail: `Gültigkeit endete ${kurz(quote.valid_until)}`,
      ton: "crit",
    };
  }

  const oeffnungen = events.filter((e) => e.kind === "opened");
  const letzteRegung = [...events]
    .filter((e) => e.kind === "opened" || e.kind === "link_clicked")
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0];

  if (oeffnungen.length > 0) {
    const seit = tage(letzteRegung!.created_at, heute);
    if (seit >= STILL_AB_TAGEN) {
      return {
        status: "still",
        label: "still",
        detail: `seit ${seit} Tagen keine Regung`,
        ton: "warn",
      };
    }
    return {
      status: "geoeffnet",
      label: "geöffnet",
      detail:
        oeffnungen.length === 1 ? "1× geöffnet" : `${oeffnungen.length}× geöffnet`,
      ton: "doing",
    };
  }

  const seitVersand = quote.sent_at ? tage(quote.sent_at, heute) : 0;
  if (seitVersand >= STILL_AB_TAGEN) {
    return {
      status: "still",
      label: "still",
      detail: `seit ${seitVersand} Tagen ungeöffnet`,
      ton: "warn",
    };
  }

  return {
    status: "gesendet",
    label: "gesendet",
    detail: "noch nicht geöffnet",
    ton: "waiting",
  };
}

/** Beschriftung eines Ereignisses im Verlauf. */
export const EVENT_LABEL: Record<string, string> = {
  created: "Angebot erzeugt",
  sent: "Mail versendet",
  delivered: "Mail zugestellt",
  opened: "Mail geöffnet",
  pdf_downloaded: "PDF heruntergeladen",
  link_clicked: "Annahme-Link geklickt",
  accepted: "Digital angenommen",
  reminded: "Erinnerung versendet",
  bounced: "Mail unzustellbar",
};

export function tage(von: string, bis: string): number {
  const a = new Date(`${von.slice(0, 10)}T12:00:00Z`).getTime();
  const b = new Date(`${bis.slice(0, 10)}T12:00:00Z`).getTime();
  return Math.max(0, Math.round((b - a) / 86400000));
}

function kurz(iso: string): string {
  const [j, m, t] = iso.slice(0, 10).split("-");
  return `${t}.${m}.${j}`;
}
