import { describe, expect, it } from "vitest";
import {
  MAHNSTUFEN,
  naechsteMahnung,
  stufenLabel,
  tageUeberfaellig,
  type Beleg,
} from "./dunning";

const OFFEN: Beleg = {
  status: "versendet",
  faelligAm: "2026-08-01",
  mahnstufe: 0,
  mahnungAktiv: true,
};

describe("tageUeberfaellig", () => {
  it("zählt Kalendertage, nicht Stunden", () => {
    expect(tageUeberfaellig("2026-08-01", "2026-08-08")).toBe(7);
    expect(tageUeberfaellig("2026-08-01", "2026-08-01")).toBe(0);
    expect(tageUeberfaellig("2026-08-01", "2026-07-30")).toBe(-2);
  });

  it("ignoriert einen Zeitanteil im Datum", () => {
    expect(tageUeberfaellig("2026-08-01T23:59:00Z", "2026-08-08T00:01:00Z")).toBe(7);
  });
});

describe("naechsteMahnung", () => {
  it("mahnt nicht vor Ablauf der Frist", () => {
    expect(naechsteMahnung(OFFEN, "2026-08-01")).toBeNull();
    expect(naechsteMahnung(OFFEN, "2026-08-07")).toBeNull();
  });

  it("erinnert ab dem siebten Tag", () => {
    expect(naechsteMahnung(OFFEN, "2026-08-08")?.stufe).toBe(1);
    expect(naechsteMahnung(OFFEN, "2026-08-08")?.ton).toBe("erinnerung");
  });

  /*
   * Der wichtigste Test: ein Betrieb, dessen Cron drei Wochen stand,
   * darf seinen Kunden nicht auf einen Schlag die zweite Mahnung
   * schicken. Der Weg dorthin gehört durchlaufen.
   */
  it("überspringt keine Stufe, auch nach langer Pause nicht", () => {
    expect(naechsteMahnung(OFFEN, "2026-09-30")?.stufe).toBe(1);
    expect(
      naechsteMahnung({ ...OFFEN, mahnstufe: 1 }, "2026-09-30")?.stufe,
    ).toBe(2);
    expect(
      naechsteMahnung({ ...OFFEN, mahnstufe: 2 }, "2026-09-30")?.stufe,
    ).toBe(3);
  });

  it("hört nach der letzten Stufe auf", () => {
    expect(naechsteMahnung({ ...OFFEN, mahnstufe: 3 }, "2027-01-01")).toBeNull();
  });

  it("mahnt dieselbe Stufe nicht zweimal", () => {
    expect(naechsteMahnung({ ...OFFEN, mahnstufe: 1 }, "2026-08-09")).toBeNull();
  });

  it("lässt ausgesetzte Rechnungen in Ruhe", () => {
    expect(
      naechsteMahnung({ ...OFFEN, mahnungAktiv: false }, "2026-09-30"),
    ).toBeNull();
  });

  it("mahnt nur, was der Kunde bekommen hat", () => {
    for (const status of ["entwurf", "bezahlt", "storniert", null]) {
      expect(naechsteMahnung({ ...OFFEN, status }, "2026-09-30")).toBeNull();
    }
  });

  it("mahnt nicht ohne Fälligkeitsdatum", () => {
    expect(naechsteMahnung({ ...OFFEN, faelligAm: null }, "2026-09-30")).toBeNull();
  });
});

describe("stufenLabel", () => {
  it("nennt die erreichte Stufe", () => {
    expect(stufenLabel(0)).toBeNull();
    expect(stufenLabel(1)).toBe("Zahlungserinnerung");
    expect(stufenLabel(3)).toBe("2. Mahnung");
  });
});

describe("MAHNSTUFEN", () => {
  it("steigt monoton — sonst greift die Auswahl der nächsten Stufe daneben", () => {
    for (let i = 1; i < MAHNSTUFEN.length; i++) {
      expect(MAHNSTUFEN[i]!.stufe).toBeGreaterThan(MAHNSTUFEN[i - 1]!.stufe);
      expect(MAHNSTUFEN[i]!.abTagen).toBeGreaterThan(MAHNSTUFEN[i - 1]!.abTagen);
    }
  });
});
