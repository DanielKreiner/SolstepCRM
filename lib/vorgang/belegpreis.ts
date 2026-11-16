/*
 * Der Betrag eines Belegs — aus den Zeilen, wie sie in der Datenbank stehen.
 *
 * Warum es dieses Modul gibt: `lib/vorgang/preis.ts` rechnet richtig, kennt
 * aber nur eigene Typen. Die Aufrufer in der Kaskade, im Rechnungslauf und
 * in der PDF-Erzeugung haben stattdessen `summen()` aus `modell.ts` benutzt,
 * und das addiert bloss `menge × ep_netto`: ohne Positionsrabatt, ohne
 * Paketpreis einer Gruppe, ohne Lieferkosten und ohne die optionalen
 * Positionen auszunehmen.
 *
 * Damit konnte das Angebot gar nicht denselben Betrag zeigen wie die
 * Auftragsbestätigung. Nachgerechnet an V-2026-0392: das Angebot wies
 * 14.521,02 netto aus, die Auftragsbestätigung 14.860,21 — die Differenz
 * war genau die eine optionale Position, die der Kunde nicht gewählt hatte.
 *
 * `summen()` bleibt für das, wofür es taugt: Sollstunden und
 * Materialeinkauf. Das sind interne Kennzahlen, die nichts mit dem
 * Kundenbetrag zu tun haben.
 */

import {
  berechne,
  type Angebotsrahmen,
  type Preis,
  type PreisGruppe,
  type PreisPosition,
} from "./preis";

/** Eine Zeile aus `vorgang_position`, so wie sie die Abfrage liefert. */
export interface BelegPositionRoh {
  id?: string | null;
  gruppe_id?: string | null;
  menge: number | string;
  ep_netto: number | string;
  rabatt_prozent?: number | string | null;
  ust_satz?: number | string | null;
  optional?: boolean | null;
  kunden_auswahl?: string | null;
  kalk_ek?: number | string | null;
}

/** Eine Zeile aus `vorgang_gruppe`. */
export interface BelegGruppeRoh {
  id: string;
  paket_preis?: number | string | null;
}

function zahl(x: number | string | null | undefined): number {
  const n = typeof x === "string" ? Number(x) : x;
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

/*
 * Ob eine optionale Position zählt, steht in `kunden_auswahl`. Erlaubt sind
 * laut 0041_angebot_gruppen.sql nur 'standard', 'gewaehlt', 'abgewaehlt'
 * und 'upgraded'. Ein Upgrade ist eine Wahl des Kunden und zählt deshalb
 * genauso wie ein gesetztes Häkchen.
 */
export function istGewaehlt(kundenAuswahl: string | null | undefined): boolean {
  return kundenAuswahl === "gewaehlt" || kundenAuswahl === "upgraded";
}

export function alsPreisPosition(p: BelegPositionRoh, index: number): PreisPosition {
  const optional = p.optional === true;
  return {
    id: p.id ?? String(index),
    gruppeId: p.gruppe_id ?? null,
    menge: zahl(p.menge),
    epNetto: zahl(p.ep_netto),
    rabattProzent: zahl(p.rabatt_prozent),
    ...(p.ust_satz === null || p.ust_satz === undefined ? {} : { ustSatz: zahl(p.ust_satz) }),
    optional,
    /*
     * `gewaehlt` nur bei optionalen Positionen setzen: bei festen Zeilen
     * ist das Feld bedeutungslos, und `exactOptionalPropertyTypes` lässt
     * ein explizites `undefined` nicht zu.
     */
    ...(optional ? { gewaehlt: istGewaehlt(p.kunden_auswahl) } : {}),
    kalkEk: p.kalk_ek === null || p.kalk_ek === undefined ? null : zahl(p.kalk_ek),
  };
}

export function alsPreisGruppe(g: BelegGruppeRoh): PreisGruppe {
  return {
    id: g.id,
    paketPreis:
      g.paket_preis === null || g.paket_preis === undefined ? null : zahl(g.paket_preis),
  };
}

/**
 * Der Betrag eines Belegs: dieselbe Rechnung, die Editor, Angebots-PDF und
 * Kundenportal zeigen.
 */
export function belegPreis(
  positionen: readonly BelegPositionRoh[],
  gruppen: readonly BelegGruppeRoh[],
  rahmen: Angebotsrahmen,
): Preis {
  return berechne(positionen.map(alsPreisPosition), gruppen.map(alsPreisGruppe), rahmen);
}

/**
 * Nettoanteil eines Bruttoteilbetrags.
 *
 * Vorher stand an zwei Stellen `brutto / 1.2`. Der Steuersatz hängt aber am
 * Vorgang (`vorgang.ust_satz`) und ist für einen deutschen Mandanten mit
 * dem PV-Nullsteuersatz 0. Dort wurden damit aus 3.000 € Anzahlung 2.500 €
 * netto und 500 € Umsatzsteuer gebucht, die nie in Rechnung gestellt wurde —
 * der Umsatzbericht und der Buchhaltungsexport leiten beide aus dieser
 * Differenz ab.
 */
export function nettoAus(brutto: number, ustSatz: number): number {
  const teiler = 1 + ustSatz / 100;
  if (teiler <= 0) return Math.round(brutto * 100) / 100;
  return Math.round((brutto / teiler) * 100) / 100;
}
