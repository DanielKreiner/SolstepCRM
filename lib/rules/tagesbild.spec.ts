import { describe, expect, it } from "vitest";
import { tageshinweis, type Tageslage } from "./tagesbild";

function lage(teil: Partial<Tageslage> = {}): Tageslage {
  return {
    istMin: 480,
    pauseMin: 30,
    geflaggt: false,
    ohneEinsatz: false,
    ...teil,
  };
}

describe("tageshinweis", () => {
  it("schweigt bei einem normalen Tag", () => {
    expect(tageshinweis(lage())).toBeNull();
  });

  it("meldet über zehn Stunden ohne Pause", () => {
    expect(tageshinweis(lage({ istMin: 680, pauseMin: 0 }))).toContain(
      "ohne Pause",
    );
  });

  it("meldet dieselbe Länge MIT Pause nicht", () => {
    expect(tageshinweis(lage({ istMin: 680, pauseMin: 30 }))).toBeNull();
  });

  it("meldet genau zehn Stunden noch nicht", () => {
    expect(tageshinweis(lage({ istMin: 600, pauseMin: 0 }))).toBeNull();
  });

  it("meldet eine markierte Buchung", () => {
    expect(tageshinweis(lage({ geflaggt: true }))).toContain("auffällig");
  });

  it("meldet eine Buchung ohne Einsatz", () => {
    expect(tageshinweis(lage({ ohneEinsatz: true }))).toContain(
      "ohne Auftragszuordnung",
    );
  });

  it("meldet einen leeren Tag nicht als unzugeordnet", () => {
    // Ohne gearbeitete Minute gibt es nichts zuzuordnen.
    expect(tageshinweis(lage({ istMin: 0, ohneEinsatz: true }))).toBeNull();
  });

  it("stellt die lange Schicht über den fehlenden Einsatz", () => {
    expect(
      tageshinweis(lage({ istMin: 680, pauseMin: 0, ohneEinsatz: true })),
    ).toContain("ohne Pause");
  });
});
