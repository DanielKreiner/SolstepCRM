/**
 * Das Vorgangsmodell — Phasen, Gates, Summen.
 *
 * Reines Rechenmodul ohne Datenbank und ohne Next-Abhängigkeit. Board,
 * Detailansicht, Kaskade und Terminierung fragen alle hier nach. Läge das
 * in den Screens, gäbe es vier Fassungen der Frage „darf dieser Vorgang
 * terminiert werden" — und drei davon wären irgendwann falsch.
 *
 * Dieselbe Begründung wie bei lib/rules/worktime.ts.
 */

export type Phase =
  | "anfrage"
  | "aufnahme"
  | "angebot"
  | "beauftragt"
  | "montage"
  | "abschluss"
  | "verloren";

export type PhaseInfo = {
  key: Phase;
  label: string;
  /** Erklärzeile im Stepper und über der Boardspalte. */
  meta: string;
};

/**
 * Die sechs Phasen in ihrer Reihenfolge. `verloren` steht bewusst nicht
 * darin: es ist ein Ende, keine Stufe, und aus jeder Phase erreichbar.
 */
export const PHASEN: readonly PhaseInfo[] = [
  { key: "anfrage", label: "Anfrage", meta: "Lead erfasst" },
  { key: "aufnahme", label: "Aufnahme", meta: "Vor Ort, Machbarkeit" },
  { key: "angebot", label: "Angebot", meta: "versendet, wartet" },
  { key: "beauftragt", label: "Beauftragt", meta: "Gates laufen" },
  { key: "montage", label: "Montage", meta: "terminiert, Ausführung" },
  { key: "abschluss", label: "Abschluss", meta: "Abnahme, Rechnung" },
] as const;

export const PHASE_LABEL: Record<Phase, string> = {
  anfrage: "Anfrage",
  aufnahme: "Aufnahme",
  angebot: "Angebot",
  beauftragt: "Beauftragt",
  montage: "Montage",
  abschluss: "Abschluss",
  verloren: "Verloren",
};

export function phaseIndex(p: Phase): number {
  return PHASEN.findIndex((x) => x.key === p);
}

export type VerlorenGrund =
  | "preis"
  | "konkurrenz"
  | "keine_rueckmeldung"
  | "nicht_machbar"
  | "kunde_verschoben"
  | "sonstiges";

export const VERLOREN_GRUND_LABEL: Record<VerlorenGrund, string> = {
  preis: "Preis",
  konkurrenz: "Konkurrenz",
  keine_rueckmeldung: "keine Rückmeldung",
  nicht_machbar: "nicht machbar",
  kunde_verschoben: "verschoben",
  sonstiges: "Sonstiges",
};

/**
 * Ist dieser Phasenwechsel erlaubt?
 *
 * Vorwärts genau eine Stufe, rückwärts beliebig (Korrektur), verloren aus
 * allem ausser dem Abschluss, und aus verloren zurück in den Vertrieb.
 *
 * Kein freies Setzen: die Phasen tragen Automatik. Wer von `anfrage`
 * direkt auf `montage' springt, hat kein Angebot, keine Gates und keinen
 * Auftragswert — und die Terminierung prüft dann Gates, die es nicht gibt.
 */
export function wechselErlaubt(von: Phase, nach: Phase): boolean {
  if (von === nach) return false;

  if (nach === "verloren") return von !== "abschluss";
  if (von === "verloren") return nach === "angebot" || nach === "anfrage";

  const a = phaseIndex(von);
  const b = phaseIndex(nach);
  if (a < 0 || b < 0) return false;

  return b === a + 1 || b < a;
}

/* --------------------------------------------------------------- GATES */

export type GateStatus = "offen" | "laeuft" | "erledigt" | "nicht_noetig";

export const GATE_STATUS_LABEL: Record<GateStatus, string> = {
  offen: "offen",
  laeuft: "läuft",
  erledigt: "erledigt",
  nicht_noetig: "nicht nötig",
};

/** Reihenfolge beim Durchklicken einer Gate-Pille. */
export const GATE_ZYKLUS: readonly GateStatus[] = [
  "offen",
  "laeuft",
  "erledigt",
  "nicht_noetig",
] as const;

export function naechsterGateStatus(jetzt: GateStatus): GateStatus {
  const i = GATE_ZYKLUS.indexOf(jetzt);
  return GATE_ZYKLUS[(i + 1) % GATE_ZYKLUS.length]!;
}

export type Gate = {
  key: string;
  label: string;
  status: GateStatus;
  blocking: boolean;
};

