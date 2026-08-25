import { describe, expect, it } from "vitest";
import {
  firstLinie,
  firstVersatzFuer,
  flaechenAusUmriss,
  walmAnteilFuer,
} from "./dachformen";
import { grundflaeche } from "./flaeche";
import type { Meter } from "./geo";

/*
 * Dach aus dem Umriss (Wunsch vom 13.08.2026: „da zeichnet man ein
 * Dach komplett und zieht dann die Gaube vom Dach bzw. beim Walmdach
 * alles hin, und es verschiebt sich alles gleich").
 *
 * Die Probe, die alles zusammenhält: Die Teilflächen müssen den
 * Umriss vollständig und überschneidungsfrei ausfüllen. Ihre
 * Grundflächen zusammen sind also genau die Grundfläche des Umrisses —
 * fehlt ein Stück oder liegt eines doppelt, fällt es hier auf.
 */

const RECHTECK: Meter[] = [
  { x: 0, y: 0 },
  { x: 12, y: 0 },
  { x: 12, y: 8 },
  { x: 0, y: 8 },
];

/** Schief und gedreht — so sieht ein von Hand gezogenes Haus aus. */
const SCHIEF: Meter[] = [
  { x: 1, y: 0 },
  { x: 13, y: 1.5 },
  { x: 12, y: 9 },
  { x: -0.5, y: 7 },
];

function summe(teile: Array<{ punkte: Meter[] }>): number {
  return teile.reduce((s, t) => s + grundflaeche(t.punkte), 0);
}

