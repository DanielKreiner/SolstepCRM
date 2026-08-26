import { describe, expect, it } from "vitest";
import type { Dachflaeche } from "./flaeche";
import type { Meter } from "./geo";
import {
  abstandVorschlag,
  aktiveZellen,
  anzahlModule,
  autoBelegen,
  eckenHub,
  modulAnbauen,
  ostWestWinkel,
  laengsVersatz,
  type Modulgruppe,
  OST_WEST_FIRSTLUFT,
  planMasse,
  rasterIndex,
  rasterMitte,
  STANDARD_MODUL,
} from "./module";
import { anbaustelleSetzen, modulEntfernen, modulSetzen } from "./setzen";
import type { Plan } from "./plan";

/*
 * Aufständerung auf dem Flachdach.
 *
 * Drei Arten, drei verschiedene Geometrien — und genau die fehlten:
 * Süd und Ost/West sahen auf dem Dach aus wie flach aufliegend, weil das
 * Raster für alle drei denselben gleichmässigen Reihenschritt nahm.
 */

const FLACHDACH: Meter[] = [
  { x: 0, y: 0 },
  { x: 12, y: 0 },
  { x: 12, y: 12 },
  { x: 0, y: 12 },
];

const dach: Dachflaeche = {
  id: "f1",
  name: "Flachdach",
  punkte: FLACHDACH,
  neigung: 0,
  azimut: 180,
  traufe: null,
  randabstand: 0.3,
  hindernisse: [],
};

function gruppe(teil: Partial<Modulgruppe> = {}): Modulgruppe {
  return {
    id: "g1",
    name: "Feld 1",
    flaeche: "f1",
    typ: STANDARD_MODUL,
    ausrichtung: "hoch",
    reihenabstand: 0.5,
    spaltenabstand: 0.02,
    winkel: 0,
    anker: { x: 1, y: 1 },
    spalten: 2,
    reihen: 4,
    aufstaenderung: { art: "ost-west", winkel: 15 },
    aus: [],
    entfernt: [],
    frei: {},
    ...teil,
  };
}

describe("Ost/West steht in Paaren", () => {
  it("legt die zwei Module eines Paares dicht aneinander", () => {
    const g = gruppe();
    const m = planMasse(g, dach);
    const innen = laengsVersatz(g, dach, 1) - laengsVersatz(g, dach, 0);
    expect(innen).toBeCloseTo(m.laengs + OST_WEST_FIRSTLUFT, 6);
  });

  it("lässt zwischen den Paaren den Reihenabstand", () => {
    const g = gruppe();
    const m = planMasse(g, dach);
    const zwischen = laengsVersatz(g, dach, 2) - laengsVersatz(g, dach, 1);
    expect(zwischen).toBeCloseTo(m.laengs + g.reihenabstand, 6);
  });

  it("findet zu jeder Reihe wieder ihren Index", () => {
    const g = gruppe({ reihen: 8 });
    for (let r = 0; r < 8; r++) {
      const mitte = rasterMitte(g, dach, r, 1);
      expect(rasterIndex(g, dach, mitte)).toEqual({ reihe: r, spalte: 1 });
    }
  });

  it("kippt die beiden Module eines Paares gegeneinander", () => {
    const g = gruppe();
    const a = eckenHub(g, 0);
    const b = eckenHub(g, 1);
    // Reihe 0 steht bergauf hoch, Reihe 1 talwärts — das ergibt das Dach.
    expect(a[2]).toBeGreaterThan(0);
    expect(a[0]).toBe(0);
    expect(b[0]).toBeGreaterThan(0);
    expect(b[2]).toBe(0);
    // 15° auf 1,762 m Modullänge sind gut 45 cm Hub.
    expect(a[2]).toBeCloseTo(1.762 * Math.sin((15 * Math.PI) / 180), 6);
  });

  it("lässt am Rand kein halbes Paar stehen", () => {
    /* Ein Dach mit schräger Kante — dort passt reihenweise nur die Hälfte. */
    const schraeg: Dachflaeche = {
      ...dach,
      punkte: [
        { x: 0, y: 0 },
        { x: 12, y: 0 },
        { x: 12, y: 6 },
        { x: 0, y: 12 },
      ],
    };
    const g = autoBelegen(schraeg, "g1", "Feld 1", {
      typ: STANDARD_MODUL,
      ausrichtung: "quer",
      reihenabstand: 0.25,
      spaltenabstand: 0.02,
      winkel: -90,
      aufstaenderung: { art: "ost-west", winkel: 15 },
    });
    expect(g).not.toBeNull();
    expect(anzahlModule(g!) % 2).toBe(0);

    /* Und keines steht ohne sein Gegenstück. */
    const belegt = new Set(aktiveZellen(g!).map((z) => `${z.reihe}:${z.spalte}`));
    for (const z of aktiveZellen(g!)) {
      const partner = z.reihe % 2 === 0 ? z.reihe + 1 : z.reihe - 1;
      expect(belegt.has(`${partner}:${z.spalte}`)).toBe(true);
    }
  });

  it("belegt nur ganze Paare", () => {
    const g = autoBelegen(dach, "g1", "Feld 1", {
      typ: STANDARD_MODUL,
      ausrichtung: "hoch",
      reihenabstand: 0.25,
      spaltenabstand: 0.02,
      winkel: 0,
      aufstaenderung: { art: "ost-west", winkel: 15 },
    });
    expect(g).not.toBeNull();
    expect(g!.reihen % 2).toBe(0);
  });
});

