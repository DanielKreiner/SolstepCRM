import { describe, expect, it } from "vitest";
import {
  grenzen,
  istModular,
  kapazitaet,
  modulzahl,
  modulzahlFuerKwh,
  speicherPosten,
  type SpeicherTyp,
} from "./speicher";

const reserva: SpeicherTyp = {
  id: "s1",
  hersteller: "Fronius",
  bezeichnung: "Reserva",
  nutzbar_kwh: 3.15,
  modulgroesse_kwh: 3.15,
  min_module: 2,
  max_module: 5,
  artikel_id: "a-modul",
  bms_artikel_id: "a-bms",
};

const fertig: SpeicherTyp = {
  id: "s2",
  hersteller: "Sigenergy",
  bezeichnung: "Sigen Battery 8.0",
  nutzbar_kwh: 7.8,
  modulgroesse_kwh: null,
  min_module: null,
  max_module: null,
  artikel_id: "a-sigen",
  bms_artikel_id: null,
};

describe("Modularer Speicher", () => {
  it("erkennt den Stapel an der Modulgrösse", () => {
    expect(istModular(reserva)).toBe(true);
    expect(istModular(fertig)).toBe(false);
  });

  it("bleibt in den Stapelgrenzen", () => {
    expect(grenzen(reserva)).toEqual({ min: 2, max: 5 });
    expect(modulzahl(reserva, 1)).toBe(2);
    expect(modulzahl(reserva, 9)).toBe(5);
    expect(modulzahl(reserva, null)).toBe(2);
  });

  it("rechnet die Kapazität aus den Modulen", () => {
    expect(kapazitaet(reserva, 4)).toBeCloseTo(12.6, 2);
    expect(kapazitaet(reserva, 5)).toBeCloseTo(15.75, 2);
    expect(kapazitaet(fertig, null)).toBe(7.8);
  });

  it("rundet den Wunsch nach oben auf ganze Module", () => {
    /* 15 kWh gewünscht: vier Module wären 12,6 — also fünf. */
    expect(modulzahlFuerKwh(reserva, 15)).toBe(5);
    expect(modulzahlFuerKwh(reserva, 12.6)).toBe(4);
    expect(modulzahlFuerKwh(reserva, 30)).toBe(5);
    expect(modulzahlFuerKwh(reserva, 1)).toBe(2);
  });
});

describe("Stückliste", () => {
  it("nimmt beim Stapel die Module und einmal das BMS", () => {
    const p = speicherPosten(reserva, 4);
    expect(p).toHaveLength(2);
    expect(p[0]!.menge).toBe(4);
    expect(p[0]!.artikel_id).toBe("a-modul");
    expect(p[1]!.menge).toBe(1);
    expect(p[1]!.artikel_id).toBe("a-bms");
    /* Zwei verschiedene Schlüssel — sonst überschreiben sie sich beim Abgleich. */
    expect(p[0]!.schluessel).not.toBe(p[1]!.schluessel);
  });

  it("lässt beim fertigen Gerät eine Zeile stehen", () => {
    const p = speicherPosten(fertig, null);
    expect(p).toHaveLength(1);
    expect(p[0]!.menge).toBe(1);
  });
});
