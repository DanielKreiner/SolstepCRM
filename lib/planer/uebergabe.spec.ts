import { describe, expect, it } from "vitest";
import {
  abgleichen,
  bedarfAusPlan,
  type GeraeteStand,
  notizMitSchluessel,
  schluesselAusNotiz,
} from "./uebergabe";
import { leererPlan, type Plan } from "./plan";

const GERAETE: GeraeteStand = {
  module: [
    { id: "m1", hersteller: "AIKO", bezeichnung: "Neostar 3P+", artikel_id: "art-modul" },
    { id: "m2", hersteller: "Trina", bezeichnung: "Vertex S+", artikel_id: null },
  ],
  wechselrichter: [
    { id: "w1", hersteller: "Fronius", bezeichnung: "Symo GEN24 10.0", artikel_id: "art-wr" },
  ],
  speicher: [
    { id: "s1", hersteller: "Huawei", bezeichnung: "LUNA2000-10", nutzbar_kwh: 10, artikel_id: null },
  ],
};

/** Ein Plan mit einer Gruppe aus `reihen × spalten` Modulen. */
function planMit(gruppen: Array<{ typ: string; wp: number; reihen: number; spalten: number }>): Plan {
  const p = leererPlan();
  p.flaechen = [
    {
      id: "f1",
      name: "Fläche 1",
      punkte: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 8 },
        { x: 0, y: 8 },
      ],
      neigung: 30,
      azimut: 180,
      traufe: null,
      randabstand: 0.3,
      hindernisse: [],
    },
  ];
  p.gruppen = gruppen.map((g, i) => ({
    id: `g${i}`,
    name: `Feld ${i + 1}`,
    flaeche: "f1",
    typ: { breite: 1.134, hoehe: 1.762, wp: g.wp, bezeichnung: g.typ },
    ausrichtung: "hoch" as const,
    reihenabstand: 0.02,
    spaltenabstand: 0.02,
    winkel: 0,
    anker: { x: 1, y: 1 },
    spalten: g.spalten,
    reihen: g.reihen,
    aufstaenderung: null,
    aus: [],
    entfernt: [],
    frei: {},
  }));
  return p;
}

describe("Bedarfsliste aus der Planung", () => {
  it("fasst Module eines Typs zusammen und hängt die Artikelreferenz an", () => {
    const plan = planMit([
      { typ: "AIKO Neostar 3P+", wp: 490, reihen: 2, spalten: 6 },
      { typ: "AIKO Neostar 3P+", wp: 490, reihen: 1, spalten: 4 },
    ]);
    plan.technik.modul = "m1";

    const p = bedarfAusPlan(plan, GERAETE);
    expect(p).toHaveLength(1);
    // 2 × 6 plus 1 × 4 = 16 Module, eine Position.
    expect(p[0]!.menge).toBe(16);
    expect(p[0]!.bezeichnung).toContain("490 Wp");
    expect(p[0]!.artikel_id).toBe("art-modul");
  });

  it("nimmt Wechselrichter und — nur mit Speicher — den Speicher auf", () => {
    const plan = planMit([{ typ: "AIKO Neostar 3P+", wp: 490, reihen: 2, spalten: 5 }]);
    plan.technik = { modul: "m1", wechselrichter: "w1", speicher: "s1" };

    const ohne = bedarfAusPlan(plan, GERAETE);
    expect(ohne.map((x) => x.schluessel)).toEqual(["modul:AIKO Neostar 3P+", "wr:w1"]);

    /*
     * Ein im Gespräch abgewählter Speicher darf nicht in der Bestellung
     * landen — sonst steht er auf dem Lieferschein und niemand weiss,
     * warum.
     */
    plan.wirtschaft.mitSpeicher = true;
    const mit = bedarfAusPlan(plan, GERAETE);
    expect(mit.map((x) => x.schluessel)).toContain("speicher:s1");
  });

  it("lässt die Artikelreferenz leer, statt einen Artikel zu raten", () => {
    const plan = planMit([{ typ: "Trina Vertex S+", wp: 465, reihen: 2, spalten: 5 }]);
    plan.technik = { modul: "m2", wechselrichter: null, speicher: null };

    const p = bedarfAusPlan(plan, GERAETE);
    // Das Trina-Modul hat keine Artikelreferenz im Stammsatz.
    expect(p[0]!.artikel_id).toBeNull();
  });

  it("ordnet die Referenz nicht dem falschen Modultyp zu", () => {
    /*
     * Zwei Typen auf dem Dach, gewählt ist nur einer. Die Referenz
     * gehört an genau eine Position — die andere lieber ohne Artikel
     * als mit dem falschen.
     */
    const plan = planMit([
      { typ: "AIKO Neostar 3P+", wp: 490, reihen: 2, spalten: 5 },
      { typ: "Trina Vertex S+", wp: 465, reihen: 1, spalten: 4 },
    ]);
    plan.technik.modul = "m1";

    const p = bedarfAusPlan(plan, GERAETE);
    expect(p).toHaveLength(2);
    expect(p.find((x) => x.bezeichnung.includes("AIKO"))!.artikel_id).toBe("art-modul");
    expect(p.find((x) => x.bezeichnung.includes("Trina"))!.artikel_id).toBeNull();
  });

  it("nimmt die Aufständerung als Freitextposition auf", () => {
    const plan = planMit([{ typ: "AIKO Neostar 3P+", wp: 490, reihen: 3, spalten: 4 }]);
    plan.gruppen[0]!.aufstaenderung = { art: "sued", winkel: 15 };
    plan.technik.modul = "m1";

    const p = bedarfAusPlan(plan, GERAETE);
    const uk = p.find((x) => x.schluessel === "aufstaenderung")!;
    expect(uk).toBeTruthy();
    // Menge = Modulzahl; welches System verbaut wird, weiss der Planer nicht.
    expect(uk.menge).toBe(12);
    expect(uk.artikel_id).toBeNull();
  });

  it("gibt für eine leere Planung nichts aus", () => {
    expect(bedarfAusPlan(leererPlan(), GERAETE)).toEqual([]);
  });
});

