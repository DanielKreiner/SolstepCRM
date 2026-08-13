import { describe, expect, it } from "vitest";
import { aufteilung, bogenfolge, strangWeg, verlegeStrings } from "./strings";
import { leererPlan, type Plan } from "./plan";
import type { Modulgruppe } from "./module";
import type { Dachflaeche } from "./flaeche";

/*
 * Strings verlegen (Wunsch vom 13.08.2026: „sieh dir auch an wie
 * reonic die strings verlegt, so mag ich das auch").
 *
 * Geprüft wird die Verlegung selbst, nicht ihre Darstellung: Der Bogen,
 * die gleichmässige Aufteilung, die Trennung nach Gruppen und dass ein
 * Weg keine Module zeigt, die es nicht mehr gibt.
 */

function flaeche(id: string): Dachflaeche {
  return {
    id,
    name: id,
    punkte: [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 12 },
      { x: 0, y: 12 },
    ],
    neigung: 30,
    azimut: 180,
    traufe: 0,
    hindernisse: [],
    randabstand: 0.3,
  };
}

function gruppe(id: string, reihen: number, spalten: number, flaecheId = "f1"): Modulgruppe {
  return {
    id,
    name: id,
    flaeche: flaecheId,
    typ: { breite: 1.134, hoehe: 1.762 },
    ausrichtung: "hoch",
    reihenabstand: 0.02,
    spaltenabstand: 0.02,
    winkel: 0,
    anker: { x: 1, y: 1 },
    spalten,
    reihen,
    aus: [],
    entfernt: [],
    frei: {},
    aufstaenderung: null,
  } as unknown as Modulgruppe;
}

function planMit(gruppen: Modulgruppe[], flaechen = [flaeche("f1")]): Plan {
  return { ...leererPlan(), flaechen, gruppen };
}

describe("bogenfolge", () => {
  it("läuft Reihe hin, nächste Reihe zurück", () => {
    const folge = bogenfolge(gruppe("g1", 2, 3));
    expect(folge.map((z) => `${z.reihe}:${z.spalte}`)).toEqual([
      "0:0",
      "0:1",
      "0:2",
      "1:2",
      "1:1",
      "1:0",
    ]);
  });

  it("überspringt weggetippte Module, ohne die Reihenfolge zu verlieren", () => {
    const g = gruppe("g1", 2, 3);
    g.entfernt = ["0:1"];
    const folge = bogenfolge(g);
    expect(folge.map((z) => `${z.reihe}:${z.spalte}`)).toEqual(["0:0", "0:2", "1:2", "1:1", "1:0"]);
  });
});

describe("aufteilung", () => {
  it("verteilt den Rest, statt einen kurzen String anzuhängen", () => {
    // 21 Module bei höchstens 12: 11 + 10, nicht 12 + 9.
    expect(aufteilung(21, 12)).toEqual([11, 10]);
  });

  it("lässt eine passende Menge in einem String", () => {
    expect(aufteilung(12, 12)).toEqual([12]);
  });

  it("teilt auf drei, wenn zwei nicht reichen", () => {
    expect(aufteilung(25, 10)).toEqual([9, 8, 8]);
  });

  it("gibt für nichts nichts zurück", () => {
    expect(aufteilung(0, 12)).toEqual([]);
  });
});

describe("verlegeStrings", () => {
  it("trennt Gruppen — ein String läuft nie über zwei Ausrichtungen", () => {
    const plan = planMit([gruppe("g1", 1, 4), gruppe("g2", 1, 4, "f2")], [
      flaeche("f1"),
      flaeche("f2"),
    ]);
    const { strings } = verlegeStrings(plan, { max: 20, min: 4, mppt: 2 });
    expect(strings).toHaveLength(2);
    expect(strings[0]!.module.every((m) => m.startsWith("g1/"))).toBe(true);
    expect(strings[1]!.module.every((m) => m.startsWith("g2/"))).toBe(true);
  });

  it("legt die Strings reihum auf die MPP-Tracker", () => {
    const plan = planMit([gruppe("g1", 4, 6)]); // 24 Module, höchstens 8
    const { strings } = verlegeStrings(plan, { max: 8, min: 4, mppt: 2 });
    expect(strings.map((s) => s.mppt)).toEqual([0, 1, 0]);
  });

  it("verlegt in Bogenreihenfolge", () => {
    const plan = planMit([gruppe("g1", 2, 2)]);
    const { strings } = verlegeStrings(plan, { max: 12, min: 2, mppt: 1 });
    expect(strings[0]!.module).toEqual(["g1/0:0", "g1/0:1", "g1/1:1", "g1/1:0"]);
  });

  it("meldet zu kurze Strings, statt sie stillschweigend anzulegen", () => {
    const plan = planMit([gruppe("g1", 1, 3)]);
    const { hinweis } = verlegeStrings(plan, { max: 12, min: 8, mppt: 1 });
    expect(hinweis).toMatch(/Mindestlänge/);
  });

  it("sagt es, wenn nichts zu verlegen ist", () => {
    const { strings, hinweis } = verlegeStrings(leererPlan(), { max: 12, min: 4, mppt: 2 });
    expect(strings).toEqual([]);
    expect(hinweis).toMatch(/keine Module/);
  });

  it("vergibt eindeutige Kennungen", () => {
    const plan = planMit([gruppe("g1", 3, 6)]);
    const { strings } = verlegeStrings(plan, { max: 6, min: 4, mppt: 2 });
    expect(new Set(strings.map((s) => s.id)).size).toBe(strings.length);
  });
});

describe("strangWeg", () => {
  it("gibt eine Mitte je Modul, in der Reihenfolge des Strings", () => {
    const plan = planMit([gruppe("g1", 2, 2)]);
    const { strings } = verlegeStrings(plan, { max: 12, min: 2, mppt: 1 });
    const weg = strangWeg(plan, strings[0]!);
    expect(weg.punkte).toHaveLength(4);
    expect(weg.flaeche).toBe("f1");
    // Erster und zweiter Punkt liegen in derselben Reihe nebeneinander.
    expect(weg.punkte[0]!.y).toBeCloseTo(weg.punkte[1]!.y, 6);
    expect(weg.punkte[1]!.x).toBeGreaterThan(weg.punkte[0]!.x);
  });

  it("lässt Module weg, deren Gruppe es nicht mehr gibt", () => {
    const plan = planMit([gruppe("g1", 1, 2)]);
    const weg = strangWeg(plan, {
      id: "s1",
      name: "String 1",
      mppt: 0,
      module: ["g1/0:0", "weg/0:0", "g1/0:1", "g1/9:9"],
    });
    expect(weg.punkte).toHaveLength(2);
  });
});
