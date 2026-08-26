import { MODELL, rechne, type WirtschaftEingaben } from "./wirtschaft";

/*
 * Wohin geht der Strom, und woher kommt er?
 *
 * Das Jahresmodell in `wirtschaft.ts` sagt, wie viel vom erzeugten
 * Strom im Haus bleibt. Für das Angebot reicht das nicht: Der Kunde
 * will sehen, welcher Teil direkt verbraucht wird, welcher über den
 * Speicher läuft und was ins Netz geht — und umgekehrt, woher der Strom
 * im Haus kommt. Genau diese zwei Bilder entscheiden im Gespräch über
 * den Speicher.
 *
 * Zwei Grundsätze:
 *
 * 1. KEIN zweites Modell. Die Jahreszahlen kommen weiter aus `rechne`;
 *    hier wird nur aufgeteilt. Zwei Rechnungen nebeneinander ergäben
 *    zwei Autarkiequoten in einem Dokument.
 * 2. Der Speicheranteil ist die DIFFERENZ zur selben Anlage ohne
 *    Speicher. Damit ist er nicht geschätzt, sondern genau das, was der
 *    Speicher im Modell bewirkt — und dieselbe Rechnung trägt den
 *    Vergleich „mit oder ohne", den der Betrieb im Gespräch braucht.
 *
 * Die Monatsaufteilung ist eine VERTEILUNG der Jahreswerte, keine
 * Simulation. Ein Viertelstundenmodell wäre genauer und würde beim
 * Kunden am Tisch nichts ändern.
 */

/** Wie sich der Haushaltsverbrauch übers Jahr verteilt. */
const VERBRAUCHSPROFIL = [
  1.19, 1.09, 1.01, 0.92, 0.87, 0.83, 0.83, 0.85, 0.9, 1.0, 1.11, 1.2,
];

export interface Energiefluss {
  produktionKwh: number;
  verbrauchKwh: number;
  /** Direkt verbraucht, ohne Umweg über den Speicher. */
  direktKwh: number;
  /** Was über den Speicher ins Haus geht. */
  speicherKwh: number;
  einspeisungKwh: number;
  netzbezugKwh: number;
  /** Anteil des erzeugten Stroms, der im Haus bleibt. */
  eigenverbrauchQuote: number;
  autarkie: number;
  monate: Array<{
    produktion: number;
    verbrauch: number;
    direkt: number;
    speicher: number;
    einspeisung: number;
    netz: number;
  }>;
}

export interface FlussEingabe extends WirtschaftEingaben {
  /** Monatserträge in kWh, zwölf Werte. */
  monateKwh: number[];
}

function summe(werte: number[]): number {
  return werte.reduce((a, b) => a + b, 0);
}

/** Einen Jahreswert nach Gewichten verteilen, ohne eine Obergrenze zu reissen. */
function verteile(gesamt: number, gewichte: number[], grenzen: number[]): number[] {
  const g = summe(gewichte);
  if (gesamt <= 0 || g <= 0) return gewichte.map(() => 0);

  const roh = gewichte.map((w, i) => Math.min(grenzen[i] ?? 0, (gesamt * w) / g));
  /*
   * Was durch die Obergrenzen liegen bleibt, wird auf die Monate mit
   * Luft verteilt. Ohne diesen zweiten Durchgang stimmte die Summe der
   * Balken nicht mit der Jahreszahl darüber überein — und genau das
   * fällt einem Kunden auf.
   */
  let rest = gesamt - summe(roh);
  for (let runde = 0; runde < 3 && rest > 0.01; runde++) {
    const luft = roh.map((w, i) => Math.max(0, (grenzen[i] ?? 0) - w));
    const l = summe(luft);
    if (l <= 0) break;
    for (let i = 0; i < roh.length; i++) {
      roh[i] = (roh[i] ?? 0) + (rest * (luft[i] ?? 0)) / l;
    }
    rest = gesamt - summe(roh);
  }
  return roh;
}

