/*
 * Gebäudemodell in drei Dimensionen (BRIEFING-planer-3d.md, Stufe 3D-1).
 *
 * Bisher war eine Dachfläche ein Polygon in der Draufsicht plus eine
 * Neigung — genug, um zu belegen und zu rechnen, aber nicht genug, um
 * etwas zu zeichnen, das nach einem Haus aussieht. Hier kommt die Höhe
 * dazu: Aus Grundriss, Dachtyp, Wandhöhe und Neigung entsteht ein
 * Körper mit Wänden und Dachflächen, jede Ecke mit ihrem z.
 *
 * Bewusst ohne Renderer. Die Geometrie ist der Teil, der falsch sein
 * kann, ohne dass es auffällt — ein Dach, dessen First einen halben
 * Meter zu hoch sitzt, sieht immer noch aus wie ein Dach. Deshalb steht
 * sie hier für sich und wird gegen nachgerechnete Werte geprüft.
 *
 * Die Draufsicht bleibt die Wahrheit für die Belegung: `dachflaechen`
 * liefert dieselben Polygone wie bisher, nur zusätzlich mit Höhen. Was
 * gerechnet wird, ändert sich dadurch nicht.
 */

import type { Meter } from "./geo";
import { grundflaeche, schwerpunkt } from "./flaeche";

/** Ein Punkt mit Höhe über dem Gelände. */
export interface Punkt3D {
  x: number;
  y: number;
  z: number;
}

export type Dachtyp = "flach" | "pult" | "sattel" | "walm";

export interface GebaeudeParameter {
  /** Grundriss in der Draufsicht, gegen den Uhrzeigersinn. */
  grundriss: Meter[];
  typ: Dachtyp;
  /** Höhe der Aussenwand bis zur Traufe, in Metern. */
  wandhoehe: number;
  /** Dachneigung in Grad. Beim Flachdach ohne Wirkung. */
  neigung: number;
  /**
   * Wie weit das Dach über die Wand hinausragt, in Metern. Wirkt nur
   * auf die Dachflächen, nicht auf die Wände.
   */
  ueberstand: number;
  /**
   * Index der Kante, die zur Traufe wird — bestimmt beim Pult- und
   * Satteldach, wohin es fällt. `null` heisst: die längste Kante.
   */
  traufe?: number | null;
}

export interface Gebaeude {
  /** Wandflächen als geschlossene Vielecke in 3D. */
  waende: Punkt3D[][];
  /** Dachflächen in 3D — was gezeichnet wird. */
  dachflaechen: Punkt3D[][];
  /** Höhe des höchsten Punktes über dem Gelände. */
  firsthoehe: number;
}

const GRAD = Math.PI / 180;

/**
 * Um wie viel eine Fläche über die Traufe hinaus ansteigt.
 *
 * Bei 30° Neigung und 4 m Sparrenlänge in der Draufsicht sind das
 * 4 · tan(30°) = 2,31 m. Nicht `sin` — die 4 m sind die waagrechte
 * Strecke, nicht die Sparrenlänge selbst.
 */
export function anstieg(waagrecht: number, neigungGrad: number): number {
  return waagrecht * Math.tan(neigungGrad * GRAD);
}

/** Index der längsten Kante — die Vorgabe für die Traufe. */
export function laengsteKante(punkte: Meter[]): number {
  let beste = 0;
  let laenge = -1;
  for (let i = 0; i < punkte.length; i++) {
    const a = punkte[i]!;
    const b = punkte[(i + 1) % punkte.length]!;
    const l = Math.hypot(b.x - a.x, b.y - a.y);
    if (l > laenge) {
      laenge = l;
      beste = i;
    }
  }
  return beste;
}

/** Einheitsvektor von der Traufkante ins Innere des Grundrisses. */
function richtungNachInnen(punkte: Meter[], kante: number): Meter {
  const n = punkte.length;
  const a = punkte[kante % n]!;
  const b = punkte[(kante + 1) % n]!;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l = Math.hypot(dx, dy) || 1;
  const normale = { x: -dy / l, y: dx / l };

  const mitte = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const s = schwerpunkt(punkte);
  const hin = normale.x * (s.x - mitte.x) + normale.y * (s.y - mitte.y) > 0;
  return hin ? normale : { x: -normale.x, y: -normale.y };
}

/** Abstand eines Punktes von der Traufkante, senkrecht gemessen. */
function abstandVonTraufe(p: Meter, a: Meter, nachInnen: Meter): number {
  return (p.x - a.x) * nachInnen.x + (p.y - a.y) * nachInnen.y;
}

