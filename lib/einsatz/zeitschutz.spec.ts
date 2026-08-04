import { describe, expect, it } from "vitest";
import { naechsteMitternacht, pruefeAlle, pruefeLaufende } from "./zeitschutz";

/*
 * Abnahmetest 9 aus dem Planungsbriefing. Der teure Fehler wäre, eine
 * Buchung zu stoppen, die zu Recht noch läuft — deshalb steht die
 * Gegenprobe in jedem Block.
 */

const B = (startedAt: string) => ({ id: "t1", userId: "u1", startedAt });

describe("Zwölf-Stunden-Grenze", () => {
  it("lässt eine normale Schicht in Ruhe", () => {
    /* Eingestempelt 06:30, jetzt ist 15:00 — acht Stunden. */
    expect(
      pruefeLaufende(B("2026-08-12T04:30:00Z"), new Date("2026-08-12T13:00:00Z")),
    ).toBeNull();
  });

  it("stoppt nach zwölf Stunden auf die Minute", () => {
    const v = pruefeLaufende(
      B("2026-08-12T04:30:00Z"),
      new Date("2026-08-12T17:00:00Z"),
    );
    expect(v?.grund).toBe("zwoelf_stunden");
    expect(v?.endeAt).toBe("2026-08-12T16:30:00.000Z");
  });

  /* Genau auf der Grenze zählt als erreicht — sonst bleibt sie ewig offen. */
  it("greift auch exakt auf der Grenze", () => {
    expect(
      pruefeLaufende(B("2026-08-12T04:30:00Z"), new Date("2026-08-12T16:30:00Z")),
    ).not.toBeNull();
  });
});

describe("Mitternacht", () => {
  /*
   * Eingestempelt um 20:00 Ortszeit. Zwölf Stunden wären 08:00 am
   * nächsten Tag — Mitternacht kommt früher und gewinnt.
   */
  it("stoppt zur örtlichen Mitternacht, wenn die früher kommt", () => {
    const v = pruefeLaufende(
      B("2026-08-12T18:00:00Z") /* 20:00 Wien im Sommer */,
      new Date("2026-08-13T05:00:00Z"),
    );
    expect(v?.grund).toBe("mitternacht");
    expect(v?.endeAt).toBe("2026-08-12T22:00:00.000Z");
  });

  it("rechnet die Tagesgrenze in Wien und nicht in UTC", () => {
    /* Sommerzeit: Wien liegt zwei Stunden vor UTC. */
    expect(naechsteMitternacht("2026-08-12T18:00:00Z").toISOString()).toBe(
      "2026-08-12T22:00:00.000Z",
    );
    /* Winterzeit: eine Stunde. */
    expect(naechsteMitternacht("2026-01-12T18:00:00Z").toISOString()).toBe(
      "2026-01-12T23:00:00.000Z",
    );
  });

  it("lässt einen Abendeinsatz vor Mitternacht laufen", () => {
    expect(
      pruefeLaufende(B("2026-08-12T18:00:00Z"), new Date("2026-08-12T20:00:00Z")),
    ).toBeNull();
  });
});

describe("Alle auf einmal", () => {
  it("liefert nur die, bei denen etwas zu tun ist", () => {
    const v = pruefeAlle(
      [
        { id: "a", userId: "u1", startedAt: "2026-08-12T04:30:00Z" },
        { id: "b", userId: "u2", startedAt: "2026-08-12T12:00:00Z" },
      ],
      new Date("2026-08-12T17:00:00Z"),
    );
    expect(v.map((x) => x.id)).toEqual(["a"]);
  });
});
