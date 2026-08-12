/*
 * Verschattung (BRIEFING-planer-3d.md, Stufe 3D-3).
 *
 * Ein Baum vor dem Dach oder das Nachbarhaus im Süden kosten Ertrag,
 * und zwar nicht wenig: Ein Modul, das im Winter zwei Stunden im
 * Schatten liegt, bringt über das Jahr merkbar weniger. Wer das
 * unterschlägt, verspricht einen Ertrag, den die Anlage nie liefert —
 * und der Kunde merkt es nach der ersten Jahresabrechnung.
 *
 * Gerechnet wird geometrisch, nicht geraten: Für jedes Modul und jeden
 * Stichzeitpunkt wird geprüft, ob auf dem Weg zur Sonne ein Objekt
 * steht. Der Verschattungsgrad ist der gewichtete Anteil der
 * Zeitpunkte, an denen das der Fall ist.
 *
 * Was hier NICHT passiert: diffuses Licht. Ein verschattetes Modul
 * liefert auch im Schatten noch etwas — Himmelsstreulicht, das im
 * Ertragsmodell steckt. Deshalb wirkt die Verschattung gedämpft und
 * nicht als vollständiger Ausfall; der Dämpfungsfaktor steht als
 * benannte Konstante unten.
 */

import type { Meter } from "./geo";
import { falllinie, punktInPolygon } from "./flaeche";
import { aktiveZellen, modulMitte } from "./module";
import type { Plan } from "./plan";
import { sonnenrichtung, sonnenstand, stichpunkte } from "./sonne";

/**
 * Wie stark eine volle Verschattung den Ertrag eines Moduls senkt.
 *
 * Nicht 1,0: Ein Modul im Schatten bekommt weiterhin diffuses
 * Himmelslicht, in Mitteleuropa je nach Jahreszeit ein Viertel bis ein
 * Drittel der Gesamteinstrahlung. 0,75 heisst: Wer ganztägig im
 * Schatten liegt, verliert drei Viertel — nicht alles.
 */
export const SCHATTEN_WIRKUNG = 0.75;

export type Objektart = "baum" | "gebaeude";

export interface Verschattungsobjekt {
  id: string;
  art: Objektart;
  name: string;
  /** Höhe über dem Gelände in Metern. */
  hoehe: number;
  /*
   * Die drei Felder tragen ein ausdrückliches `undefined`: Bei
   * `exactOptionalPropertyTypes` ist „Feld fehlt" nicht dasselbe wie
   * „Feld ist undefined", und aus dem Plan-Schema kommt Letzteres.
   */
  /** Beim Baum: Mittelpunkt der Krone. Beim Gebäude ungenutzt. */
  mitte?: Meter | undefined;
  /** Beim Baum: Kronenradius in Metern. */
  radius?: number | undefined;
  /** Beim Gebäude: Grundriss in der Draufsicht. */
  punkte?: Meter[] | undefined;
}

/**
 * Liegt der Punkt zu diesem Zeitpunkt im Schatten?
 *
 * `sonne` ist der Einheitsvektor ZUR Sonne. Geprüft wird der Strahl von
 * `punkt` in diese Richtung: Steht ein Objekt darauf, ist der Punkt
 * verschattet.
 */
export function imSchatten(
  punkt: { x: number; y: number; z: number },
  sonne: { x: number; y: number; z: number },
  objekte: Verschattungsobjekt[],
): boolean {
  // Sonne unter dem Horizont: dann ist alles dunkel, aber nicht
  // „verschattet" — das gehört in die Nachtstunden, nicht in die
  // Verschattungsbilanz.
  if (sonne.z <= 0.01) return false;

  for (const o of objekte) {
    if (o.hoehe <= 0) continue;
    if (o.art === "baum" && o.mitte && o.radius) {
      if (baumImWeg(punkt, sonne, o.mitte, o.radius, o.hoehe)) return true;
    } else if (o.art === "gebaeude" && o.punkte && o.punkte.length >= 3) {
      if (gebaeudeImWeg(punkt, sonne, o.punkte, o.hoehe)) return true;
    }
  }
  return false;
}

/**
 * Baum als stehender Zylinder.
 *
 * Vereinfacht gegenüber einer Krone, und zwar bewusst: Ein Zylinder
 * verschattet etwas mehr als eine Kugel, liegt also auf der sicheren
 * Seite. Einen Ertrag zu hoch zu versprechen ist der teurere Fehler.
 */
