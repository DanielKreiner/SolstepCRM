import { flaechenFuerBau } from "./dachformen";
import { naechsteId, type Bau, type Plan } from "./plan";
import type { Meter } from "./geo";

/*
 * Baukörper und Plan zusammenbringen.
 *
 * `dachformen.ts` rechnet Geometrie, `plan.ts` beschreibt die Daten —
 * hier steht, was passiert, wenn jemand den Dachtyp wechselt: welche
 * Flächen neu entstehen, welche verschwinden und was mit der Belegung
 * darauf geschieht.
 */

/** Einen gezeichneten Umriss als Baukörper aufnehmen. */
export function bauAusUmriss(plan: Plan, umriss: Meter[], name = "Haus"): { plan: Plan; bau: Bau } {
  const bau: Bau = {
    id: naechsteId(plan.bauten.map((b) => b.id), "b"),
    name,
    umriss,
    /*
     * Pultdach mit 30 Grad als Ausgangspunkt — genau die eine Fläche,
     * die vorher beim blossen Zeichnen entstand, mit der Traufe auf
     * der längsten Kante. Wer ein Satteldach will, tippt einmal auf
     * „Satteldach"; wer gar nichts tut, hat wie bisher eine geneigte
     * Fläche und keine stillschweigende Null im Ertrag.
     */
    form: "pult",
    neigung: 30,
    richtung: 0,
    walmAnteil: 1,
    firstVersatz: 0,
  };

  return { plan: bauAnwenden({ ...plan, bauten: [...plan.bauten, bau] }, bau), bau };
}

export interface Anwendung {
  plan: Plan;
  /** Was der Betrieb wissen muss — nur wenn etwas verloren ging. */
  hinweis: string | null;
}

/**
 * Den Dachtyp eines Baukörpers anwenden.
 *
 * Die Flächen dieses Baus werden neu gerechnet, alles andere bleibt.
 * Fällt eine Fläche weg — beim Wechsel von Walmdach auf Flachdach
 * etwa —, gehen die Modulfelder darauf mit. Das ist unvermeidlich: Die
 * Fläche, auf der sie lagen, gibt es nicht mehr. Gesagt wird es
 * trotzdem, statt sie still verschwinden zu lassen.
 */
export function bauAnwendenMitHinweis(plan: Plan, bau: Bau): Anwendung {
  const eigene = plan.flaechen.filter((f) => f.bau === bau.id);
  const neue = flaechenFuerBau(bau, eigene);
  const bleibt = new Set(neue.map((f) => f.id));

  const verloren = eigene.filter((f) => !bleibt.has(f.id)).map((f) => f.id);
  const weg = new Set(verloren);

  const gruppen = plan.gruppen.filter((g) => !weg.has(g.flaeche));
  const verloreneGruppen = plan.gruppen.length - gruppen.length;
  const gruppenIds = new Set(gruppen.map((g) => g.id));

  /*
   * Die Flächen dieses Baus werden an Ort und Stelle ersetzt, nicht
   * hinten angehängt: Sonst springt die Reihenfolge in der Liste bei
   * jedem Umschalten, und der Betrieb sucht seine Fläche.
   */
  const raus = [...plan.flaechen];
  const ersteStelle = raus.findIndex((f) => f.bau === bau.id);
  const ohne = raus.filter((f) => f.bau !== bau.id);
  const stelle = ersteStelle < 0 ? ohne.length : Math.min(ersteStelle, ohne.length);
  const flaechen = [...ohne.slice(0, stelle), ...neue, ...ohne.slice(stelle)];

  return {
    plan: {
      ...plan,
      bauten: plan.bauten.map((b) => (b.id === bau.id ? bau : b)),
      flaechen,
      gruppen,
      strings: plan.strings.map((s) => ({
        ...s,
        module: s.module.filter((m) =>
          gruppenIds.has(m.slice(0, Math.max(0, m.lastIndexOf("/")))),
        ),
      })),
    },
    hinweis:
      verloreneGruppen > 0
        ? `${verloreneGruppen} ${verloreneGruppen === 1 ? "Modulfeld" : "Modulfelder"} entfernt — die Fläche darunter gibt es in dieser Dachform nicht mehr.`
        : null,
  };
}

/** Kurzform ohne Rückmeldung. */
export function bauAnwenden(plan: Plan, bau: Bau): Plan {
  return bauAnwendenMitHinweis(plan, bau).plan;
}

/** Den Baukörper zu einer Fläche finden. */
export function bauZu(plan: Plan, flaecheId: string | null): Bau | null {
  const f = plan.flaechen.find((x) => x.id === flaecheId);
  if (!f?.bau) return null;
  return plan.bauten.find((b) => b.id === f.bau) ?? null;
}

/**
 * Ein Haus löschen — mit allem, was daran hängt.
 *
 * Ausgelöst durch eine Beobachtung aus dem Betrieb: „wenn ich ein Dach
 * lösche, bleibt vom vorherigen die orangen Linien". Genau so war es —
 * die Dachfläche verschwand, der Umriss blieb als gestrichelte Linie
 * auf dem Luftbild stehen, und niemand konnte ihn noch anfassen, weil
 * die Liste im Panel leer war.
 *
 * Eine Teilfläche einzeln zu löschen gibt es nicht: Wer die eine
 * Hälfte eines Satteldachs wegnimmt, meint das Dach.
 */
export function bauLoeschen(plan: Plan, bauId: string): Plan {
  const weg = new Set(plan.flaechen.filter((f) => f.bau === bauId).map((f) => f.id));
  const gruppen = plan.gruppen.filter((g) => !weg.has(g.flaeche));
  const gruppenIds = new Set(gruppen.map((g) => g.id));

  return {
    ...plan,
    bauten: plan.bauten.filter((b) => b.id !== bauId),
    flaechen: plan.flaechen.filter((f) => f.bau !== bauId),
    gruppen,
    strings: plan.strings.map((s) => ({
      ...s,
      module: s.module.filter((m) => gruppenIds.has(m.slice(0, Math.max(0, m.lastIndexOf("/"))))),
    })),
  };
}
