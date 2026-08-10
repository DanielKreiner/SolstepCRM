import { describe, expect, it } from "vitest";
import {
  evQuote,
  MODELL,
  rechne,
  richtpreis,
  verbrauchAusChips,
  type WirtschaftEingaben,
} from "./wirtschaft";

/*
 * Abnahmetest 18 des Briefings verlangt, dass die Rechenkette von Hand
 * nachvollziehbar ist. Deshalb steht sie hier ausgeschrieben — wer eine
 * Konstante ändert, sieht sofort, welche Zahl sich mitbewegt.
 *
 * Beispielhaus: 9.500 kWh Ertrag, 4.500 kWh Verbrauch, 0,28 €/kWh
 * Netzstrom, 0,08 €/kWh Einspeisung, 18.000 € Anlage, 1.500 € Förderung.
 */
const HAUS: WirtschaftEingaben = {
  ertragKwh: 9500,
  verbrauchKwh: 4500,
  speicherKwh: 0,
  strompreis: 0.28,
  verguetung: 0.08,
  anlagenpreis: 18000,
  foerderung: 1500,
};

describe("Wirtschaftlichkeit ohne Speicher", () => {
  it("rechnet die Kette so, wie sie von Hand herauskommt", () => {
    const r = rechne(HAUS);

    /*
     *   Deckung  = min(1, 4500 / 9500)          = 0,473684
     *   EV-Quote = 0,22 + 0,38 · 0,473684       = 0,40
     */
    expect(r.evQuote).toBeCloseTo(0.4, 6);

    //   Eigenverbrauch = min(9500 · 0,40 ; 4500 · 0,99) = min(3800 ; 4455) = 3800
    expect(r.eigenverbrauchKwh).toBeCloseTo(3800, 6);

    //   Autarkie = 3800 / 4500 = 0,84444
    expect(r.autarkie).toBeCloseTo(0.844444, 5);

    //   Einspeisung = 9500 − 3800 = 5700
    expect(r.einspeisungKwh).toBeCloseTo(5700, 6);

    //   Ersparnis = 3800 · 0,28 + 5700 · 0,08 = 1064 + 456 = 1520 €
    expect(r.ersparnisJahr1).toBeCloseTo(1520, 6);

    //   Investition = 18000 − 1500 = 16500 €
    expect(r.investition).toBeCloseTo(16500, 6);

    //   Amortisation = 16500 / 1520 = 10,855 Jahre
    expect(r.amortisationJahre).toBeCloseTo(10.855263, 5);
  });

  it("führt die 20-Jahre-Kurve mit steigendem Strompreis", () => {
    const r = rechne(HAUS);
    expect(r.kurve).toHaveLength(MODELL.jahre);

    //   Jahr 1: 1520 − 16500 = −14980
    expect(r.kurve[0]).toBeCloseTo(-14980, 6);

    /*
     * Jahr 2 rechnet den gesparten Netzstrom mit 0,28 · 1,02 = 0,2856:
     *   3800 · 0,2856 + 456 = 1541,28
     *   kumuliert 3061,28 → 3061,28 − 16500 = −13438,72
     */
    expect(r.kurve[1]).toBeCloseTo(-13438.72, 4);

    /*
     * Break-even mit Steigerung: nach 10 Jahren sind 16.210 € kumuliert
     * (noch unter der Investition), nach 11 Jahren 17.963 €.
     */
    expect(r.breakEvenJahr).toBe(11);
    expect(r.kurve[9]).toBeLessThan(0);
    expect(r.kurve[10]).toBeGreaterThan(0);
  });

  it("lässt die Einspeisevergütung NICHT mitsteigen", () => {
    /*
     * Sie ist vertraglich fix, während der Netzstrompreis steigt. Eine
     * mitwachsende Vergütung wäre schöngerechnet — und der Kunde merkt
     * es erst nach Jahren.
     */
    const nurEinspeisung = rechne({ ...HAUS, verbrauchKwh: 1, ertragKwh: 9500 });
    const j1 = nurEinspeisung.kurve[0]!;
    const j2 = nurEinspeisung.kurve[1]! - j1;
    // Der Zuwachs im zweiten Jahr ist praktisch derselbe wie im ersten,
    // weil fast alles eingespeist wird.
    expect(j2).toBeCloseTo(nurEinspeisung.kurve[0]! + nurEinspeisung.investition, 0);
  });
});

