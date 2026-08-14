import { type LatLon, type Meter, zuLatLon } from "./geo";
import type { Plan } from "./plan";

/*
 * Den Nullpunkt des Plans versetzen.
 *
 * Der Ursprung ist die Stelle, an der das lokale Metersystem an die
 * Welt geknüpft ist: Alles im Plan steht als Abstand zu ihm. Gesetzt
 * wird er beim Anlegen aus der Adresse, und das trifft die Hausnummer,
 * nicht das Dach — bei einem Hof liegen dazwischen leicht vierzig
 * Meter.
 *
 * Das ist nicht nur Kosmetik. An ihm hängen:
 *  - die Mitte der räumlichen Ansicht (dort steht die Kamera)
 *  - der Ausschnitt des Luftbilds für Boden und Dachtextur (160 m)
 *  - die Koordinaten in PDF und Übergabe
 *
 * Verschieben heisst deshalb: neuer Weltbezug UND alle Geometrie um
 * denselben Betrag zurück. Sonst wandert das Haus über die Karte,
 * obwohl sich nur die Beschreibung geändert hat — dieselbe Anlage,
 * plötzlich beim Nachbarn.
 */

/** Einen Punkt verschieben. */
function um(p: Meter, d: Meter): Meter {
  return { x: p.x - d.x, y: p.y - d.y };
}

export interface Versetzung {
  /** Neuer Weltbezug für den Nullpunkt. */
  ursprung: LatLon;
  /** Plan mit zurückgerechneter Geometrie — steht unverändert auf der Karte. */
  plan: Plan;
}

/**
 * Den Nullpunkt an diese Stelle legen.
 *
 * `ziel` ist in den ALTEN Meterkoordinaten angegeben — also dort, wo
 * der Zeiger im Bild steht.
 */
export function ursprungVersetzen(plan: Plan, alt: LatLon, ziel: Meter): Versetzung {
  const d = { x: ziel.x, y: ziel.y };

  return {
    ursprung: zuLatLon(alt, d),
    plan: {
      ...plan,
      flaechen: plan.flaechen.map((f) => ({
        ...f,
        punkte: f.punkte.map((q) => um(q, d)),
        hindernisse: f.hindernisse.map((h) => ({
          ...h,
          punkte: h.punkte.map((q) => um(q, d)),
        })),
      })),
      gruppen: plan.gruppen.map((g) => ({
        ...g,
        anker: um(g.anker, d),
        /*
         * Auch die frei gesetzten Module: Sie stehen als absolute
         * Punkte im Plan, nicht als Rasterplatz. Bliebe eines stehen,
         * spränge es beim Versetzen quer über das Dach.
         */
        frei: Object.fromEntries(
          Object.entries(g.frei).map(([s, q]) => [s, um(q, d)]),
        ),
      })),
      objekte: plan.objekte.map((o) => ({
        ...o,
        ...(o.mitte ? { mitte: um(o.mitte, d) } : {}),
        ...(o.punkte ? { punkte: o.punkte.map((q) => um(q, d)) } : {}),
      })),
    },
  };
}