/**
 * Das Gebäude bauen.
 *
 * Die Höhe jeder Dachecke folgt aus ihrem Abstand zur Traufe: an der
 * Traufe die Wandhöhe, weiter innen entsprechend höher. Damit stimmt
 * das Modell auch für Grundrisse, die kein Rechteck sind — beim Pult-
 * und Satteldach jedenfalls; das Walmdach verlangt einen echten
 * Grundriss-Skelettschnitt und ist deshalb auf Rechtecke beschränkt.
 */
export function gebaeude(p: GebaeudeParameter): Gebaeude {
  const grund = p.grundriss;
  if (grund.length < 3) {
    return { waende: [], dachflaechen: [], firsthoehe: p.wandhoehe };
  }

  const waende = wandflaechen(grund, p.wandhoehe);

  if (p.typ === "flach") {
    const dach = grund.map((q) => ({ x: q.x, y: q.y, z: p.wandhoehe }));
    return { waende, dachflaechen: [dach], firsthoehe: p.wandhoehe };
  }

  const kante = p.traufe ?? laengsteKante(grund);
  const nachInnen = richtungNachInnen(grund, kante);
  const a = grund[kante % grund.length]!;

  const abstaende = grund.map((q) => abstandVonTraufe(q, a, nachInnen));
  const tiefe = Math.max(...abstaende);

  if (p.typ === "pult") {
    /*
     * Eine Fläche, die von der Traufe zur Gegenseite ansteigt. Jede
     * Ecke bekommt ihre eigene Höhe — bei einem schiefen Grundriss ist
     * das kein ebenes Viereck mehr, aber genau das ist die Wahrheit
     * über so ein Dach.
     */
    const dach = grund.map((q, i) => ({
      x: q.x,
      y: q.y,
      z: p.wandhoehe + anstieg(abstaende[i]!, p.neigung),
    }));
    return {
      waende,
      dachflaechen: [dach],
      firsthoehe: p.wandhoehe + anstieg(tiefe, p.neigung),
    };
  }

  /*
   * Sattel- und Walmdach brauchen einen First. Er verläuft in der Mitte
   * zwischen Traufe und Gegenseite, parallel zur Traufe.
   */
  const halbe = tiefe / 2;
  const first = p.wandhoehe + anstieg(halbe, p.neigung);

  if (p.typ === "sattel") {
    const kanteEnde = grund[(kante + 1) % grund.length]!;
    const firstA = {
      x: a.x + nachInnen.x * halbe,
      y: a.y + nachInnen.y * halbe,
      z: first,
    };
    const firstB = {
      x: kanteEnde.x + nachInnen.x * halbe,
      y: kanteEnde.y + nachInnen.y * halbe,
      z: first,
    };

    /*
     * Zwei Trapeze: von der Traufkante zum First, und von der
     * Gegenkante zum First. Der Überstand verlängert beide nach aussen.
     */
    const vorne = [
      versetzt(a, nachInnen, -p.ueberstand, p.wandhoehe),
      versetzt(kanteEnde, nachInnen, -p.ueberstand, p.wandhoehe),
      firstB,
      firstA,
    ];

    // Die Gegenseite: die Kante mit dem grössten Abstand zur Traufe.
    const gegen = gegenkante(grund, abstaende, tiefe);
    const hinten = [
      versetzt(gegen.a, nachInnen, p.ueberstand, p.wandhoehe),
      versetzt(gegen.b, nachInnen, p.ueberstand, p.wandhoehe),
      firstA,
      firstB,
    ];

    return { waende, dachflaechen: [vorne, hinten], firsthoehe: first };
  }

  /*
   * Walmdach: vier Flächen, zwei Trapeze und zwei Dreiecke. Der First
   * ist kürzer als das Gebäude — er endet dort, wo die Walmflächen
   * ansetzen, also je einen halben Gebäudequerschnitt von den
   * Giebelseiten entfernt.
   *
   * Auf Rechtecke beschränkt: Für beliebige Grundrisse braucht es einen
   * Skelettschnitt, und ein halb richtiges Walmdach über einem L-Bau
   * wäre schlimmer als gar keines.
   */
  return walmdach(grund, kante, nachInnen, p, tiefe, first, waende);
}

function versetzt(q: Meter, richtung: Meter, um: number, z: number): Punkt3D {
  return { x: q.x + richtung.x * um, y: q.y + richtung.y * um, z };
}

