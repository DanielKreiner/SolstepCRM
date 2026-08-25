import { describe, expect, it } from "vitest";
import { bauAnwendenMitHinweis, bauAusUmriss, bauLoeschen, bauZu } from "./bau";
import { leererPlan, type Plan } from "./plan";
import { grundflaeche } from "./flaeche";
import type { Meter } from "./geo";

/*
 * Umriss und Dachtyp (Wunsch vom 13.08.2026, Reonic-Vorbild).
 *
 * Der Prüfgegenstand ist der Wechsel: Umriss bleibt, Flächen ändern
 * sich, und was der Betrieb an einer Fläche eingestellt hat, überlebt.
 */

const UMRISS: Meter[] = [
  { x: 0, y: 0 },
  { x: 12, y: 0 },
  { x: 12, y: 8 },
  { x: 0, y: 8 },
];

describe("bauAusUmriss", () => {
  it("legt eine geneigte Fläche an — genau wie das blosse Zeichnen vorher", () => {
    const { plan, bau } = bauAusUmriss(leererPlan(), UMRISS);
    expect(plan.bauten).toHaveLength(1);
    expect(plan.flaechen).toHaveLength(1);
    expect(plan.flaechen[0]!.bau).toBe(bau.id);
    expect(plan.flaechen[0]!.neigung, "30 Grad wie vorher, keine stille Null").toBe(30);
    expect(grundflaeche(plan.flaechen[0]!.punkte)).toBeCloseTo(96, 6);

    /*
     * Und die Traufe liegt auf der langen Kante (12 m), nicht auf der
     * kurzen. Daran hängen Falllinie und Azimut.
     */
    const f = plan.flaechen[0]!;
    const a = f.punkte[f.traufe!]!;
    const b = f.punkte[(f.traufe! + 1) % f.punkte.length]!;
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeCloseTo(12, 6);
  });
});

describe("bauAnwendenMitHinweis", () => {
  it("macht aus einer Fläche zwei, ohne den Umriss anzufassen", () => {
    const { plan, bau } = bauAusUmriss(leererPlan(), UMRISS);
    const { plan: sattel } = bauAnwendenMitHinweis(plan, { ...bau, form: "sattel" });

    expect(sattel.bauten[0]!.umriss).toEqual(UMRISS);
    expect(sattel.flaechen).toHaveLength(2);
    expect(sattel.flaechen.every((f) => f.neigung === 30)).toBe(true);
    expect(
      sattel.flaechen.reduce((s, f) => s + grundflaeche(f.punkte), 0),
      "zusammen wieder der ganze Umriss",
    ).toBeCloseTo(96, 6);
  });

  it("behält Randabstand und Sperrzonen der ersten Fläche", () => {
    const { plan, bau } = bauAusUmriss(leererPlan(), UMRISS);
    const mitZone: Plan = {
      ...plan,
      flaechen: plan.flaechen.map((f) => ({
        ...f,
        randabstand: 0.8,
        hindernisse: [
          {
            id: "h1",
            art: "polygon" as const,
            name: "Sperrzone 1",
            punkte: [
              { x: 4, y: 3 },
              { x: 6, y: 3 },
              { x: 6, y: 5 },
              { x: 4, y: 5 },
            ],
            abstand: 0.3,
          },
        ],
      })),
    };

    const { plan: walm } = bauAnwendenMitHinweis(mitZone, { ...bau, form: "walm" });
    expect(walm.flaechen[0]!.randabstand).toBe(0.8);
    expect(walm.flaechen[0]!.hindernisse).toHaveLength(1);
  });

  it("behält die Belegung auf der ersten Teilfläche", () => {
    const { plan, bau } = bauAusUmriss(leererPlan(), UMRISS);
    const mitFeld: Plan = {
      ...plan,
      gruppen: [
        {
          id: "g1",
          name: "Feld 1",
          flaeche: plan.flaechen[0]!.id,
          typ: { breite: 1.134, hoehe: 1.762, wp: 440, bezeichnung: "Modul" },
          ausrichtung: "hoch",
          reihenabstand: 0.02,
          spaltenabstand: 0.02,
          winkel: 0,
          anker: { x: 1, y: 1 },
          spalten: 2,
          reihen: 2,
          aus: [],
          entfernt: [],
          frei: {},
          aufstaenderung: null,
        },
      ],
    } as unknown as Plan;

    const { plan: sattel, hinweis } = bauAnwendenMitHinweis(mitFeld, { ...bau, form: "sattel" });
    expect(sattel.gruppen, "das Feld liegt weiter auf Teilfläche 0").toHaveLength(1);
    expect(hinweis).toBeNull();
  });

  it("sagt es, wenn eine Fläche mitsamt Belegung wegfällt", () => {
    const { plan, bau } = bauAusUmriss(leererPlan(), UMRISS);
    const { plan: walm } = bauAnwendenMitHinweis(plan, { ...bau, form: "walm" });
    expect(walm.flaechen).toHaveLength(4);

    const mitFeld: Plan = {
      ...walm,
      gruppen: [
        {
          id: "g1",
          name: "Feld 1",
          flaeche: walm.flaechen[3]!.id,
          typ: { breite: 1.134, hoehe: 1.762, wp: 440, bezeichnung: "Modul" },
          ausrichtung: "hoch",
          reihenabstand: 0.02,
          spaltenabstand: 0.02,
          winkel: 0,
          anker: { x: 1, y: 1 },
          spalten: 1,
          reihen: 1,
          aus: [],
          entfernt: [],
          frei: {},
          aufstaenderung: null,
        },
      ],
      strings: [{ id: "s1", name: "String 1", mppt: 0, module: ["g1/0:0"] }],
    } as unknown as Plan;

    const { plan: flach, hinweis } = bauAnwendenMitHinweis(mitFeld, { ...bau, form: "flach" });
    expect(flach.flaechen).toHaveLength(1);
    expect(flach.gruppen).toHaveLength(0);
    expect(flach.strings[0]!.module, "und aus dem String ist es auch heraus").toEqual([]);
    expect(hinweis).toMatch(/Modulfeld entfernt/);
  });

  it("lässt frei gezeichnete Flächen unberührt", () => {
    const { plan, bau } = bauAusUmriss(leererPlan(), UMRISS);
    const mitFremder: Plan = {
      ...plan,
      flaechen: [
        ...plan.flaechen,
        {
          id: "f-frei",
          name: "Garage",
          punkte: [
            { x: 20, y: 0 },
            { x: 26, y: 0 },
            { x: 26, y: 6 },
            { x: 20, y: 6 },
          ],
          neigung: 15,
          azimut: 180,
          traufe: 0,
          randabstand: 0.3,
          hindernisse: [],
          bau: null,
          teil: null,
        },
      ],
    };

    const { plan: sattel } = bauAnwendenMitHinweis(mitFremder, { ...bau, form: "sattel" });
    expect(sattel.flaechen.filter((f) => f.id === "f-frei")).toHaveLength(1);
    expect(sattel.flaechen).toHaveLength(3);
  });
});

