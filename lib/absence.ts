/*
 * Urlaubsrechnung.
 *
 * Reines Modul, wie lib/rules/worktime.ts: keine Datenbank, keine Uhr.
 * Gezählt werden Werktage Montag bis Freitag — Feiertage bleiben vorerst
 * außen vor, weil sie je Bundesland abweichen und location.holiday_region
 * dafür erst ausgewertet werden muss. Das ist bewusst und steht im UI.
 */

export type AbsenceRow = {
  kind: string;
  from: string;
  to: string;
  halfDay: boolean;
  status: string;
};

export type VacationBalance = {
  anspruch: number;
  uebertrag: number;
  genommen: number;
  beantragt: number;
  rest: number;
};

/** Werktage zwischen zwei Datumsangaben, beide Grenzen inklusive. */
export function workdays(from: string, to: string): number {
  let tage = 0;
  const d = new Date(`${from}T12:00:00Z`);
  const ende = new Date(`${to}T12:00:00Z`);
  while (d <= ende) {
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) tage++;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return tage;
}

/** Auf das Jahr beschnittene Werktage — ein Urlaub über den Jahreswechsel
 *  zählt anteilig in beiden Jahren. */
export function workdaysInYear(
  from: string,
  to: string,
  year: number,
): number {
  const start = from < `${year}-01-01` ? `${year}-01-01` : from;
  const ende = to > `${year}-12-31` ? `${year}-12-31` : to;
  if (start > ende) return 0;
  return workdays(start, ende);
}

export function vacationBalance(
  rows: AbsenceRow[],
  anspruch: number,
  uebertrag: number,
  year: number,
): VacationBalance {
  let genommen = 0;
  let beantragt = 0;

  for (const r of rows) {
    if (r.kind !== "vacation") continue;
    if (r.status === "rejected") continue;

    const tage = r.halfDay ? 0.5 : workdaysInYear(r.from, r.to, year);
    if (tage === 0) continue;

    if (r.status === "approved") genommen += tage;
    else beantragt += tage;
  }

  return {
    anspruch,
    uebertrag,
    genommen,
    beantragt,
    // Beantragtes zählt mit: sonst plant jemand Urlaub, den er nicht mehr hat.
    rest: Math.round((anspruch + uebertrag - genommen - beantragt) * 10) / 10,
  };
}

/** Tage einer Abwesenheit, die in einen bestimmten Monat fallen. */
export function daysInMonth(
  row: AbsenceRow,
  year: number,
  month: number,
): number[] {
  const tage: number[] = [];
  /*
   * Alle Grenzen auf 12:00 UTC. Läge der Monatsletzte auf Mitternacht und
   * die Abwesenheit auf Mittag, fiele der letzte Tag aus dem Vergleich —
   * genau das ist beim ersten Durchlauf passiert.
   */
  const erster = new Date(Date.UTC(year, month, 1, 12));
  const letzter = new Date(Date.UTC(year, month + 1, 0, 12));

  const von = new Date(`${row.from}T12:00:00Z`);
  const bis = new Date(`${row.to}T12:00:00Z`);

  const start = von > erster ? von : erster;
  const ende = bis < letzter ? bis : letzter;

  const d = new Date(start);
  while (d <= ende) {
    tage.push(d.getUTCDate());
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return tage;
}

/**
 * Werktage (Montag–Freitag) eines Monats, "2026-08".
 *
 * Feiertage bleiben aussen vor — location.holiday_region ist gepflegt, wird
 * aber noch nicht ausgewertet. Das Sollstundenmodell liegt dadurch in
 * Feiertagsmonaten zu hoch; das steht so in docs/STATUS.md und ist kein
 * stiller Fehler.
 */
export function werktageImMonat(monat: string): number {
  const [jahr, m] = monat.split("-").map(Number);
  if (!jahr || !m) return 0;
  const letzter = new Date(Date.UTC(jahr, m, 0)).getUTCDate();
  return workdays(`${monat}-01`, `${monat}-${String(letzter).padStart(2, "0")}`);
}
