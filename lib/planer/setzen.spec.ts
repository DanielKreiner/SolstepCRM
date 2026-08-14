import { describe, expect, it } from "vitest";
import { anschluss, modulEntfernen, modulSetzen, modulVorschau } from "./setzen";
import { aktiveZellen, anzahlModule, rasterMitte, type Modulgruppe } from "./module";
import { leererPlan, type Plan } from "./plan";
import type { Dachflaeche } from "./flaeche";

/*
 * Module setzen — für Draufsicht und räumliche Ansicht dieselbe
 * Rechnung (Beschwerde vom 13.08.2026: „dann ist immer ein eigenes
 * Feld, ich kann nicht auf dem Feld weiter von der 2D Ansicht, das
 * soll alles gleich sein").
 */

function flaeche(): Dachflaeche {
  return {
    id: "f1",
    name: "Fläche 1",
    punkte: [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 14 },
      { x: 0, y: 14 },
    ],
    neigung: 0,
    azimut: 180,
    traufe: 0,
    hindernisse: [],
    randabstand: 0.3,
  } as unknown as Dachflaeche;
}

function gruppe(reihen: number, spalten: number): Modulgruppe {
  return {
    id: "g1",
    name: "Feld 1",
    flaeche: "f1",
    typ: { breite: 1.134, hoehe: 1.762, wp: 440, bezeichnung: "Modul" },
    ausrichtung: "hoch",
    reihenabstand: 0.02,
    spaltenabstand: 0.02,
    winkel: 0,
    anker: { x: 4, y: 4 },
    spalten,
    reihen,
    aus: [],
    entfernt: [],
    frei: {},
    aufstaenderung: null,
  } as unknown as Modulgruppe;
}

function planMit(g: Modulgruppe): Plan {
  return { ...leererPlan(), flaechen: [flaeche()], gruppen: [g] };
}

describe("anschluss", () => {
  it("erkennt den Rasterplatz direkt neben dem Feld", () => {
    const g = gruppe(2, 2);
    const plan = planMit(g);
    // Punkt in der Zellmitte rechts neben der Spalte 1.
    const ziel = rasterMitte(g, flaeche(), 0, 2);
    const an = anschluss(plan, "f1", ziel);
    expect(an?.art).toBe("anbauen");
    expect(an && an.art === "anbauen" ? [an.reihe, an.spalte] : null).toEqual([0, 2]);
  });

  it("meldet einen belegten Platz, statt daneben ein Feld anzulegen", () => {
    const g = gruppe(2, 2);
    const plan = planMit(g);
    const an = anschluss(plan, "f1", rasterMitte(g, flaeche(), 1, 1));
    expect(an?.art).toBe("besetzt");
  });

  it("hält sich fern, wenn das Feld weit weg ist", () => {
    const g = gruppe(2, 2);
    const plan = planMit(g);
    // Vier Rasterschritte daneben — das ist kein Anbau mehr.
    expect(anschluss(plan, "f1", rasterMitte(g, flaeche(), 0, 5))).toBeNull();
  });
});

describe("modulSetzen", () => {
  it("baut an ein bestehendes Feld an, statt ein zweites anzulegen", () => {
    const plan = planMit(gruppe(2, 2));
    const erg = modulSetzen(plan, rasterMitte(plan.gruppen[0]!, flaeche(), 0, 2), "f1");
    expect(erg.ok).toBe(true);
    if (!erg.ok) return;
    expect(erg.plan.gruppen, "es bleibt bei einem Feld").toHaveLength(1);
    expect(anzahlModule(erg.plan.gruppen[0]!)).toBe(5);
    expect(erg.gruppe).toBe("g1");
  });

  it("legt weit entfernt ein neues Feld an", () => {
    const plan = planMit(gruppe(2, 2));
    const erg = modulSetzen(plan, { x: 16, y: 11 }, "f1");
    expect(erg.ok).toBe(true);
    if (!erg.ok) return;
    expect(erg.plan.gruppen).toHaveLength(2);
    expect(anzahlModule(erg.plan.gruppen[1]!)).toBe(1);
  });

  it("setzt ein weggetipptes Modul wieder ein, ohne ein Feld zu erfinden", () => {
    const g = gruppe(2, 2);
    g.entfernt = ["0:0"];
    const plan = planMit(g);
    expect(anzahlModule(plan.gruppen[0]!)).toBe(3);

    const erg = modulSetzen(plan, rasterMitte(g, flaeche(), 0, 0), "f1");
    expect(erg.ok).toBe(true);
    if (!erg.ok) return;
    expect(erg.plan.gruppen).toHaveLength(1);
    expect(anzahlModule(erg.plan.gruppen[0]!)).toBe(4);
  });

  it("lehnt einen belegten Platz mit Klartext ab", () => {
    const plan = planMit(gruppe(2, 2));
    const erg = modulSetzen(plan, rasterMitte(plan.gruppen[0]!, flaeche(), 0, 0), "f1");
    expect(erg.ok).toBe(false);
    if (erg.ok) return;
    expect(erg.meldung).toMatch(/schon ein Modul/);
  });
});

describe("modulVorschau", () => {
  it("zeigt die Vorschau auf dem Raster des Nachbarfeldes", () => {
    const g = gruppe(2, 2);
    const plan = planMit(g);
    const rasterziel = rasterMitte(g, flaeche(), 0, 2);
    // Ein Stück neben der Zellmitte — die Vorschau muss trotzdem einrasten.
    const v = modulVorschau(plan, { x: rasterziel.x + 0.2, y: rasterziel.y + 0.15 }, "f1");
    expect(v?.passt).toBe(true);
    const mitte = {
      x: v!.ecken.reduce((s, p) => s + p.x, 0) / v!.ecken.length,
      y: v!.ecken.reduce((s, p) => s + p.y, 0) / v!.ecken.length,
    };
    expect(mitte.x).toBeCloseTo(rasterziel.x, 6);
    expect(mitte.y).toBeCloseTo(rasterziel.y, 6);
  });
});

describe("modulEntfernen", () => {
  it("nimmt das Modul heraus und lässt die Gruppe stehen", () => {
    const plan = planMit(gruppe(2, 2));
    const neu = modulEntfernen(plan, "g1", 0, 0);
    expect(neu.gruppen).toHaveLength(1);
    expect(aktiveZellen(neu.gruppen[0]!)).toHaveLength(3);
  });

  it("räumt eine Gruppe weg, von der nichts übrig bleibt", () => {
    const plan = planMit(gruppe(1, 1));
    const neu = modulEntfernen(plan, "g1", 0, 0);
    expect(neu.gruppen).toHaveLength(0);
  });

  it("nimmt das Modul auch aus seinem String", () => {
    const plan: Plan = {
      ...planMit(gruppe(2, 2)),
      strings: [{ id: "s1", name: "String 1", mppt: 0, module: ["g1/0:0", "g1/0:1"] }],
    };
    const neu = modulEntfernen(plan, "g1", 0, 0);
    expect(neu.strings[0]!.module).toEqual(["g1/0:1"]);
  });
});