describe("Ost/West liegt quer", () => {
  it("nimmt bei der Belegung das Querformat und dreht die Reihen", () => {
    const r = modulSetzen(
      { flaechen: [dach], gruppen: [], strings: [], objekte: [] } as unknown as Plan,
      { x: 6, y: 6 },
      dach.id,
      STANDARD_MODUL,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const g = r.plan.gruppen[0]!;
    /*
     * Quer liegt die lange Kante in der Reihe: das Gestell wird
     * niedriger, und auf dieselbe Dachtiefe passen mehr Paare.
     */
    expect(planMasse(g, dach).quer).toBeCloseTo(STANDARD_MODUL.hoehe, 6);
    // Reihen von Nord nach Süd, damit die Paare nach Ost und West kippen.
    expect(g.winkel).toBe(-90);
  });
});

describe("Süd steht in Reihen", () => {
  it("hält den gleichmässigen Schritt", () => {
    const g = gruppe({ aufstaenderung: { art: "sued", winkel: 20 }, winkel: 0 });
    const m = planMasse(g, dach);
    expect(laengsVersatz(g, dach, 1) - laengsVersatz(g, dach, 0)).toBeCloseTo(
      m.laengs + g.reihenabstand,
      6,
    );
  });

  it("kippt alle Module in dieselbe Richtung", () => {
    const g = gruppe({ aufstaenderung: { art: "sued", winkel: 20 } });
    expect(eckenHub(g, 0)).toEqual(eckenHub(g, 1));
  });
});

describe("Reihenabstand aus dem Winkel", () => {
  it("wächst bei Süd mit dem Winkel", () => {
    const flach = abstandVorschlag(
      { typ: STANDARD_MODUL, ausrichtung: "hoch", aufstaenderung: { art: "sued", winkel: 10 } },
      48,
    );
    const steil = abstandVorschlag(
      { typ: STANDARD_MODUL, ausrichtung: "hoch", aufstaenderung: { art: "sued", winkel: 30 } },
      48,
    );
    expect(steil).toBeGreaterThan(flach);
    expect(flach).toBeGreaterThan(0.5);
  });

  it("bleibt bei Ost/West ein Gang, kein Schattenabstand", () => {
    const ow = abstandVorschlag(
      { typ: STANDARD_MODUL, ausrichtung: "hoch", aufstaenderung: { art: "ost-west", winkel: 15 } },
      48,
    );
    const sued = abstandVorschlag(
      { typ: STANDARD_MODUL, ausrichtung: "hoch", aufstaenderung: { art: "sued", winkel: 15 } },
      48,
    );
    expect(ow).toBeLessThan(sued);
    expect(ow).toBeGreaterThanOrEqual(0.1);
  });

  it("liegt flach bei zwei Zentimetern", () => {
    expect(
      abstandVorschlag(
        { typ: STANDARD_MODUL, ausrichtung: "hoch", aufstaenderung: null },
        48,
      ),
    ).toBe(0.02);
  });
});

describe("Ein Klick legt bei Ost/West beide Module", () => {
  const plan = (gruppen: Modulgruppe[]): Plan =>
    ({
      flaechen: [dach],
      gruppen,
      strings: [],
      objekte: [],
    }) as unknown as Plan;

  it("legt schon beim ersten Modul ein Paar an", () => {
    /*
     * Auch auf dem leeren Flachdach: Ost/West ist dort die Vorgabe, und
     * ein einzelnes Modul eines Paares gibt es nicht. Vorher legte der
     * erste Klick ein flach liegendes Einzelmodul, und wer danach die
     * Fläche fertig belegte, hatte zwei Bauarten auf einem Dach.
     */
    const r = modulSetzen(plan([]), { x: 6, y: 6 }, dach.id, STANDARD_MODUL);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const neu = r.plan.gruppen.find((x) => x.id === r.gruppe)!;
    expect(neu.aufstaenderung?.art).toBe("ost-west");
    expect(neu.ausrichtung).toBe("quer");
    expect(anzahlModule(neu)).toBe(2);
  });

  it("zieht beim Anbauen das Gegenstück nach", () => {
    const g = gruppe({ spalten: 1, reihen: 2, aus: [], entfernt: [] });
    const p = plan([g]);
    /* Die Nachbarspalte des vorhandenen Paares. */
    const ziel = rasterMitte(g, dach, 0, 1);
    const r = modulSetzen(p, ziel, dach.id);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const neu = r.plan.gruppen.find((x) => x.id === "g1")!;
    const inSpalte1 = aktiveZellen(neu)
      .filter((z) => z.spalte === 1)
      .map((z) => z.reihe)
      .sort();
    expect(inSpalte1).toEqual([0, 1]);
  });

  it("nimmt beide wieder weg", () => {
    const g = gruppe({ spalten: 1, reihen: 2 });
    const p = plan([g]);
    expect(anzahlModule(g)).toBe(2);
    const nachher = modulEntfernen(p, "g1", 0, 0);
    // Von der Gruppe bleibt nichts übrig — beide Module gehören zusammen.
    expect(nachher.gruppen).toHaveLength(0);
  });
});

describe("Anbauen bleibt paarweise", () => {
  it("legt am Pluszeichen beide Module des Paares", () => {
    const g = gruppe({ spalten: 1, reihen: 2 });
    const neu = modulAnbauen(g, dach, { reihe: 0, spalte: 1 });
    const inSpalte1 = aktiveZellen(neu)
      .filter((z) => z.spalte === 1)
      .map((z) => z.reihe)
      .sort();
    expect(inSpalte1).toEqual([0, 1]);
  });

  const weit: Dachflaeche = {
    ...dach,
    punkte: [
      { x: -12, y: -12 },
      { x: 24, y: -12 },
      { x: 24, y: 24 },
      { x: -12, y: 24 },
    ],
  };

  it("wächst nach unten um ein ganzes Paar", () => {
    /*
     * Der Fehler dahinter: Wuchs die Gruppe um EINE Reihe nach unten,
     * verschoben sich alle Nummern um eins — aus jedem Paar wurden zwei
     * Hälften, und man konnte eine einzelne Ost/West-Reihe bekommen.
     */
    const g = gruppe({ spalten: 1, reihen: 2 });
    const neu = modulAnbauen(g, weit, { reihe: -1, spalte: 0 });
    expect(neu.reihen).toBe(4);
    expect(anzahlModule(neu) % 2).toBe(0);
    const belegt = new Set(aktiveZellen(neu).map((z) => `${z.reihe}:${z.spalte}`));
    for (const z of aktiveZellen(neu)) {
      const partner = z.reihe % 2 === 0 ? z.reihe + 1 : z.reihe - 1;
      expect(belegt.has(`${partner}:${z.spalte}`)).toBe(true);
    }
  });

  it("hält die Lage des bestehenden Paares beim Wachsen nach unten", () => {
    const g = gruppe({ spalten: 1, reihen: 2 });
    const vorher = rasterMitte(g, weit, 0, 0);
    const neu = modulAnbauen(g, weit, { reihe: -1, spalte: 0 });
    /* Aus Reihe 0 wird Reihe 2 — an derselben Stelle auf dem Dach. */
    const nachher = rasterMitte(neu, weit, 2, 0);
    expect(nachher.x).toBeCloseTo(vorher.x, 6);
    expect(nachher.y).toBeCloseTo(vorher.y, 6);
  });

  it("setzt auch am Pluszeichen der räumlichen Ansicht ein Paar", () => {
    const p = {
      flaechen: [dach],
      gruppen: [gruppe({ spalten: 1, reihen: 2 })],
      strings: [],
      objekte: [],
    } as unknown as Plan;
    const nachher = anbaustelleSetzen(p, "g1", 0, 1);
    const g = nachher.gruppen[0]!;
    expect(anzahlModule(g)).toBe(4);
  });
});

describe("Ost/West richtet sich an einer Dachkante aus", () => {
  it("kippt nach Ost und West, wenn das Dach nach Norden steht", () => {
    /* Rechteck achsparallel: die Kipprichtung zeigt genau nach Osten. */
    expect(Math.abs(ostWestWinkel(dach))).toBe(90);
  });

  it("folgt einer gedrehten Dachkante", () => {
    const gedreht: Dachflaeche = {
      ...dach,
      punkte: [
        { x: 0, y: 0 },
        { x: 10, y: 2 },
        { x: 8, y: 12 },
        { x: -2, y: 10 },
      ],
    };
    /*
     * Die längste Ost-West-Kante steigt um gut elf Grad an; das Feld
     * dreht sich mit, statt schräg im Dach zu stehen.
     */
    const w = ostWestWinkel(gedreht);
    expect(w).toBeLessThan(-70);
    expect(w).toBeGreaterThan(-85);
  });
});