function baumImWeg(
  punkt: { x: number; y: number; z: number },
  sonne: { x: number; y: number; z: number },
  mitte: Meter,
  radius: number,
  hoehe: number,
): boolean {
  /*
   * In der Draufsicht: Abstand der Zylinderachse von der Strahllinie.
   * Nur der Teil des Strahls VOR dem Punkt zählt — ein Baum hinter dem
   * Modul wirft keinen Schatten darauf.
   */
  const richtung = { x: sonne.x, y: sonne.y };
  const laenge = Math.hypot(richtung.x, richtung.y);
  if (laenge < 1e-9) {
    // Sonne im Zenit: nur ein Objekt direkt über dem Punkt verschattet.
    return Math.hypot(mitte.x - punkt.x, mitte.y - punkt.y) <= radius && hoehe > punkt.z;
  }
  const e = { x: richtung.x / laenge, y: richtung.y / laenge };

  const zumBaum = { x: mitte.x - punkt.x, y: mitte.y - punkt.y };
  const laengs = zumBaum.x * e.x + zumBaum.y * e.y;
  if (laengs <= 0) return false; // liegt entgegen der Sonnenrichtung

  const quer = Math.abs(zumBaum.x * e.y - zumBaum.y * e.x);
  if (quer > radius) return false;

  /*
   * Höhe des Strahls an der Stelle des Baums. Der Strahl steigt mit
   * dem Tangens der Sonnenhöhe: z je Meter waagrechter Strecke.
   */
  const steigung = sonne.z / laenge;
  const hoeheDort = punkt.z + laengs * steigung;
  return hoeheDort < hoehe;
}

/** Nachbargebäude als Prisma über seinem Grundriss. */
function gebaeudeImWeg(
  punkt: { x: number; y: number; z: number },
  sonne: { x: number; y: number; z: number },
  grundriss: Meter[],
  hoehe: number,
): boolean {
  const richtung = { x: sonne.x, y: sonne.y };
  const laenge = Math.hypot(richtung.x, richtung.y);
  if (laenge < 1e-9) {
    return punktInPolygon({ x: punkt.x, y: punkt.y }, grundriss) && hoehe > punkt.z;
  }
  const e = { x: richtung.x / laenge, y: richtung.y / laenge };
  const steigung = sonne.z / laenge;

  /*
   * Den Strahl in Schritten abtasten, statt jede Polygonkante zu
   * schneiden. Ein halber Meter Schrittweite ist feiner als jedes
   * Gebäude, das noch Schatten wirft, und die Rechnung bleibt kurz —
   * das zählt, weil sie für jedes Modul und jeden Zeitpunkt läuft.
   *
   * Weiter als 80 m wird nicht gesucht: Ein Gebäude, das von dort noch
   * auf das Dach reicht, müsste über dreissig Meter hoch sein.
   */
  for (let d = 0.5; d <= 80; d += 0.5) {
    const hoeheDort = punkt.z + d * steigung;
    if (hoeheDort >= hoehe) return false; // ab hier ist der Strahl darüber
    const p = { x: punkt.x + e.x * d, y: punkt.y + e.y * d };
    if (punktInPolygon(p, grundriss)) return true;
  }
  return false;
}

export interface VerschattungErgebnis {
  /** Gewichteter Anteil verschatteter Zeit, 0 bis 1. */
  grad: number;
  /** Faktor auf den Ertrag: 1 heisst unverschattet. */
  faktor: number;
}

/**
 * Verschattung eines einzelnen Modulpunkts über das Jahr.
 *
 * Gewichtet wird mit den Stichpunkten aus `sonne.ts` — eine Stunde
 * Schatten im Juni zu Mittag wiegt weit mehr als eine im Dezember bei
 * Sonnenaufgang.
 */
export function verschattungAm(
  punkt: { x: number; y: number; z: number },
  objekte: Verschattungsobjekt[],
  ort: { lat: number; lon: number },
  jahr: number,
): VerschattungErgebnis {
  if (objekte.length === 0) return { grad: 0, faktor: 1 };

  let beschattet = 0;
  let gesamt = 0;

  for (const sp of stichpunkte(jahr)) {
    const stand = sonnenstand(ort.lat, ort.lon, sp.zeit);
    if (stand.hoehe <= 0) continue; // Nacht trägt nichts bei
    gesamt += sp.gewicht;
    if (imSchatten(punkt, sonnenrichtung(stand), objekte)) beschattet += sp.gewicht;
  }

  const grad = gesamt > 0 ? beschattet / gesamt : 0;
  return { grad, faktor: 1 - grad * SCHATTEN_WIRKUNG };
}

