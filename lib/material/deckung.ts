/**
 * Deckungsstatus einer Bedarfsposition.
 *
 * Die Frage, die der Bauleiter am Freitag stellt, lautet nicht „wie viel
 * ist bestellt", sondern „kann ich Montag anfangen". Genau darauf
 * antwortet dieser Status — vier Stufen, in der Reihenfolge, in der
 * Material durchs Haus läuft.
 *
 * Ein Bestell-ENTWURF zählt bewusst nicht als bestellt. Vergessene
 * Entwürfe sind der häufigste Grund, warum jemand glaubt, die Ware sei
 * unterwegs, während nie etwas rausging.
 */

export type DeckungStatus = "offen" | "bestellt" | "im_lager" | "geladen";

export type DeckungEingabe = {
  /** Was gebraucht wird. */
  menge: number;
  /**
   * Was bereits auf diesen Vorgang gebucht ist — Entnahme aus dem Lager
   * minus Rückgabe, dazu die Direktlieferung auf die Baustelle. Beides
   * heisst dasselbe: das Material ist dort, wo gearbeitet wird.
   */
  aufVorgang: number;
  /** Frei verfügbar im Hauptlager. */
  imLager: number;
  /**
   * In einer abgeschickten Bestellung, nicht storniert, noch nicht
   * geliefert.
   */
  bestellt: number;
  /**
   * Ob der bestätigte Liefertermin vor dem Montagebeginn liegt. Ohne
   * Termin ist die Antwort nein — „irgendwann" ist keine Zusage.
   */
  terminReicht: boolean;
};

export function deckung(e: DeckungEingabe): DeckungStatus {
  if (e.aufVorgang >= e.menge) return "geladen";

  const rest = e.menge - e.aufVorgang;
  if (e.imLager >= rest) return "im_lager";
  if (e.bestellt >= rest && e.terminReicht) return "bestellt";
  return "offen";
}

export const DECKUNG_TEXT: Record<DeckungStatus, string> = {
  offen: "offen",
  bestellt: "bestellt",
  im_lager: "im Lager",
  geladen: "geladen",
};

/**
 * Zählt eine Position als gedeckt?
 *
 * Standard: bestellt mit bestätigtem Termin reicht — sonst stünde das
 * Gate bis zum Wareneingang auf rot, obwohl alles seinen Gang geht.
 * Wer es strenger will, stellt es um; dann zählt erst, was im Haus ist.
 */
export function gedeckt(status: DeckungStatus, streng: boolean): boolean {
  if (streng) return status === "im_lager" || status === "geladen";
  return status !== "offen";
}

/**
 * Der Gate-Status, der sich aus der Bedarfsliste ergibt.
 *
 * Ohne Bedarfsliste gibt es nichts zu rechnen — dann bleibt das Gate,
 * wie es ist, und jemand setzt es von Hand auf „nicht nötig". Das
 * System erzwingt keine Stückliste, es belohnt sie nur.
 */
export function materialGate(
  stati: readonly DeckungStatus[],
  streng: boolean,
): "erledigt" | "laeuft" | "offen" | null {
  if (stati.length === 0) return null;
  if (stati.every((s) => gedeckt(s, streng))) return "erledigt";
  if (stati.some((s) => s !== "offen")) return "laeuft";
  return "offen";
}
