import { describe, expect, it } from "vitest";
import { leererPlan, type Plan } from "./plan";
import { STANDARD_MODUL } from "./module";
import { sonnenrichtung } from "./sonne";
import {
  anlagenVerschattung,
  imSchatten,
  mittlererFaktor,
  SCHATTEN_WIRKUNG,
  verschattungAm,
  type Verschattungsobjekt,
} from "./verschattung";

const LINZ = { lat: 48.30604, lon: 14.28583 };

/** Ein Modul am Ursprung, 4 m über dem Gelände. */
const MODUL = { x: 0, y: 0, z: 4 };

function baum(teil: Partial<Verschattungsobjekt> = {}): Verschattungsobjekt {
  return {
    id: "b1",
    art: "baum",
    name: "Fichte",
    hoehe: 12,
    mitte: { x: 0, y: -8 },
    radius: 3,
    ...teil,
  };
}

describe("Schattenwurf zu einem Zeitpunkt", () => {
  it("verschattet, wenn der Baum genau in der Sonnenrichtung steht", () => {
    /*
     * Sonne im Süden auf 20° Höhe — Winterstand. Der Baum steht 8 m
     * südlich und ist 12 m hoch. Der Strahl vom Modul (4 m hoch)
     * erreicht beim Baum eine Höhe von 4 + 8 · tan(20°) = 6,9 m, also
     * deutlich unter der Baumkrone: Schatten.
     */
    const sonne = sonnenrichtung({ hoehe: 20, azimut: 180 });
    expect(imSchatten(MODUL, sonne, [baum()])).toBe(true);
  });

  it("verschattet nicht, wenn die Sonne über den Baum hinausreicht", () => {
    /*
     * Dieselbe Lage, aber 70° Sonnenhöhe. Beim Baum ist der Strahl
     * schon 4 + 8 · tan(70°) = 26 m hoch — weit über der Krone.
     */
    const sonne = sonnenrichtung({ hoehe: 70, azimut: 180 });
    expect(imSchatten(MODUL, sonne, [baum()])).toBe(false);
  });

  it("verschattet nicht, wenn der Baum auf der falschen Seite steht", () => {
    /*
     * Der Baum steht im Norden, die Sonne kommt aus Süden. Wer den
     * Strahl in beide Richtungen prüft, findet hier einen Schatten, den
     * es nicht gibt — der klassische Vorzeichenfehler.
     */
    const sonne = sonnenrichtung({ hoehe: 20, azimut: 180 });
    expect(imSchatten(MODUL, sonne, [baum({ mitte: { x: 0, y: 8 } })])).toBe(false);
  });

  it("verschattet nicht, wenn der Baum seitlich daneben steht", () => {
    // 10 m östlich, Krone 3 m: der Strahl nach Süden geht daran vorbei.
    const sonne = sonnenrichtung({ hoehe: 20, azimut: 180 });
    expect(imSchatten(MODUL, sonne, [baum({ mitte: { x: 10, y: -8 } })])).toBe(false);
  });

  it("verschattet nicht, wenn die Sonne unter dem Horizont steht", () => {
    const sonne = sonnenrichtung({ hoehe: -5, azimut: 180 });
    expect(imSchatten(MODUL, sonne, [baum({ hoehe: 40 })])).toBe(false);
  });

  it("übergeht Objekte ohne Höhe", () => {
    const sonne = sonnenrichtung({ hoehe: 20, azimut: 180 });
    expect(imSchatten(MODUL, sonne, [baum({ hoehe: 0 })])).toBe(false);
  });

  it("erkennt ein Nachbargebäude über seinem Grundriss", () => {
    /*
     * Ein Haus südlich, 10 m hoch, Grundriss von y = −14 bis −6. Bei
     * 20° Sonnenhöhe steigt der Strahl bis zum Haus auf
     * 4 + 6 · tan(20°) = 6,2 m — unter der Traufe: Schatten.
     */
    const haus: Verschattungsobjekt = {
      id: "g1",
      art: "gebaeude",
      name: "Nachbar",
      hoehe: 10,
      punkte: [
        { x: -6, y: -14 },
        { x: 6, y: -14 },
        { x: 6, y: -6 },
        { x: -6, y: -6 },
      ],
    };
    const tief = sonnenrichtung({ hoehe: 20, azimut: 180 });
    expect(imSchatten(MODUL, tief, [haus])).toBe(true);

    // Hoch genug: der Strahl geht über das Dach.
    const hoch = sonnenrichtung({ hoehe: 60, azimut: 180 });
    expect(imSchatten(MODUL, hoch, [haus])).toBe(false);
  });

  it("verschattet nicht durch ein Gebäude im Norden", () => {
    const haus: Verschattungsobjekt = {
      id: "g2",
      art: "gebaeude",
      name: "Nachbar Nord",
      hoehe: 20,
      punkte: [
        { x: -6, y: 6 },
        { x: 6, y: 6 },
        { x: 6, y: 14 },
        { x: -6, y: 14 },
      ],
    };
    expect(imSchatten(MODUL, sonnenrichtung({ hoehe: 20, azimut: 180 }), [haus])).toBe(false);
  });
});