/**
 * Verschattung für eine ganze Modulgruppe.
 *
 * Geprüft wird die Mitte jedes Moduls, nicht jede Ecke: Ein Modul, das
 * halb im Schatten liegt, ist elektrisch ohnehin fast so schlecht wie
 * ein ganz verschattetes — die Zellen sind in Reihe.
 */
export function verschattungJeModul(
  module: Array<{ schluessel: string; mitte: { x: number; y: number; z: number } }>,
  objekte: Verschattungsobjekt[],
  ort: { lat: number; lon: number },
  jahr: number,
): Map<string, VerschattungErgebnis> {
  const aus = new Map<string, VerschattungErgebnis>();
  for (const m of module) {
    aus.set(m.schluessel, verschattungAm(m.mitte, objekte, ort, jahr));
  }
  return aus;
}

/**
 * Mittlerer Ertragsfaktor über alle Module.
 *
 * Das ist die Zahl, die in den Ertrag eingeht. Ungewichtet, weil alle
 * Module dieselbe Leistung haben — sobald es gemischte Typen gibt,
 * muss hier nach kWp gewichtet werden.
 */
export function mittlererFaktor(ergebnisse: Map<string, VerschattungErgebnis>): number {
  if (ergebnisse.size === 0) return 1;
  let summe = 0;
  for (const e of ergebnisse.values()) summe += e.faktor;
  return summe / ergebnisse.size;
}

/*
 * ── Verschattung einer ganzen Planung ──────────────────────────────
 */

/** Bezugsjahr — der Sonnenlauf wiederholt sich, das Jahr ist beliebig. */
export const VERSCHATTUNGSJAHR = 2026;

/**
 * Verschattung aller Module einer Planung.
 *
 * Diese Funktion ist die EINZIGE Stelle, an der aus einem Plan ein
 * Verschattungsfaktor wird — der Bildschirm und das PDF rufen dieselbe
 * auf. Der erste Anlauf rechnete den Faktor nur im Hook: Auf dem
 * Bildschirm stand der geminderte Ertrag, im PDF beim Kunden der
 * ungeminderte. Zwei Zahlen für dieselbe Anlage, und die höhere lag beim
 * Kunden auf dem Tisch.
 *
 * `hoeheUeberGelaende` ist die Höhe der Traufe; ab dort steigt das Dach
 * mit seiner Neigung. Ein Dach vier Meter höher steht über manchem Baum.
 */
export function anlagenVerschattung(
  plan: Plan,
  ort: { lat: number; lon: number },
  hoeheUeberGelaende: number,
  jahr: number = VERSCHATTUNGSJAHR,
): { faktor: number; jeModul: Map<string, VerschattungErgebnis> } {
  const leer = new Map<string, VerschattungErgebnis>();
  if (plan.objekte.length === 0) return { faktor: 1, jeModul: leer };

  const punkte: Array<{ schluessel: string; mitte: { x: number; y: number; z: number } }> = [];
  for (const g of plan.gruppen) {
    const f = plan.flaechen.find((x) => x.id === g.flaeche);
    if (!f) continue;
    const fall = falllinie(f);
    const steig = Math.tan((f.neigung * Math.PI) / 180);
    const a = f.traufe !== null ? f.punkte[f.traufe % f.punkte.length]! : f.punkte[0]!;
    for (const z of aktiveZellen(g)) {
      const m = modulMitte(g, f, z.reihe, z.spalte);
      const hoehe =
        hoeheUeberGelaende + (fall ? ((m.x - a.x) * fall.x + (m.y - a.y) * fall.y) * steig : 0);
      punkte.push({ schluessel: `${g.id}/${z.reihe}:${z.spalte}`, mitte: { ...m, z: hoehe } });
    }
  }
  if (punkte.length === 0) return { faktor: 1, jeModul: leer };

  const jeModul = verschattungJeModul(punkte, plan.objekte, ort, jahr);
  return { faktor: mittlererFaktor(jeModul), jeModul };
}
