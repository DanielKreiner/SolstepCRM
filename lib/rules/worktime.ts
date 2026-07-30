/*
 * Arbeitsrechtsregeln als reines Modul — keine Datenbank, keine Uhr, kein
 * Next. Alles kommt als Argument herein.
 *
 * Benutzt an genau drei Stellen (CLAUDE.md Abschnitt 10):
 *   1. Dispo-Konfliktprüfung vor der Veröffentlichung
 *   2. Plausibilitätsprüfung der Zeiterfassung
 *   3. Dienstplanveröffentlichung
 * Eine vierte Implementierung wird nicht geduldet.
 *
 * Grundlage ist das österreichische AZG in den Punkten, die einen
 * PV-Betrieb betreffen. Die Werte sind je Standort konfigurierbar, weil
 * Kollektivverträge und Betriebsvereinbarungen abweichen — hart verdrahtet
 * ist nur die Struktur, nicht die Zahl.
 */

export type WorktimeRules = {
  /** Ununterbrochene Ruhezeit zwischen zwei Diensten, in Stunden. */
  restHours: number;
  /** Höchstarbeitszeit je Tag, in Stunden. */
  maxDaily: number;
  /** Höchstarbeitszeit je Woche, in Stunden. */
  maxWeekly: number;
  /** Ab dieser Dauer ist eine Pause fällig, in Minuten. */
  breakAfterMin: number;
  /** Mindestdauer dieser Pause, in Minuten. */
  breakMin: number;
};

export const DEFAULT_RULES: WorktimeRules = {
  restHours: 11,
  maxDaily: 10,
  maxWeekly: 50,
  breakAfterMin: 360,
  breakMin: 30,
};

export type Shift = {
  id: string;
  userId: string;
  /** ISO-Zeitpunkt. */
  start: string;
  end: string;
  /** Bereits eingeplante Pause innerhalb der Schicht, in Minuten. */
  breakMin?: number;
};

export type Absence = {
  userId: string;
  /** YYYY-MM-DD, beide Grenzen inklusive. */
  from: string;
  to: string;
  kind: string;
};

export type Severity = "block" | "warn";

export type Conflict = {
  code:
    | "ruhezeit"
    | "tageshoechst"
    | "wochenhoechst"
    | "pause"
    | "abwesenheit"
    | "ueberschneidung";
  severity: Severity;
  userId: string;
  /** Betroffene Schichten. */
  shiftIds: string[];
  message: string;
};

const H = 3600_000;

/**
 * Prüft einen Dienstplan gegen die Regeln.
 *
 * Blockierend sind nur die Punkte, bei denen ein Verstoß den Betrieb in die
 * Haftung bringt: Ruhezeit, Tageshöchstarbeitszeit, Wochenhöchstarbeitszeit
 * und Planung während einer genehmigten Abwesenheit. Die Pausenregel warnt —
 * sie wird in der Praxis beim Stempeln erfüllt, nicht in der Planung.
 */
