import { describe, expect, it } from "vitest";
import { type Dachflaeche, grundflaeche, punktInPolygon } from "./flaeche";
import type { Meter } from "./geo";
import {
  achsen,
  aktiveZellen,
  anzahlModule,
  autoBelegen,
  eckenUm,
  kwp,
  modulEcken,
  modulPasst,
  modulflaeche,
  type Modulgruppe,
  nachfuehren,
  naechsteZelle,
  planMasse,
  rasterMitte,
  reihenabstandVorschlag,
  sonnenhoeheWinter,
  STANDARD_MODUL,
  stoesstAn,
  wahreMasse,
  zelle,
} from "./module";

/** Rechteck 10 × 7 m, Traufe ist die untere Kante (Index 0). */
const RECHTECK: Meter[] = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 7 },
  { x: 0, y: 7 },
];

function dach(teil: Partial<Dachflaeche> = {}): Dachflaeche {
  return {
    id: "f1",
    name: "Fläche 1",
    punkte: RECHTECK,
    neigung: 30,
    azimut: 180,
    traufe: 0,
    randabstand: 0.3,
    hindernisse: [],
    ...teil,
  };
}

function gruppe(teil: Partial<Modulgruppe> = {}): Modulgruppe {
  return {
    id: "g1",
    name: "Feld 1",
    flaeche: "f1",
    typ: STANDARD_MODUL,
    ausrichtung: "hoch",
    reihenabstand: 0.02,
    spaltenabstand: 0.02,
    winkel: 0,
    anker: { x: 0.3, y: 0.3 },
    spalten: 3,
    reihen: 2,
    aufstaenderung: null,
    aus: [],
    frei: {},
    ...teil,
  };
}

describe("Modulmasse", () => {
  it("dreht Hoch- und Querformat", () => {
    expect(wahreMasse(gruppe({ ausrichtung: "hoch" }))).toEqual({ quer: 1.134, laengs: 1.762 });
    expect(wahreMasse(gruppe({ ausrichtung: "quer" }))).toEqual({ quer: 1.762, laengs: 1.134 });
  });

  it("verkürzt nur längs — Abnahmetest 5", () => {
    /*
     * Der Kern von Briefing 1.2: in der Draufsicht schrumpft die Kante
     * in Falllinienrichtung, die traufparallele bleibt. 1,762 m auf 45°
     * sind von oben 1,246 m.
     */
    const p45 = planMasse(gruppe(), dach({ neigung: 45 }));
    expect(p45.laengs).toBeCloseTo(1.246, 3);
    expect(p45.quer).toBeCloseTo(1.134, 6);

    const p30 = planMasse(gruppe(), dach({ neigung: 30 }));
    expect(p30.laengs).toBeCloseTo(1.526, 3);

    // Die WAHRE Fläche bleibt davon unberührt — sonst fehlte Leistung.
    expect(modulflaeche(gruppe())).toBeCloseTo(1.134 * 1.762, 9);
  });

  it("verkürzt beim Flachdach nach der Aufständerung, nicht nach dem Dach", () => {
    /*
     * Ein Flachdach hat 0° Neigung — verkürzt wird trotzdem, weil das
     * Modul auf einem Gestell steht. Würde hier die Dachneigung zählen,
     * stünden aufgeständerte Module in der Draufsicht zu tief und die
     * Reihen kämen zu eng.
     */
    const flach = dach({ neigung: 0, traufe: null });
    const g = gruppe({ aufstaenderung: { art: "sued", winkel: 15 } });
    expect(planMasse(g, flach).laengs).toBeCloseTo(1.762 * Math.cos(Math.PI / 12), 6);
    // Ohne Aufständerung liegt das Modul flach und wird nicht verkürzt.
    expect(planMasse(gruppe(), flach).laengs).toBeCloseTo(1.762, 9);
  });
});

