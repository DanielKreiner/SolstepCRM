import { describe, expect, it } from "vitest";
import {
  arbeitstageImMonat,
  feiertage,
  istArbeitstag,
} from "@/lib/zeiten/feiertage";

describe("feiertage", () => {
  it("kennt die österreichischen Fixtage", () => {
    const t = feiertage(2026, "AT-4");
    expect(t.has("2026-01-01")).toBe(true);
    expect(t.has("2026-10-26")).toBe(true);
    expect(t.has("2026-12-08")).toBe(true);
  });

  it("rechnet die beweglichen aus Ostern", () => {
    /* Ostersonntag 2026 ist der 5. April. */
    const t = feiertage(2026, "AT-4");
    expect(t.has("2026-04-06")).toBe(true); // Ostermontag
    expect(t.has("2026-05-14")).toBe(true); // Christi Himmelfahrt
    expect(t.has("2026-05-25")).toBe(true); // Pfingstmontag
    expect(t.has("2026-06-04")).toBe(true); // Fronleichnam
  });

  it("unterscheidet Deutschland von Österreich", () => {
    const at = feiertage(2026, "AT-4");
    const de = feiertage(2026, "DE-BY");
    expect(at.has("2026-10-26")).toBe(true);
    expect(de.has("2026-10-26")).toBe(false);
    expect(de.has("2026-10-03")).toBe(true);
    /* Karfreitag ist in Deutschland frei, in Österreich nicht. */
    expect(de.has("2026-04-03")).toBe(true);
    expect(at.has("2026-04-03")).toBe(false);
  });
});

describe("istArbeitstag", () => {
  it("zählt Wochenenden nicht", () => {
    expect(istArbeitstag("2026-08-08", "AT-4")).toBe(false); // Samstag
    expect(istArbeitstag("2026-08-07", "AT-4")).toBe(true);
  });

  it("zählt Feiertage nicht", () => {
    expect(istArbeitstag("2026-10-26", "AT-4")).toBe(false);
  });
});

describe("arbeitstageImMonat", () => {
  it("zieht den Feiertag ab", () => {
    /*
     * Oktober 2026 hat 22 Werktage; der Nationalfeiertag fällt auf einen
     * Montag und geht ab.
     */
    expect(arbeitstageImMonat("2026-10", "AT-4")).toBe(21);
    /*
     * In Deutschland fällt der 3. Oktober 2026 auf einen Samstag — ein
     * Feiertag am Wochenende schenkt niemandem etwas.
     */
    expect(arbeitstageImMonat("2026-10", "DE-BY")).toBe(22);
  });
});

describe("arbeitstageImMonat mit Stichtag", () => {
  it("zählt den laufenden Monat nur bis heute", () => {
    /*
     * 05.08.2026 ist ein Mittwoch. Bis dahin: Mo 3., Di 4., Mi 5. — drei
     * Arbeitstage, nicht die einundzwanzig des ganzen Monats.
     */
    expect(arbeitstageImMonat("2026-08", "AT-4", "2026-08-05")).toBe(3);
  });

  it("lässt vergangene Monate voll zählen", () => {
    const voll = arbeitstageImMonat("2026-07", "AT-4");
    expect(arbeitstageImMonat("2026-07", "AT-4", "2026-08-05")).toBe(voll);
  });

  it("zählt ohne Stichtag wie bisher", () => {
    expect(arbeitstageImMonat("2026-08", "AT-4")).toBeGreaterThan(15);
  });
});
