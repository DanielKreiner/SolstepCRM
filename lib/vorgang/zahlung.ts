/*
 * Zahlungsstand eines Rechnungsbelegs — Restbetrag, Status, Buchung.
 *
 * Reines Rechenmodul (CLAUDE.md Abschnitt 2 und 10): kein React, kein
 * Next, kein Supabase. Die Frage "wie viel ist an dieser Rechnung noch
 * offen" wird an fünf Stellen gestellt — Zahlungserfassung, Postenliste,
 * Mahnlauf, Cockpit und Umsatzbericht. Fünf Implementierungen wären fünf
 * Gelegenheiten, einem zahlenden Kunden den Gesamtbetrag nachzumahnen.
 * Genau das ist passiert, solange der Teilbetrag nur im Ereignistext
 * stand (Migration 0073).
 *
 * Beträge hier sind BRUTTO: eine Zahlung geht in Brutto ein, der Kunde
 * überweist keinen Nettobetrag. Netto wird gespeichert und ausgewiesen
 * (CLAUDE.md 5.2), aber nicht bezahlt.
 */

import { round2 } from "@/lib/money";

/**
 * Was als "voll" gilt.
 *
 * Ein halber Cent. Geld ist numeric(12,2), die Zahlen kommen aber als
 * String aus Postgres und werden in JS zu Gleitkomma — ohne Toleranz
 * bleibt an einer vollständig bezahlten Rechnung ein Rest von 1e-14
 * stehen, und der Beleg wird nie bezahlt.
 */
export const CENT_TOLERANZ = 0.005;

/** Ein Beleg, so weit er für den Zahlungsstand zählt. */
export interface Zahlungsbeleg {
  betragBrutto: number | null;
  bezahltBetrag: number;
  status: string | null;
}

/**
 * Was noch offen ist.
 *
 * Nie negativ: eine Überzahlung ist keine negative Forderung, sondern
 * ein Fall für die Rückzahlung. Sie wird deshalb in `zahlungBuchen()`
 * abgewiesen und kann hier gar nicht entstehen.
 */
export function restbetrag(soll: number, bezahlt: number): number {
  const rest = round2(soll - bezahlt);
  return rest > CENT_TOLERANZ ? rest : 0;
}

/** Ist nichts mehr offen? Gilt auch für einen Beleg über 0 €. */
export function istVollBezahlt(soll: number, bezahlt: number): boolean {
  return restbetrag(soll, bezahlt) === 0;
}

/**
 * Der Status, der zum Betrag passt.
 *
 * Nur diese beiden: ein Entwurf wird durch eine Zahlung nicht versendet,
 * und ein Storno nicht durch eine Zahlung ungültig. Beide Fälle sind
 * vorher abzufangen, hier wäre es eine stille Statusänderung.
 */
export function statusNachZahlung(soll: number, bezahlt: number): "versendet" | "bezahlt" {
  return istVollBezahlt(soll, bezahlt) ? "bezahlt" : "versendet";
}

/**
 * Der offene Posten eines Belegs, wie ihn Liste, Cockpit und Mahnung
 * summieren.
 *
 * Ein stornierter Beleg ist keine Forderung mehr — auch dann nicht, wenn
 * noch etwas darauf offen stand. Entwürfe zählen mit: sie sind gestellt,
 * nur noch nicht abgeschickt, und genau das ist die Erinnerung, die die
 * Postenliste geben soll.
 */
export function offenerBetrag(beleg: Zahlungsbeleg): number {
  if (beleg.status === "storniert") return 0;
  return restbetrag(Number(beleg.betragBrutto ?? 0), beleg.bezahltBetrag);
}

/** Anteil des bezahlten am geforderten Betrag, 0 bis 1. */
export function zahlungsanteil(beleg: Zahlungsbeleg): number {
  const soll = Number(beleg.betragBrutto ?? 0);
  if (soll <= CENT_TOLERANZ) {
    /* Ohne Forderung gibt es keinen Anteil — ein Beleg über 0 € ist
       entweder bezahlt oder bedeutungslos. */
    return beleg.status === "bezahlt" ? 1 : 0;
  }
  const anteil = beleg.bezahltBetrag / soll;
  return anteil < 0 ? 0 : anteil > 1 ? 1 : anteil;
}

export type ZahlungFehler = "nichts_offen" | "kein_betrag" | "ueberzahlung";

