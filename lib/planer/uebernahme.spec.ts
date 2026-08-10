import { describe, expect, it } from "vitest";
import {
  abmessungenMeter,
  type Artikel,
  bereich,
  deutscheZahl,
  kapazitaetInKWh,
  leistungInKW,
  moduleAusArtikeln,
  speicherAusArtikeln,
  specWert,
  wechselrichterAusArtikeln,
} from "./uebernahme";

/*
 * Die Werte kommen aus echten Datenblättern und stehen im Lager in
 * deutscher Schreibweise. Der Punkt trennt Tausender, das Komma die
 * Nachkommastellen — wer das verwechselt, macht aus 1.100 V eben 1,1 V
 * und legt Strings aus, die im Winter den Wechselrichter überspannen.
 */

describe("Zahlen aus Datenblättern", () => {
  it("liest Tausenderpunkt und Dezimalkomma richtig", () => {
    expect(deutscheZahl("1.100")).toBe(1100);
    expect(deutscheZahl("1.000")).toBe(1000);
    expect(deutscheZahl("0,22")).toBeCloseTo(0.22, 6);
    expect(deutscheZahl("41,10")).toBeCloseTo(41.1, 6);
    expect(deutscheZahl("24,2 kg")).toBeCloseTo(24.2, 6);
    expect(deutscheZahl("11")).toBe(11);
  });

  it("versteht das echte Minuszeichen aus dem Datenblatt", () => {
    // U+2212, nicht der Bindestrich — genau so steht es im Bestand.
    expect(deutscheZahl("−0,22")).toBeCloseTo(-0.22, 6);
    expect(deutscheZahl("-0,26")).toBeCloseTo(-0.26, 6);
    expect(deutscheZahl("+0,05")).toBeCloseTo(0.05, 6);
  });

  it("gibt null zurück, wo keine Zahl steht", () => {
    expect(deutscheZahl(null)).toBeNull();
    expect(deutscheZahl("")).toBeNull();
    expect(deutscheZahl("nach Aufwand")).toBeNull();
  });

  it("liest Bereiche mit Gedankenstrich", () => {
    expect(bereich("140 – 980")).toEqual({ von: 140, bis: 980 });
    expect(bereich("160 – 1.000")).toEqual({ von: 160, bis: 1000 });
    expect(bereich("80–800")).toEqual({ von: 80, bis: 800 });
    expect(bereich("200 bis 800")).toEqual({ von: 200, bis: 800 });
    // Kein Bereich, nur eine Zahl.
    expect(bereich("800")).toBeNull();
    // Verkehrt herum ist kein gültiges Fenster.
    expect(bereich("800 – 200")).toBeNull();
  });

  it("rechnet Abmessungen in Meter um", () => {
    expect(abmessungenMeter("1762 × 1134 × 30 mm")).toEqual({ laenge: 1.762, breite: 1.134 });
    expect(abmessungenMeter("2278 × 1134 × 35 mm")).toEqual({ laenge: 2.278, breite: 1.134 });
    expect(abmessungenMeter("keine Angabe")).toBeNull();
  });

  it("findet Werte über mehrere mögliche Schlüssel", () => {
    const specs = [{ key: "Nutzbarer MPP-Spannungsbereich", value: "80 – 800" }];
    expect(specWert(specs, "MPP-Spannungsbereich", "Nutzbarer MPP-Spannungsbereich")).toBe("80 – 800");
    expect(specWert(specs, "Gibt es nicht")).toBeNull();
  });
});

/** Ein Modul, wie es tatsächlich im Lager steht (AIKO Neostar 3P+). */
const MODUL_ARTIKEL: Artikel = {
  id: "a1",
  sku: "SH-10001",
  name: "AIKO Neostar 3P+ A490-MCE54Dw",
  manufacturer: "AIKO",
  category: "PV-Module",
  datasheet_url: "https://example.test/aiko.pdf",
  modul_wp: 490,
  wr_kw: null,
  tech_specs: [
    { group: "Elektrisch", key: "Leerlaufspannung Uoc", value: "41,10", unit: "V" },
    { group: "Elektrisch", key: "Kurzschlussstrom Isc", value: "14,88", unit: "A" },
    { group: "Elektrisch", key: "MPP-Spannung Umpp", value: "34,70", unit: "V" },
    { group: "Elektrisch", key: "MPP-Strom Impp", value: "14,13", unit: "A" },
    { group: "Elektrisch", key: "Temperaturkoeffizient Uoc", value: "−0,22", unit: "%/°C" },
    { group: "Maße", key: "Abmessungen", value: "1762 × 1134 × 30", unit: "mm" },
    { group: "Maße", key: "Gewicht", value: "24,2", unit: "kg" },
  ],
};

