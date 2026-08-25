import { describe, expect, it } from "vitest";
import { alsZeitpunkt, tagPlus, zeitraum } from "./zeitfeld";

describe("Zeitraum aus den Dialogfeldern", () => {
  const basis = {
    datum: "2026-09-01",
    zeitVon: "11:00",
    zeitBis: "14:00",
    endDatum: "2026-09-01",
    mehrtaegig: false,
    ganztaegig: false,
  };

  it("nimmt die Uhrzeiten so, wie sie eingetragen sind", () => {
    const z = zeitraum(basis);
    expect(z.von).toBe("2026-09-01T11:00");
    expect(z.bis).toBe("2026-09-01T14:00");
    expect(z.ueberNacht).toBe(false);
  });

  it("legt eine Nachtschicht auf den Folgetag", () => {
    const z = zeitraum({ ...basis, zeitVon: "22:00", zeitBis: "06:00" });
    expect(z.bisTag).toBe("2026-09-02");
    expect(z.ueberNacht).toBe(true);
  });

  it("nimmt bei mehrtägig das zweite Datum", () => {
    const z = zeitraum({
      ...basis,
      mehrtaegig: true,
      endDatum: "2026-09-03",
    });
    expect(z.bis).toBe("2026-09-03T14:00");
  });

  it("ganztägig läuft von Mitternacht bis 23:59", () => {
    const z = zeitraum({ ...basis, ganztaegig: true });
    expect(z.von).toBe("2026-09-01T00:00");
    expect(z.bis).toBe("2026-09-01T23:59");
  });

  it("springt über den Monatswechsel", () => {
    expect(tagPlus("2026-08-31", 1)).toBe("2026-09-01");
    expect(tagPlus("2027-01-01", -1)).toBe("2026-12-31");
  });
});

describe("Wanduhrzeit in einen Zeitpunkt", () => {
  /*
   * Der eigentliche Fehler: 11 Uhr eingetragen, 13 Uhr in der Tafel.
   * Der Test läuft unabhängig davon, in welcher Zone der Rechner steht —
   * sonst hätte er den Fehler nie gefunden.
   */
  it("rechnet Sommerzeit gegen UTC", () => {
    expect(alsZeitpunkt("2026-09-01T11:00")).toBe("2026-09-01T09:00:00.000Z");
  });

  it("rechnet Winterzeit gegen UTC", () => {
    expect(alsZeitpunkt("2026-12-01T11:00")).toBe("2026-12-01T10:00:00.000Z");
  });
});
