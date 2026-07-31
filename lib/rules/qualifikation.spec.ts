import { describe, expect, it } from "vitest";
import {
  ERINNERUNGSSTUFEN,
  VORWARNUNG_TAGE,
  qualifikationsstand,
  tageBis,
} from "./qualifikation";

const HEUTE = "2026-08-01";

describe("qualifikationsstand", () => {
  it("meldet einen abgelaufenen Nachweis", () => {
    expect(qualifikationsstand("2026-07-31", HEUTE)).toBe("abgelaufen");
  });

  it("zählt den heutigen Tag noch nicht als abgelaufen", () => {
    expect(qualifikationsstand(HEUTE, HEUTE)).toBe("laeuft_ab");
  });

  it("warnt genau ab der Schwelle aus der Spezifikation", () => {
    // 120 Tage nach dem 01.08.2026 ist der 29.11.2026.
    expect(qualifikationsstand("2026-11-29", HEUTE)).toBe("laeuft_ab");
    expect(qualifikationsstand("2026-11-30", HEUTE)).toBe("gueltig");
  });

  it("wertet einen Nachweis ohne Ablaufdatum als gültig", () => {
    // Sonst wäre jede Meisterprüfung ein Warnfall.
    expect(qualifikationsstand(null, HEUTE)).toBe("gueltig");
  });
});

describe("tageBis", () => {
  it("zählt vorwärts und rückwärts", () => {
    expect(tageBis("2026-08-11", HEUTE)).toBe(10);
    expect(tageBis("2026-07-22", HEUTE)).toBe(-10);
    expect(tageBis(HEUTE, HEUTE)).toBe(0);
  });

  it("verträgt Zeitstempel statt reiner Datumsangaben", () => {
    expect(tageBis("2026-08-11T23:30:00Z", HEUTE)).toBe(10);
  });
});

describe("Erinnerungsstufen", () => {
  it("beginnen bei der Vorwarnung und werden enger", () => {
    expect(ERINNERUNGSSTUFEN[0]).toBe(VORWARNUNG_TAGE);
    const absteigend = [...ERINNERUNGSSTUFEN].every(
      (v, i, a) => i === 0 || a[i - 1]! > v,
    );
    expect(absteigend).toBe(true);
  });
});