/** Die Kante gegenüber der Traufe: beide Ecken am weitesten entfernt. */
function gegenkante(
  grund: Meter[],
  abstaende: number[],
  tiefe: number,
): { a: Meter; b: Meter } {
  const weit = grund
    .map((q, i) => ({ q, i, d: abstaende[i]! }))
    .filter((x) => Math.abs(x.d - tiefe) < 0.05);
  if (weit.length >= 2) return { a: weit[0]!.q, b: weit[weit.length - 1]!.q };
  // Entartet: nur eine Ecke ganz hinten — dann diese doppelt nehmen.
  const eine = weit[0]?.q ?? grund[0]!;
  return { a: eine, b: eine };
}

function walmdach(
  grund: Meter[],
  kante: number,
  nachInnen: Meter,
  p: GebaeudeParameter,
  tiefe: number,
  first: number,
  waende: Punkt3D[][],
): Gebaeude {
  const n = grund.length;
  const a = grund[kante % n]!;
  const b = grund[(kante + 1) % n]!;
  const laenge = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const laengs = { x: (b.x - a.x) / laenge, y: (b.y - a.y) / laenge };
  const halbe = tiefe / 2;

  // Der First sitzt mittig und ist an beiden Enden um die halbe
  // Gebäudetiefe eingerückt — so entstehen die 45°-Grate.
  const einrueckung = Math.min(halbe, laenge / 2 - 0.01);
  const mitteA = {
    x: a.x + laengs.x * einrueckung + nachInnen.x * halbe,
    y: a.y + laengs.y * einrueckung + nachInnen.y * halbe,
    z: first,
  };
  const mitteB = {
    x: b.x - laengs.x * einrueckung + nachInnen.x * halbe,
    y: b.y - laengs.y * einrueckung + nachInnen.y * halbe,
    z: first,
  };

  const gegen = gegenkante(grund, grund.map((q) => abstandVonTraufe(q, a, nachInnen)), tiefe);
  const traufeA = versetzt(a, nachInnen, -p.ueberstand, p.wandhoehe);
  const traufeB = versetzt(b, nachInnen, -p.ueberstand, p.wandhoehe);
  const hintenA = versetzt(gegen.a, nachInnen, p.ueberstand, p.wandhoehe);
  const hintenB = versetzt(gegen.b, nachInnen, p.ueberstand, p.wandhoehe);

  return {
    waende,
    dachflaechen: [
      // Zwei Trapeze
      [traufeA, traufeB, mitteB, mitteA],
      [hintenA, hintenB, mitteA, mitteB],
      // Zwei Dreiecke an den Giebelseiten
      [traufeA, mitteA, hintenB],
      [traufeB, mitteB, hintenA],
    ],
    firsthoehe: first,
  };
}

/** Die Aussenwände als senkrechte Vierecke. */
function wandflaechen(grund: Meter[], hoehe: number): Punkt3D[][] {
  const aus: Punkt3D[][] = [];
  for (let i = 0; i < grund.length; i++) {
    const a = grund[i]!;
    const b = grund[(i + 1) % grund.length]!;
    aus.push([
      { x: a.x, y: a.y, z: 0 },
      { x: b.x, y: b.y, z: 0 },
      { x: b.x, y: b.y, z: hoehe },
      { x: a.x, y: a.y, z: hoehe },
    ]);
  }
  return aus;
}

/**
 * Wahre Fläche eines Polygons in 3D.
 *
 * Für die Kontrolle: Die Summe der Dachflächen muss zur Grundfläche
 * passen, geteilt durch den Kosinus der Neigung. Weicht sie ab, stimmt
 * das Modell nicht — und das fällt an einem gerenderten Bild nicht auf.
 */
export function flaeche3D(punkte: Punkt3D[]): number {
  if (punkte.length < 3) return 0;
  let x = 0;
  let y = 0;
  let z = 0;
  for (let i = 0; i < punkte.length; i++) {
    const a = punkte[i]!;
    const b = punkte[(i + 1) % punkte.length]!;
    x += a.y * b.z - a.z * b.y;
    y += a.z * b.x - a.x * b.z;
    z += a.x * b.y - a.y * b.x;
  }
  return Math.hypot(x, y, z) / 2;
}

/** Grundfläche eines 3D-Polygons in der Draufsicht. */
export function grundrissVon(punkte: Punkt3D[]): number {
  return grundflaeche(punkte.map((q) => ({ x: q.x, y: q.y })));
}
