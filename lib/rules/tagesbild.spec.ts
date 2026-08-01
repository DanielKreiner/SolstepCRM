import { describe, expect, it } from "vitest";
import { liveText, tagesbild, type Buchung } from "./tagesbild";

const PERSONEN = [
  { id: "u1", name: "Markus Grabner", weeklyHours: 38.5 },
  { id: "u2", name: "Lukas Berger", weeklyHours: 38.5 },
];

function b(teil: Partial<Buchung>): Buchung {
  return {
    userId: "u1",
    kind: "work",
    startedAt: "2026-08-03T05:00:00Z",
    endedAt: "2026-08-03T13:00:00Z",
    durationMin: 480,
    status: "booked",
    jobId: "j1",
    jobNumber: "A-2026-0041",
    ...teil,
  };
}

const leer = new Map<string, string>();

describe("tagesbild", () => {
  it("liefert eine Zeile je Person, auch ohne Buchung", () => {
    const z = tagesbild({
      personen: PERSONEN,
      buchungen: [],
      abwesend: leer,
      tagessollMin: 462,
    });
    expect(z).toHaveLength(2);
    expect(z[1]!.status).toBe("offen");
    expect(z[1]!.istMin).toBe(0);
    expect(z[1]!.kommt).toBeNull();
  });

  it("zählt Pause nicht als Arbeitszeit", () => {
    const z = tagesbild({
      personen: [PERSONEN[0]!],
      buchungen: [b({}), b({ kind: "break", durationMin: 30 })],
      abwesend: leer,
      tagessollMin: 462,
    });
    expect(z[0]!.istMin).toBe(480);
    expect(z[0]!.pauseMin).toBe(30);
  });

  it("nimmt die früheste Stempelung als Kommt-Zeit", () => {
    const z = tagesbild({
      personen: [PERSONEN[0]!],
      buchungen: [
        b({ startedAt: "2026-08-03T09:00:00Z" }),
        b({ startedAt: "2026-08-03T04:45:00Z" }),
      ],
      abwesend: leer,
      tagessollMin: 462,
    });
    expect(z[0]!.kommt).toBe("2026-08-03T04:45:00Z");
  });

  it("meldet über zehn Stunden ohne Pause als unplausibel", () => {
    const z = tagesbild({
      personen: [PERSONEN[0]!],
      buchungen: [b({ durationMin: 680 })],
      abwesend: leer,
      tagessollMin: 462,
    });
    expect(z[0]!.status).toBe("unplausibel");
    expect(z[0]!.hinweis).toContain("ohne Pause");
  });

  it("meldet zehn Stunden MIT Pause nicht als unplausibel", () => {
    const z = tagesbild({
      personen: [PERSONEN[0]!],
      buchungen: [b({ durationMin: 680 }), b({ kind: "break", durationMin: 30 })],
      abwesend: leer,
      tagessollMin: 462,
    });
    expect(z[0]!.status).not.toBe("unplausibel");
  });

  it("meldet eine Buchung ohne Auftrag zur Prüfung", () => {
    const z = tagesbild({
      personen: [PERSONEN[0]!],
      buchungen: [b({ jobId: null, jobNumber: null })],
      abwesend: leer,
      tagessollMin: 462,
    });
    expect(z[0]!.status).toBe("pruefen");
    expect(z[0]!.hinweis).toContain("ohne Auftragszuordnung");
    expect(z[0]!.auftrag).toBeNull();
  });

  it("fasst mehrere Aufträge als mehrere zusammen", () => {
    const z = tagesbild({
      personen: [PERSONEN[0]!],
      buchungen: [b({}), b({ jobId: "j2", jobNumber: "A-2026-0042" })],
      abwesend: leer,
      tagessollMin: 462,
    });
    expect(z[0]!.auftrag).toBe("mehrere");
  });

  it("erkennt den laufenden Eintrag und seine Art", () => {
    const laufend = tagesbild({
      personen: [PERSONEN[0]!],
      buchungen: [b({ status: "running", endedAt: null, durationMin: null })],
      abwesend: leer,
      tagessollMin: 462,
    });
    expect(laufend[0]!.status).toBe("eingestempelt");

    const pause = tagesbild({
      personen: [PERSONEN[0]!],
      buchungen: [
        b({ kind: "break", status: "running", endedAt: null, durationMin: null }),
      ],
      abwesend: leer,
      tagessollMin: 462,
    });
    expect(pause[0]!.status).toBe("pause");
  });

  it("setzt Abwesenheit über alles andere", () => {
    const z = tagesbild({
      personen: [PERSONEN[0]!],
      buchungen: [b({ durationMin: 680 })],
      abwesend: new Map([["u1", "Krankenstand"]]),
      tagessollMin: 462,
    });
    expect(z[0]!.status).toBe("abwesend");
    expect(z[0]!.hinweis).toBe("Krankenstand");
  });

  it("rechnet das Tagessoll aus den Wochenstunden der Person", () => {
    const z = tagesbild({
      personen: [{ id: "u1", name: "Teilzeit", weeklyHours: 20 }],
      buchungen: [b({ durationMin: 240 })],
      abwesend: leer,
      tagessollMin: 462,
    });
    expect(z[0]!.sollMin).toBe(240);
    expect(z[0]!.diffMin).toBe(0);
  });
});

describe("liveText", () => {
  it("zählt die Zustände zusammen", () => {
    const z = tagesbild({
      personen: [
        { id: "a", name: "A", weeklyHours: 38.5 },
        { id: "c", name: "C", weeklyHours: 38.5 },
      ],
      buchungen: [
        b({ userId: "a", status: "running", endedAt: null, durationMin: null }),
        b({
          userId: "c",
          kind: "break",
          status: "running",
          endedAt: null,
          durationMin: null,
        }),
      ],
      abwesend: leer,
      tagessollMin: 462,
    });
    expect(liveText(z)).toBe("1 eingestempelt · 1 Pause");
  });

  it("sagt es klar, wenn niemand steht", () => {
    expect(liveText([])).toBe("niemand eingestempelt");
  });
});