describe("Abgleich bei erneuter Übergabe", () => {
  const neu = [
    { bezeichnung: "AIKO (490 Wp)", menge: 20, einheit: "Stk", artikel_id: "a1", schluessel: "modul:AIKO" },
    { bezeichnung: "Fronius Symo", menge: 1, einheit: "Stk", artikel_id: "a2", schluessel: "wr:w1" },
  ];

  it("erkennt neu, geändert und entfallen", () => {
    const vorhanden = [
      { id: "p1", bezeichnung: "AIKO (490 Wp)", menge: 16, notiz: "[planer:modul:AIKO]" },
      { id: "p2", bezeichnung: "Huawei LUNA", menge: 1, notiz: "[planer:speicher:s1]" },
    ];
    const a = abgleichen(neu, vorhanden);

    const modul = a.find((x) => x.schluessel === "modul:AIKO")!;
    expect(modul.art).toBe("geaendert");
    expect(modul.vorherigeMenge).toBe(16);
    expect(modul.menge).toBe(20);
    expect(modul.vorhandeneId).toBe("p1");

    expect(a.find((x) => x.schluessel === "wr:w1")!.art).toBe("neu");

    const speicher = a.find((x) => x.schluessel === "speicher:s1")!;
    expect(speicher.art).toBe("entfallen");
    expect(speicher.vorhandeneId).toBe("p2");
  });

  it("erkennt eine umbenannte Position als dieselbe", () => {
    /*
     * Der Vergleich läuft über den Schlüssel in der Notiz, nicht über
     * die Bezeichnung. Im Material werden Namen angepasst — das ist der
     * Normalfall, und danach dürfen Positionen nicht doppelt entstehen.
     */
    const vorhanden = [
      { id: "p1", bezeichnung: "AIKO 490 (Charge Mai)", menge: 20, notiz: "[planer:modul:AIKO]" },
    ];
    const a = abgleichen(neu, vorhanden);
    expect(a.find((x) => x.schluessel === "modul:AIKO")!.art).toBe("unveraendert");
    // Und sie taucht nicht zusätzlich als „neu" auf.
    expect(a.filter((x) => x.schluessel === "modul:AIKO")).toHaveLength(1);
  });

  it("übergeht handgepflegte Positionen ohne Planer-Marke", () => {
    /*
     * Die Bedarfsliste gehört dem Betrieb. Was jemand von Hand
     * eingetragen hat, darf ein Abgleich nicht als „entfallen"
     * vorschlagen.
     */
    const vorhanden = [
      { id: "p9", bezeichnung: "Gerüst 3 Tage", menge: 1, notiz: null },
      { id: "p1", bezeichnung: "AIKO (490 Wp)", menge: 20, notiz: "[planer:modul:AIKO]" },
    ];
    const a = abgleichen(neu, vorhanden);
    expect(a.some((x) => x.bezeichnung.includes("Gerüst"))).toBe(false);
  });

  it("schreibt und liest den Schlüssel in der Notiz", () => {
    const notiz = notizMitSchluessel("modul:AIKO", true);
    expect(notiz).toContain("Artikel zuordnen");
    expect(schluesselAusNotiz(notiz)).toBe("modul:AIKO");
    expect(schluesselAusNotiz(notizMitSchluessel("wr:w1", false))).toBe("wr:w1");
    expect(schluesselAusNotiz(null)).toBeNull();
    expect(schluesselAusNotiz("von Hand ergänzt")).toBeNull();
  });
});
