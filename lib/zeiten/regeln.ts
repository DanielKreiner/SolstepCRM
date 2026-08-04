/**
 * Die Regeln der Zeiterfassung — als reine Funktionen.
 *
 * Sie stehen hier und nicht in den Serveraktionen, weil sie an drei
 * Stellen gebraucht werden: beim Stempeln in der Mitarbeiter-App, bei
 * der Nacherfassung im Büro und bei der Korrektur. Drei Kopien wären
 * drei Auslegungen davon, was eine gültige Zeit ist.
 */

/** Kürzer als das ist beim Stempeln fast immer ein Doppeltipp. */
export const MINI_MINUTEN = 5;

export type Spanne = { von: string; bis: string | null };

export type Pruefung =
  | { ok: true }
  | { ok: false; grund: string }
  /** Kein Fehler, aber eine Rückfrage: der Mensch entscheidet. */
  | { ok: false; rueckfrage: true; grund: string };

export function minuten(von: string, bis: string): number {
  return Math.round(
    (new Date(bis).getTime() - new Date(von).getTime()) / 60_000,
  );
}

/**
 * Darf eine Zeit gestartet werden?
 *
 * Genau eine laufende Zeit je Person. Ein zweiter Start erzeugt sonst
 * eine Schicht, die niemand beendet — und am Monatsende zwei Zeilen für
 * denselben Nachmittag.
 */
export function darfStarten(laeuftSeit: string | null): Pruefung {
  if (!laeuftSeit) return { ok: true };
  return {
    ok: false,
    grund: "Es läuft schon eine Zeit. Stoppe sie zuerst.",
  };
}

/**
 * Darf gestoppt werden — und wenn ja, ohne Rückfrage?
 *
 * Unter fünf Minuten ist beim Stempeln fast immer ein Doppeltipp. Die
 * Buchung stillschweigend zu speichern erzeugt die 18:02–18:02-Zeilen,
 * über die sich später niemand mehr erinnert; sie stillschweigend zu
 * verwerfen wäre schlimmer. Also fragen.
 */
export function darfStoppen(
  laeuftSeit: string | null,
  jetzt: string,
): Pruefung {
  if (!laeuftSeit) {
    return { ok: false, grund: "Es läuft gerade keine Zeit." };
  }
  const dauer = minuten(laeuftSeit, jetzt);
  if (dauer <= 0) {
    return { ok: false, grund: "Das Ende liegt vor dem Beginn." };
  }
  if (dauer < MINI_MINUTEN) {
    return {
      ok: false,
      rueckfrage: true,
      grund: `Die Zeit läuft erst ${dauer} ${dauer === 1 ? "Minute" : "Minuten"}. Verwerfen oder trotzdem speichern?`,
    };
  }
  return { ok: true };
}

/**
 * Überlappt eine neue Spanne mit einer bestehenden?
 *
 * Zwei Zeiten am selben Nachmittag heissen: eine davon ist falsch. Wer
 * nacherfasst, sieht nicht, was schon gebucht ist — deshalb prüft es
 * der Server.
 */
export function ueberlappt(neu: Spanne, bestehend: readonly Spanne[]): Spanne | null {
  const vonNeu = new Date(neu.von).getTime();
  const bisNeu = neu.bis ? new Date(neu.bis).getTime() : Number.MAX_SAFE_INTEGER;

  for (const b of bestehend) {
    const vonAlt = new Date(b.von).getTime();
    const bisAlt = b.bis ? new Date(b.bis).getTime() : Number.MAX_SAFE_INTEGER;
    /* Berührung an den Rändern ist keine Überlappung: 12:00 endet, 12:00 beginnt. */
    if (vonNeu < bisAlt && vonAlt < bisNeu) return b;
  }
  return null;
}

/**
 * Prüft eine von Hand erfasste oder korrigierte Spanne.
 *
 * `inZukunftErlaubt` gilt nur fürs Büro: eine geplante Nacherfassung
 * ist zulässig, ein Monteur, der sich in die Zukunft stempelt, nicht.
 */
export function pruefeSpanne(
  d: {
    von: string;
    bis: string;
    jetzt: string;
    inZukunftErlaubt: boolean;
  },
  bestehend: readonly Spanne[] = [],
): Pruefung {
  const dauer = minuten(d.von, d.bis);
  if (dauer <= 0) {
    return { ok: false, grund: "Das Ende muss nach dem Beginn liegen." };
  }
  if (dauer > 16 * 60) {
    return { ok: false, grund: "Mehr als sechzehn Stunden am Stück sind keine Schicht." };
  }
  if (!d.inZukunftErlaubt && new Date(d.von).getTime() > new Date(d.jetzt).getTime()) {
    return { ok: false, grund: "Der Beginn liegt in der Zukunft." };
  }

  const kollision = ueberlappt({ von: d.von, bis: d.bis }, bestehend);
  if (kollision) {
    const bis = kollision.bis
      ? new Date(kollision.bis).toLocaleTimeString("de-AT", {
          hour: "2-digit",
          minute: "2-digit",
        })
      : "offen";
    const von = new Date(kollision.von).toLocaleTimeString("de-AT", {
      hour: "2-digit",
      minute: "2-digit",
    });
    return {
      ok: false,
      grund: `Überschneidet sich mit einer Zeit von ${von} bis ${bis}.`,
    };
  }

  return { ok: true };
}
