import { describe, expect, it } from "vitest";
import { vacationBalance, type AbsenceRow } from "@/lib/absence";

/*
 * Der Resturlaub im Stundenkonto.
 *
 * `lib/zeiten/daten.ts` hatte dafür eine zweite Rechnung, und sie war
 * zweifach falsch:
 *
 *   1. Sie filterte auf `kind === "urlaub"`. Das Enum heisst
 *      "vacation" (0001_init.sql), in der Datenbank steht nichts
 *      anderes — `verbraucht` war damit immer 0 und der Resturlaub
 *      zeigte jedem den vollen Jahresanspruch. Eine Zahl, die nie
 *      kleiner wird, fällt niemandem auf, bis jemand Urlaub nehmen will.
 *
 *   2. Sie zählte Kalendertage, (bis - von) / 86400000 + 1. Eine
 *      Urlaubswoche kostete damit sieben Tage statt fünf.
 *
 * Das Stundenkonto rechnet jetzt über `vacationBalance`, wie
 * /abwesenheiten. Diese Datei hält fest, was dabei herauskommen muss.
 */

const woche: AbsenceRow[] = [
  // Montag bis Sonntag — fünf Werktage, nicht sieben Kalendertage.
  {
    kind: "vacation",
    from: "2026-08-03",
    to: "2026-08-09",
    halfDay: false,
    status: "approved",
  },
];

describe("Resturlaub im Stundenkonto", () => {
  it("zählt eine Urlaubswoche mit fünf Werktagen", () => {
    const b = vacationBalance(woche, 25, 0, 2026);
    expect(b.genommen).toBe(5);
    expect(b.rest).toBe(20);
  });

  it("kennt nur das Enum vacation, nicht das deutsche Wort", () => {
    const falsch: AbsenceRow[] = [{ ...woche[0]!, kind: "urlaub" }];
    const b = vacationBalance(falsch, 25, 0, 2026);
    expect(b.genommen).toBe(0);
    expect(b.rest).toBe(25);
  });

  it("zieht Beantragtes mit ab, Krankenstand aber nicht", () => {
    const gemischt: AbsenceRow[] = [
      ...woche,
      {
        kind: "vacation",
        from: "2026-09-14",
        to: "2026-09-16",
        halfDay: false,
        status: "requested",
      },
      {
        kind: "sick",
        from: "2026-05-04",
        to: "2026-05-08",
        halfDay: false,
        status: "approved",
      },
    ];
    const b = vacationBalance(gemischt, 25, 3, 2026);
    expect(b.genommen).toBe(5);
    expect(b.beantragt).toBe(3);
    expect(b.rest).toBe(20); // 25 + 3 - 5 - 3
  });
});
