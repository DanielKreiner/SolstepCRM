import { describe, expect, it } from "vitest";
import {
  kwp,
  mengenJeModul,
  speicherAnzahl,
  wechselrichterFuer,
  type Kandidat,
} from "./auslegung";

describe("kwp", () => {
  it("rechnet Modulzahl mal Nennleistung in Kilowatt", () => {
    expect(kwp(20, 465)).toBe(9.3);
    expect(kwp(31, 465)).toBe(14.42);
  });

  it("kommt mit null Modulen klar", () => {
    expect(kwp(0, 465)).toBe(0);
  });
});

describe("wechselrichterFuer", () => {
  const geraete: Kandidat[] = [
    { id: "a", name: "EC 5.0", wert: 5 },
    { id: "b", name: "EC 10.0", wert: 10 },
    { id: "c", name: "EC 15.0", wert: 15 },
    { id: "d", name: "EC 25.0", wert: 25 },
  ];

  it("nimmt den kleinsten, der reicht", () => {
    /* 9,3 kWp → Untergrenze 6,51 → das 10er passt, das 5er nicht. */
    expect(wechselrichterFuer(9.3, geraete).treffer?.name).toBe("EC 10.0");
  });

  it("legt bewusst knapp unter der Modulleistung aus", () => {
    /* 14,42 kWp → Untergrenze 10,09 → 15er, nicht 25er. */
    expect(wechselrichterFuer(14.42, geraete).treffer?.name).toBe("EC 15.0");
  });

  /*
   * Wichtig, weil es sonst still danebengeht: reicht das grösste Gerät
   * nicht, muss der Aufrufer das erfahren und nicht einfach ein zu
   * kleines eingesetzt bekommen.
   */
  it("meldet, wenn selbst das grösste Gerät zu klein ist", () => {
    const e = wechselrichterFuer(60, geraete);
    expect(e.treffer?.name).toBe("EC 25.0");
    expect(e.zuKlein).toBe(true);
  });

  it("gibt nichts zurück, wenn es nichts gibt", () => {
    expect(wechselrichterFuer(9.3, []).treffer).toBeNull();
  });

  it("ignoriert Geräte ohne hinterlegte Leistung", () => {
    const e = wechselrichterFuer(9.3, [
      { id: "x", name: "ohne Angabe", wert: null },
      { id: "b", name: "EC 10.0", wert: 10 },
    ]);
    expect(e.treffer?.name).toBe("EC 10.0");
  });
});

describe("speicherAnzahl", () => {
  /*
   * Aufrunden, nicht abrunden: 12 kWh Wunsch bei 9,04 je Modul sind zwei
   * Module. Abrunden hiesse, weniger zu liefern als besprochen.
   */
  it("rundet auf", () => {
    expect(speicherAnzahl(12, 9.04)).toBe(2);
    expect(speicherAnzahl(9.04, 9.04)).toBe(1);
    expect(speicherAnzahl(9.05, 9.04)).toBe(2);
  });

  it("ohne Wunsch kein Speicher", () => {
    expect(speicherAnzahl(0, 9.04)).toBe(0);
  });

  it("teilt nicht durch null", () => {
    expect(speicherAnzahl(12, 0)).toBe(0);
  });
});

describe("mengenJeModul", () => {
  const produkte = [
    { id: "k", name: "Klemme", einheit: "Stk", epNetto: 3.1, kalkEk: 2.3, jeModul: 4 },
    { id: "s", name: "Schiene", einheit: "m", epNetto: 12, kalkEk: 9, jeModul: 1.7 },
    { id: "x", name: "zählt nicht mit", einheit: "Stk", epNetto: 5, kalkEk: 4, jeModul: 0 },
  ];

  it("rechnet Stückzahlen hoch und rundet auf ganze Stück", () => {
    const z = mengenJeModul(20, produkte);
    expect(z.find((e) => e.produkt.id === "k")?.menge).toBe(80);
  });

  it("lässt Meter mit Nachkommastelle stehen", () => {
    const z = mengenJeModul(20, produkte);
    expect(z.find((e) => e.produkt.id === "s")?.menge).toBe(34);
  });

  it("rundet halbe Stück auf — 2,5 Klemmen gibt es nicht zu kaufen", () => {
    const z = mengenJeModul(1, [
      { id: "k", name: "Klemme", einheit: "Stk", epNetto: 3, kalkEk: 2, jeModul: 2.5 },
    ]);
    expect(z[0]?.menge).toBe(3);
  });

  it("lässt Produkte ohne Faktor weg", () => {
    expect(mengenJeModul(20, produkte).some((e) => e.produkt.id === "x")).toBe(false);
  });

  it("bei null Modulen bleibt nichts übrig", () => {
    expect(mengenJeModul(0, produkte)).toEqual([]);
  });
});
