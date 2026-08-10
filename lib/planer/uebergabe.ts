/*
 * Aus einer Planung eine Bedarfsliste machen (Briefing 8.2).
 *
 * Der Planer weiss, was auf dem Dach liegt: wie viele Module welchen
 * Typs, welcher Wechselrichter, ob ein Speicher dabei ist. Diese Liste
 * ins Material zu übertragen, ist stumpfe Arbeit — und stumpfe Arbeit
 * wird falsch gemacht, wenn man sie von Hand erledigt.
 *
 * Zwei Grundsätze, beide aus dem Briefing:
 *
 *   1. Wo eine Artikelreferenz am Stammdatensatz hängt, wird sie
 *      mitgegeben. Wo keine hängt, entsteht eine Freitextposition mit
 *      dem Hinweis „Artikel zuordnen" — nicht ein geratener Artikel.
 *   2. Die Bedarfsliste gehört dem Betrieb. Eine erneute Übergabe nach
 *      Planänderung überschreibt sie NICHT, sondern zeigt einen
 *      Abgleich zur Auswahl.
 */

import { anzahlModule } from "./module";
import type { Plan } from "./plan";

export interface GeraeteStand {
  module: Array<{ id: string; hersteller: string; bezeichnung: string; artikel_id: string | null }>;
  wechselrichter: Array<{
    id: string;
    hersteller: string;
    bezeichnung: string;
    artikel_id: string | null;
  }>;
  speicher: Array<{
    id: string;
    hersteller: string;
    bezeichnung: string;
    nutzbar_kwh: number;
    artikel_id: string | null;
  }>;
}

export interface BedarfPosition {
  bezeichnung: string;
  menge: number;
  einheit: string;
  /** Verweis in den Artikelstamm; null heisst: muss zugeordnet werden. */
  artikel_id: string | null;
  /**
   * Stabile Kennung dieser Position innerhalb der Planung. Nur darüber
   * lässt sich beim zweiten Mal sagen, ob eine Position dieselbe ist —
   * die Bezeichnung ändert sich, sobald jemand ein Gerät umbenennt.
   */
  schluessel: string;
}

/**
 * Was die Planung an Material braucht.
 *
 * Module werden nach Typ zusammengefasst: auf einem Dach mit zwei
 * Feldern desselben Moduls steht eine Position mit der Summe, nicht
 * zwei. Wer sie getrennt bestellen will, teilt sie im Material — dort
 * gehört diese Entscheidung hin.
 */
export function bedarfAusPlan(plan: Plan, geraete: GeraeteStand): BedarfPosition[] {
  const positionen: BedarfPosition[] = [];

  /*
   * ── Module ─────────────────────────────────────────────────────
   *
   * Gruppiert wird nach der Bezeichnung des Modultyps, die in der
   * Gruppe steckt. Sie stammt aus der Technikwahl; liegen auf dem Dach
   * Gruppen aus verschiedenen Planungsständen, stehen sie zu Recht
   * getrennt.
   */
  const nachTyp = new Map<string, { wp: number; anzahl: number }>();
  for (const g of plan.gruppen) {
    const anzahl = anzahlModule(g);
    if (anzahl === 0) continue;
    const name = g.typ.bezeichnung || "Modul";
    const bisher = nachTyp.get(name);
    nachTyp.set(name, { wp: g.typ.wp, anzahl: (bisher?.anzahl ?? 0) + anzahl });
  }

  const gewaehltesModul = geraete.module.find((m) => m.id === plan.technik.modul);
  for (const [name, daten] of nachTyp) {
    /*
     * Die Artikelreferenz nur dann anhängen, wenn dieser Modultyp auch
     * der gewählte ist. Bei zwei Typen auf dem Dach gehört sie nur zu
     * einem — die andere Position bekommt lieber gar keinen Artikel als
     * den falschen.
     */
    const passt =
      gewaehltesModul &&
      `${gewaehltesModul.hersteller} ${gewaehltesModul.bezeichnung}`.includes(name);
    positionen.push({
      bezeichnung: `${name} (${daten.wp} Wp)`,
      menge: daten.anzahl,
      einheit: "Stk",
      artikel_id: passt ? gewaehltesModul.artikel_id : null,
      schluessel: `modul:${name}`,
    });
  }

  /* ── Wechselrichter ──────────────────────────────────────────── */
  const wr = geraete.wechselrichter.find((w) => w.id === plan.technik.wechselrichter);
  if (wr) {
    positionen.push({
      bezeichnung: `${wr.hersteller} ${wr.bezeichnung}`,
      menge: 1,
      einheit: "Stk",
      artikel_id: wr.artikel_id,
      schluessel: `wr:${wr.id}`,
    });
  }

  /* ── Speicher ────────────────────────────────────────────────── */
  const sp = geraete.speicher.find((s) => s.id === plan.technik.speicher);
  /*
   * Nur wenn die Rechnung auch mit Speicher gezeigt wird. Ein Speicher,
   * den der Kunde im Gespräch abgewählt hat, gehört nicht in die
   * Bestellung — sonst steht er auf dem Lieferschein und niemand weiss,
   * warum.
   */
  if (sp && plan.wirtschaft.mitSpeicher) {
    positionen.push({
      bezeichnung: `${sp.hersteller} ${sp.bezeichnung}`,
      menge: 1,
      einheit: "Stk",
      artikel_id: sp.artikel_id,
      schluessel: `speicher:${sp.id}`,
    });
  }

  /*
   * ── Aufständerung ──────────────────────────────────────────────
   *
   * Für Flachdachgruppen. Welches System der Betrieb verbaut, weiss der
   * Planer nicht — die Position ist deshalb bewusst Freitext mit der
   * Modulzahl als Menge, damit im Material der passende Artikel
   * gewählt werden kann.
   */
  const aufgestaendert = plan.gruppen.filter((g) => g.aufstaenderung !== null);
  if (aufgestaendert.length > 0) {
    const arten = new Set(aufgestaendert.map((g) => g.aufstaenderung!.art));
    const modulzahl = aufgestaendert.reduce((s, g) => s + anzahlModule(g), 0);
    positionen.push({
      bezeichnung: `Aufständerung ${[...arten].join(" und ")} (Flachdach)`,
      menge: modulzahl,
      einheit: "Stk",
      artikel_id: null,
      schluessel: "aufstaenderung",
    });
  }

  return positionen;
}