describe("Verschattung über das Jahr", () => {
  it("gibt ohne Objekte den Faktor 1", () => {
    const e = verschattungAm(MODUL, [], LINZ, 2026);
    expect(e.grad).toBe(0);
    expect(e.faktor).toBe(1);
  });

  it("ein hoher Baum direkt im Süden kostet deutlich", () => {
    /*
     * Ein 15 m hoher Baum, 6 m südlich eines 4 m hohen Dachs, steht
     * ganzjährig im Weg — im Winter erst recht, weil die Sonne flach
     * steht. Der Grad muss klar über einem Drittel liegen.
     */
    const e = verschattungAm(MODUL, [baum({ hoehe: 15, mitte: { x: 0, y: -6 }, radius: 4 })], LINZ, 2026);
    expect(e.grad).toBeGreaterThan(0.3);
    expect(e.faktor).toBeLessThan(1 - 0.3 * SCHATTEN_WIRKUNG + 0.01);
  });

  it("derselbe Baum im Norden kostet nichts", () => {
    /*
     * Auf der Nordhalbkugel steht die Sonne nie im Norden — jedenfalls
     * nicht in Mitteleuropa. Ein Baum dort wirft keinen Schatten aufs
     * Dach. Kommt hier etwas anderes heraus, ist die Zählrichtung des
     * Azimuts verdreht.
     */
    const e = verschattungAm(MODUL, [baum({ hoehe: 15, mitte: { x: 0, y: 6 } })], LINZ, 2026);
    expect(e.grad).toBeLessThan(0.02);
  });

  it("ein weiter entfernter Baum kostet weniger als ein naher", () => {
    const nah = verschattungAm(MODUL, [baum({ hoehe: 12, mitte: { x: 0, y: -6 } })], LINZ, 2026);
    const weit = verschattungAm(MODUL, [baum({ hoehe: 12, mitte: { x: 0, y: -25 } })], LINZ, 2026);
    expect(weit.grad).toBeLessThan(nah.grad);
  });

  it("ein höheres Dach hilft gegen denselben Baum", () => {
    const tief = verschattungAm({ x: 0, y: 0, z: 3 }, [baum()], LINZ, 2026);
    const hoch = verschattungAm({ x: 0, y: 0, z: 9 }, [baum()], LINZ, 2026);
    expect(hoch.grad).toBeLessThan(tief.grad);
  });

  it("bleibt der Faktor auch bei voller Verschattung über null", () => {
    /*
     * Ein Modul im Dauerschatten liefert noch diffuses Licht. Ein
     * Faktor von 0 wäre falsch und würde im Angebot einen Totalausfall
     * behaupten.
     */
    const e = verschattungAm(
      MODUL,
      [baum({ hoehe: 60, mitte: { x: 0, y: -2 }, radius: 20 })],
      LINZ,
      2026,
    );
    expect(e.faktor).toBeGreaterThan(0);
    expect(e.faktor).toBeCloseTo(1 - e.grad * SCHATTEN_WIRKUNG, 6);
  });
});

