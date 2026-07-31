import { describe, expect, it } from "vitest";
import { auslastungJeWoche, mittlereAuslastung } from "./auslastung";

/*
 * 2026-07-27 ist ein Montag (KW 31). Alle Faelle rechnen von dort aus,
 * damit die Wochengrenzen im Test sichtbar bleiben.
 */
const MONTAG = "2026-07-27";

describe("auslastungJeWoche", () => {
  it("liefert genau so viele Wochen wie verlangt, ab der Woche des Stichtags", () => {
    const w = auslastungJeWoche({
      auftraege: [],
      kapazitaetProWoche: 100,
      abTag: "2026-07-29", // Mittwoch derselben Woche
      wochen: 3,
    });

    expect(w.map((x) => x.label)).toEqual(["KW 31", "KW 32", "KW 33"]);
    expect(w[0]!.von).toBe(MONTAG);
    expect(w.every((x) => x.leer)).toBe(true);
  });

  it("verteilt die Stunden über die Werktage statt sie der Startwoche zuzuschlagen", () => {
    // Zwei volle Arbeitswochen, 100 h. Je Woche 5 von 10 Werktagen -> 50 h.
    const w = auslastungJeWoche({
      auftraege: [{ plannedHours: 100, from: MONTAG, to: "2026-08-07" }],
      kapazitaetProWoche: 200,
      abTag: MONTAG,
      wochen: 3,
    });

    expect(w[0]!.stunden).toBe(50);
    expect(w[1]!.stunden).toBe(50);
    expect(w[2]!.stunden).toBe(0);
    expect(w[0]!.prozent).toBe(25);
  });

  it("zählt Wochenenden nicht als Arbeitstage", () => {
    // Freitag bis Montag: zwei Werktage, das Wochenende dazwischen zählt nicht.
    const w = auslastungJeWoche({
      auftraege: [{ plannedHours: 16, from: "2026-07-31", to: "2026-08-03" }],
      kapazitaetProWoche: 80,
      abTag: MONTAG,
      wochen: 2,
    });

    expect(w[0]!.stunden).toBe(8); // Freitag
    expect(w[1]!.stunden).toBe(8); // Montag
  });

  it("behandelt einen Auftrag ohne Endtermin als eintägig", () => {
    const w = auslastungJeWoche({
      auftraege: [{ plannedHours: 12, from: "2026-07-28", to: null }],
      kapazitaetProWoche: 100,
      abTag: MONTAG,
      wochen: 2,
    });

    expect(w[0]!.stunden).toBe(12);
    expect(w[1]!.stunden).toBe(0);
  });

  it("ignoriert Aufträge ohne Termin — die sind der Pool, keine Auslastung", () => {
    const w = auslastungJeWoche({
      auftraege: [
        { plannedHours: 500, from: null, to: null },
        { plannedHours: 40, from: MONTAG, to: MONTAG },
      ],
      kapazitaetProWoche: 100,
      abTag: MONTAG,
      wochen: 2,
    });

    expect(w[0]!.stunden).toBe(40);
    expect(w[0]!.leer).toBe(false);
    expect(w[1]!.leer).toBe(true);
  });

  it("schneidet Aufträge am Fensterrand ab, statt sie ganz zu zählen", () => {
    // Auftrag läuft über KW 31 bis KW 34, das Fenster endet nach KW 32.
    const w = auslastungJeWoche({
      auftraege: [{ plannedHours: 80, from: MONTAG, to: "2026-08-21" }],
      kapazitaetProWoche: 100,
      abTag: MONTAG,
      wochen: 2,
    });

    // 20 Werktage insgesamt, 4 h je Tag, 5 Tage je Woche im Fenster.
    expect(w[0]!.stunden).toBe(20);
    expect(w[1]!.stunden).toBe(20);
  });

  it("weist Überlast über 100 Prozent aus, statt zu kappen", () => {
    const w = auslastungJeWoche({
      auftraege: [{ plannedHours: 200, from: MONTAG, to: "2026-07-31" }],
      kapazitaetProWoche: 100,
      abTag: MONTAG,
      wochen: 1,
    });

    expect(w[0]!.prozent).toBe(200);
  });

  it("rechnet ohne Kapazität nicht durch null", () => {
    const w = auslastungJeWoche({
      auftraege: [{ plannedHours: 40, from: MONTAG, to: MONTAG }],
      kapazitaetProWoche: 0,
      abTag: MONTAG,
      wochen: 1,
    });

    expect(w[0]!.prozent).toBe(0);
    expect(Number.isFinite(w[0]!.prozent)).toBe(true);
  });
});

describe("mittlereAuslastung", () => {
  it("mittelt über die ersten n Wochen", () => {
    const w = auslastungJeWoche({
      auftraege: [{ plannedHours: 100, from: MONTAG, to: "2026-08-07" }],
      kapazitaetProWoche: 100,
      abTag: MONTAG,
      wochen: 4,
    });

    // 50 %, 50 %, 0 %, 0 % -> 25 %
    expect(mittlereAuslastung(w, 4)).toBe(25);
  });

  it("bleibt bei leerem Fenster bei null", () => {
    expect(mittlereAuslastung([], 4)).toBe(0);
  });
});
