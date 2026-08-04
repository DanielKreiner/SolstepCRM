import {
  checkRoster,
  DEFAULT_RULES,
  type Absence,
  type Shift,
  type WorktimeRules,
} from "@/lib/rules/worktime";

/*
 * Konflikte beim Planen eines Einsatzes.
 *
 * Genau zwei Stufen, nicht mehr (Briefing 3):
 *
 *   hart  – die Person ist abwesend. Speichern nicht möglich.
 *   weich – alles andere. Warnung im Dialog, mit Begründung überstimmbar,
 *           das Überstimmen wird als Ereignis am Einsatz protokolliert.
 *
 * Keine automatische Optimierung, kein „besten Termin finden". Bei 8 bis
 * 40 Mitarbeitern plant ein Mensch; die Software macht nur sichtbar, was
 * er sonst übersieht.
 *
 * Die Arbeitszeitregeln kommen aus lib/rules/worktime.ts und werden hier
 * NICHT neu implementiert (CLAUDE.md Abschnitt 10). Der einzige
 * Unterschied: dort ist eine Überschneidung blockierend, weil ein
 * veröffentlichter Dienstplan eine Zusage ist. Beim Planen ist sie eine
 * Warnung — zwei Leute am selben Vormittag auf derselben Baustelle sind
 * ein normaler Fall, den der Planer bewusst herbeiführt.
 */

export type Stufe = "hart" | "weich";

export type EinsatzKonflikt = {
  stufe: Stufe;
  code:
    | "abwesend"
    | "doppelt"
    | "fahrzeug"
    | "ruhezeit"
    | "tageshoechst"
    | "wochenhoechst"
    | "pause"
    | "qualifikation";
  text: string;
  /** Woher die Regel kommt — im Dialog sichtbar, damit sie nachprüfbar ist. */
  regel?: string;
};

export type PlanEinsatz = {
  id: string;
  von: string;
  bis: string;
  personen: string[];
  fahrzeugId: string | null;
  titel: string;
};

export type PlanPerson = {
  id: string;
  name: string;
  qualifikationen: string[];
};

export type PlanAbwesenheit = {
  userId: string;
  /** YYYY-MM-DD, beide Grenzen inklusive. */
  von: string;
  bis: string;
  art: string;
};

export type Pruefung = {
  /** Der Einsatz, wie er gespeichert werden soll. */
  neu: PlanEinsatz;
  /** Alle anderen Einsätze im betrachteten Zeitraum. */
  bestand: PlanEinsatz[];
  personen: PlanPerson[];
  abwesenheiten: PlanAbwesenheit[];
  /** Was der Einsatz an Qualifikationen verlangt. */
  benoetigt: string[];
  fahrzeuge: { id: string; name: string }[];
  regeln?: WorktimeRules;
};

const ABWESENHEIT_TEXT: Record<string, string> = {
  vacation: "Urlaub",
  sick: "Krankenstand",
  leave_comp: "Zeitausgleich",
  care: "Pflegefreistellung",
  school: "Schulung",
  special: "Sonderurlaub",
};

/** Überlappen zwei Zeiträume? Berührung am Rand zählt nicht. */
function ueberlappt(aVon: string, aBis: string, bVon: string, bBis: string): boolean {
  return new Date(aVon) < new Date(bBis) && new Date(bVon) < new Date(aBis);
}

/** Fällt ein Zeitraum in einen Tagesbereich (beide Grenzen inklusive)? */
function trifftTage(von: string, bis: string, vonTag: string, bisTag: string): boolean {
  const a = von.slice(0, 10);
  const b = bis.slice(0, 10);
  return a <= bisTag && vonTag <= b;
}

