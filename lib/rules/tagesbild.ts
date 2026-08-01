/*
 * Tagesbild je Mitarbeiter.
 *
 * Die Vorlage zeigt in der Zeiterfassung nicht die einzelnen Buchungen,
 * sondern eine Zeile je Person: Kommt, Pause, Ist, Soll, Differenz, Auftrag,
 * Status. Das ist die Ansicht, in der ein Büro morgens sieht, wer fehlt —
 * eine Liste von Buchungen beantwortet diese Frage nicht.
 *
 * Reines Rechenmodul, damit die Plausibilitätsregeln prüfbar bleiben:
 * SPEC 4.8 verlangt Warnungen bei über 10 Stunden ohne Pause, bei Buchungen
 * ohne Auftragszuordnung und bei unrealistischen Fahrtzeiten.
 */

export type Buchung = {
  userId: string;
  kind: string;
  startedAt: string;
  endedAt: string | null;
  durationMin: number | null;
  status: string;
  jobId: string | null;
  jobNumber: string | null;
};

export type Tageszeile = {
  userId: string;
  name: string;
  /** Erste Stempelung des Tages, ISO-Zeitpunkt. Null, wenn nichts gebucht. */
  kommt: string | null;
  pauseMin: number;
  istMin: number;
  sollMin: number;
  diffMin: number;
  /** Auftragsnummer, wenn eindeutig; sonst "mehrere" oder null. */
  auftrag: string | null;
  status:
    | "eingestempelt"
    | "pause"
    | "dienstgang"
    | "abwesend"
    | "unplausibel"
    | "pruefen"
    | "gebucht"
    | "offen";
  /** Klartext, warum geprüft werden soll. Leer, wenn alles passt. */
  hinweis: string | null;
};

/** Über so vielen Minuten Arbeit ohne Pause wird der Tag unplausibel. */
const OHNE_PAUSE_KRITISCH = 10 * 60;

export function tagesbild({
  personen,
  buchungen,
  abwesend,
  tagessollMin,
}: {
  personen: { id: string; name: string; weeklyHours: number }[];
  buchungen: Buchung[];
  /** userId -> Klartext der Abwesenheitsart. */
  abwesend: Map<string, string>;
  /** Fallback, wenn eine Person keine Wochenstunden hinterlegt hat. */
  tagessollMin: number;
}): Tageszeile[] {
  return personen.map((p) => {
    const eigene = buchungen.filter((b) => b.userId === p.id);

    const arbeit = eigene.filter((b) => b.kind !== "break");
    const pausen = eigene.filter((b) => b.kind === "break");

    const istMin = arbeit.reduce((s, b) => s + (b.durationMin ?? 0), 0);
    const pauseMin = pausen.reduce((s, b) => s + (b.durationMin ?? 0), 0);

    const soll =
      p.weeklyHours > 0 ? Math.round((p.weeklyHours / 5) * 60) : tagessollMin;

    const kommt =
      eigene.length === 0
        ? null
        : eigene.reduce(
            (frueh, b) => (b.startedAt < frueh ? b.startedAt : frueh),
            eigene[0]!.startedAt,
          );

    const nummern = new Set(
      arbeit.map((b) => b.jobNumber).filter((n): n is string => n !== null),
    );
    const ohneZuordnung = arbeit.some((b) => b.jobId === null);
    const auftrag =
      nummern.size === 1
        ? [...nummern][0]!
        : nummern.size > 1
          ? "mehrere"
          : null;

    const laufend = eigene.find((b) => b.status === "running");
    const geflaggt = eigene.some((b) => b.status === "flagged");

    // --- Status und Hinweis ---
    let status: Tageszeile["status"];
    let hinweis: string | null = null;

    const frei = abwesend.get(p.id);
    if (frei) {
      status = "abwesend";
      hinweis = frei;
    } else if (istMin > OHNE_PAUSE_KRITISCH && pauseMin === 0) {
      status = "unplausibel";
      hinweis = "über 10 Stunden ohne Pause";
    } else if (geflaggt) {
      status = "pruefen";
      hinweis = "Buchung als auffällig markiert";
    } else if (ohneZuordnung && istMin > 0) {
      status = "pruefen";
      hinweis = "Buchung ohne Auftragszuordnung";
    } else if (laufend) {
      status =
        laufend.kind === "break"
          ? "pause"
          : laufend.kind === "travel" || laufend.kind === "errand"
            ? "dienstgang"
            : "eingestempelt";
    } else if (eigene.length > 0) {
      status = "gebucht";
    } else {
      status = "offen";
    }

    return {
      userId: p.id,
      name: p.name,
      kommt,
      pauseMin,
      istMin,
      sollMin: soll,
      diffMin: istMin - soll,
      auftrag: ohneZuordnung && auftrag === null ? null : auftrag,
      status,
      hinweis,
    };
  });
}

/** Die Zusammenfassung der Live-Leiste: "6 eingestempelt · 2 Pause · 1 Dienstgang". */
export function liveText(zeilen: Tageszeile[]): string {
  const zaehle = (s: Tageszeile["status"]) =>
    zeilen.filter((z) => z.status === s).length;

  const teile: string[] = [];
  const ein = zaehle("eingestempelt");
  const pause = zaehle("pause");
  const gang = zaehle("dienstgang");
  const frei = zaehle("abwesend");

  if (ein > 0) teile.push(`${ein} eingestempelt`);
  if (pause > 0) teile.push(`${pause} Pause`);
  if (gang > 0) teile.push(`${gang} Dienstgang`);
  if (frei > 0) teile.push(`${frei} abwesend`);

  return teile.length > 0 ? teile.join(" · ") : "niemand eingestempelt";
}