describe("Wirtschaftlichkeit mit Speicher", () => {
  const mitSpeicher: WirtschaftEingaben = { ...HAUS, speicherKwh: 10 };

  it("hebt die EV-Quote anteilig zur Speichergrösse", () => {
    /*
     *   Tagesverbrauch = 4500 / 365 = 12,329 kWh
     *   f_sp     = min(1, 10 / 12,329)      = 0,81111
     *   EV-Quote = 0,40 + 0,27 · 0,81111    = 0,619
     */
    expect(evQuote(9500, 4500, 10)).toBeCloseTo(0.619, 6);
  });

  it("deckelt den Eigenverbrauch beim Verbrauch — man kann nicht mehr nutzen, als man braucht", () => {
    const r = rechne(mitSpeicher);
    //   min(9500 · 0,619 ; 4455) = min(5880,5 ; 4455) = 4455
    expect(r.eigenverbrauchKwh).toBeCloseTo(4455, 6);
    expect(r.autarkie).toBeCloseTo(0.99, 6);

    //   Ersparnis = 4455 · 0,28 + (9500 − 4455) · 0,08 = 1247,4 + 403,6 = 1651
    expect(r.ersparnisJahr1).toBeCloseTo(1651, 6);
    //   16500 / 1651 = 9,994 Jahre
    expect(r.amortisationJahre).toBeCloseTo(9.99394, 4);
  });

  it("verändert Quote, Autarkie und Amortisation konsistent (Abnahmetest 18)", () => {
    const ohne = rechne(HAUS);
    const mit = rechne(mitSpeicher);

    expect(mit.evQuote).toBeGreaterThan(ohne.evQuote);
    expect(mit.autarkie).toBeGreaterThan(ohne.autarkie);
    expect(mit.eigenverbrauchKwh).toBeGreaterThan(ohne.eigenverbrauchKwh);
    expect(mit.einspeisungKwh).toBeLessThan(ohne.einspeisungKwh);
    expect(mit.ersparnisJahr1).toBeGreaterThan(ohne.ersparnisJahr1);

    /*
     * Bei gleichem Anlagenpreis amortisiert der Speicher schneller —
     * in der Oberfläche kostet er aber extra, und dann kippt es meist
     * andersherum. Genau deshalb wirkt der Toggle auch auf den Preis.
     */
    expect(mit.amortisationJahre!).toBeLessThan(ohne.amortisationJahre!);

    const teurer = rechne({ ...mitSpeicher, anlagenpreis: 25000 });
    expect(teurer.amortisationJahre!).toBeGreaterThan(ohne.amortisationJahre!);
  });

  it("bringt ein kleiner Speicher bei grossem Verbrauch wenig", () => {
    // 5 kWh Speicher, 30 kWh Tagesverbrauch → f_sp = 5/30 = 0,1667.
    const gross = evQuote(12000, 11000, 5);
    const klein = evQuote(12000, 11000, 0);
    expect(gross - klein).toBeCloseTo(MODELL.evSpeicherPlus * (5 / (11000 / 365)), 5);
    expect(gross - klein).toBeLessThan(0.05);
  });

  it("hält die Obergrenze auch bei riesigem Speicher", () => {
    expect(evQuote(9500, 9000, 200)).toBeLessThanOrEqual(MODELL.evMaxMitSpeicher);
  });
});