describe("Module übernehmen", () => {
  it("übernimmt ein vollständiges Modul mit allen Werten", () => {
    const { fertig, luecken } = moduleAusArtikeln([MODUL_ARTIKEL]);
    expect(luecken).toHaveLength(0);
    expect(fertig).toHaveLength(1);

    const m = fertig[0]!;
    expect(m.artikel_id).toBe("a1");
    expect(m.wp).toBe(490);
    expect(m.uoc).toBeCloseTo(41.1, 6);
    expect(m.umpp).toBeCloseTo(34.7, 6);
    // %/K wird zum Faktor je Kelvin — der Unterschied ist Faktor 100.
    expect(m.tk_uoc).toBeCloseTo(-0.0022, 8);
    expect(m.hoehe).toBeCloseTo(1.762, 6);
    expect(m.breite).toBeCloseTo(1.134, 6);
    expect(m.gewicht).toBeCloseTo(24.2, 6);
  });

  it("meldet fehlende Werte, statt sie zu erfinden", () => {
    const ohne: Artikel = {
      ...MODUL_ARTIKEL,
      tech_specs: [{ key: "Leerlaufspannung Uoc", value: "41,10" }],
    };
    const { fertig, luecken } = moduleAusArtikeln([ohne]);
    expect(fertig).toHaveLength(0);
    expect(luecken[0]!.fehlt).toContain("MPP-Spannung Umpp");
    expect(luecken[0]!.fehlt).toContain("Temperaturkoeffizient Uoc");
    expect(luecken[0]!.fehlt).toContain("Abmessungen");
    expect(luecken[0]!.sku).toBe("SH-10001");
  });

  it("lehnt einen positiven Temperaturkoeffizienten ab", () => {
    /*
     * Mit positivem Vorzeichen rechnete die Prüfung die Winterspannung
     * nach unten und liesse zu lange Strings durch. Lieber als Lücke
     * melden.
     */
    const falsch: Artikel = {
      ...MODUL_ARTIKEL,
      tech_specs: MODUL_ARTIKEL.tech_specs!.map((e) =>
        e.key === "Temperaturkoeffizient Uoc" ? { ...e, value: "0,22" } : e,
      ),
    };
    const { fertig, luecken } = moduleAusArtikeln([falsch]);
    expect(fertig).toHaveLength(0);
    expect(luecken[0]!.fehlt.join(" ")).toContain("negativ");
  });

  it("lehnt Uoc unter Umpp ab", () => {
    const falsch: Artikel = {
      ...MODUL_ARTIKEL,
      tech_specs: MODUL_ARTIKEL.tech_specs!.map((e) =>
        e.key === "Leerlaufspannung Uoc" ? { ...e, value: "30,0" } : e,
      ),
    };
    expect(moduleAusArtikeln([falsch]).luecken[0]!.fehlt.join(" ")).toContain("über Umpp");
  });
});