describe("flaechenAusUmriss", () => {
  it("Flachdach ist der Umriss selbst, ohne Neigung", () => {
    const teile = flaechenAusUmriss(RECHTECK, "flach", { neigung: 30, richtung: 0 });
    expect(teile).toHaveLength(1);
    expect(teile[0]!.neigung).toBe(0);
    expect(teile[0]!.traufe).toBeNull();
    expect(grundflaeche(teile[0]!.punkte)).toBeCloseTo(96, 6);
  });

  it("Pultdach ist eine geneigte Fläche mit Traufe an Kante 0", () => {
    const teile = flaechenAusUmriss(RECHTECK, "pult", { neigung: 22, richtung: 0 });
    expect(teile).toHaveLength(1);
    expect(teile[0]!.traufe).toBe(0);
    expect(teile[0]!.neigung).toBe(22);
  });

  it("Satteldach ergibt zwei Hälften, die den Umriss füllen", () => {
    const teile = flaechenAusUmriss(RECHTECK, "sattel", { neigung: 30, richtung: 0 });
    expect(teile).toHaveLength(2);
    expect(summe(teile)).toBeCloseTo(96, 6);
    // Beide Hälften gleich gross, solange der First mittig liegt.
    expect(grundflaeche(teile[0]!.punkte)).toBeCloseTo(grundflaeche(teile[1]!.punkte), 6);
  });

  it("Der Firstversatz macht ungleiche Seiten — ohne Fläche zu verlieren", () => {
    const teile = flaechenAusUmriss(RECHTECK, "sattel", {
      neigung: 30,
      richtung: 0,
      firstVersatz: 0.5,
    });
    expect(summe(teile)).toBeCloseTo(96, 6);
    expect(grundflaeche(teile[0]!.punkte)).toBeGreaterThan(grundflaeche(teile[1]!.punkte));
  });

  it("Walmdach ergibt zwei Trapeze und zwei Dreiecke, die den Umriss füllen", () => {
    const teile = flaechenAusUmriss(RECHTECK, "walm", { neigung: 35, richtung: 0 });
    expect(teile).toHaveLength(4);
    expect(summe(teile)).toBeCloseTo(96, 6);
    expect(teile[2]!.punkte).toHaveLength(3);
    expect(teile[3]!.punkte).toHaveLength(3);
  });

  it("Krüppelwalm schneidet weniger ab als der volle Walm", () => {
    const walm = flaechenAusUmriss(RECHTECK, "walm", { neigung: 35, richtung: 0 });
    const kruppel = flaechenAusUmriss(RECHTECK, "kruppelwalm", { neigung: 35, richtung: 0 });
    expect(summe(kruppel)).toBeCloseTo(96, 6);
    // Die Walmdreiecke sind kleiner, die Hauptflächen entsprechend grösser.
    expect(grundflaeche(kruppel[2]!.punkte)).toBeLessThan(grundflaeche(walm[2]!.punkte));
    expect(grundflaeche(kruppel[0]!.punkte)).toBeGreaterThan(grundflaeche(walm[0]!.punkte));
  });

  it("Zeltdach ergibt vier Dreiecke auf einen Punkt", () => {
    const teile = flaechenAusUmriss(RECHTECK, "zelt", { neigung: 40, richtung: 0 });
    expect(teile).toHaveLength(4);
    expect(teile.every((t) => t.punkte.length === 3)).toBe(true);
    expect(summe(teile)).toBeCloseTo(96, 6);
  });

  it("Richtung 1 dreht den First um 90 Grad (Schräge Seiten tauschen)", () => {
    const quer = flaechenAusUmriss(RECHTECK, "sattel", { neigung: 30, richtung: 0 });
    const laengs = flaechenAusUmriss(RECHTECK, "sattel", { neigung: 30, richtung: 1 });
    expect(summe(laengs)).toBeCloseTo(96, 6);

    /*
     * Bei einem symmetrischen Rechteck sind beide Hälften in jedem Fall
     * gleich gross — der Unterschied liegt in der RICHTUNG. Verglichen
     * wird deshalb die Traufkante: Sie steht danach quer zu vorher.
     */
    const richtungVon = (t: { punkte: Meter[] }) => {
      const a = t.punkte[0]!;
      const b = t.punkte[1]!;
      return Math.atan2(b.y - a.y, b.x - a.x);
    };
    const dreh = Math.abs(richtungVon(quer[0]!) - richtungVon(laengs[0]!));
    expect(Math.min(dreh, Math.PI - dreh)).toBeCloseTo(Math.PI / 2, 3);
  });

  it("funktioniert auch über einem schiefen Haus", () => {
    const roh = grundflaeche(SCHIEF);
    for (const form of ["sattel", "walm", "kruppelwalm", "zelt"] as const) {
      const teile = flaechenAusUmriss(SCHIEF, form, { neigung: 30, richtung: 0 });
      expect(summe(teile), form).toBeCloseTo(roh, 6);
    }
  });

  it("dreht einen im Uhrzeigersinn gezeichneten Umriss um", () => {
    const anders = [...RECHTECK].reverse();
    const teile = flaechenAusUmriss(anders, "sattel", { neigung: 30, richtung: 0 });
    expect(summe(teile)).toBeCloseTo(96, 6);
  });

  it("gibt bei zu wenig Punkten nichts zurück", () => {
    expect(flaechenAusUmriss([{ x: 0, y: 0 }], "sattel", { neigung: 30, richtung: 0 })).toEqual([]);
  });

  it("macht aus einem Fünfeck ein Pultdach statt Unsinn", () => {
    const fuenf: Meter[] = [...RECHTECK, { x: -3, y: 4 }];
    const teile = flaechenAusUmriss(fuenf, "walm", { neigung: 30, richtung: 0 });
    expect(teile).toHaveLength(1);
    expect(grundflaeche(teile[0]!.punkte)).toBeCloseTo(grundflaeche(fuenf), 6);
  });
});

