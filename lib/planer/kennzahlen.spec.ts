import { describe, expect, it } from "vitest";
import { planungKennzahlen } from "./kennzahlen";
import { leererPlan, type Plan } from "./plan";
import type { Meter } from "./geo";

/*
 * Die Zahlen, die beim Kunden landen (Wunsch vom 13.08.2026: „mach,
 * dass der Ertrag PDF mit dem Angebot verschmilzt").
 *
 * Geprüft wird, dass hier dieselben Regeln gelten wie am Bildschirm —
 * vor allem beim Speicher und beim Preis, den beiden Stellen, an denen
 * die Dokumente auseinandergelaufen sind.
 */

const LINZ = { lat: 48.30604, lon: 14.28583 };

const VORGABE = {
  strompreis: 0.28,
  verguetung: 0.08,
  steigerung: 0.02,
  speicherEurProKwh: 600,
  staffel: [{ ab_kwp: 0, eur_pro_kwp: 1400 }],
  verlustProzent: 14,
};

function planMitDach(): Plan {
  const punkte: Meter[] = [
    { x: 0, y: 0 },
    { x: 14, y: 0 },
    { x: 14, y: 9 },
    { x: 0, y: 9 },
  ];
  return {
    ...leererPlan(),
    flaechen: [
      {
        id: "f1",
        name: "Fläche 1",
        punkte,
        neigung: 30,
        azimut: 180,
        traufe: 0,
        randabstand: 0.3,
        hindernisse: [],
        bau: null,
        teil: null,
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
        anker: { x: 1, y: 1 },
        spalten: 6,
        reihen: 3,
        aus: [],
        entfernt: [],
        frei: {},
        aufstaenderung: null,
      },
    ],
  } as unknown as Plan;
}

describe("planungKennzahlen", () => {
  it("rechnet Leistung und Ertrag aus dem Plan", () => {
    const k = planungKennzahlen({
      plan: planMitDach(),
      ursprung: LINZ,
      geraetSpeicherKwh: 0,
      angebotssumme: null,
      vorgabe: VORGABE,
    });

    // 18 Module à 440 Wp = 7,92 kWp
    expect(k.kwp).toBeCloseTo(7.92, 2);
    expect(k.jahresertragKwh).toBeGreaterThan(6000);
    expect(k.jahresertragKwh).toBeLessThan(11000);
    expect(k.monateKwh).toHaveLength(12);
  });

  it("nimmt die eingetippte Speichergrösse vor dem Gerät", () => {
    const plan = planMitDach();
    const ohne = planungKennzahlen({
      plan,
      ursprung: LINZ,
      geraetSpeicherKwh: 0,
      angebotssumme: null,
      vorgabe: VORGABE,
    });

    const mit = planungKennzahlen({
      plan: { ...plan, wirtschaft: { ...plan.wirtschaft, speicherKwh: 10 } },
      ursprung: LINZ,
      /*
       * Kein Gerät gewählt — genau der Fall aus dem Betrieb: „In der
       * Kunden-PDF wird der Speicher nicht eingerechnet."
       */
      geraetSpeicherKwh: 0,
      angebotssumme: null,
      vorgabe: VORGABE,
    });

    expect(mit.speicherKwh).toBe(10);
    expect(mit.wirtschaft.autarkie).toBeGreaterThan(ohne.wirtschaft.autarkie);
    expect(mit.wirtschaft.ersparnisJahr1).toBeGreaterThan(ohne.wirtschaft.ersparnisJahr1);
  });

  it("nimmt die Angebotssumme als Anlagenpreis", () => {
    const k = planungKennzahlen({
      plan: planMitDach(),
      ursprung: LINZ,
      geraetSpeicherKwh: 0,
      angebotssumme: 24500,
      vorgabe: VORGABE,
    });
    expect(k.anlagenpreis).toBe(24500);
    expect(k.wirtschaft.investition).toBe(24500);
  });

  it("gibt die Ersparnis über zwanzig Jahre ohne die Investition aus", () => {
    const k = planungKennzahlen({
      plan: planMitDach(),
      ursprung: LINZ,
      geraetSpeicherKwh: 0,
      angebotssumme: 20000,
      vorgabe: VORGABE,
    });

    /*
     * Die Kurve zeigt „kumuliert minus Investition". Für den Satz „du
     * sparst insgesamt" ist die reine Ersparnis gemeint — sonst stünde
     * dort eine kleinere Zahl als im ersten Jahr mal zwanzig.
     */
    expect(k.ersparnis20).toBeGreaterThan(k.wirtschaft.ersparnisJahr1 * 20 * 0.9);
    expect(k.ersparnis20).toBeCloseTo(
      (k.wirtschaft.kurve[19] ?? 0) + k.wirtschaft.investition,
      6,
    );
  });

  it("kommt mit einem leeren Plan zurecht", () => {
    const k = planungKennzahlen({
      plan: leererPlan(),
      ursprung: LINZ,
      geraetSpeicherKwh: 0,
      angebotssumme: null,
      vorgabe: VORGABE,
    });
    expect(k.kwp).toBe(0);
    expect(k.jahresertragKwh).toBe(0);
    expect(k.wirtschaft.autarkie).toBe(0);
  });
});
