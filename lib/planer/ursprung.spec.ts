import { describe, expect, it } from "vitest";
import { ursprungVersetzen } from "./ursprung";
import { leererPlan, type Plan } from "./plan";
import { zuMeter } from "./geo";

/*
 * Nullpunkt versetzen (Wunsch vom 13.08.2026: „gib mich auch was, dass
 * ich diesen viewpunkt verschieben kann").
 *
 * Der Prüfgegenstand ist nicht die Zahl im Plan, sondern die Stelle auf
 * der Welt: Nach dem Versetzen muss jede Ecke dort liegen, wo sie
 * vorher lag.
 */

const LINZ = { lat: 48.30604, lon: 14.28583 };

function planMit(): Plan {
  return {
    ...leererPlan(),
    flaechen: [
      {
        id: "f1",
        name: "Fläche 1",
        punkte: [
          { x: 10, y: 10 },
          { x: 22, y: 10 },
          { x: 22, y: 19 },
          { x: 10, y: 19 },
        ],
        neigung: 30,
        azimut: 180,
        traufe: 0,
        hindernisse: [
          { id: "h1", art: "polygon", name: "Sperrzone 1", punkte: [
            { x: 14, y: 13 },
            { x: 16, y: 13 },
            { x: 16, y: 15 },
            { x: 14, y: 15 },
          ], abstand: 0.3 },
        ],
        randabstand: 0.3,
      },
    ],
    gruppen: [
      {
        id: "g1",
        name: "Feld 1",
        flaeche: "f1",
        typ: { breite: 1.134, hoehe: 1.762, wp: 440, bezeichnung: "Modul" },
        ausrichtung: "hoch",
        reihenabstand: 0.02,
        spaltenabstand: 0.02,
        winkel: 0,
        anker: { x: 11, y: 11 },
        spalten: 2,
        reihen: 2,
        aus: [],
        entfernt: [],
        frei: { "0:0": { x: 12.5, y: 12.5 } },
        aufstaenderung: null,
      },
    ],
    objekte: [{ id: "o1", art: "baum", name: "Nussbaum", hoehe: 9, mitte: { x: 30, y: 5 }, radius: 3 }],
  } as unknown as Plan;
}

describe("ursprungVersetzen", () => {
  it("lässt jede Ecke dort liegen, wo sie auf der Welt lag", () => {
    const vorher = planMit();
    const eckeVorher = vorher.flaechen[0]!.punkte[0]!;

    const { ursprung, plan } = ursprungVersetzen(vorher, LINZ, { x: 12, y: 8 });
    const eckeNachher = plan.flaechen[0]!.punkte[0]!;

    /*
     * Dieselbe Ecke, einmal im alten und einmal im neuen System in
     * Weltkoordinaten gerechnet — der Abstand muss unter einem
     * Zentimeter bleiben.
     */
    const altWelt = { x: eckeVorher.x, y: eckeVorher.y };
    const neuWelt = zuMeter(LINZ, {
      lat: ursprung.lat + eckeNachher.y / 6371000 / (Math.PI / 180),
      lon:
        ursprung.lon +
        eckeNachher.x / 6371000 / (Math.PI / 180) / Math.cos((ursprung.lat * Math.PI) / 180),
    });
    expect(Math.hypot(neuWelt.x - altWelt.x, neuWelt.y - altWelt.y)).toBeLessThan(0.01);
  });

  it("zieht alles mit: Sperrzone, Anker, freies Modul, Baum", () => {
    const { plan } = ursprungVersetzen(planMit(), LINZ, { x: 10, y: 10 });
    expect(plan.flaechen[0]!.punkte[0]).toEqual({ x: 0, y: 0 });
    expect(plan.flaechen[0]!.hindernisse[0]!.punkte[0]).toEqual({ x: 4, y: 3 });
    expect(plan.gruppen[0]!.anker).toEqual({ x: 1, y: 1 });
    expect(plan.gruppen[0]!.frei["0:0"]).toEqual({ x: 2.5, y: 2.5 });
    expect(plan.objekte[0]!.mitte).toEqual({ x: 20, y: -5 });
  });

  it("verschiebt den Weltbezug in die richtige Richtung", () => {
    const { ursprung } = ursprungVersetzen(planMit(), LINZ, { x: 0, y: 100 });
    // 100 m nach Norden sind rund 0,0009 Grad.
    expect(ursprung.lat).toBeGreaterThan(LINZ.lat);
    expect(ursprung.lat - LINZ.lat).toBeCloseTo(0.0009, 4);
    expect(ursprung.lon).toBeCloseTo(LINZ.lon, 6);
  });
});