describe("firstLinie", () => {
  it("liegt beim Satteldach in der Mitte", () => {
    const l = flaechenAusUmriss(RECHTECK, "sattel", { neigung: 30, richtung: 0 });
    expect(l).toHaveLength(2);
    const first = firstLinie(RECHTECK, "sattel", { neigung: 30, richtung: 0 })!;
    expect(first.a.y).toBeCloseTo(4, 6);
    expect(first.b.y).toBeCloseTo(4, 6);
  });

  it("wandert mit dem Versatz", () => {
    const mittig = firstLinie(RECHTECK, "sattel", { neigung: 30, richtung: 0 })!;
    const weg = firstLinie(RECHTECK, "sattel", { neigung: 30, richtung: 0, firstVersatz: 0.5 })!;
    expect(weg.a.y).toBeGreaterThan(mittig.a.y);
  });

  it("ist beim Walmdach kürzer als beim Satteldach", () => {
    const laenge = (l: { a: Meter; b: Meter }) => Math.hypot(l.b.x - l.a.x, l.b.y - l.a.y);
    const sattel = firstLinie(RECHTECK, "sattel", { neigung: 30, richtung: 0 })!;
    const walm = firstLinie(RECHTECK, "walm", { neigung: 30, richtung: 0 })!;
    expect(laenge(walm)).toBeLessThan(laenge(sattel));
  });

  it("gibt es bei Flach-, Pult- und Zeltdach nicht", () => {
    for (const form of ["flach", "pult", "zelt"] as const) {
      expect(firstLinie(RECHTECK, form, { neigung: 30, richtung: 0 })).toBeNull();
    }
  });
});

describe("firstVersatzFuer", () => {
  it("gibt null in der Mitte", () => {
    expect(firstVersatzFuer(RECHTECK, 0, { x: 6, y: 4 })).toBeCloseTo(0, 6);
  });

  it("rechnet einen Punkt weiter oben in einen positiven Versatz um", () => {
    const v = firstVersatzFuer(RECHTECK, 0, { x: 6, y: 6 });
    expect(v).toBeGreaterThan(0);
    // Und der First landet danach wirklich dort.
    const first = firstLinie(RECHTECK, "sattel", { neigung: 30, richtung: 0, firstVersatz: v })!;
    expect(first.a.y).toBeCloseTo(6, 6);
  });

  it("ignoriert eine Bewegung längs des Firsts", () => {
    expect(firstVersatzFuer(RECHTECK, 0, { x: 11, y: 4 })).toBeCloseTo(0, 6);
  });

  it("bleibt in den Grenzen", () => {
    expect(firstVersatzFuer(RECHTECK, 0, { x: 6, y: 99 })).toBeLessThanOrEqual(0.8);
    expect(firstVersatzFuer(RECHTECK, 0, { x: 6, y: -99 })).toBeGreaterThanOrEqual(-0.8);
  });
});

describe("walmAnteilFuer", () => {
  it("rechnet ein Firstende in den Anteil zurück", () => {
    // Volles Walmdach: Wo liegen seine Enden?
    const voll = firstLinie(RECHTECK, "walm", { neigung: 30, richtung: 0, walmAnteil: 1 })!;
    const anteil = walmAnteilFuer(RECHTECK, 0, 0, voll.a);
    expect(anteil).toBeCloseTo(1, 2);

    // Und der Anteil bringt das Ende wieder genau dorthin.
    const zurueck = firstLinie(RECHTECK, "walm", {
      neigung: 30,
      richtung: 0,
      walmAnteil: anteil,
    })!;
    expect(zurueck.a.x).toBeCloseTo(voll.a.x, 4);
  });

  it("ergibt einen kleineren Anteil, je näher am Giebel gezogen wird", () => {
    const weit = walmAnteilFuer(RECHTECK, 0, 0, { x: 1, y: 4 });
    const nah = walmAnteilFuer(RECHTECK, 0, 0, { x: 4, y: 4 });
    expect(weit).toBeLessThan(nah);
  });

  it("bleibt in den Grenzen", () => {
    expect(walmAnteilFuer(RECHTECK, 0, 0, { x: -50, y: 4 })).toBeGreaterThanOrEqual(0.05);
    expect(walmAnteilFuer(RECHTECK, 0, 0, { x: 6, y: 4 })).toBeLessThanOrEqual(1);
  });
});
