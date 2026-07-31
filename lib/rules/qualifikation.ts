/*
 * Ablaufwarnung für Qualifikationen.
 *
 * Die Schwelle stand an drei Stellen mit zwei verschiedenen Zahlen: das
 * Cockpit warnte 120 Tage vorher, die Mitarbeiterliste 60, der Nachtlauf
 * schickte Mails bei 60, 30 und 7. Ein Bauleiter, der im Cockpit eine
 * Warnung sah und in der Mitarbeiterliste nachschaute, fand dort nichts.
 *
 * SPEC 3 und 7 legen 120 Tage fest — Kurse haben Vorlaufzeit, und ein
 * Monteur ohne gültige Unterweisung darf nicht aufs Dach.
 */

/** Ab hier gilt ein Nachweis als "läuft ab". SPEC 3. */
export const VORWARNUNG_TAGE = 120;

/**
 * Stufen des Nachtlaufs. Die erste ist die Vorwarnung aus der Spezifikation,
 * die weiteren erhöhen den Druck, je näher der Ablauf rückt.
 */
export const ERINNERUNGSSTUFEN = [VORWARNUNG_TAGE, 60, 30, 7] as const;

export type Qualifikationsstand = "gueltig" | "laeuft_ab" | "abgelaufen";

/**
 * Zustand eines Nachweises am Stichtag.
 *
 * Ohne Ablaufdatum gilt der Nachweis als gültig — nicht jede Qualifikation
 * verfällt, und ein fehlendes Datum als "abgelaufen" zu werten würde jede
 * Meisterprüfung zum Warnfall machen.
 */
export function qualifikationsstand(
  gueltigBis: string | null,
  heute: string,
): Qualifikationsstand {
  if (!gueltigBis) return "gueltig";
  if (gueltigBis < heute) return "abgelaufen";
  return tageBis(gueltigBis, heute) <= VORWARNUNG_TAGE ? "laeuft_ab" : "gueltig";
}

/** Kalendertage von `heute` bis `ziel`. Negativ, wenn `ziel` vorbei ist. */
export function tageBis(ziel: string, heute: string): number {
  const a = new Date(`${heute.slice(0, 10)}T12:00:00Z`).getTime();
  const b = new Date(`${ziel.slice(0, 10)}T12:00:00Z`).getTime();
  return Math.round((b - a) / 86400000);
}
