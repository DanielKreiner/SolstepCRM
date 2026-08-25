import { describe, expect, it } from "vitest";
import {
  evQuote,
  MODELL,
  rechne,
  richtpreis,
  verbrauchAusChips,
  type WirtschaftEingaben,
  autarkie,
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
     * Gerechnet wird ab der AUTARKIE, nicht ab einer geschätzten
     * Eigenverbrauchsquote:
     *
     *   Verhältnis = 9500 / 4500                     = 2,1111
     *   Autarkie   = 0,44 · (1 − e^(−1,1 · 2,1111))  = 0,39684
     */
    expect(r.autarkie).toBeCloseTo(0.39686, 4);

    //   Eigenverbrauch = 4500 · 0,39684 = 1785,8 kWh
    expect(r.eigenverbrauchKwh).toBeCloseTo(1785.85, 1);

    //   EV-Quote = 1785,8 / 9500 = 0,188
    expect(r.evQuote).toBeCloseTo(0.18798, 4);

    //   Einspeisung = 9500 − 1785,8 = 7714,2
    expect(r.einspeisungKwh).toBeCloseTo(7714.15, 1);

    //   Ersparnis = 1785,8 · 0,28 + 7714,2 · 0,08 = 500,0 + 617,1 = 1117,2 €
    expect(r.ersparnisJahr1).toBeCloseTo(1117.17, 1);

    //   Investition = 18000 − 1500 = 16500 €
    expect(r.investition).toBeCloseTo(16500, 6);

    //   Amortisation = 16500 / 1117,2 = 14,77 Jahre
    expect(r.amortisationJahre).toBeCloseTo(14.77, 2);
  });

  it("führt die 20-Jahre-Kurve mit steigendem Strompreis", () => {
    const r = rechne(HAUS);
    expect(r.kurve).toHaveLength(MODELL.jahre);

    //   Jahr 1: 1117,17 − 16500 = −15382,83
    expect(r.kurve[0]).toBeCloseTo(-15382.83, 1);

    /*
     * Jahr 2 rechnet den gesparten Netzstrom mit 0,28 · 1,02 = 0,2856:
     *   1785,85 · 0,2856 + 617,13 = 1127,17
     *   kumuliert 2244,34 → 2244,34 − 16500 = −14255,66
     */
    expect(r.kurve[1]).toBeCloseTo(-14255.66, 1);

    /*
     * Break-even im 14. Jahr. Er liegt später als vorher — das ist der
     * Preis der ehrlicheren Autarkierechnung: Ohne Speicher bleibt
     * weniger Strom im Haus, und eingespeister Strom bringt acht statt
     * achtundzwanzig Cent.
     */
    expect(r.breakEvenJahr).toBe(14);
    expect(r.kurve[12]).toBeLessThan(0);
    expect(r.kurve[13]).toBeGreaterThan(0);
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

  it("hebt die Autarkie nach Speichergrösse je 1000 kWh Verbrauch", () => {
    /*
     *   je 1000 kWh = 10 / 4,5                      = 2,2222
     *   Zusatz      = 0,42 · (1 − e^(−0,7 · 2,2222)) = 0,33144
     *   Autarkie    = 0,39684 + 0,33144 · 1          = 0,72828
     */
    expect(autarkie(9500, 4500, 10)).toBeCloseTo(0.72821, 4);
  });

  it("nutzt nie mehr, als das Haus braucht", () => {
    const r = rechne(mitSpeicher);
    //   4500 · 0,72828 = 3277,3 kWh
    expect(r.eigenverbrauchKwh).toBeCloseTo(3276.92, 1);
    expect(r.eigenverbrauchKwh).toBeLessThanOrEqual(HAUS.verbrauchKwh);
    expect(r.autarkie).toBeLessThan(0.85);
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
    /*
     * 5 kWh bei 11 000 kWh Jahresverbrauch sind 0,45 kWh je 1000 —
     * das hebt die Autarkie um gut zehn Punkte, nicht um dreissig.
     */
    const mit = autarkie(12000, 11000, 5);
    const ohne = autarkie(12000, 11000, 0);
    expect(mit - ohne).toBeGreaterThan(0.05);
    expect(mit - ohne).toBeLessThan(0.15);
  });

  it("hält die Obergrenze auch bei riesigem Speicher", () => {
    expect(autarkie(9500, 9000, 200)).toBeLessThanOrEqual(MODELL.autarkieDeckelMitSpeicher);
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

  it("hält die Grenzen der Autarkie ein", () => {
    /*
     * Winzige Anlage, riesiger Verbrauch: Die Autarkie ist klein — was
     * erzeugt wird, wird zwar fast vollständig gebraucht, deckt aber
     * kaum etwas ab.
     */
    expect(autarkie(1000, 20000, 0)).toBeLessThan(0.05);
    expect(evQuote(1000, 20000, 0)).toBeGreaterThan(0.4);

    /*
     * Riesenanlage über winzigem Verbrauch: Ohne Speicher ist bei
     * 44 % Schluss — nachts erzeugt kein Dach Strom, und daran ändert
     * die Anlagengrösse nichts. GENAU das war der gemeldete Fehler:
     * Vorher kamen hier 99 % heraus.
     */
    expect(autarkie(50000, 500, 0)).toBeCloseTo(MODELL.autarkieOhne, 3);
    expect(autarkie(50000, 500, 0)).toBeLessThan(0.5);
  });

  it("bleibt in jedem Fall unter den Obergrenzen", () => {
    for (const ertrag of [500, 5000, 50000]) {
      for (const verbrauch of [500, 4500, 30000]) {
        for (const speicher of [0, 5, 30]) {
          const a = autarkie(ertrag, verbrauch, speicher);
          expect(a).toBeGreaterThanOrEqual(0);
          expect(a).toBeLessThanOrEqual(
            speicher > 0 ? MODELL.autarkieDeckelMitSpeicher : MODELL.autarkieDeckel,
          );
          const q = evQuote(ertrag, verbrauch, speicher);
          expect(q).toBeGreaterThanOrEqual(0);
          expect(q).toBeLessThanOrEqual(1);
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
