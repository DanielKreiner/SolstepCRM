import { describe, expect, it } from "vitest";
import { type Dachflaeche, grundflaeche, punktInPolygon } from "./flaeche";
import type { Meter } from "./geo";
import {
  achsen,
  aktiveZellen,
  anzahlModule,
  autoBelegen,
  erweitere,
  fangeAufRaster,
  insRasterZurueck,
  modulMitte,
  setzeFrei,
  teileGruppe,
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

describe("Gruppe umformen", () => {
  const f = dach();

  it("wächst nach oben und rechts, ohne Zellen zu verschieben", () => {
    const g = gruppe({ spalten: 3, reihen: 2, aus: [zelle(0, 0)] });
    const hoch = erweitere(g, f, "oben", 1);
    expect(hoch.reihen).toBe(3);
    expect(hoch.anker).toEqual(g.anker);
    // Die abgeschaltete Zelle bleibt dieselbe.
    expect(hoch.aus).toEqual([zelle(0, 0)]);

    const breit = erweitere(g, f, "rechts", 2);
    expect(breit.spalten).toBe(5);
    expect(breit.aus).toEqual([zelle(0, 0)]);
  });

  it("verschiebt Anker UND Zellnummern beim Wachsen nach unten", () => {
    /*
     * Der heikle Fall: unten kommt eine Reihe dazu, damit wird aus
     * Reihe 0 die Reihe 1. Ohne Mitverschieben zeigte die abgeschaltete
     * Zelle danach auf ein anderes Modul — still und ohne Fehlermeldung.
     */
    const g = gruppe({ spalten: 3, reihen: 2, aus: [zelle(0, 1)], frei: { [zelle(1, 2)]: { x: 9, y: 9 } } });
    const runter = erweitere(g, f, "unten", 1);

    expect(runter.reihen).toBe(3);
    expect(runter.aus).toEqual([zelle(1, 1)]);
    expect(runter.frei[zelle(2, 2)]).toEqual({ x: 9, y: 9 });
    // Der Anker wandert um genau eine Reihenhöhe nach unten (südwärts).
    const m = planMasse(g, f);
    expect(runter.anker.y).toBeCloseTo(g.anker.y - (m.laengs + g.reihenabstand), 9);

    // Und die Zelle, die vorher (0,1) war, liegt jetzt an derselben Stelle.
    expect(rasterMitte(runter, f, 1, 1).y).toBeCloseTo(rasterMitte(g, f, 0, 1).y, 9);
  });

  it("verschiebt beim Wachsen nach links die Spalten", () => {
    const g = gruppe({ spalten: 2, reihen: 2, aus: [zelle(1, 0)] });
    const links = erweitere(g, f, "links", 1);
    expect(links.spalten).toBe(3);
    expect(links.aus).toEqual([zelle(1, 1)]);
    expect(rasterMitte(links, f, 1, 1).x).toBeCloseTo(rasterMitte(g, f, 1, 0).x, 9);
  });

  it("wirft beim Verkleinern nur die weggefallenen Zellen weg", () => {
    const g = gruppe({ spalten: 3, reihen: 3, aus: [zelle(2, 2), zelle(0, 0)] });
    const kleiner = erweitere(g, f, "oben", -1);
    expect(kleiner.reihen).toBe(2);
    // Reihe 2 gibt es nicht mehr, Zelle (0,0) schon.
    expect(kleiner.aus).toEqual([zelle(0, 0)]);
  });

  it("lässt sich nicht auf null schrumpfen", () => {
    const g = gruppe({ spalten: 2, reihen: 1 });
    expect(erweitere(g, f, "oben", -5)).toEqual(g);
  });
});

describe("Gruppe teilen", () => {
  const f = dach();

  it("trennt einen Block ab und schaltet ihn in der alten Gruppe aus", () => {
    const g = gruppe({ spalten: 4, reihen: 3 });
    const teil = teileGruppe(
      g, f,
      [{ reihe: 1, spalte: 2 }, { reihe: 2, spalte: 3 }],
      "g2", "Feld 2",
    )!;
    expect(teil).not.toBeNull();

    // Der umschliessende Block ist 2 × 2.
    expect(teil.neu.reihen).toBe(2);
    expect(teil.neu.spalten).toBe(2);
    expect(anzahlModule(teil.neu)).toBe(4);

    // In der alten Gruppe fehlen genau diese vier.
    expect(anzahlModule(teil.alt)).toBe(12 - 4);

    // Und sie liegen weiterhin an derselben Stelle.
    expect(rasterMitte(teil.neu, f, 0, 0).x).toBeCloseTo(rasterMitte(g, f, 1, 2).x, 9);
    expect(rasterMitte(teil.neu, f, 0, 0).y).toBeCloseTo(rasterMitte(g, f, 1, 2).y, 9);
  });

  it("nimmt abgeschaltete Module in den neuen Block mit", () => {
    const g = gruppe({ spalten: 3, reihen: 3, aus: [zelle(1, 1)] });
    const teil = teileGruppe(g, f, [{ reihe: 1, spalte: 1 }, { reihe: 2, spalte: 2 }], "g2", "F2")!;
    // (1,1) wird zu (0,0) — und bleibt abgeschaltet.
    expect(teil.neu.aus).toContain(zelle(0, 0));
    expect(anzahlModule(teil.neu)).toBe(3);
  });

  it("teilt nicht, wenn die ganze Gruppe gewählt ist", () => {
    const g = gruppe({ spalten: 2, reihen: 2 });
    const alle = [
      { reihe: 0, spalte: 0 }, { reihe: 0, spalte: 1 },
      { reihe: 1, spalte: 0 }, { reihe: 1, spalte: 1 },
    ];
    expect(teileGruppe(g, f, alle, "g2", "F2")).toBeNull();
    expect(teileGruppe(g, f, [], "g2", "F2")).toBeNull();
  });
});

describe("Einzelmodul frei setzen", () => {
  const f = dach();

  it("löst ein Modul aus dem Raster und holt es zurück", () => {
    const g = gruppe({ spalten: 2, reihen: 2 });
    const raster = rasterMitte(g, f, 0, 1);

    const frei = setzeFrei(g, 0, 1, { x: 8, y: 6 });
    expect(modulMitte(frei, f, 0, 1)).toEqual({ x: 8, y: 6 });
    // Die anderen bleiben im Raster.
    expect(modulMitte(frei, f, 0, 0)).toEqual(rasterMitte(g, f, 0, 0));

    const zurueck = insRasterZurueck(frei, 0, 1);
    expect(modulMitte(zurueck, f, 0, 1)).toEqual(raster);
    // Es zählt weiter zur Gruppe — frei heisst nicht gelöscht.
    expect(anzahlModule(zurueck)).toBe(4);
  });

  it("fängt beim Ziehen aufs Raster ein, wenn es nah genug ist", () => {
    const g = gruppe({ spalten: 2, reihen: 2, frei: { [zelle(0, 0)]: { x: 9, y: 9 } } });
    const ziel = rasterMitte(g, f, 1, 1);
    const nah = { x: ziel.x + 0.05, y: ziel.y + 0.05 };

    expect(fangeAufRaster(g, f, nah, 0.2)).toEqual(ziel);
    // Weit weg bleibt frei.
    const weit = { x: ziel.x + 2, y: ziel.y };
    expect(fangeAufRaster(g, f, weit, 0.2)).toEqual(weit);
  });
});

/*
 * ── Abnahmetests 4, 8, 10 und 11 ───────────────────────────────────
 *
 * Diese vier stehen im Briefing als Bedienabläufe, sind aber im Kern
 * Geometriefragen. Als Unit-Test geprüft sagen sie mehr: Ein
 * Canvas-Klick trifft je nach Kartenausschnitt andere Zellen, die
 * Funktion dahinter ist eindeutig.
 */

describe("Konkaves L-Dach — Abnahmetest 4", () => {
  /*
   * Ein L, zwölf mal zehn Meter, mit einer Kerbe rechts oben. Der
   * springende Punkt ist die Innenecke: Ein Rasteralgorithmus, der nur
   * die Bounding-Box prüft, legt dort Module hin, die ausserhalb des
   * Dachs liegen — und auf dem Bau steht der Monteur vor der Kante.
   */
  const L: Meter[] = [
    { x: 0, y: 0 },
    { x: 12, y: 0 },
    { x: 12, y: 4 },
    { x: 6, y: 4 },
    { x: 6, y: 10 },
    { x: 0, y: 10 },
  ];

  it("belegt beide Schenkel, aber kein Modul liegt in der Kerbe", () => {
    const f = dach({ punkte: L, randabstand: 0.2 });
    const g = autoBelegen(f, "gL", "L-Feld", {
      typ: STANDARD_MODUL,
      ausrichtung: "hoch",
      reihenabstand: 0.02,
      spaltenabstand: 0.02,
      winkel: 0,
      aufstaenderung: null,
    });
    expect(g).not.toBeNull();
    expect(anzahlModule(g!)).toBeGreaterThan(4);

    /*
     * Jede Ecke jedes aktiven Moduls muss im Polygon liegen. Die Mitte
     * zu prüfen würde nicht reichen: ein Modul kann mittig drin liegen
     * und trotzdem über die Innenecke ragen.
     */
    for (const z of aktiveZellen(g!)) {
      for (const ecke of modulEcken(g!, f, z.reihe, z.spalte)) {
        expect(
          punktInPolygon(ecke, L),
          `Ecke (${ecke.x.toFixed(2)}, ${ecke.y.toFixed(2)}) liegt ausserhalb`,
        ).toBe(true);
      }
    }

    // Und in der Kerbe (rechts oben) liegt wirklich nichts.
    const inDerKerbe = aktiveZellen(g!).filter((z) => {
      const m = modulMitte(g!, f, z.reihe, z.spalte);
      return m.x > 6 && m.y > 4;
    });
    expect(inDerKerbe).toHaveLength(0);
  });
});

describe("Gruppe über ein Hindernis — Abnahmetest 8", () => {
  /*
   * Ein Kamin mitten auf dem Dach. Wandert die Gruppe darüber, müssen
   * die betroffenen Module verschwinden; wandert sie zurück, müssen sie
   * wiederkommen. Der zweite Teil ist der schwierigere: Wer die Module
   * beim Verschieben löscht statt sie zu markieren, bekommt sie nie
   * wieder — und der Planer verliert stillschweigend Leistung.
   */
  const kamin = {
    id: "h1",
    name: "Kamin",
    art: "rechteck" as const,
    punkte: [
      { x: 4.5, y: 2.5 },
      { x: 6.0, y: 2.5 },
      { x: 6.0, y: 4.0 },
      { x: 4.5, y: 4.0 },
    ],
    abstand: 0.3,
  };

  it("markiert betroffene Module und gibt sie beim Zurückziehen wieder frei", () => {
    const f = dach({ hindernisse: [kamin] });
    const frei = nachfuehren(gruppe({ anker: { x: 0.3, y: 0.3 }, spalten: 3, reihen: 2 }), f);
    const vorher = anzahlModule(frei);
    expect(vorher).toBe(6);

    // Die Gruppe auf den Kamin schieben.
    const drueber = nachfuehren({ ...frei, anker: { x: 4.4, y: 2.4 } }, f);
    expect(anzahlModule(drueber)).toBeLessThan(vorher);

    /*
     * Zurück an die alte Stelle — und die Module sind wieder da. Der
     * Vergleich ist bewusst gegen die ANFANGSZAHL, nicht gegen „mehr
     * als vorhin": Ein Verlust von einem Modul wäre sonst unsichtbar.
     */
    const zurueck = nachfuehren({ ...drueber, anker: { x: 0.3, y: 0.3 } }, f);
    expect(anzahlModule(zurueck)).toBe(vorher);
  });
});

describe("Zwei Gruppen auf einer Fläche — Abnahmetests 10 und 11", () => {
  it("hält unterschiedliche Rasterwinkel auseinander", () => {
    /*
     * Ein Dach kann zwei Felder tragen, die verschieden ausgerichtet
     * sind — etwa um eine Gaube herum. Der Winkel gehört zur Gruppe,
     * nicht zur Fläche.
     */
    const f = dach();
    const gerade = gruppe({ id: "g1", winkel: 0, anker: { x: 0.3, y: 0.3 } });
    const schraeg = gruppe({ id: "g2", winkel: 12, anker: { x: 5.5, y: 0.3 } });

    const a = achsen(gerade, f);
    const b = achsen(schraeg, f);

    // Die Rasterachsen zeigen wirklich in verschiedene Richtungen.
    const winkelZwischen =
      (Math.atan2(b.quer.y, b.quer.x) - Math.atan2(a.quer.y, a.quer.x)) * (180 / Math.PI);
    expect(Math.abs(winkelZwischen)).toBeCloseTo(12, 0);

    // Und beide bleiben belegbar, jede in ihrem eigenen Raster.
    expect(anzahlModule(nachfuehren(gerade, f))).toBeGreaterThan(0);
    expect(anzahlModule(nachfuehren(schraeg, f))).toBeGreaterThan(0);
  });

  it("ändert das Querformat nur die eine Gruppe — Abnahmetest 11", () => {
    const gerade = gruppe({ id: "g1", ausrichtung: "hoch" });
    const gedreht: Modulgruppe = { ...gruppe({ id: "g2" }), ausrichtung: "quer" };

    expect(wahreMasse(gerade)).toEqual({ quer: 1.134, laengs: 1.762 });
    expect(wahreMasse(gedreht)).toEqual({ quer: 1.762, laengs: 1.134 });
    // Die erste Gruppe ist davon unberührt — sie teilt sich nichts mit
    // der zweiten ausser der Fläche.
    expect(gerade.ausrichtung).toBe("hoch");
  });
});
