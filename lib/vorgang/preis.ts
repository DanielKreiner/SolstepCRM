/*
 * Was ein Angebot kostet.
 *
 * Eigenes Modul, weil dieselbe Rechnung an fünf Stellen gebraucht wird:
 * im Editor, in der Zusammenfassung, im PDF, im Kundenportal und beim
 * Erzeugen der Rechnungen. Fünf Implementierungen wären fünf Anlässe für
 * einen Vorgang, dessen Angebot einen anderen Betrag zeigt als seine
 * Rechnung — und das merkt der Kunde beim Vergleich.
 *
 * Die Reihenfolge ist nicht beliebig:
 *
 *   1. Je Position: Menge × VK, dann Positionsrabatt
 *   2. Je Gruppe: entweder die Summe ihrer Positionen oder der
 *      Paketpreis, der sie überschreibt
 *   3. Gesamtrabatt auf die Summe aller Gruppen und freien Positionen
 *   4. Umsatzsteuer auf das rabattierte Netto
 *   5. Lieferung getrennt, mit eigener Steuer
 *
 * Gerundet wird auf Positionsebene (CLAUDE.md Abschnitt 5, Punkt 2).
 */

export type PreisPosition = {
  id: string;
  gruppeId: string | null;
  menge: number;
  epNetto: number;
  rabattProzent: number;
  /** Optionale Positionen zählen erst, wenn der Kunde sie ankreuzt. */
  optional: boolean;
  /** Vom Kunden angekreuzt? Nur bei optionalen Positionen von Belang. */
  gewaehlt?: boolean;
  kalkEk?: number | null;
};

export type PreisGruppe = {
  id: string;
  /** Überschreibt die Summe der enthaltenen Positionen. */
  paketPreis: number | null;
};

export type Angebotsrahmen = {
  ustSatz: number;
  rabattProzent: number;
  lieferungNetto: number;
};

export type Preis = {
  /** Summe aller zählenden Positionen und Pakete, vor Gesamtrabatt. */
  positionenNetto: number;
  gesamtRabatt: number;
  netto: number;
  ust: number;
  brutto: number;
  lieferungNetto: number;
  lieferungBrutto: number;
  /** Was der Kunde zahlt: Brutto plus Lieferung. */
  gesamt: number;
  /** Einkauf über alles, was zählt. */
  ek: number;
  marge: number;
  margeProzent: number;
  /** Was zusätzlich käme, wenn der Kunde alle Optionen ankreuzt. */
  optionalNetto: number;
};

/** Zählt diese Position in die Summe? */
export function zaehlt(p: PreisPosition): boolean {
  return !p.optional || p.gewaehlt === true;
}

/** Zeilenbetrag netto nach Positionsrabatt. */
export function zeilenNetto(p: PreisPosition): number {
  const roh = p.menge * p.epNetto;
  return runde2(roh * (1 - p.rabattProzent / 100));
}

/**
 * Netto einer Gruppe.
 *
 * Der Paketpreis gewinnt gegen die Summe. Das ist der Sinn der Sache:
 * der Betrieb hat einen Preis verhandelt, und der gilt — auch wenn die
 * Einzelteile zusammen woanders landen.
 *
 * Optionale Positionen einer Gruppe bleiben aussen vor, auch bei
 * Paketpreis: sonst wäre eine abgewählte Option im Paket doch bezahlt.
 */
export function gruppenNetto(
  gruppe: PreisGruppe,
  positionen: readonly PreisPosition[],
): number {
  const drin = positionen.filter((p) => p.gruppeId === gruppe.id && zaehlt(p));
  const optionaleDrin = positionen.filter(
    (p) => p.gruppeId === gruppe.id && p.optional && p.gewaehlt === true,
  );

  if (gruppe.paketPreis !== null) {
    /* Paketpreis plus die Optionen, die der Kunde dazugenommen hat. */
    return runde2(
      gruppe.paketPreis +
        optionaleDrin.reduce((s, p) => s + zeilenNetto(p), 0),
    );
  }
  return runde2(drin.reduce((s, p) => s + zeilenNetto(p), 0));
}

export function berechne(
  positionen: readonly PreisPosition[],
  gruppen: readonly PreisGruppe[],
  rahmen: Angebotsrahmen,
): Preis {
  const gruppenIds = new Set(gruppen.map((g) => g.id));

  let positionenNetto = 0;
  for (const g of gruppen) positionenNetto += gruppenNetto(g, positionen);

  /* Freie Positionen — alles ohne Gruppe oder mit einer, die es nicht gibt. */
  for (const p of positionen) {
    if (p.gruppeId !== null && gruppenIds.has(p.gruppeId)) continue;
    if (!zaehlt(p)) continue;
    positionenNetto += zeilenNetto(p);
  }
  positionenNetto = runde2(positionenNetto);

  const gesamtRabatt = runde2(
    (positionenNetto * rahmen.rabattProzent) / 100,
  );
  const netto = runde2(positionenNetto - gesamtRabatt);
  const ust = runde2((netto * rahmen.ustSatz) / 100);
  const brutto = runde2(netto + ust);

  const lieferungBrutto = runde2(
    rahmen.lieferungNetto * (1 + rahmen.ustSatz / 100),
  );

  /*
   * Einkauf über alles, was zählt — auch in Gruppen mit Paketpreis. Der
   * Paketpreis ändert den Verkauf, nicht den Einkauf; sonst zeigte die
   * Marge eine Zahl, die niemand bezahlt hat.
   */
  let ek = 0;
  for (const p of positionen) {
    if (!zaehlt(p)) continue;
    ek += runde2(p.menge * (p.kalkEk ?? 0));
  }
  ek = runde2(ek);

  const optionalNetto = runde2(
    positionen
      .filter((p) => p.optional && p.gewaehlt !== true)
      .reduce((s, p) => s + zeilenNetto(p), 0),
  );

  const marge = runde2(netto - ek);

  return {
    positionenNetto,
    gesamtRabatt,
    netto,
    ust,
    brutto,
    lieferungNetto: runde2(rahmen.lieferungNetto),
    lieferungBrutto,
    gesamt: runde2(brutto + lieferungBrutto),
    ek,
    marge,
    margeProzent: netto > 0 ? Math.round((marge / netto) * 10000) / 100 : 0,
    optionalNetto,
  };
}

function runde2(n: number): number {
  /*
   * Über Cent und nicht über toFixed: 1.005 rundet in JavaScript wegen
   * der Fliesskommadarstellung sonst auf 1,00 statt 1,01.
   */
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
