import { describe, expect, it } from "vitest";
import { viennaClock } from "@/lib/time";
import {
  DEFAULT_RULES,
  blocksPublication,
  checkBooking,
  checkRoster,
  isoWeekKey,
  type Shift,
} from "./worktime";

/*
 * Die Zahlen hier sind von Hand gerechnet, nicht aus dem Modul abgeleitet.
 * Ein Test, der dieselbe Formel noch einmal aufschreibt, prüft nichts.
 */

const U = "monteur-1";

function schicht(id: string, tag: string, von: string, bis: string, pause = 0): Shift {
  return {
    id,
    userId: U,
    start: `${tag}T${von}:00.000Z`,
    end: `${tag}T${bis}:00.000Z`,
    breakMin: pause,
  };
}

/**
 * Eine Schicht in Wiener Wanduhrzeit — so, wie sie im Dienstplan steht.
 *
 * Gebraucht für die Fälle, in denen Wiener und UTC-Kalendertag
 * auseinanderfallen. Das war der Fehler: `slice(0, 10)` auf dem
 * gespeicherten Instant las den UTC-Tag, und ein Dienst um 01:00
 * Ortszeit gehörte damit zum Vortag.
 */
function wien(
  id: string,
  tag: string,
  von: string,
  bisTag: string,
  bis: string,
  pause = 0,
): Shift {
  return {
    id,
    userId: U,
    start: viennaClock(tag, von).toISOString(),
    end: viennaClock(bisTag, bis).toISOString(),
    breakMin: pause,
  };
}

describe("Ruhezeit", () => {
  it("elf Stunden zwischen zwei Diensten sind in Ordnung", () => {
    const konflikte = checkRoster([
      schicht("a", "2026-08-03", "06:00", "16:00", 30),
      // 16:00 bis 03:00+1 = 11 Stunden
      schicht("b", "2026-08-04", "03:00", "09:00"),
    ]);
    expect(konflikte.filter((c) => c.code === "ruhezeit")).toHaveLength(0);
  });

  it("zehn Stunden sind zu wenig und blockieren", () => {
    const konflikte = checkRoster([
      schicht("a", "2026-08-03", "06:00", "16:00", 30),
      schicht("b", "2026-08-04", "02:00", "08:00"),
    ]);
    const ruhe = konflikte.filter((c) => c.code === "ruhezeit");
    expect(ruhe).toHaveLength(1);
    expect(ruhe[0]!.severity).toBe("block");
    expect(ruhe[0]!.message).toContain("10 statt 11");
    expect(blocksPublication(konflikte)).toBe(true);
  });

  it("eine Lücke am selben Tag ist eine Pause, keine Ruhezeitfrage", () => {
    const konflikte = checkRoster([
      schicht("a", "2026-08-03", "06:00", "10:00"),
      schicht("b", "2026-08-03", "11:00", "15:00"),
    ]);
    expect(konflikte.filter((c) => c.code === "ruhezeit")).toHaveLength(0);
  });

  it("greift auch, wenn beide Dienste am selben UTC-Tag liegen", () => {
    /*
     * Der Fehler: Mo 08:00–16:00 Wien endet 14:00 UTC am Montag, Di
     * 01:00–05:00 Wien beginnt Montag 23:00 UTC. Beide UTC-Tage waren
     * "2026-08-03", die Prüfung hielt das für denselben Tag und sprang
     * ab — neun Stunden Ruhezeit blieben unbemerkt. Genau der Fall, für
     * den die Regel da ist.
     */
    const konflikte = checkRoster([
      wien("mo", "2026-08-03", "08:00", "2026-08-03", "16:00", 30),
      wien("di", "2026-08-04", "01:00", "2026-08-04", "05:00"),
    ]);
    const ruhe = konflikte.filter((c) => c.code === "ruhezeit");
    expect(ruhe).toHaveLength(1);
    expect(ruhe[0]!.message).toContain("9 statt 11");
    expect(blocksPublication(konflikte)).toBe(true);
  });
});

describe("Tageshöchstarbeitszeit", () => {
  it("zehn Stunden netto sind erlaubt", () => {
    // 06:00 bis 16:30 = 10,5 Stunden brutto, 30 Minuten Pause = 10 netto
    const konflikte = checkRoster([schicht("a", "2026-08-03", "06:00", "16:30", 30)]);
    expect(konflikte.filter((c) => c.code === "tageshoechst")).toHaveLength(0);
  });

  it("zehneinhalb Stunden netto blockieren", () => {
    const konflikte = checkRoster([schicht("a", "2026-08-03", "06:00", "17:00", 30)]);
    const treffer = konflikte.filter((c) => c.code === "tageshoechst");
    expect(treffer).toHaveLength(1);
    expect(treffer[0]!.message).toContain("10.5 Stunden");
  });

  it("zählt mehrere Einsätze desselben Tags zusammen", () => {
    const konflikte = checkRoster([
      schicht("a", "2026-08-03", "05:00", "11:00"),
      schicht("b", "2026-08-03", "12:00", "17:30"),
    ]);
    // 6 + 5,5 = 11,5 Stunden ohne Pause
    expect(konflikte.some((c) => c.code === "tageshoechst")).toBe(true);
  });

  it("gruppiert nach Wiener Tag, nicht nach UTC-Tag", () => {
    /*
     * Beide Dienste liegen am Dienstag Ortszeit: 01:00–05:00 und
     * 08:00–18:00, zusammen 14 Stunden. Nach UTC-Tag gerechnet fiel der
     * Nachtdienst auf den Montag; der Dienstag landete bei genau zehn
     * Stunden und blieb unauffällig.
     */
    const konflikte = checkRoster([
      wien("nacht", "2026-08-04", "01:00", "2026-08-04", "05:00"),
      wien("tag", "2026-08-04", "08:00", "2026-08-04", "18:00"),
    ]);
    const treffer = konflikte.filter((c) => c.code === "tageshoechst");
    expect(treffer).toHaveLength(1);
    expect(treffer[0]!.message).toContain("14 Stunden am 2026-08-04");
  });
});