describe("Wechselrichter übernehmen", () => {
  const VOLL: Artikel = {
    id: "w1",
    sku: "SH-20001",
    name: "Symo GEN24 10.0 Plus",
    manufacturer: "Fronius",
    category: "Wechselrichter",
    datasheet_url: null,
    modul_wp: null,
    wr_kw: 10,
    tech_specs: [
      { key: "Max. Eingangsspannung", value: "1.000", unit: "V" },
      { key: "MPP-Spannungsbereich", value: "160 – 1.000", unit: "V" },
      { key: "Max. Strom je MPPT", value: "16", unit: "A" },
      { key: "MPP-Tracker", value: "2" },
      { key: "Geräteart", value: "Hybrid-Wechselrichter" },
    ],
  };

  it("übernimmt ein vollständiges Gerät und legt je Tracker dasselbe Fenster an", () => {
    const { fertig, luecken } = wechselrichterAusArtikeln([VOLL]);
    expect(luecken).toHaveLength(0);
    const w = fertig[0]!;
    expect(w.max_dc).toBe(1000);
    expect(w.ac_nenn).toBe(10);
    expect(w.hybrid).toBe(true);
    expect(w.mppt).toHaveLength(2);
    expect(w.mppt[0]).toEqual({ uMin: 160, uMax: 1000, iMax: 16, maxStrings: 2 });
    expect(w.mppt[1]).toEqual(w.mppt[0]);
  });

  it("meldet die fehlende DC-Grenze — der häufigste Fall im Bestand", () => {
    const ohneDc: Artikel = {
      ...VOLL,
      tech_specs: VOLL.tech_specs!.filter((e) => e.key !== "Max. Eingangsspannung"),
    };
    const { fertig, luecken } = wechselrichterAusArtikeln([ohneDc]);
    expect(fertig).toHaveLength(0);
    expect(luecken[0]!.fehlt).toContain("max. DC-Spannung");
  });

  it("erkennt Hybridgeräte auch am Namen", () => {
    const amNamen: Artikel = {
      ...VOLL,
      name: "Sigen Hybrid 8.0 TP2",
      tech_specs: VOLL.tech_specs!.filter((e) => e.key !== "Geräteart"),
    };
    expect(wechselrichterAusArtikeln([amNamen]).fertig[0]!.hybrid).toBe(true);
  });
});

describe("Speicher übernehmen", () => {
  it("nimmt die nutzbare Kapazität und die Modulgrösse", () => {
    const a: Artikel = {
      id: "s1",
      sku: "SH-30001",
      name: "LUNA2000-10-E1",
      manufacturer: "Huawei",
      category: "Speicher",
      datasheet_url: null,
      modul_wp: null,
      wr_kw: null,
      tech_specs: [
        { key: "Nutzbare Kapazität", value: "10,0", unit: "kWh" },
        { key: "Modulgröße", value: "5,0", unit: "kWh" },
      ],
    };
    const { fertig, luecken } = speicherAusArtikeln([a]);
    expect(luecken).toHaveLength(0);
    expect(fertig[0]!.nutzbar_kwh).toBeCloseTo(10, 6);
    expect(fertig[0]!.modulgroesse_kwh).toBeCloseTo(5, 6);
  });

  it("meldet, wenn die Kapazität fehlt", () => {
    const a: Artikel = {
      id: "s2", sku: "SH-30002", name: "Ohne Angabe", manufacturer: null,
      category: "Speicher", datasheet_url: null, modul_wp: null, wr_kw: null,
      tech_specs: [{ key: "Zellchemie", value: "LiFePO4" }],
    };
    expect(speicherAusArtikeln([a]).luecken[0]!.fehlt).toContain("nutzbare Kapazität");
  });
});

