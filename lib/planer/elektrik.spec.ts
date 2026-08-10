import { describe, expect, it } from "vitest";
import {
  maxModuleProString,
  minModuleProString,
  type ModulElektrik,
  type Mppt,
  pruefe,
  type String as PvString,
  stringSpannungKalt,
  stringSpannungMpp,
  uocKalt,
  type Wechselrichter,
} from "./elektrik";

/*
 * Die vier Testvektoren aus Briefing 5.3 sind wörtlich vorgegeben und
 * müssen exakt bestehen (Abnahmetest 14). Sie stehen deshalb ganz oben
 * und mit den Zahlen aus dem Briefing als Sollwert — nicht mit dem, was
 * der Code gerade ausrechnet.
 */

/** Modul des ersten Vektorpaars: Uoc 39,4 V, tk −0,25 %/K. */
const MODUL_A: ModulElektrik = {
  bezeichnung: "Testmodul A",
  uoc: 39.4,
  umpp: 33.1,
  isc: 13.9,
  impp: 13.1,
  tkUoc: -0.0025,
  wp: 440,
};

const MPPT_A: Mppt = { uMin: 200, uMax: 800, iMax: 26, maxStrings: 2 };

function wr(teil: Partial<Wechselrichter> = {}): Wechselrichter {
  return {
    bezeichnung: "Testwechselrichter",
    maxDc: 1000,
    mppt: [MPPT_A, { ...MPPT_A }],
    acNenn: 10,
    hybrid: false,
    ...teil,
  };
}

function str(teil: Partial<PvString> = {}): PvString {
  return {
    id: "s1",
    name: "String 1",
    mppt: 0,
    module: [],
    typen: [MODUL_A],
    ...teil,
  };
}

/** n Modulschlüssel — der Inhalt spielt für die Elektrik keine Rolle. */
function module(n: number, praefix = "g1"): string[] {
  return Array.from({ length: n }, (_, i) => `${praefix}/0:${i}`);
}

describe("Testvektoren aus Briefing 5.3 — Abnahmetest 14", () => {
  it("Uoc_kalt liegt bei 42,85 V", () => {
    /*
     * 39,4 V · (1 + (−0,0025) · (−10 − 25)) = 39,4 · 1,0875.
     * Der Koeffizient ist negativ UND die Temperaturdifferenz ist es —
     * die Spannung steigt also, das ist der ganze Punkt der Rechnung.
     */
    expect(uocKalt(MODUL_A)).toBeCloseTo(42.85, 2);
    expect(uocKalt(MODUL_A)).toBeGreaterThan(MODUL_A.uoc);
  });

  it("19 Module: 814,1 V — in Ordnung", () => {
    expect(stringSpannungKalt(19, MODUL_A)).toBeCloseTo(814.1, 1);

    const e = pruefe({ strings: [str({ module: module(19) })], wechselrichter: wr(), ohneString: 0 });
    expect(e.befunde.filter((b) => b.schwere === "fehler")).toHaveLength(0);
    expect(e.geprueft).toBe(true);
  });

  it("24 Module: 1.028,3 V — Fehler, höchstens 23", () => {
    expect(stringSpannungKalt(24, MODUL_A)).toBeCloseTo(1028.3, 1);
    expect(maxModuleProString(MODUL_A, wr())).toBe(23);

    const e = pruefe({ strings: [str({ module: module(24) })], wechselrichter: wr(), ohneString: 0 });
    const fehler = e.befunde.filter((b) => b.schwere === "fehler");
    expect(fehler).toHaveLength(1);
    expect(e.geprueft).toBe(false);

    /*
     * Der Satz muss die gerechneten Werte UND den Ausweg nennen
     * (Briefing 5.3) — kein Fehlercode.
     */
    expect(fehler[0]!.text).toContain("24 Modulen");
    /*
     * Tausendertrenner: de-AT setzt ein schmales Leerzeichen, nicht den
     * Punkt aus dem Beispielsatz des Briefings. Geprüft wird deshalb auf
     * die Ziffern, unabhängig vom Trennzeichen — sonst prüft der Test
     * eine Landeseinstellung statt der Rechnung.
     */
    const ohneTrenner = fehler[0]!.text.replace(/[\u202f\u00a0.\s]/g, "");
    expect(ohneTrenner).toContain("1028,3V");
    expect(ohneTrenner).toContain("1000V");
    expect(fehler[0]!.text).toContain("maximal 23 Module");
  });

  it("5 Module: MPP 165,5 V — Fehler, mehr Module nötig", () => {
    expect(stringSpannungMpp(5, MODUL_A)).toBeCloseTo(165.5, 1);
    expect(minModuleProString(MODUL_A, MPPT_A)).toBe(7);

    const e = pruefe({ strings: [str({ module: module(5) })], wechselrichter: wr(), ohneString: 0 });
    const fehler = e.befunde.filter((b) => b.schwere === "fehler");
    expect(fehler).toHaveLength(1);
    expect(fehler[0]!.text).toContain("165,5 V");
    expect(fehler[0]!.text).toContain("mindestens 7 Module");
  });

  it("21 Module: MPP 695,1 V — in Ordnung", () => {
    expect(stringSpannungMpp(21, MODUL_A)).toBeCloseTo(695.1, 1);

    const e = pruefe({ strings: [str({ module: module(21) })], wechselrichter: wr(), ohneString: 0 });
    expect(e.befunde.filter((b) => b.schwere === "fehler")).toHaveLength(0);
    expect(e.geprueft).toBe(true);
  });
});

