import { describe, expect, it } from "vitest";
import {
  daysInMonth,
  vacationBalance,
  workdays,
  workdaysInYear,
  type AbsenceRow,
} from "./absence";

describe("Werktage", () => {
  it("zählt Montag bis Freitag", () => {
    // Mo 03.08.2026 bis Fr 07.08.2026
    expect(workdays("2026-08-03", "2026-08-07")).toBe(5);
  });

  it("überspringt das Wochenende", () => {
    // Fr 07.08. bis Mo 10.08. sind zwei Werktage
    expect(workdays("2026-08-07", "2026-08-10")).toBe(2);
  });

  it("zählt einen einzelnen Werktag als einen", () => {
    expect(workdays("2026-08-05", "2026-08-05")).toBe(1);
  });

  it("zählt einen Samstag als null", () => {
    expect(workdays("2026-08-08", "2026-08-09")).toBe(0);
  });

  it("beschneidet auf das Jahr", () => {
    // 28.12.2026 (Mo) bis 04.01.2027 (Mo)
    expect(workdaysInYear("2026-12-28", "2027-01-04", 2026)).toBe(4); // Mo–Do
    expect(workdaysInYear("2026-12-28", "2027-01-04", 2027)).toBe(2); // Fr, Mo
  });
});

describe("Resturlaub", () => {
  const rows: AbsenceRow[] = [
    { kind: "vacation", from: "2026-08-03", to: "2026-08-07", halfDay: false, status: "approved" },
    { kind: "vacation", from: "2026-09-14", to: "2026-09-18", halfDay: false, status: "requested" },
    { kind: "sick", from: "2026-05-04", to: "2026-05-08", halfDay: false, status: "approved" },
    { kind: "vacation", from: "2026-03-02", to: "2026-03-06", halfDay: false, status: "rejected" },
  ];

  it("zieht genommenen und beantragten Urlaub ab", () => {
    const b = vacationBalance(rows, 25, 3, 2026);
    expect(b.genommen).toBe(5);
    expect(b.beantragt).toBe(5);
    expect(b.rest).toBe(18); // 25 + 3 - 5 - 5
  });

  it("ignoriert Krankenstand und abgelehnte Anträge", () => {
    const nurKrank: AbsenceRow[] = [rows[2]!, rows[3]!];
    const b = vacationBalance(nurKrank, 25, 0, 2026);
    expect(b.genommen).toBe(0);
    expect(b.beantragt).toBe(0);
    expect(b.rest).toBe(25);
  });

  it("zählt einen halben Tag als 0,5", () => {
    const b = vacationBalance(
      [{ kind: "vacation", from: "2026-08-05", to: "2026-08-05", halfDay: true, status: "approved" }],
      25,
      0,
      2026,
    );
    expect(b.genommen).toBe(0.5);
    expect(b.rest).toBe(24.5);
  });

  it("zählt Urlaub über den Jahreswechsel anteilig", () => {
    const ueber: AbsenceRow[] = [
      { kind: "vacation", from: "2026-12-28", to: "2027-01-04", halfDay: false, status: "approved" },
    ];
    expect(vacationBalance(ueber, 25, 0, 2026).genommen).toBe(4);
    expect(vacationBalance(ueber, 25, 0, 2027).genommen).toBe(2);
  });

  it("kann negativ werden, wenn zu viel geplant ist", () => {
    const viel: AbsenceRow[] = [
      { kind: "vacation", from: "2026-01-05", to: "2026-03-06", halfDay: false, status: "approved" },
    ];
    expect(vacationBalance(viel, 25, 0, 2026).rest).toBeLessThan(0);
  });
});

describe("Jahresplaner", () => {
  it("liefert die Tage einer Abwesenheit im gefragten Monat", () => {
    const row: AbsenceRow = {
      kind: "vacation",
      from: "2026-07-29",
      to: "2026-08-04",
      halfDay: false,
      status: "approved",
    };
    // Juli ist Monat 6 (nullbasiert)
    expect(daysInMonth(row, 2026, 6)).toEqual([29, 30, 31]);
    expect(daysInMonth(row, 2026, 7)).toEqual([1, 2, 3, 4]);
    expect(daysInMonth(row, 2026, 8)).toEqual([]);
  });
});