export function pruefe(p: Pruefung): EinsatzKonflikt[] {
  const konflikte: EinsatzKonflikt[] = [];
  const name = (id: string) =>
    p.personen.find((x) => x.id === id)?.name ?? "Diese Person";

  /* ---------------------------------------------------------- HART */
  for (const uid of p.neu.personen) {
    for (const a of p.abwesenheiten) {
      if (a.userId !== uid) continue;
      if (!trifftTage(p.neu.von, p.neu.bis, a.von, a.bis)) continue;
      konflikte.push({
        stufe: "hart",
        code: "abwesend",
        text: `${name(uid)} ist im Zeitraum abwesend (${ABWESENHEIT_TEXT[a.art] ?? a.art}).`,
      });
    }
  }

  /* --------------------------------------------------------- WEICH */

  /* 1. Person doppelt verplant. */
  for (const uid of p.neu.personen) {
    for (const e of p.bestand) {
      if (e.id === p.neu.id) continue;
      if (!e.personen.includes(uid)) continue;
      if (!ueberlappt(p.neu.von, p.neu.bis, e.von, e.bis)) continue;
      konflikte.push({
        stufe: "weich",
        code: "doppelt",
        text: `${name(uid)} ist zur selben Zeit in „${e.titel}" eingeplant.`,
      });
    }
  }

  /* 2. Fahrzeug doppelt verplant. */
  if (p.neu.fahrzeugId) {
    const fahrzeug =
      p.fahrzeuge.find((f) => f.id === p.neu.fahrzeugId)?.name ?? "Das Fahrzeug";
    for (const e of p.bestand) {
      if (e.id === p.neu.id) continue;
      if (e.fahrzeugId !== p.neu.fahrzeugId) continue;
      if (!ueberlappt(p.neu.von, p.neu.bis, e.von, e.bis)) continue;
      konflikte.push({
        stufe: "weich",
        code: "fahrzeug",
        text: `${fahrzeug} ist zur selben Zeit für „${e.titel}" verplant.`,
      });
    }
  }

  /* 3. Arbeitszeitregeln — aus der bestehenden Regel-Engine. */
  const regeln = p.regeln ?? DEFAULT_RULES;

  /*
   * Die Pause rechnet die Planung selbst hinein.
   *
   * Vorher warnte jeder Einsatz über sechs Stunden mit „Pause fehlt" —
   * bei einem Montagetag also immer. Wer eine Baustelle plant, gibt
   * Beginn und Ende ein und nicht die Jausenzeit; die gesetzliche Pause
   * ist eine Rechengrösse und keine Planungsentscheidung.
   *
   * Sie wird deshalb abgezogen, statt gemeldet zu werden: die
   * Tageshöchstarbeitszeit misst damit die tatsächliche Arbeitszeit, und
   * die Pausenwarnung entsteht gar nicht erst. Beim Stempeln bleibt es
   * bei der echten Pause — dort ist sie eine Tatsache und keine Annahme.
   */
  const mitPause = (start: string, ende: string) => {
    const min = (new Date(ende).getTime() - new Date(start).getTime()) / 60000;
    return min > regeln.breakAfterMin ? regeln.breakMin : 0;
  };

  const schichten: Shift[] = [
    ...p.bestand
      .filter((e) => e.id !== p.neu.id)
      .flatMap((e) =>
        e.personen.map((uid) => ({
          id: e.id,
          userId: uid,
          start: e.von,
          end: e.bis,
          breakMin: mitPause(e.von, e.bis),
        })),
      ),
    ...p.neu.personen.map((uid) => ({
      id: p.neu.id,
      userId: uid,
      start: p.neu.von,
      end: p.neu.bis,
      breakMin: mitPause(p.neu.von, p.neu.bis),
    })),
  ];

  const abw: Absence[] = p.abwesenheiten.map((a) => ({
    userId: a.userId,
    from: a.von,
    to: a.bis,
    kind: a.art,
  }));

  for (const c of checkRoster(schichten, regeln, abw)) {
    /*
     * Abwesenheit und Überschneidung sind oben schon behandelt — mit
     * eigenem Text und der richtigen Stufe. Sie hier ein zweites Mal
     * durchzulassen hiesse, dieselbe Warnung doppelt anzuzeigen.
     */
    if (c.code === "abwesenheit" || c.code === "ueberschneidung") continue;
    /* Die Pause ist eingerechnet — eine Warnung dazu wäre gegenstandslos. */
    if (c.code === "pause") continue;
    if (!c.shiftIds.includes(p.neu.id)) continue;

    const regel = REGELBEZUG[c.code];
    konflikte.push({
      stufe: "weich",
      code: c.code,
      text: c.message,
      ...(regel ? { regel } : {}),
    });
  }

  /* 4. Qualifikation. */
  if (p.benoetigt.length > 0) {
    const vorhanden = new Set(
      p.neu.personen.flatMap(
        (uid) => p.personen.find((x) => x.id === uid)?.qualifikationen ?? [],
      ),
    );
    const fehlt = p.benoetigt.filter((q) => !vorhanden.has(q));
    if (fehlt.length > 0) {
      konflikte.push({
        stufe: "weich",
        code: "qualifikation",
        text:
          p.neu.personen.length === 0
            ? `Noch niemand zugeordnet — gefordert ist ${fehlt.join(", ")}.`
            : `Im Team hat niemand ${fehlt.join(", ")}.`,
      });
    }
  }

  return konflikte;
}

/*
 * Der Regelbezug steht im Dialog. Ohne ihn ist eine Warnung eine
 * Behauptung der Software; mit ihm kann der Planer nachsehen und
 * begründet überstimmen.
 */
const REGELBEZUG: Record<string, string> = {
  ruhezeit: "AZG § 12 · Ruhezeit 11 Stunden",
  tageshoechst: "AZG § 9 Abs. 1 · Tageshöchstarbeitszeit",
  wochenhoechst: "AZG § 9 Abs. 1 · Wochenhöchstarbeitszeit",
  pause: "AZG § 11 · Ruhepause",
};

/** Blockiert einer der Konflikte das Speichern? */
export function blockiert(k: EinsatzKonflikt[]): boolean {
  return k.some((x) => x.stufe === "hart");
}
