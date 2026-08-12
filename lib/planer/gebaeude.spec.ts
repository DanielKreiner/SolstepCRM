import { describe, expect, it } from "vitest";
import {
  anstieg,
  flaeche3D,
  gebaeude,
  type GebaeudeParameter,
  grundrissVon,
  laengsteKante,
} from "./gebaeude";
import type { Meter } from "./geo";

/*
 * Die Geometrie ist der Teil, der falsch sein kann, ohne dass es
 * auffällt: Ein Dach, dessen First einen halben Meter zu hoch sitzt,
 * sieht am Bildschirm immer noch aus wie ein Dach. Deshalb wird hier
 * gegen von Hand nachgerechnete Werte geprüft, nicht gegen ein Bild.
 */

/** Rechteck 12 × 8 m, Ursprung in der Ecke. */
const RECHTECK: Meter[] = [
  { x: 0, y: 0 },
  { x: 12, y: 0 },
  { x: 12, y: 8 },
  { x: 0, y: 8 },
];

function haus(teil: Partial<GebaeudeParameter> = {}): GebaeudeParameter {
  return {
    grundriss: RECHTECK,
    typ: "sattel",
    wandhoehe: 3,
    neigung: 30,
    ueberstand: 0,
    traufe: 0,
    ...teil,
  };
}

describe("Anstieg", () => {
  it("rechnet mit dem Tangens, nicht mit dem Sinus", () => {
    /*
     * Die 4 m sind die waagrechte Strecke, nicht die Sparrenlänge.
     * 4 · tan(30°) = 2,309 m. Mit sin käme 2,0 heraus — ein Fehler von
     * 30 cm am First, den niemand am Bild bemerkt.
     */
    expect(anstieg(4, 30)).toBeCloseTo(2.3094, 4);
    expect(anstieg(4, 45)).toBeCloseTo(4, 6);
    expect(anstieg(4, 0)).toBeCloseTo(0, 9);
  });
});

describe("Traufkante", () => {
  it("nimmt die längste Kante als Vorgabe", () => {
    // 12 m lang, 8 m tief — die Traufe liegt an der langen Seite.
    expect(laengsteKante(RECHTECK)).toBe(0);
  });
});

describe("Flachdach", () => {
  it("liegt waagrecht auf der Wandhöhe", () => {
    const g = gebaeude(haus({ typ: "flach", wandhoehe: 4 }));
    expect(g.dachflaechen).toHaveLength(1);
    expect(g.firsthoehe).toBe(4);
    for (const p of g.dachflaechen[0]!) expect(p.z).toBe(4);
    // Die wahre Fläche ist die Grundfläche: 12 × 8 = 96 m².
    expect(flaeche3D(g.dachflaechen[0]!)).toBeCloseTo(96, 6);
  });

  it("hat vier Wände in voller Höhe", () => {
    const g = gebaeude(haus({ typ: "flach", wandhoehe: 4 }));
    expect(g.waende).toHaveLength(4);
    for (const w of g.waende) {
      expect(w).toHaveLength(4);
      expect(Math.max(...w.map((p) => p.z))).toBe(4);
      expect(Math.min(...w.map((p) => p.z))).toBe(0);
    }
  });
});

describe("Pultdach", () => {
  it("steigt von der Traufe zur Gegenseite an", () => {
    const g = gebaeude(haus({ typ: "pult" }));
    const dach = g.dachflaechen[0]!;

    // An der Traufe (y = 0) die Wandhöhe.
    const anDerTraufe = dach.filter((p) => Math.abs(p.y) < 0.01);
    expect(anDerTraufe).toHaveLength(2);
    for (const p of anDerTraufe) expect(p.z).toBeCloseTo(3, 6);

    /*
     * Hinten (y = 8) um 8 · tan(30°) = 4,619 m höher, also auf 7,619 m.
     */
    const hinten = dach.filter((p) => Math.abs(p.y - 8) < 0.01);
    expect(hinten).toHaveLength(2);
    for (const p of hinten) expect(p.z).toBeCloseTo(7.6188, 3);
    expect(g.firsthoehe).toBeCloseTo(7.6188, 3);
  });

  it("hat die wahre Fläche der Draufsicht geteilt durch cos", () => {
    /*
     * Die Kontrolle, die das ganze Modell trägt: 96 m² Grundriss auf
     * 30° sind 96 / cos(30°) = 110,85 m². Genau das rechnet auch der
     * 2D-Planer — beide müssen übereinstimmen, sonst gibt es zwei
     * Wahrheiten über dieselbe Anlage.
     */
    const g = gebaeude(haus({ typ: "pult" }));
    expect(flaeche3D(g.dachflaechen[0]!)).toBeCloseTo(96 / Math.cos(Math.PI / 6), 3);
    expect(grundrissVon(g.dachflaechen[0]!)).toBeCloseTo(96, 6);
  });
});