describe("Mittelwert über die Anlage", () => {
  it("mittelt die Faktoren der Module", () => {
    const m = new Map([
      ["a", { grad: 0, faktor: 1 }],
      ["b", { grad: 0.4, faktor: 0.7 }],
    ]);
    expect(mittlererFaktor(m)).toBeCloseTo(0.85, 6);
  });

  it("gibt für eine leere Anlage 1", () => {
    expect(mittlererFaktor(new Map())).toBe(1);
  });
});

/*
 * ── Verschattung einer ganzen Planung ──────────────────────────────
 *
 * `anlagenVerschattung` ist die Stelle, die der Bildschirm UND das PDF
 * aufrufen. Weicht sie ab, stehen zwei Erträge für dieselbe Anlage im
 * Raum — deshalb wird sie hier eigens geprüft.
 */

function planMitBelegung(objekte: Plan["objekte"]): Plan {
  return {
    ...leererPlan(),
    flaechen: [
      {
        id: "f1",
        name: "Fläche 1",
        punkte: [
          { x: -5, y: -3.5 },
          { x: 5, y: -3.5 },
          { x: 5, y: 3.5 },
          { x: -5, y: 3.5 },
        ],
        neigung: 30,
        azimut: 180,
        traufe: 0,
        randabstand: 0.3,
        hindernisse: [],
      },
    ],
    gruppen: [
      {
        id: "g1",
        name: "Feld 1",
        flaeche: "f1",
        typ: STANDARD_MODUL,
        ausrichtung: "hoch",
        reihenabstand: 0.02,
        spaltenabstand: 0.02,
        winkel: 0,
        anker: { x: -4.5, y: -3 },
        spalten: 4,
        reihen: 2,
        aufstaenderung: null,
        aus: [],
        frei: {},
      },
    ],
    objekte,
  };
}

const FICHTE: Plan["objekte"][number] = {
  id: "o1",
  art: "baum",
  name: "Fichte",
  hoehe: 22,
  mitte: { x: 0, y: -7 },
  radius: 6,
};

describe("Verschattung einer Planung", () => {
  it("gibt ohne Objekte den Faktor 1 und eine leere Karte", () => {
    const e = anlagenVerschattung(planMitBelegung([]), LINZ, 3);
    expect(e.faktor).toBe(1);
    expect(e.jeModul.size).toBe(0);
  });

  it("führt jedes aktive Modul einzeln", () => {
    const e = anlagenVerschattung(planMitBelegung([FICHTE]), LINZ, 3);
    // 4 × 2 Module, alle an.
    expect(e.jeModul.size).toBe(8);
    // Schlüssel wie beim Stringmalen — daran hängt die Färbung.
    expect(e.jeModul.has("g1/0:0")).toBe(true);
  });

  it("übergeht abgeschaltete Module", () => {
    const plan = planMitBelegung([FICHTE]);
    plan.gruppen[0]!.aus = ["0:0", "0:1"];
    expect(anlagenVerschattung(plan, LINZ, 3).jeModul.size).toBe(6);
  });

  it("ein Baum im Süden senkt den Faktor", () => {
    const e = anlagenVerschattung(planMitBelegung([FICHTE]), LINZ, 3);
    expect(e.faktor).toBeLessThan(1);
    expect(e.faktor).toBeGreaterThan(0.2);
  });

  it("ein höheres Haus steht über demselben Baum", () => {
    const tief = anlagenVerschattung(planMitBelegung([FICHTE]), LINZ, 3);
    const hoch = anlagenVerschattung(planMitBelegung([FICHTE]), LINZ, 12);
    expect(hoch.faktor).toBeGreaterThan(tief.faktor);
  });

  it("der Faktor ist der Mittelwert der Einzelwerte", () => {
    /*
     * Sonst liesse sich aus der Kennzahl nicht auf die Färbung schliessen
     * — und im PDF stünde ein Abschlag, den die Module nicht zeigen.
     */
    const e = anlagenVerschattung(planMitBelegung([FICHTE]), LINZ, 3);
    expect(e.faktor).toBeCloseTo(mittlererFaktor(e.jeModul), 9);
  });

  it("ohne Belegung gibt es nichts zu verschatten", () => {
    const plan = { ...planMitBelegung([FICHTE]), gruppen: [] };
    expect(anlagenVerschattung(plan, LINZ, 3).faktor).toBe(1);
  });
});
