import { describe, expect, it } from "vitest";
import { viennaDay } from "@/lib/format";
import { isoWeek, startOfViennaWeek, viennaClock } from "@/lib/time";

/*
 * Die Tagesgrenze, an der mehrere Rechnungen falsch lagen.
 *
 * Gespeichert wird timestamptz in UTC, gedacht wird in Europe/Vienna.
 * Zwischen 00:00 und 01:00 Ortszeit (02:00 im Sommer) zeigt der
 * UTC-Anteil noch den Vortag — und damit auch den Vormonat und die
 * Vorwoche. An dieser Stelle hatten gleich vier Stellen `slice(0, 10)`
 * bzw. `slice(0, 7)` auf dem Instant stehen und lasen den falschen Tag:
 * die Wochenansicht der Zeiten, das Stundenkonto, die Korrektur und die
 * Kalenderwoche der Plantafel.
 *
 * Diese Datei hält die Regel fest, auf die alle vier jetzt zeigen.
 */

describe("Tagesgrenze Europe/Vienna", () => {
  it("ordnet Mitternacht Ortszeit dem richtigen Tag zu", () => {
    // Montag 00:30 Wien ist Sonntag 22:30 UTC (Sommerzeit).
    const mitternacht = viennaClock("2026-08-10", "00:30");
    expect(mitternacht.toISOString()).toBe("2026-08-09T22:30:00.000Z");
    expect(viennaDay(mitternacht)).toBe("2026-08-10");
    expect(mitternacht.toISOString().slice(0, 10)).toBe("2026-08-09");
  });

  it("ordnet den Monatsersten dem richtigen Monat zu", () => {
    // 1. Oktober 00:30 Wien ist 30. September 22:30 UTC.
    const erster = viennaClock("2026-10-01", "00:30");
    expect(viennaDay(erster).slice(0, 7)).toBe("2026-10");
    expect(erster.toISOString().slice(0, 7)).toBe("2026-09");
  });

  it("ordnet den Wochenbeginn der richtigen Woche zu", () => {
    const mitternacht = viennaClock("2026-08-10", "00:30");
    expect(isoWeek(viennaDay(mitternacht))).toBe("2026-W33");
    expect(isoWeek(mitternacht.toISOString().slice(0, 10))).toBe("2026-W32");
  });

  it("hält die Winterzeit genauso", () => {
    // Nach der Umstellung: 00:30 Ortszeit sind 23:30 UTC am Vortag.
    const winter = viennaClock("2026-11-16", "00:30");
    expect(winter.toISOString()).toBe("2026-11-15T23:30:00.000Z");
    expect(viennaDay(winter)).toBe("2026-11-16");
    expect(startOfViennaWeek(viennaDay(winter))).toBe("2026-11-16");
  });
});