export function energiefluss(e: FlussEingabe): Energiefluss {
  const mit = rechne(e);
  /*
   * Dieselbe Anlage ohne Speicher — daraus ergibt sich, was der
   * Speicher tatsächlich beiträgt.
   */
  const ohne = rechne({ ...e, speicherKwh: 0 });

  const produktion = e.ertragKwh;
  const verbrauch = e.verbrauchKwh;
  const direkt = Math.min(ohne.eigenverbrauchKwh, mit.eigenverbrauchKwh);
  const ueberSpeicher = Math.max(0, mit.eigenverbrauchKwh - direkt);

  const monate =
    e.monateKwh.length === 12 && summe(e.monateKwh) > 0
      ? e.monateKwh
      : Array.from({ length: 12 }, () => produktion / 12);
  const faktor = produktion > 0 ? produktion / summe(monate) : 0;
  const pM = monate.map((m) => m * faktor);

  const profil = summe(VERBRAUCHSPROFIL);
  const vM = VERBRAUCHSPROFIL.map((f) => (verbrauch * f) / profil);

  const direktM = verteile(
    direkt,
    pM.map((p, i) => Math.min(p, vM[i] ?? 0)),
    pM.map((p, i) => Math.min(p, vM[i] ?? 0)),
  );
  const speicherGrenzen = pM.map((p, i) =>
    Math.max(0, Math.min(p - (direktM[i] ?? 0), (vM[i] ?? 0) - (direktM[i] ?? 0))),
  );
  const speicherM = verteile(ueberSpeicher, speicherGrenzen, speicherGrenzen);

  return {
    produktionKwh: produktion,
    verbrauchKwh: verbrauch,
    direktKwh: direkt,
    speicherKwh: ueberSpeicher,
    einspeisungKwh: mit.einspeisungKwh,
    netzbezugKwh: Math.max(0, verbrauch - mit.eigenverbrauchKwh),
    eigenverbrauchQuote: mit.evQuote,
    autarkie: mit.autarkie,
    monate: pM.map((p, i) => {
      const d = direktM[i] ?? 0;
      const s = speicherM[i] ?? 0;
      return {
        produktion: p,
        verbrauch: vM[i] ?? 0,
        direkt: d,
        speicher: s,
        einspeisung: Math.max(0, p - d - s),
        netz: Math.max(0, (vM[i] ?? 0) - d - s),
      };
    }),
  };
}

export interface SpeicherVergleich {
  mit: Kennwerte;
  ohne: Kennwerte;
  /** Der angesetzte Speicherpreis, nach dem Deckel. */
  preis: number;
  /** Was der Speicher zusätzlich bringt — die Zahlen für das Gespräch. */
  mehrAutarkie: number;
  mehrErsparnisJahr: number;
  wenigerNetzbezugKwh: number;
}

export interface Kennwerte {
  autarkie: number;
  eigenverbrauchQuote: number;
  netzbezugKwh: number;
  ersparnisJahr1: number;
  investition: number;
  amortisationJahre: number | null;
  ersparnis20: number;
}

function kennwerte(e: WirtschaftEingaben): Kennwerte {
  const r = rechne(e);
  return {
    autarkie: r.autarkie,
    eigenverbrauchQuote: r.evQuote,
    netzbezugKwh: Math.max(0, e.verbrauchKwh - r.eigenverbrauchKwh),
    ersparnisJahr1: r.ersparnisJahr1,
    investition: r.investition,
    amortisationJahre: r.amortisationJahre,
    ersparnis20: (r.kurve[r.kurve.length - 1] ?? 0) + r.investition,
  };
}

/**
 * Mit Speicher oder ohne — dieselbe Anlage, zwei Rechnungen.
 *
 * Die Frage kommt in jedem Gespräch, und sie wird heute mit Bauchgefühl
 * beantwortet. Der Preis des Speichers wird dabei aus dem Angebot
 * herausgerechnet: Ohne ihn ist die Anlage billiger, deckt aber weniger.
 * Genau diese beiden Zahlen nebeneinander sind die Entscheidung.
 */
export function speicherVergleich(
  e: WirtschaftEingaben,
  speicherPreis: number,
): SpeicherVergleich {
  const mit = kennwerte(e);
  /*
   * Der Speicherpreis wird gedeckelt. Steht im Angebot noch kein
   * Speicher, greift der Richtwert je kWh — und der kann grösser sein
   * als die ganze Angebotssumme. Ohne Deckel stünde dann „Investition
   * 0 €, bezahlt nach 0 Jahren" in der Gegenrechnung, und das glaubt
   * einem zu Recht niemand.
   */
  const preis = Math.min(Math.max(0, speicherPreis), e.anlagenpreis * 0.7);
  const ohne = kennwerte({
    ...e,
    speicherKwh: 0,
    anlagenpreis: Math.max(0, e.anlagenpreis - preis),
  });
  return {
    mit,
    ohne,
    preis,
    mehrAutarkie: mit.autarkie - ohne.autarkie,
    mehrErsparnisJahr: mit.ersparnisJahr1 - ohne.ersparnisJahr1,
    wenigerNetzbezugKwh: ohne.netzbezugKwh - mit.netzbezugKwh,
  };
}

/**
 * Rendite pro Jahr, wie sie im Angebot steht.
 *
 * Die mittlere Ersparnis über den Betrachtungszeitraum, gemessen an der
 * Investition. Keine interne Zinsfussrechnung — die wäre genauer und
 * für ein Angebotsblatt nicht erklärbar. Was hier steht, kann der Kunde
 * mit dem Taschenrechner nachvollziehen.
 */
export function renditeProJahr(ersparnis20: number, investition: number): number | null {
  if (!(investition > 0) || !(ersparnis20 > 0)) return null;
  return ersparnis20 / MODELL.jahre / investition;
}