describe("Rasterachsen", () => {
  it("liegen quer zur Falllinie und bergauf", () => {
    const a = achsen(gruppe(), dach());
    // Traufe unten → bergab nach Süden → bergauf nach Norden.
    expect(a.laengs.x).toBeCloseTo(0, 9);
    expect(a.laengs.y).toBeCloseTo(1, 9);
    // Quer dazu: entlang der Traufe.
    expect(Math.abs(a.quer.x)).toBeCloseTo(1, 9);
    expect(a.quer.y).toBeCloseTo(0, 9);
    // Rechtwinklig zueinander.
    expect(a.quer.x * a.laengs.x + a.quer.y * a.laengs.y).toBeCloseTo(0, 9);
  });

  it("drehen mit dem Rasterwinkel", () => {
    const a = achsen(gruppe({ winkel: 90 }), dach());
    expect(a.laengs.x).toBeCloseTo(-1, 6);
    expect(a.laengs.y).toBeCloseTo(0, 6);
  });

  it("setzen Zellen im richtigen Abstand", () => {
    const g = gruppe();
    const f = dach();
    const m = planMasse(g, f);
    const a = rasterMitte(g, f, 0, 0);
    const rechts = rasterMitte(g, f, 0, 1);
    const oben = rasterMitte(g, f, 1, 0);

    expect(Math.hypot(rechts.x - a.x, rechts.y - a.y)).toBeCloseTo(m.quer + 0.02, 9);
    expect(Math.hypot(oben.x - a.x, oben.y - a.y)).toBeCloseTo(m.laengs + 0.02, 9);
    // Reihe 1 liegt weiter oben, also nördlicher.
    expect(oben.y).toBeGreaterThan(a.y);
  });

  it("gibt vier Ecken in Draufsichtgrösse", () => {
    const g = gruppe();
    const f = dach({ neigung: 45 });
    const ecken = modulEcken(g, f, 0, 0);
    expect(ecken).toHaveLength(4);
    // Die Fläche des Vierecks entspricht den verkürzten Massen.
    const m = planMasse(g, f);
    expect(grundflaeche(ecken)).toBeCloseTo(m.quer * m.laengs, 6);
  });
});

describe("Passt das Modul", () => {
  it("nimmt an, was drin liegt, und lehnt ab, was zu nah am Rand ist", () => {
    const f = dach({ randabstand: 0.3 });
    const g = gruppe();
    // Mitte der Fläche: passt.
    expect(modulPasst(eckenUm({ x: 5, y: 3.5 }, g, f), f)).toBe(true);
    // Direkt an der Traufe: der Randabstand fehlt.
    expect(modulPasst(eckenUm({ x: 5, y: 0.4 }, g, f), f)).toBe(false);
    // Halb draussen.
    expect(modulPasst(eckenUm({ x: 9.9, y: 3.5 }, g, f), f)).toBe(false);
  });

  it("hält den Saum um ein Hindernis frei", () => {
    const f = dach({
      hindernisse: [
        {
          id: "h1",
          art: "rechteck",
          name: "Kamin",
          punkte: [
            { x: 4.5, y: 3 },
            { x: 5.5, y: 3 },
            { x: 5.5, y: 4 },
            { x: 4.5, y: 4 },
          ],
          abstand: 0.4,
        },
      ],
    });
    const g = gruppe();
    // Direkt neben dem Kamin: der Saum verbietet es.
    expect(modulPasst(eckenUm({ x: 5, y: 2 }, g, f), f)).toBe(false);
    // Weit genug weg.
    expect(modulPasst(eckenUm({ x: 2, y: 3.5 }, g, f), f)).toBe(true);
  });

  it("erkennt eine Kante, die quer durchs Modul läuft", () => {
    /*
     * Der Fall, den eine reine Eckenprüfung übersieht: eine Einbuchtung,
     * die zwischen den Ecken hindurchgeht. Bei einem schmalen Schlitz
     * lägen alle vier Ecken innen — das Modul aber über dem Loch.
     */
    const schlitz: Meter[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 7 },
      { x: 5.1, y: 7 },
      { x: 5.1, y: 1 },
      { x: 4.9, y: 1 },
      { x: 4.9, y: 7 },
      { x: 0, y: 7 },
    ];
    const f = dach({ punkte: schlitz, randabstand: 0.1 });
    const g = gruppe({ ausrichtung: "quer" });
    expect(modulPasst(eckenUm({ x: 5, y: 4 }, g, f), f)).toBe(false);
  });
});

describe("Kollision zwischen Gruppen", () => {
  it("erkennt Überlappung und lässt Nachbarschaft zu", () => {
    const f = dach();
    const g = gruppe();
    const a = eckenUm({ x: 3, y: 3 }, g, f);
    expect(stoesstAn(eckenUm({ x: 3.2, y: 3 }, g, f), [a])).toBe(true);
    expect(stoesstAn(eckenUm({ x: 6, y: 3 }, g, f), [a])).toBe(false);
    // Deckungsgleich ist erst recht eine Kollision.
    expect(stoesstAn(a, [a])).toBe(true);
  });
});