describe("Zubehör aus derselben Kategorie", () => {
  /*
   * Im Lager stehen unter „Wechselrichter" auch Kabelsätze und
   * Bodenwannen — sie werden zusammen mit dem Gerät eingekauft und
   * tragen deshalb dieselbe Kategorie. Beim ersten echten Lauf machte
   * das die Lückenliste unbrauchbar: 153 Einträge, davon der Grossteil
   * Zubehör, dem man „max. DC-Spannung" nicht nachtragen kann.
   */
  it("übergeht einen Kabelsatz still, statt ihn als Lücke zu melden", () => {
    const kabel: Artikel = {
      id: "z1",
      sku: "SH-10441",
      name: "SigenMicro AC Cable Kit-20-230-2.5",
      manufacturer: "Sigenergy",
      category: "Wechselrichter",
      datasheet_url: null,
      modul_wp: null,
      wr_kw: 2.5,
      tech_specs: [
        { key: "Geräteart", value: "Zubehör" },
        { key: "Nennleistung AC", value: "2,5", unit: "kW" },
      ],
    };
    const { fertig, luecken, uebersprungen } = wechselrichterAusArtikeln([kabel]);
    expect(fertig).toHaveLength(0);
    expect(luecken).toHaveLength(0);
    expect(uebersprungen).toBe(1);
  });

  it("meldet ein echtes Gerät weiterhin als Lücke", () => {
    /*
     * Der Fronius trägt AC-Leistung und Geräteart „Wechselrichter",
     * aber keinen einzigen DC-Wert. Hier LOHNT das Nachtragen — der
     * Eintrag muss sichtbar bleiben.
     */
    const fronius: Artikel = {
      id: "w9",
      sku: "WR-FRO-10",
      name: "Fronius Symo GEN24 10.0 Plus",
      manufacturer: "Fronius",
      category: "Wechselrichter",
      datasheet_url: null,
      modul_wp: null,
      wr_kw: 10,
      tech_specs: [
        { key: "Geräteart", value: "Wechselrichter" },
        { key: "Max. Eingangsspannung", value: "1.000", unit: "V" },
      ],
    };
    const { luecken, uebersprungen } = wechselrichterAusArtikeln([fronius]);
    expect(uebersprungen).toBe(0);
    expect(luecken[0]!.fehlt).toContain("MPP-Spannungsbereich");
  });

  it("übergeht einen Speichersockel ohne Kapazitätsangabe", () => {
    const sockel: Artikel = {
      id: "z2", sku: "SH-10451", name: "SigenStack BC M2-0.5C-BST", manufacturer: "Sigenergy",
      category: "Speicher", datasheet_url: null, modul_wp: null, wr_kw: null,
      tech_specs: [{ key: "Geräteart", value: "Zubehör" }],
    };
    const e = speicherAusArtikeln([sockel]);
    expect(e.luecken).toHaveLength(0);
    expect(e.uebersprungen).toBe(1);
  });
});

describe("Einheiten", () => {
  /*
   * Der Bestand mischt die Einheiten: Huawei gibt die AC-Leistung in
   * Watt („3.000 W"), Sigenergy in Kilowatt („2,5 kW"). Beim ersten
   * echten Lauf wurde die Einheit übergangen — aus einem 3-kW-Gerät
   * wurde ein 3.000-kW-Gerät. Die Prüfung des DC/AC-Verhältnisses hätte
   * danach jede Überdimensionierung durchgewunken, ohne zu murren.
   */
  it("rechnet Watt in Kilowatt um", () => {
    expect(leistungInKW({ value: "3.000", unit: "W" })).toBeCloseTo(3, 6);
    expect(leistungInKW({ value: "10.000", unit: "W" })).toBeCloseTo(10, 6);
    expect(leistungInKW({ value: "2,5", unit: "kW" })).toBeCloseTo(2.5, 6);
    expect(leistungInKW({ value: "5.000", unit: "VA" })).toBeCloseTo(5, 6);
    expect(leistungInKW(null)).toBeNull();
  });

  it("greift ohne Einheit zur Plausibilitätsgrenze", () => {
    // Über 1.000 kW gibt es im Wohn- und Gewerbebau kein Gerät.
    expect(leistungInKW({ value: "8.000" })).toBeCloseTo(8, 6);
    expect(leistungInKW({ value: "10" })).toBeCloseTo(10, 6);
  });

  it("rechnet Wattstunden in Kilowattstunden um", () => {
    expect(kapazitaetInKWh({ value: "5.000", unit: "Wh" })).toBeCloseTo(5, 6);
    expect(kapazitaetInKWh({ value: "10,0", unit: "kWh" })).toBeCloseTo(10, 6);
  });

  it("übernimmt einen Huawei-Wechselrichter mit 3 kW, nicht 3.000", () => {
    const huawei: Artikel = {
      id: "h1", sku: "SH-10151", name: "SUN2000-3KTL-M1", manufacturer: "Huawei",
      category: "Wechselrichter", datasheet_url: null, modul_wp: null, wr_kw: null,
      tech_specs: [
        { key: "Nennleistung AC", value: "3.000", unit: "W" },
        { key: "Max. Eingangsspannung", value: "1.100", unit: "V" },
        { key: "MPP-Spannungsbereich", value: "140 – 980", unit: "V" },
        { key: "Max. Strom je MPPT", value: "11", unit: "A" },
        { key: "Anzahl MPP-Tracker", value: "2" },
      ],
    };
    const w = wechselrichterAusArtikeln([huawei]).fertig[0]!;
    expect(w.ac_nenn).toBeCloseTo(3, 6);
    expect(w.max_dc).toBe(1100);
    expect(w.mppt).toHaveLength(2);
  });
});