describe("MPP-Fenster nach oben", () => {
  it("meldet zu viele Module fürs Fenster", () => {
    // 25 · 33,1 = 827,5 V, das Fenster endet bei 800 V.
    const e = pruefe({ strings: [str({ module: module(25) })], wechselrichter: wr(), ohneString: 0 });
    const texte = e.befunde.map((b) => b.text).join(" ");
    expect(texte).toContain("827,5 V");
    expect(texte).toContain("höchstens 24 Module");
  });
});

describe("Strom und Strings je MPPT", () => {
  it("erkennt zu hohen Strom paralleler Strings", () => {
    // Zwei Strings à 13,1 A = 26,2 A gegen 26 A Grenze.
    const e = pruefe({
      strings: [
        str({ id: "s1", name: "String 1", module: module(19) }),
        str({ id: "s2", name: "String 2", module: module(19, "g2") }),
      ],
      wechselrichter: wr(),
      ohneString: 0,
    });
    const fehler = e.befunde.filter((b) => b.schwere === "fehler");
    expect(fehler).toHaveLength(1);
    expect(fehler[0]!.text).toContain("26,2 A");
    expect(fehler[0]!.text).toContain("freien MPPT");
  });

  it("erkennt zu viele Strings an einem MPPT", () => {
    const e = pruefe({
      strings: [
        str({ id: "s1", module: module(19) }),
        str({ id: "s2", module: module(19, "g2") }),
        str({ id: "s3", module: module(19, "g3") }),
      ],
      wechselrichter: wr({ mppt: [{ ...MPPT_A, iMax: 60, maxStrings: 2 }] }),
      ohneString: 0,
    });
    expect(e.befunde.some((b) => b.text.includes("erlaubt sind 2"))).toBe(true);
  });

  it("warnt bei ungleich langen parallelen Strings — Abnahmetest 16", () => {
    const e = pruefe({
      strings: [
        str({ id: "s1", name: "String 1", module: module(12) }),
        str({ id: "s2", name: "String 2", module: module(14, "g2") }),
      ],
      wechselrichter: wr({ mppt: [{ ...MPPT_A, iMax: 40 }] }),
      ohneString: 0,
    });
    const warnung = e.befunde.find((b) => b.schwere === "warnung");
    expect(warnung).toBeDefined();
    expect(warnung!.text).toContain("12 und 14 Modulen");
    // Warnung, kein Fehler: die Anlage läuft, sie verschenkt nur.
    expect(e.befunde.filter((b) => b.schwere === "fehler")).toHaveLength(0);
  });

  it("nimmt gleich lange parallele Strings widerspruchslos", () => {
    const e = pruefe({
      strings: [
        str({ id: "s1", module: module(14) }),
        str({ id: "s2", module: module(14, "g2") }),
      ],
      wechselrichter: wr({ mppt: [{ ...MPPT_A, iMax: 40 }] }),
      ohneString: 0,
    });
    expect(e.befunde).toHaveLength(0);
    expect(e.geprueft).toBe(true);
  });
});

describe("Nicht zugeordnete Module — Abnahmetest 15", () => {
  it("nennt die Anzahl und verhindert „geprüft“", () => {
    const e = pruefe({
      strings: [str({ module: module(19) })],
      wechselrichter: wr(),
      ohneString: 3,
    });
    expect(e.geprueft).toBe(false);
    const hinweis = e.befunde.find((b) => b.schwere === "hinweis")!;
    expect(hinweis.text).toContain("3 Module");
    expect(hinweis.text).toContain("keinem String");
  });

  it("formuliert die Einzahl richtig", () => {
    const e = pruefe({ strings: [str({ module: module(19) })], wechselrichter: wr(), ohneString: 1 });
    expect(e.befunde.find((b) => b.schwere === "hinweis")!.text).toContain("1 Modul ist");
  });
});

describe("Gemischte Modultypen", () => {
  it("warnt, blockiert aber nicht", () => {
    const anderes: ModulElektrik = { ...MODUL_A, bezeichnung: "Testmodul B", impp: 11.5 };
    const e = pruefe({
      strings: [str({ module: module(19), typen: [MODUL_A, anderes] })],
      wechselrichter: wr(),
      ohneString: 0,
    });
    const warnung = e.befunde.find((b) => b.schwere === "warnung")!;
    expect(warnung.text).toContain("verschiedene Modultypen");
    expect(warnung.text).toContain("schwächste");
    expect(e.geprueft).toBe(true);
  });
});

describe("DC zu AC", () => {
  it("meldet nur oberhalb von 1,5", () => {
    // 19 · 440 Wp = 8,36 kWp an 10 kW AC — unauffällig.
    const knapp = pruefe({
      strings: [str({ module: module(19) })],
      wechselrichter: wr(),
      ohneString: 0,
    });
    expect(knapp.dcAc).toBeCloseTo(0.836, 3);
    expect(knapp.befunde.some((b) => b.text.includes("DC zu AC"))).toBe(false);

    // Derselbe String an 5 kW AC: 1,67 — das regelt ab.
    const viel = pruefe({
      strings: [str({ module: module(19) })],
      wechselrichter: wr({ acNenn: 5 }),
      ohneString: 0,
    });
    expect(viel.dcAc).toBeCloseTo(1.672, 3);
    const warnung = viel.befunde.find((b) => b.text.includes("DC zu AC"))!;
    expect(warnung.schwere).toBe("warnung");
    expect(warnung.text).toContain("1,67");
    // Abregeln ist kein Defekt — geprüft bleibt möglich.
    expect(viel.geprueft).toBe(true);
  });
});

describe("Auslegungstemperatur", () => {
  it("wirkt sich auf die Grenze aus", () => {
    // Milder gerechnet passen mehr Module in den String.
    expect(maxModuleProString(MODUL_A, wr(), 0)).toBeGreaterThan(
      maxModuleProString(MODUL_A, wr(), -20),
    );
  });
});