/** Ein Gate ist durch, wenn es erledigt ist oder gar nicht nötig war. */
export function gateDurch(g: { status: GateStatus }): boolean {
  return g.status === "erledigt" || g.status === "nicht_noetig";
}

/**
 * Welche Pflicht-Gates halten die Terminierung noch auf?
 *
 * Leere Liste heisst: es kann terminiert werden. Optionale Gates zählen
 * nicht — die Förderzusage kommt in der Praxis oft erst nach der Montage,
 * und ein Betrieb, der darauf wartet, verliert eine Saison.
 */
export function offenePflichtGates<T extends Gate>(gates: readonly T[]): T[] {
  return gates.filter((g) => g.blocking && !gateDurch(g));
}

export function darfTerminieren(gates: readonly Gate[]): boolean {
  return offenePflichtGates(gates).length === 0;
}

/** Für die Mini-Ampel auf der Karte: „4/6". */
export function gateFortschritt(gates: readonly Gate[]): string {
  if (gates.length === 0) return "";
  return `${gates.filter(gateDurch).length}/${gates.length}`;
}

/* -------------------------------------------------------------- SUMMEN */

export type Position = {
  menge: number;
  epNetto: number;
  ustSatz: number;
  kalkStunden: number | null;
  kalkEk: number | null;
  istMaterial: boolean;
};

export type Summen = {
  netto: number;
  ust: number;
  brutto: number;
  /** Einkauf über alle Positionen — Basis der Marge. */
  ek: number;
  /** Nur Material: das ist die Bedarfsliste, Leistung wird nicht bestellt. */
  materialEk: number;
  /** Kalkulierte Montagestunden. */
  stunden: number;
  marge: number;
};

/**
 * Summen eines Angebots.
 *
 * Gerundet wird auf Positionsebene, nicht am Ende (CLAUDE.md Abschnitt 5,
 * Punkt 2). 22 Module zu 168,00 sind 3.696,00 — nicht 3.695,99, weil
 * irgendwo eine Kommastelle mitgeschleppt wurde.
 */
export function summen(positionen: readonly Position[]): Summen {
  let netto = 0;
  let ust = 0;
  let ek = 0;
  let materialEk = 0;
  let stunden = 0;

  for (const p of positionen) {
    const zeile = runde2(p.menge * p.epNetto);
    netto += zeile;
    ust += runde2((zeile * p.ustSatz) / 100);

    const einkauf = runde2(p.menge * (p.kalkEk ?? 0));
    ek += einkauf;
    if (p.istMaterial) materialEk += einkauf;

    stunden += p.menge * (p.kalkStunden ?? 0);
  }

  netto = runde2(netto);
  ust = runde2(ust);

  return {
    netto,
    ust,
    brutto: runde2(netto + ust),
    ek: runde2(ek),
    materialEk: runde2(materialEk),
    stunden: Math.round(stunden * 100) / 100,
    marge: netto > 0 ? Math.round(((netto - ek) / netto) * 10000) / 100 : 0,
  };
}

/**
 * Anzahlung und Restbetrag.
 *
 * Die Anzahlung rechnet vom Brutto: der Kunde überweist einen
 * Bruttobetrag, und die Schlussrechnung muss ihn genau so wieder
 * abziehen, sonst bleibt ein Cent stehen, den jemand suchen muss.
 */
export function anzahlung(brutto: number, prozent: number): {
  anzahlungBrutto: number;
  schlussBrutto: number;
} {
  const a = runde2((brutto * prozent) / 100);
  return { anzahlungBrutto: a, schlussBrutto: runde2(brutto - a) };
}

function runde2(n: number): number {
  /*
   * Über die Zwischeneinheit Cent, nicht über toFixed: 1.005 rundet in
   * JavaScript wegen der Fliesskommadarstellung sonst auf 1.00 statt 1.01.
   */
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/* ------------------------------------------------------- STALE-ANZEIGE */

/**
 * Wie lange liegt der Vorgang schon in dieser Phase?
 *
 * Ab `schwelle` Tagen ohne Bewegung ist er auffällig. Das ist die einzige
 * Zahl, die auf dem Board Aufmerksamkeit lenkt — deshalb konfigurierbar
 * und nicht hart auf 7.
 */
export function tageInPhase(phaseSeit: string, jetzt: Date): number {
  const ms = jetzt.getTime() - new Date(phaseSeit).getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
}

export const STALE_SCHWELLE_STANDARD = 7;