describe("Randfälle", () => {
  it("rechnet ohne Ertrag oder ohne Verbrauch nicht mit Unsinn", () => {
    const ohneErtrag = rechne({ ...HAUS, ertragKwh: 0 });
    expect(ohneErtrag.eigenverbrauchKwh).toBe(0);
    expect(ohneErtrag.autarkie).toBe(0);
    // Ohne Ersparnis gibt es keine Amortisation — nicht Unendlich.
    expect(ohneErtrag.amortisationJahre).toBeNull();
    expect(ohneErtrag.breakEvenJahr).toBeNull();

    const ohneVerbrauch = rechne({ ...HAUS, verbrauchKwh: 0 });
    expect(Number.isNaN(ohneVerbrauch.autarkie)).toBe(false);
    expect(ohneVerbrauch.autarkie).toBe(0);
  });

  it("hält die Quotengrenzen ein", () => {
    // Winzige Anlage, riesiger Verbrauch: Deckung 1 → 0,22 + 0,38 = 0,60,
    // gedeckelt auf 0,55.
    expect(evQuote(1000, 20000, 0)).toBeCloseTo(MODELL.evMax, 6);

    /*
     * Die Untergrenze greift beim heutigen Sockel nie: 0,22 liegt schon
     * über 0,20, und die Steigung addiert nur dazu. Sie ist eine
     * Absicherung für den Fall, dass jemand den Sockel senkt — hier
     * festgehalten, damit die Kalibrierung nicht am falschen Ende dreht.
     */
    const riesenanlage = evQuote(50000, 500, 0);
    expect(riesenanlage).toBeGreaterThanOrEqual(MODELL.evMin);
    expect(riesenanlage).toBeCloseTo(0.2238, 4);
  });

  it("bleibt in jedem Fall im Band zwischen Unter- und Obergrenze", () => {
    for (const ertrag of [500, 5000, 50000]) {
      for (const verbrauch of [500, 4500, 30000]) {
        for (const speicher of [0, 5, 30]) {
          const q = evQuote(ertrag, verbrauch, speicher);
          expect(q).toBeGreaterThanOrEqual(MODELL.evMin);
          expect(q).toBeLessThanOrEqual(MODELL.evMaxMitSpeicher);
        }
      }
    }
  });

  it("gibt eine Förderung über dem Anlagenpreis nicht als negative Investition aus", () => {
    const r = rechne({ ...HAUS, foerderung: 25000 });
    expect(r.investition).toBe(0);
    expect(r.amortisationJahre).toBe(0);
  });
});

describe("Vorbelegungen", () => {
  it("addiert Wärmepumpe und E-Auto auf die Haushaltsbasis", () => {
    expect(verbrauchAusChips(["p4"])).toBe(4500);
    expect(verbrauchAusChips(["p4", "wp"])).toBe(8000);
    expect(verbrauchAusChips(["p4", "wp", "auto"])).toBe(10500);
    expect(verbrauchAusChips(["p2", "auto"])).toBe(5500);
    // Zwei Basis-Chips ergeben keinen doppelten Haushalt.
    expect(verbrauchAusChips(["p2", "p4"])).toBe(4500);
    expect(verbrauchAusChips([])).toBe(0);
  });

  it("nimmt aus der Preisstaffel die passende Stufe", () => {
    const staffel = [
      { ab_kwp: 0, eur_pro_kwp: 1600 },
      { ab_kwp: 10, eur_pro_kwp: 1400 },
      { ab_kwp: 20, eur_pro_kwp: 1200 },
    ];
    expect(richtpreis(8, staffel)).toBe(12800);
    expect(richtpreis(10, staffel)).toBe(14000);
    expect(richtpreis(15, staffel)).toBe(21000);
    expect(richtpreis(30, staffel)).toBe(36000);
    // Speicher kommt oben drauf.
    expect(richtpreis(10, staffel, 6000)).toBe(20000);
  });

  it("erfindet ohne passende Stufe keinen Preis", () => {
    // Staffel beginnt erst bei 5 kWp — eine 3-kWp-Anlage bleibt offen.
    expect(richtpreis(3, [{ ab_kwp: 5, eur_pro_kwp: 1500 }])).toBe(0);
    expect(richtpreis(0, [{ ab_kwp: 0, eur_pro_kwp: 1500 }])).toBe(0);
  });
});