describe("Wochenhöchstarbeitszeit", () => {
  it("fünfzig Stunden sind erlaubt", () => {
    // Mo bis Fr je 10 Stunden netto
    const tage = ["2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06", "2026-08-07"];
    const konflikte = checkRoster(
      tage.map((t, i) => schicht(`s${i}`, t, "06:00", "16:30", 30)),
    );
    expect(konflikte.filter((c) => c.code === "wochenhoechst")).toHaveLength(0);
  });

  it("eine zusätzliche Samstagsschicht blockiert", () => {
    const tage = ["2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06", "2026-08-07"];
    const schichten = tage.map((t, i) => schicht(`s${i}`, t, "06:00", "16:30", 30));
    schichten.push(schicht("sa", "2026-08-08", "07:00", "12:00"));

    const konflikte = checkRoster(schichten);
    const woche = konflikte.filter((c) => c.code === "wochenhoechst");
    expect(woche).toHaveLength(1);
    expect(woche[0]!.message).toContain("55 Stunden");
    expect(woche[0]!.message).toContain("2026-W32");
  });

  it("trennt Kalenderwochen sauber", () => {
    // Freitag und der folgende Montag gehören in verschiedene Wochen.
    const konflikte = checkRoster([
      schicht("fr", "2026-08-07", "06:00", "16:30", 30),
      schicht("mo", "2026-08-10", "06:00", "16:30", 30),
    ]);
    expect(konflikte.filter((c) => c.code === "wochenhoechst")).toHaveLength(0);
  });
});

describe("Pausenpflicht", () => {
  it("warnt ab sechs Stunden ohne Pause, blockiert aber nicht", () => {
    const konflikte = checkRoster([schicht("a", "2026-08-03", "07:00", "14:00")]);
    const pause = konflikte.filter((c) => c.code === "pause");
    expect(pause).toHaveLength(1);
    expect(pause[0]!.severity).toBe("warn");
    expect(blocksPublication(konflikte)).toBe(false);
  });

  it("schweigt bei genau sechs Stunden", () => {
    const konflikte = checkRoster([schicht("a", "2026-08-03", "07:00", "13:00")]);
    expect(konflikte.filter((c) => c.code === "pause")).toHaveLength(0);
  });
});

describe("Überschneidung und Abwesenheit", () => {
  it("erkennt zwei gleichzeitige Einsätze", () => {
    const konflikte = checkRoster([
      schicht("a", "2026-08-03", "06:00", "12:00"),
      schicht("b", "2026-08-03", "11:00", "15:00"),
    ]);
    const treffer = konflikte.filter((c) => c.code === "ueberschneidung");
    expect(treffer).toHaveLength(1);
    expect(treffer[0]!.severity).toBe("block");
  });

  it("blockiert Planung während genehmigten Urlaubs", () => {
    const konflikte = checkRoster(
      [schicht("a", "2026-08-05", "07:00", "12:00")],
      DEFAULT_RULES,
      [{ userId: U, from: "2026-08-03", to: "2026-08-07", kind: "vacation" }],
    );
    const treffer = konflikte.filter((c) => c.code === "abwesenheit");
    expect(treffer).toHaveLength(1);
    expect(treffer[0]!.severity).toBe("block");
    expect(blocksPublication(konflikte)).toBe(true);
  });

  it("beachtet nur die Abwesenheit der betroffenen Person", () => {
    const konflikte = checkRoster(
      [schicht("a", "2026-08-05", "07:00", "12:00")],
      DEFAULT_RULES,
      [{ userId: "jemand-anderer", from: "2026-08-03", to: "2026-08-07", kind: "sick" }],
    );
    expect(konflikte.filter((c) => c.code === "abwesenheit")).toHaveLength(0);
  });
});

describe("Regeln je Standort", () => {
  it("respektiert abweichende Werte", () => {
    const streng = { ...DEFAULT_RULES, maxDaily: 8, restHours: 12 };
    const konflikte = checkRoster(
      [schicht("a", "2026-08-03", "06:00", "15:00", 30)],
      streng,
    );
    // 8,5 Stunden netto, erlaubt sind 8
    expect(konflikte.some((c) => c.code === "tageshoechst")).toBe(true);
  });
});

describe("checkBooking", () => {
  it("meldet nur Konflikte, die die neue Buchung betreffen", () => {
    const bestehend = [schicht("alt", "2026-08-03", "06:00", "16:00", 30)];
    const neu = schicht("neu", "2026-08-04", "02:00", "08:00");

    const konflikte = checkBooking(neu, bestehend);
    expect(konflikte.every((c) => c.shiftIds.includes("neu"))).toBe(true);
    expect(konflikte.some((c) => c.code === "ruhezeit")).toBe(true);
  });
});

describe("isoWeekKey", () => {
  it("ordnet Jahreswechsel korrekt zu", () => {
    // Der 1.1.2027 ist ein Freitag und gehört zur KW 53 von 2026.
    expect(isoWeekKey("2027-01-01T08:00:00.000Z")).toBe("2026-W53");
    expect(isoWeekKey("2026-08-03T08:00:00.000Z")).toBe("2026-W32");
  });
});
