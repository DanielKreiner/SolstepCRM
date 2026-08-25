import { fromZonedTime } from "date-fns-tz";
import { TZ } from "@/lib/format";

/*
 * Aus den Feldern des Einsatzdialogs wird ein Zeitraum.
 *
 * Eigene Datei, weil dieselbe Rechnung an zwei Stellen gebraucht wird:
 * der Dialog zeigt den Zeitraum an und prüft damit auf Konflikte, die
 * Serveraktion speichert ihn. Zwei Kopien wären zwei Wahrheiten — und
 * genau daran ist die Zeit vorher gescheitert: der Browser rechnete in
 * Wiener Zeit, der Server auf Vercel in UTC, und ein Einsatz von 11 Uhr
 * lag hinterher um 13 Uhr in der Tafel.
 *
 * Gespeichert wird UTC, gedacht wird in Europe/Vienna (CLAUDE.md 5.3).
 */

export interface Zeitfelder {
  /** Erster Tag, "YYYY-MM-DD". */
  datum: string;
  /** Uhrzeiten "HH:mm" — bei ganztägig ohne Bedeutung. */
  zeitVon: string;
  zeitBis: string;
  /** Letzter Tag; zählt nur bei `mehrtaegig`. */
  endDatum: string;
  mehrtaegig: boolean;
  ganztaegig: boolean;
}

/** Tag plus n Kalendertage. Über UTC-Mittag, damit keine Zone kippt. */
export function tagPlus(tag: string, n: number): string {
  const d = new Date(`${tag}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export interface Zeitraum {
  /** Wanduhrzeit für die Formularfelder, "YYYY-MM-DDTHH:mm". */
  von: string;
  bis: string;
  /** Der Tag, an dem der Einsatz endet — für den Klartext im Dialog. */
  bisTag: string;
  /** Endzeit vor Anfangszeit: eine Nachtschicht, kein Fehler. */
  ueberNacht: boolean;
}

export function zeitraum(f: Zeitfelder): Zeitraum {
  /*
   * Ohne zweites Datum endet der Einsatz am selben Tag — ausser die
   * Endzeit liegt vor der Anfangszeit. 22:00 bis 06:00 ist keine
   * Fehleingabe, sondern eine Nachtstörung; früher kam dafür „Das Ende
   * liegt vor dem Beginn" und der Einsatz liess sich nicht anlegen.
   */
  const ueberNacht = !f.ganztaegig && !f.mehrtaegig && f.zeitBis <= f.zeitVon;
  const bisTag = f.mehrtaegig
    ? f.endDatum
    : ueberNacht
      ? tagPlus(f.datum, 1)
      : f.datum;

  return {
    von: f.ganztaegig ? `${f.datum}T00:00` : `${f.datum}T${f.zeitVon}`,
    bis: f.ganztaegig ? `${bisTag}T23:59` : `${bisTag}T${f.zeitBis}`,
    bisTag,
    ueberNacht,
  };
}

/**
 * Wanduhrzeit des Betriebs („2026-09-01T11:00") als Zeitpunkt.
 *
 * Ausdrücklich nicht `new Date(roh)`: das liest die Zone des laufenden
 * Prozesses. Im Browser ist das zufällig die richtige, auf Vercel ist es
 * UTC — und dieselbe Eingabe ergab zwei verschiedene Zeitpunkte.
 */
export function alsZeitpunkt(roh: string): string {
  return fromZonedTime(roh, TZ).toISOString();
}
