import { addDays, isoWeek, startOfViennaWeek } from "../time";

/*
 * Auslastung je Kalenderwoche.
 *
 * Reines Rechenmodul ohne Datenbank und ohne Uhr — wie lib/rules/worktime.ts.
 * Das Cockpit zeigt die Zahlen prominent an; sie muessen ohne laufende
 * Umgebung pruefbar sein.
 *
 * Die eine Entscheidung, die hier drinsteckt: geplante Stunden werden ueber
 * die Werktage des Auftragsfensters verteilt, nicht der Startwoche
 * zugeschlagen. Ein dreiwoechiger Auftrag mit 240 h ist keine Woche mit
 * 240 h und zwei leere — genau so haette der Plan eine Ueberlast gemeldet,
 * die es nicht gibt, und die zwei Folgewochen als frei ausgewiesen.
 *
 * Auftraege ohne Termin zaehlen nirgends mit. Sie sind der Grund fuer den
 * Pool "nicht terminiert" in der Einsatzplanung, keine Auslastung.
 */

export type PlanAuftrag = {
  plannedHours: number;
  /** ISO-Datum, Wiener Kalendertag. */
  from: string | null;
  /** ISO-Datum. Fehlt es, gilt der Auftrag als eintaegig. */
  to: string | null;
};

export type Wochenlast = {
  /** "2026-W31" */
  woche: string;
  /** "KW 31" */
  label: string;
  /** Erster Tag der Woche, ISO-Datum. */
  von: string;
  stunden: number;
  prozent: number;
  /** Keine geplanten Stunden in dieser Woche. */
  leer: boolean;
};

/** Werktage Montag bis Freitag im Fenster, als ISO-Datumsliste. */
function werktage(von: string, bis: string): string[] {
  const tage: string[] = [];
  let t = von;
  // Obergrenze gegen kaputte Daten: ein Auftrag ueber mehr als ein Jahr ist
  // ein Tippfehler, keine Planung.
  for (let i = 0; i <= 366 && t <= bis; i++) {
    const wt = new Date(`${t}T12:00:00Z`).getUTCDay();
    if (wt !== 0 && wt !== 6) tage.push(t);
    t = addDays(t, 1);
  }
  return tage;
}

export function auslastungJeWoche({
  auftraege,
  kapazitaetProWoche,
  abTag,
  wochen = 8,
}: {
  auftraege: PlanAuftrag[];
  /** Summe der Wochenstunden aller aktiven Mitarbeiter. */
  kapazitaetProWoche: number;
  /** Kalendertag, ab dessen Woche gezaehlt wird. */
  abTag: string;
  wochen?: number;
}): Wochenlast[] {
  const start = startOfViennaWeek(abTag);

  const fenster: Wochenlast[] = [];
  for (let i = 0; i < wochen; i++) {
    const von = addDays(start, i * 7);
    const woche = isoWeek(von);
    fenster.push({
      woche,
      label: `KW ${woche.slice(-2)}`,
      von,
      stunden: 0,
      prozent: 0,
      leer: true,
    });
  }

  const nachWoche = new Map(fenster.map((w) => [w.woche, w]));

  for (const a of auftraege) {
    if (!a.from || a.plannedHours <= 0) continue;
    const tage = werktage(a.from, a.to ?? a.from);
    if (tage.length === 0) continue;

    const jeTag = a.plannedHours / tage.length;
    for (const tag of tage) {
      const treffer = nachWoche.get(isoWeek(tag));
      if (treffer) {
        treffer.stunden += jeTag;
        treffer.leer = false;
      }
    }
  }

  for (const w of fenster) {
    w.stunden = Math.round(w.stunden * 10) / 10;
    w.prozent =
      kapazitaetProWoche > 0
        ? Math.round((w.stunden / kapazitaetProWoche) * 1000) / 10
        : 0;
  }

  return fenster;
}

/** Mittlere Auslastung ueber die ersten n Wochen — die Kennzahl im Cockpit. */
export function mittlereAuslastung(wochen: Wochenlast[], n = 4): number {
  const teil = wochen.slice(0, n);
  if (teil.length === 0) return 0;
  const summe = teil.reduce((s, w) => s + w.prozent, 0);
  return Math.round(summe / teil.length);
}