describe("Automatische Belegung", () => {
  it("füllt ein Rechteck und hält jedes Modul im Innenbereich", () => {
    const f = dach();
    const g = autoBelegen(f, "g1", "Feld 1", {
      typ: STANDARD_MODUL,
      ausrichtung: "hoch",
      reihenabstand: 0.02,
      spaltenabstand: 0.02,
      winkel: 0,
      aufstaenderung: null,
    })!;
    expect(g).not.toBeNull();

    /*
     * Von Hand nachgerechnet, mit Randabstand 0,30 m ringsum:
     *
     *   Spalten: 9,40 m / (1,134 + 0,02) = 8
     *   Reihen:  6,40 m / (1,526 + 0,02) = 4
     *
     * Die 1,526 m sind die VERKÜRZTE Modultiefe bei 30° Neigung
     * (1,762 · cos 30°). Genau hier liegt die Falle: mit dem wahren Mass
     * kämen nur 3 Reihen heraus — eine ganze Reihe zu wenig, weil in der
     * Draufsicht weniger Platz gebraucht wird, als das Modul gross ist.
     */
    expect(anzahlModule(g)).toBe(32);

    // Und jedes einzelne muss die Prüfung bestehen.
    for (const z of aktiveZellen(g)) {
      expect(modulPasst(modulEcken(g, f, z.reihe, z.spalte), f)).toBe(true);
    }
  });

  it("legt bei der L-Form nichts in die Aussparung — Abnahmetest 4", () => {
    const l: Meter[] = [
      { x: 0, y: 0 },
      { x: 12, y: 0 },
      { x: 12, y: 5 },
      { x: 5, y: 5 },
      { x: 5, y: 11 },
      { x: 0, y: 11 },
    ];
    const f = dach({ punkte: l });
    const g = autoBelegen(f, "g1", "Feld 1", {
      typ: STANDARD_MODUL,
      ausrichtung: "hoch",
      reihenabstand: 0.02,
      spaltenabstand: 0.02,
      winkel: 0,
      aufstaenderung: null,
    })!;
    expect(anzahlModule(g)).toBeGreaterThan(20);

    for (const z of aktiveZellen(g)) {
      const ecken = modulEcken(g, f, z.reihe, z.spalte);
      for (const e of ecken) expect(punktInPolygon(e, l)).toBe(true);
      // Der Punkt in der Innenecke ist ausserhalb — dort darf nichts liegen.
      expect(punktInPolygon({ x: 9, y: 9 }, ecken)).toBe(false);
    }
  });

  it("spart Hindernisse aus", () => {
    const ohne = autoBelegen(dach(), "g1", "F", {
      typ: STANDARD_MODUL, ausrichtung: "hoch", reihenabstand: 0.02,
      spaltenabstand: 0.02, winkel: 0, aufstaenderung: null,
    })!;
    const mit = autoBelegen(
      dach({
        hindernisse: [{
          id: "h1", art: "rechteck", name: "Kamin", abstand: 0.3,
          punkte: [{ x: 4, y: 3 }, { x: 6, y: 3 }, { x: 6, y: 5 }, { x: 4, y: 5 }],
        }],
      }),
      "g1", "F",
      { typ: STANDARD_MODUL, ausrichtung: "hoch", reihenabstand: 0.02,
        spaltenabstand: 0.02, winkel: 0, aufstaenderung: null },
    )!;
    expect(anzahlModule(mit)).toBeLessThan(anzahlModule(ohne));
    expect(anzahlModule(mit)).toBeGreaterThan(0);
  });

  it("weicht bereits belegten Stellen aus", () => {
    const f = dach();
    const erste = autoBelegen(f, "g1", "F1", {
      typ: STANDARD_MODUL, ausrichtung: "hoch", reihenabstand: 0.02,
      spaltenabstand: 0.02, winkel: 0, aufstaenderung: null,
    })!;
    const besetzt = aktiveZellen(erste).map((z) => modulEcken(erste, f, z.reihe, z.spalte));

    const zweite = autoBelegen(f, "g2", "F2", {
      typ: STANDARD_MODUL, ausrichtung: "hoch", reihenabstand: 0.02,
      spaltenabstand: 0.02, winkel: 0, aufstaenderung: null, besetzt,
    });
    // Die Fläche ist voll — für eine zweite Gruppe bleibt nichts.
    expect(zweite === null || anzahlModule(zweite) === 0).toBe(true);
  });

  it("bleibt unter 300 ms für eine 60-m²-Fläche", () => {
    const gross: Meter[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 6 },
      { x: 0, y: 6 },
    ];
    const f = dach({ punkte: gross });
    const start = performance.now();
    autoBelegen(f, "g1", "F", {
      typ: STANDARD_MODUL, ausrichtung: "hoch", reihenabstand: 0.02,
      spaltenabstand: 0.02, winkel: 0, aufstaenderung: null,
    });
    expect(performance.now() - start).toBeLessThan(300);
  });
});