describe("Satteldach", () => {
  it("setzt den First mittig und auf die richtige Höhe", () => {
    const g = gebaeude(haus());
    expect(g.dachflaechen).toHaveLength(2);

    /*
     * Halbe Tiefe 4 m, 30° Neigung: 4 · tan(30°) = 2,309 m über der
     * Wand. Der First liegt also bei 3 + 2,309 = 5,309 m.
     */
    expect(g.firsthoehe).toBeCloseTo(5.3094, 3);

    // Und er verläuft bei y = 4, also mittig.
    const firstpunkte = g.dachflaechen
      .flat()
      .filter((p) => Math.abs(p.z - g.firsthoehe) < 0.001);
    expect(firstpunkte.length).toBeGreaterThanOrEqual(2);
    for (const p of firstpunkte) expect(p.y).toBeCloseTo(4, 6);
  });

  it("teilt die Fläche in zwei gleiche Hälften", () => {
    const g = gebaeude(haus());
    const [vorne, hinten] = g.dachflaechen as [typeof g.dachflaechen[0], typeof g.dachflaechen[0]];

    const a = flaeche3D(vorne!);
    const b = flaeche3D(hinten!);
    expect(a).toBeCloseTo(b, 4);

    // Zusammen wieder die Grundfläche durch den Kosinus.
    expect(a + b).toBeCloseTo(96 / Math.cos(Math.PI / 6), 2);
  });

  it("verlängert die Traufe um den Überstand", () => {
    const ohne = gebaeude(haus({ ueberstand: 0 }));
    const mit = gebaeude(haus({ ueberstand: 0.5 }));

    // Der Überstand ragt nach aussen, also ins Negative bei y = 0.
    const kanteOhne = Math.min(...ohne.dachflaechen.flat().map((p) => p.y));
    const kanteMit = Math.min(...mit.dachflaechen.flat().map((p) => p.y));
    expect(kanteOhne).toBeCloseTo(0, 6);
    expect(kanteMit).toBeCloseTo(-0.5, 6);

    // Der First bleibt, wo er war — der Überstand hebt das Dach nicht.
    expect(mit.firsthoehe).toBeCloseTo(ohne.firsthoehe, 6);
  });

  it("nimmt eine andere Traufkante, wenn sie vorgegeben ist", () => {
    /*
     * Traufe an der kurzen Seite: dann ist die Tiefe 12 m statt 8, und
     * der First sitzt entsprechend höher.
     */
    const quer = gebaeude(haus({ traufe: 1 }));
    expect(quer.firsthoehe).toBeCloseTo(3 + anstieg(6, 30), 3);
    expect(quer.firsthoehe).toBeGreaterThan(gebaeude(haus()).firsthoehe);
  });
});

describe("Walmdach", () => {
  it("hat vier Flächen: zwei Trapeze und zwei Dreiecke", () => {
    const g = gebaeude(haus({ typ: "walm" }));
    expect(g.dachflaechen).toHaveLength(4);
    expect(g.dachflaechen[0]).toHaveLength(4);
    expect(g.dachflaechen[1]).toHaveLength(4);
    expect(g.dachflaechen[2]).toHaveLength(3);
    expect(g.dachflaechen[3]).toHaveLength(3);
  });

  it("hat denselben First wie ein Satteldach gleicher Neigung", () => {
    /*
     * Der Walm ändert die Form der Flächen, nicht die Höhe: Sie folgt
     * allein aus halber Tiefe und Neigung.
     */
    const walm = gebaeude(haus({ typ: "walm" }));
    const sattel = gebaeude(haus({ typ: "sattel" }));
    expect(walm.firsthoehe).toBeCloseTo(sattel.firsthoehe, 6);
  });

  it("rückt den First an beiden Enden um die halbe Tiefe ein", () => {
    /*
     * Daran erkennt man ein Walmdach: Der First ist kürzer als das
     * Gebäude. Bei 12 m Länge und 8 m Tiefe bleiben 12 − 2 · 4 = 4 m
     * First übrig.
     */
    const g = gebaeude(haus({ typ: "walm" }));
    const first = g.dachflaechen
      .flat()
      .filter((p) => Math.abs(p.z - g.firsthoehe) < 0.001);
    const xWerte = first.map((p) => p.x);
    expect(Math.min(...xWerte)).toBeCloseTo(4, 2);
    expect(Math.max(...xWerte)).toBeCloseTo(8, 2);
  });
});

describe("Entartete Eingaben", () => {
  it("gibt für zu wenige Punkte ein leeres Gebäude zurück", () => {
    const g = gebaeude(haus({ grundriss: [{ x: 0, y: 0 }, { x: 1, y: 0 }] }));
    expect(g.dachflaechen).toHaveLength(0);
    expect(g.waende).toHaveLength(0);
  });

  it("kommt mit Neigung 0 zurecht, ohne durch null zu teilen", () => {
    const g = gebaeude(haus({ typ: "sattel", neigung: 0 }));
    expect(g.firsthoehe).toBeCloseTo(3, 6);
    // Ohne Neigung ist die wahre Fläche die Grundfläche.
    const summe = g.dachflaechen.reduce((s, f) => s + flaeche3D(f), 0);
    expect(summe).toBeCloseTo(96, 2);
  });
});