describe("bauZu", () => {
  it("findet den Baukörper zur Fläche", () => {
    const { plan, bau } = bauAusUmriss(leererPlan(), UMRISS);
    expect(bauZu(plan, plan.flaechen[0]!.id)?.id).toBe(bau.id);
    expect(bauZu(plan, "f-gibtsnicht")).toBeNull();
  });
});

describe("bauLoeschen", () => {
  it("nimmt Umriss, Flächen und Belegung mit", () => {
    const { plan, bau } = bauAusUmriss(leererPlan(), UMRISS);
    const { plan: walm } = bauAnwendenMitHinweis(plan, { ...bau, form: "walm" });
    const mitFeld: Plan = {
      ...walm,
      gruppen: [
        {
          id: "g1",
          name: "Feld 1",
          flaeche: walm.flaechen[0]!.id,
          typ: { breite: 1.134, hoehe: 1.762, wp: 440, bezeichnung: "Modul" },
          ausrichtung: "hoch",
          reihenabstand: 0.02,
          spaltenabstand: 0.02,
          winkel: 0,
          anker: { x: 1, y: 1 },
          spalten: 1,
          reihen: 1,
          aus: [],
          entfernt: [],
          frei: {},
          aufstaenderung: null,
        },
      ],
      strings: [{ id: "s1", name: "String 1", mppt: 0, module: ["g1/0:0"] }],
    } as unknown as Plan;

    const leer = bauLoeschen(mitFeld, bau.id);
    expect(leer.bauten, "kein Umriss bleibt zurück").toHaveLength(0);
    expect(leer.flaechen).toHaveLength(0);
    expect(leer.gruppen).toHaveLength(0);
    expect(leer.strings[0]!.module).toEqual([]);
  });

  it("lässt ein zweites Haus stehen", () => {
    const erst = bauAusUmriss(leererPlan(), UMRISS);
    const zweit = bauAusUmriss(erst.plan, UMRISS.map((q) => ({ x: q.x + 30, y: q.y })));
    const leer = bauLoeschen(zweit.plan, erst.bau.id);
    expect(leer.bauten).toHaveLength(1);
    expect(leer.bauten[0]!.id).toBe(zweit.bau.id);
    expect(leer.flaechen).toHaveLength(1);
  });
});
