import { describe, expect, it } from "vitest";
import { energiefluss, renditeProJahr, speicherVergleich } from "./energiefluss";

/*
 * Der Energiefluss ist eine Aufteilung, keine zweite Rechnung. Die Tests
 * halten genau das fest: Die Summen müssen zu den Jahreszahlen passen,
 * sonst stehen im Angebot zwei verschiedene Wahrheiten.
 */

const MONATE = [260, 380, 590, 750, 760, 760, 790, 735, 625, 480, 285, 235];

const basis = {
  ertragKwh: 6650,
  verbrauchKwh: 4500,
  speicherKwh: 10,
  strompreis: 0.32,
  verguetung: 0.08,
  anlagenpreis: 18000,
  foerderung: 0,
  steigerung: 0.02,
  monateKwh: MONATE,
};

describe("Energiefluss", () => {
  it("teilt die Produktion vollständig auf", () => {
    const f = energiefluss(basis);
    expect(f.direktKwh + f.speicherKwh + f.einspeisungKwh).toBeCloseTo(f.produktionKwh, 0);
  });

  it("deckt den Verbrauch aus Solar, Speicher und Netz", () => {
    const f = energiefluss(basis);
    expect(f.direktKwh + f.speicherKwh + f.netzbezugKwh).toBeCloseTo(f.verbrauchKwh, 0);
  });

  it("summiert die Monate zu den Jahreswerten", () => {
    const f = energiefluss(basis);
    const s = (w: (m: (typeof f.monate)[number]) => number) =>
      f.monate.reduce((a, m) => a + w(m), 0);
    expect(s((m) => m.produktion)).toBeCloseTo(f.produktionKwh, 0);
    expect(s((m) => m.verbrauch)).toBeCloseTo(f.verbrauchKwh, 0);
    expect(s((m) => m.direkt)).toBeCloseTo(f.direktKwh, 0);
    expect(s((m) => m.speicher)).toBeCloseTo(f.speicherKwh, 0);
  });

  it("lässt im Winter mehr Netzbezug als im Sommer", () => {
    const f = energiefluss(basis);
    expect(f.monate[0]!.netz).toBeGreaterThan(f.monate[5]!.netz);
  });

  it("kennt ohne Speicher keinen Speicheranteil", () => {
    const f = energiefluss({ ...basis, speicherKwh: 0 });
    expect(f.speicherKwh).toBe(0);
    expect(f.monate.every((m) => m.speicher === 0)).toBe(true);
  });

  it("holt mit Speicher mehr ins Haus", () => {
    const mit = energiefluss(basis);
    const ohne = energiefluss({ ...basis, speicherKwh: 0 });
    expect(mit.netzbezugKwh).toBeLessThan(ohne.netzbezugKwh);
    expect(mit.autarkie).toBeGreaterThan(ohne.autarkie);
  });
});

describe("Speicher oder nicht", () => {
  it("stellt beide Rechnungen nebeneinander", () => {
    const v = speicherVergleich(basis, 7000);
    expect(v.mit.autarkie).toBeGreaterThan(v.ohne.autarkie);
    expect(v.mehrAutarkie).toBeCloseTo(v.mit.autarkie - v.ohne.autarkie, 6);
    expect(v.wenigerNetzbezugKwh).toBeGreaterThan(0);
    /* Ohne Speicher ist die Anlage billiger — das gehört zur Wahrheit. */
    expect(v.ohne.investition).toBeCloseTo(basis.anlagenpreis - 7000, 6);
    expect(v.preis).toBe(7000);
  });

  it("rechnet ohne Speicherpreis trotzdem sauber", () => {
    const v = speicherVergleich(basis, 0);
    expect(v.ohne.investition).toBeCloseTo(basis.anlagenpreis, 6);
    expect(v.preis).toBe(0);
  });

  it("deckelt einen Speicherpreis über der Angebotssumme", () => {
    /*
     * Steht im Angebot noch kein Speicher, greift der Richtwert je kWh
     * — und der kann grösser sein als die ganze Summe. Ohne Deckel
     * stünde „Investition 0 €, bezahlt nach 0 Jahren" daneben.
     */
    const v = speicherVergleich(basis, basis.anlagenpreis * 2);
    expect(v.preis).toBeCloseTo(basis.anlagenpreis * 0.7, 6);
    expect(v.ohne.investition).toBeGreaterThan(0);
  });
});

describe("Rendite", () => {
  it("ist die mittlere Ersparnis gemessen an der Investition", () => {
    expect(renditeProJahr(76630, 15133)).toBeCloseTo(76630 / 20 / 15133, 6);
  });

  it("bleibt leer, wenn nichts investiert wurde", () => {
    expect(renditeProJahr(1000, 0)).toBeNull();
  });
});
