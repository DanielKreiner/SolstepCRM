/*
 * Plausibilität eines Arbeitstags.
 *
 * SPEC 4.8 verlangt, dass drei Dinge auffallen: über zehn Stunden Arbeit
 * ohne jede Pause, eine ausdrücklich markierte Buchung und eine Zeit, die
 * an keinem Einsatz hängt.
 *
 * Das ist bewusst eine Warnung und keine Sperre. Wer um sechs anfängt und
 * abends noch das Gerüst abbaut, hat einen langen Tag gehabt — den zu
 * verbieten steht der Software nicht zu. Ihn stumm durchzuwinken aber
 * auch nicht: die Aufzeichnungspflicht liegt beim Betrieb, und was
 * niemand sieht, korrigiert niemand.
 *
 * Bis zum Navigationsumbau rechnete dieses Modul das ganze Tagesbild —
 * Kommt, Soll, Differenz, Status. Das macht jetzt lib/zeiten/daten aus
 * derselben Abfrage, die auch die Woche und die Konten speist. Geblieben
 * ist die Regel selbst, als reines Rechenmodul ohne Datenbankzugriff,
 * damit sie prüfbar bleibt und nicht in einer Server Component liegt.
 */

/** Über so vielen Arbeitsminuten ohne Pause wird der Tag unplausibel. */
export const OHNE_PAUSE_KRITISCH = 10 * 60;

export type Tageslage = {
  /** Arbeitsminuten des Tages, Pausen bereits abgezogen. */
  istMin: number;
  /** Pausenminuten, egal ob gebucht oder automatisch abgezogen. */
  pauseMin: number;
  /** Mindestens eine Buchung steht auf 'flagged'. */
  geflaggt: boolean;
  /** Mindestens eine Arbeitsbuchung hängt an keinem Einsatz. */
  ohneEinsatz: boolean;
};

/**
 * Der Klartext, warum jemand diesen Tag ansehen sollte — oder null.
 *
 * Die Reihenfolge ist die Rangfolge: die lange Schicht ohne Pause ist
 * arbeitsrechtlich das Schwerere und verdrängt den fehlenden Einsatz.
 */
export function tageshinweis(lage: Tageslage): string | null {
  if (lage.istMin > OHNE_PAUSE_KRITISCH && lage.pauseMin === 0) {
    return "über 10 Stunden ohne Pause";
  }
  if (lage.geflaggt) return "Buchung als auffällig markiert";
  if (lage.ohneEinsatz && lage.istMin > 0) {
    return "Buchung ohne Auftragszuordnung";
  }
  return null;
}