export type Buchung =
  | {
      ok: true;
      /** Neuer Gesamtstand der Zahlungen, brutto. */
      bezahlt: number;
      /** Was danach noch offen ist. */
      rest: number;
      vollstaendig: boolean;
    }
  | { ok: false; fehler: ZahlungFehler; offen: number };

export const ZAHLUNG_FEHLER: Record<ZahlungFehler, string> = {
  nichts_offen: "An diesem Beleg ist nichts mehr offen.",
  kein_betrag: "Ohne Betrag ist nichts zu buchen.",
  /*
   * Überzahlung wird abgewiesen, nicht verbucht.
   *
   * Zulassen hiesse, einen negativen offenen Posten zu führen, den
   * weder die Postenliste noch der Buchhaltungsexport als Guthaben
   * darstellen können — und der Betrieb müsste das Geld zurückzahlen,
   * wovon in der Software nichts stünde. Wer zu viel bekommt, erfasst
   * den Rechnungsbetrag und klärt die Differenz dort, wo sie hingehört:
   * in der Buchhaltung. Ein Guthabenkonto ist ein eigenes Thema und
   * keine Nebenwirkung der Zahlungserfassung.
   */
  ueberzahlung: "Mehr als offen ist, lässt sich nicht buchen.",
};

/**
 * Eine Zahlung auf einen Beleg buchen.
 *
 * Addiert, nicht ersetzt: zwei Teilzahlungen hintereinander ergeben die
 * Summe, nicht die letzte. Gerundet wird kaufmännisch auf beiden Seiten
 * (CLAUDE.md 5.2), sonst wandert bei drei Teilzahlungen ein Cent.
 */
export function zahlungBuchen(p: {
  soll: number;
  bisher: number;
  betrag: number;
}): Buchung {
  const soll = round2(p.soll);
  const bisher = round2(p.bisher);
  const betrag = round2(p.betrag);
  const offen = restbetrag(soll, bisher);

  if (offen === 0) return { ok: false, fehler: "nichts_offen", offen };
  if (betrag <= CENT_TOLERANZ) return { ok: false, fehler: "kein_betrag", offen };
  if (betrag > offen + CENT_TOLERANZ) {
    return { ok: false, fehler: "ueberzahlung", offen };
  }

  const bezahlt = round2(bisher + betrag);
  const rest = restbetrag(soll, bezahlt);

  return { ok: true, bezahlt, rest, vollstaendig: rest === 0 };
}

/* ------------------------------------------------------------- STORNO */

export type StornoFehler = "schon_storniert" | "entwurf" | "kein_grund" | "keine_rechnung";

export const STORNO_FEHLER: Record<StornoFehler, string> = {
  schon_storniert: "Dieser Beleg ist bereits storniert.",
  entwurf:
    "Ein Entwurf wird verworfen, nicht storniert — er hat den Betrieb nie verlassen.",
  kein_grund: "Ein Storno braucht einen Grund.",
  keine_rechnung: "Stornieren lässt sich nur eine Rechnung.",
};

/** Belegarten, die überhaupt storniert werden können. */
export const STORNIERBAR: readonly string[] = ["anzahlungsrechnung", "schlussrechnung"];

/**
 * Darf dieser Beleg storniert werden?
 *
 * Reine Prüfung, damit die Reihenfolge der Gründe testbar ist und nicht
 * davon abhängt, wie eine Action ihre `if`-Zweige sortiert hat.
 *
 * Eine bereits bezahlte Rechnung ist ausdrücklich stornierbar: eine
 * Rechnungsberichtigung ist auch dann zulässig, wenn das Geld schon da
 * ist. Dass es zurückgehen muss, gehört in den Grund und in den
 * Ereignisstrom — die Software bucht keine Rückzahlung.
 */
export function stornoPruefen(beleg: {
  typ: string;
  status: string | null;
  grund: string;
}): { ok: true } | { ok: false; fehler: StornoFehler } {
  if (!STORNIERBAR.includes(beleg.typ)) {
    return { ok: false, fehler: "keine_rechnung" };
  }
  if (beleg.status === "storniert") return { ok: false, fehler: "schon_storniert" };
  if (beleg.status === "entwurf" || beleg.status === null) {
    return { ok: false, fehler: "entwurf" };
  }
  if (beleg.grund.trim().length < 4) return { ok: false, fehler: "kein_grund" };
  return { ok: true };
}