describe("Nachführen beim Verschieben — Abnahmetest 8", () => {
  it("markiert verdeckte Module und holt sie zurück", () => {
    const kamin = {
      id: "h1" as const,
      art: "rechteck" as const,
      name: "Kamin",
      abstand: 0.3,
      punkte: [{ x: 4, y: 3 }, { x: 6, y: 3 }, { x: 6, y: 5 }, { x: 4, y: 5 }],
    };
    const f = dach({ hindernisse: [kamin] });
    const frei = gruppe({ anker: { x: 0.4, y: 0.4 }, spalten: 2, reihen: 2 });

    const weg = nachfuehren(frei, f);
    const vorher = anzahlModule(weg);
    expect(vorher).toBeGreaterThan(0);

    // Gruppe unter den Kamin schieben: Module fallen weg.
    const drunter = nachfuehren({ ...weg, anker: { x: 3.6, y: 2.6 } }, f);
    expect(anzahlModule(drunter)).toBeLessThan(vorher);

    // Zurückziehen: sie sind wieder da — nicht gelöscht, nur markiert.
    const zurueck = nachfuehren({ ...drunter, anker: { x: 0.4, y: 0.4 } }, f);
    expect(anzahlModule(zurueck)).toBe(vorher);
  });
});

describe("Flachdach", () => {
  it("rechnet die Sonnenhöhe zur Wintersonnenwende", () => {
    // 90° minus Breite minus Achsneigung 23,44°.
    expect(sonnenhoeheWinter(48)).toBeCloseTo(18.56, 6);
    expect(sonnenhoeheWinter(0)).toBeCloseTo(66.56, 6);
  });

  it("schlägt den Reihenabstand gegen Winterverschattung vor", () => {
    /*
     * Von Hand: h = 1,762 · sin(15°) = 0,456 m über Grund.
     * Schatten = 0,456 / tan(18,56°) = 1,36 m.
     */
    expect(reihenabstandVorschlag(1.762, 15, 48)).toBeCloseTo(1.36, 2);
    // Steiler aufgeständert wirft längere Schatten.
    expect(reihenabstandVorschlag(1.762, 30, 48)).toBeGreaterThan(
      reihenabstandVorschlag(1.762, 15, 48),
    );
    // Weiter nördlich ebenfalls.
    expect(reihenabstandVorschlag(1.762, 15, 60)).toBeGreaterThan(
      reihenabstandVorschlag(1.762, 15, 48),
    );
    // Flach hingelegt braucht es keinen Abstand.
    expect(reihenabstandVorschlag(1.762, 0, 48)).toBeCloseTo(0, 6);
  });
});

describe("Zählen und Zellen", () => {
  it("zählt Module und Leistung ohne die abgeschalteten", () => {
    const g = gruppe({ spalten: 4, reihen: 3, aus: [zelle(0, 0), zelle(1, 1)] });
    expect(anzahlModule(g)).toBe(10);
    expect(kwp(g)).toBeCloseTo(4.4, 9);
    expect(aktiveZellen(g)).toHaveLength(10);
  });

  it("findet die nächste freie Zelle für „ins Raster zurück“", () => {
    const g = gruppe({ spalten: 3, reihen: 2, frei: { [zelle(0, 0)]: { x: 9, y: 6 } } });
    const f = dach();
    const ziel = rasterMitte(g, f, 1, 2);
    const z = naechsteZelle(g, f, ziel)!;
    expect(z).toEqual({ reihe: 1, spalte: 2 });

    // Die frei gezogene Zelle wird nicht als Ziel angeboten.
    const nahAmUrsprung = naechsteZelle(g, f, rasterMitte(g, f, 0, 0))!;
    expect(nahAmUrsprung).not.toEqual({ reihe: 0, spalte: 0 });
  });
});