export function checkRoster(
  shifts: Shift[],
  rules: WorktimeRules = DEFAULT_RULES,
  absences: Absence[] = [],
): Conflict[] {
  const conflicts: Conflict[] = [];
  const byUser = new Map<string, Shift[]>();

  for (const s of shifts) {
    if (!byUser.has(s.userId)) byUser.set(s.userId, []);
    byUser.get(s.userId)!.push(s);
  }

  for (const [userId, liste] of byUser) {
    const sortiert = [...liste].sort((a, b) => a.start.localeCompare(b.start));

    // --- Überschneidung und Ruhezeit ---
    for (let i = 1; i < sortiert.length; i++) {
      const vor = sortiert[i - 1]!;
      const jetzt = sortiert[i]!;
      const endeVor = new Date(vor.end).getTime();
      const startJetzt = new Date(jetzt.start).getTime();

      if (startJetzt < endeVor) {
        conflicts.push({
          code: "ueberschneidung",
          severity: "block",
          userId,
          shiftIds: [vor.id, jetzt.id],
          message: "Zwei Einsätze überschneiden sich.",
        });
        continue;
      }

      const pauseH = (startJetzt - endeVor) / H;
      // Innerhalb desselben Kalendertags ist eine kurze Lücke keine
      // Ruhezeitfrage, sondern eine Pause. Die Ruhezeit gilt zwischen Diensten.
      const gleicherTag = vor.end.slice(0, 10) === jetzt.start.slice(0, 10);
      if (!gleicherTag && pauseH < rules.restHours) {
        conflicts.push({
          code: "ruhezeit",
          severity: "block",
          userId,
          shiftIds: [vor.id, jetzt.id],
          message: `Ruhezeit ${round1(pauseH)} statt ${rules.restHours} Stunden.`,
        });
      }
    }

    // --- Tageshöchstarbeitszeit und Pausenpflicht ---
    const proTag = new Map<string, Shift[]>();
    for (const s of sortiert) {
      const tag = s.start.slice(0, 10);
      if (!proTag.has(tag)) proTag.set(tag, []);
      proTag.get(tag)!.push(s);
    }

    for (const [tag, tagesSchichten] of proTag) {
      const brutto = tagesSchichten.reduce((sum, s) => sum + dauerMin(s), 0);
      const pausen = tagesSchichten.reduce((sum, s) => sum + (s.breakMin ?? 0), 0);
      const netto = brutto - pausen;

      if (netto > rules.maxDaily * 60) {
        conflicts.push({
          code: "tageshoechst",
          severity: "block",
          userId,
          shiftIds: tagesSchichten.map((s) => s.id),
          message: `${round1(netto / 60)} Stunden am ${tag}, erlaubt sind ${rules.maxDaily}.`,
        });
      }

      if (netto > rules.breakAfterMin && pausen < rules.breakMin) {
        conflicts.push({
          code: "pause",
          severity: "warn",
          userId,
          shiftIds: tagesSchichten.map((s) => s.id),
          message: `Am ${tag} fehlt die Pause von ${rules.breakMin} Minuten.`,
        });
      }
    }

    // --- Wochenhöchstarbeitszeit ---
    const proWoche = new Map<string, Shift[]>();
    for (const s of sortiert) {
      const woche = isoWeekKey(s.start);
      if (!proWoche.has(woche)) proWoche.set(woche, []);
      proWoche.get(woche)!.push(s);
    }

    for (const [woche, wochenSchichten] of proWoche) {
      const netto = wochenSchichten.reduce(
        (sum, s) => sum + dauerMin(s) - (s.breakMin ?? 0),
        0,
      );
      if (netto > rules.maxWeekly * 60) {
        conflicts.push({
          code: "wochenhoechst",
          severity: "block",
          userId,
          shiftIds: wochenSchichten.map((s) => s.id),
          message: `${round1(netto / 60)} Stunden in ${woche}, erlaubt sind ${rules.maxWeekly}.`,
        });
      }
    }

    // --- Abwesenheit ---
    const eigene = absences.filter((a) => a.userId === userId);
    for (const s of sortiert) {
      const tag = s.start.slice(0, 10);
      const treffer = eigene.find((a) => tag >= a.from && tag <= a.to);
      if (treffer) {
        conflicts.push({
          code: "abwesenheit",
          severity: "block",
          userId,
          shiftIds: [s.id],
          message: `Am ${tag} abwesend (${treffer.kind}).`,
        });
      }
    }
  }

  return conflicts;
}

/** Blockiert mindestens ein Konflikt die Veröffentlichung? */
export function blocksPublication(conflicts: Conflict[]): boolean {
  return conflicts.some((c) => c.severity === "block");
}

/**
 * Plausibilitätsprüfung einer erfassten Zeit — dieselben Regeln, andere
 * Blickrichtung: hier ist die Arbeit schon geleistet, die Buchung wird nicht
 * abgelehnt, sondern markiert.
 */
export function checkBooking(
  shift: Shift,
  vorherige: Shift[],
  rules: WorktimeRules = DEFAULT_RULES,
): Conflict[] {
  return checkRoster([...vorherige, shift], rules).filter((c) =>
    c.shiftIds.includes(shift.id),
  );
}

function dauerMin(s: Shift): number {
  const ms = new Date(s.end).getTime() - new Date(s.start).getTime();
  return Math.max(0, Math.round(ms / 60000));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** ISO-Woche als "2026-W31". Lokal gerechnet, wie die Anzeige. */
export function isoWeekKey(iso: string): string {
  const d = new Date(iso);
  const target = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
  const dayNr = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNr + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const firstDayNr = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNr + 3);
  const week =
    1 +
    Math.round(
      (target.getTime() - firstThursday.getTime()) / (7 * 24 * 3600 * 1000),
    );
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}