/*
 * ── Abgleich bei erneuter Übergabe ─────────────────────────────────
 */

export interface VorhandenePosition {
  id: string;
  bezeichnung: string;
  menge: number;
  notiz: string | null;
}

export type AenderungsArt = "neu" | "geaendert" | "entfallen" | "unveraendert";

export interface Abgleich {
  art: AenderungsArt;
  schluessel: string;
  bezeichnung: string;
  /** Menge laut aktueller Planung; bei „entfallen" die alte Menge. */
  menge: number;
  /** Bei „geaendert“: was bisher in der Liste stand. */
  vorherigeMenge?: number;
  vorhandeneId?: string;
  artikel_id: string | null;
}

/**
 * Was sich seit der letzten Übergabe geändert hat.
 *
 * Die Zuordnung läuft über den Schlüssel, der beim ersten Mal in die
 * Notiz geschrieben wurde. Über die Bezeichnung zu vergleichen wäre
 * naheliegend und falsch: sobald jemand im Material einen Namen
 * anpasst — und das ist der Normalfall —, gälte dieselbe Position als
 * entfallen und käme ein zweites Mal hinzu.
 */
export function abgleichen(
  neu: BedarfPosition[],
  vorhanden: VorhandenePosition[],
): Abgleich[] {
  const alteNachSchluessel = new Map<string, VorhandenePosition>();
  for (const v of vorhanden) {
    const s = schluesselAusNotiz(v.notiz);
    if (s) alteNachSchluessel.set(s, v);
  }

  const ergebnis: Abgleich[] = [];
  const gesehen = new Set<string>();

  for (const n of neu) {
    gesehen.add(n.schluessel);
    const alt = alteNachSchluessel.get(n.schluessel);
    if (!alt) {
      ergebnis.push({ art: "neu", ...n });
      continue;
    }
    if (Math.abs(alt.menge - n.menge) > 1e-9) {
      ergebnis.push({
        art: "geaendert",
        ...n,
        vorherigeMenge: alt.menge,
        vorhandeneId: alt.id,
      });
    } else {
      ergebnis.push({ art: "unveraendert", ...n, vorhandeneId: alt.id });
    }
  }

  for (const [schluessel, alt] of alteNachSchluessel) {
    if (gesehen.has(schluessel)) continue;
    ergebnis.push({
      art: "entfallen",
      schluessel,
      bezeichnung: alt.bezeichnung,
      menge: alt.menge,
      vorhandeneId: alt.id,
      artikel_id: null,
    });
  }

  return ergebnis;
}

/** Der Schlüssel wird in der Notiz mitgeführt: „[planer:modul:AIKO …]". */
export function notizMitSchluessel(schluessel: string, artikelFehlt: boolean): string {
  const marke = `[planer:${schluessel}]`;
  return artikelFehlt ? `${marke} Artikel zuordnen` : marke;
}

export function schluesselAusNotiz(notiz: string | null): string | null {
  if (!notiz) return null;
  const treffer = notiz.match(/\[planer:([^\]]+)\]/);
  return treffer?.[1] ?? null;
}
