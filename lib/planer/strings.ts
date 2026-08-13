import { aktiveZellen, modulMitte, type Modulgruppe } from "./module";
import type { Meter } from "./geo";
import { modulSchluessel, naechsteId, type Plan, type Strang } from "./plan";

/*
 * Strings verlegen — die Verkabelung der Module.
 *
 * Bisher entstand ein String nur von Hand: String anlegen, Werkzeug
 * wählen, über die Module fahren. Bei 34 Modulen auf zwei Dachhälften
 * ist das eine Viertelstunde Malarbeit, und der häufigste Fehler dabei
 * ist der teuerste — ein String über zwei Ausrichtungen.
 *
 * Dieses Modul macht daraus einen Knopf. Drei Regeln, mehr steckt
 * nicht dahinter, aber die drei sind nicht verhandelbar:
 *
 * 1. Ein String bleibt in EINER Modulgruppe. Zwei Ausrichtungen an
 *    einem MPP-Tracker heisst: Der Tracker regelt auf einen
 *    Kompromiss, und beide Teilfelder liefern weniger als sie
 *    könnten. Eine Gruppe ist im Planer genau eine Ausrichtung.
 * 2. Die Reihenfolge läuft im Bogen (Reihe hin, nächste Reihe zurück).
 *    So läuft auch das Kabel auf dem Dach: Am Reihenende steht der
 *    Monteur schon dort, wo die nächste Reihe anfängt. Zeilenweise
 *    immer von links wäre je Reihe eine Feldbreite Kabel mehr.
 * 3. Die Länge richtet sich nach der Spannung, und die Reste werden
 *    verteilt statt angehängt. 21 Module bei höchstens 12 je String
 *    werden 11 + 10, nicht 12 + 9: Zwei ungleiche Strings an einem
 *    Tracker kosten Ertrag, zwei fast gleiche kosten nichts.
 *
 * Reines Rechenmodul, keine Abhängigkeit zur Oberfläche — dieselbe
 * Verlegung zeichnet die Draufsicht, die räumliche Ansicht und das PDF.
 */

/** Ein Modul in seiner Gruppe, mit Rasterplatz. */
export interface Zelle {
  reihe: number;
  spalte: number;
}

/**
 * Die aktiven Zellen einer Gruppe in Verlegereihenfolge (Bogen).
 *
 * Reihe 0 von links nach rechts, Reihe 1 von rechts nach links, und so
 * weiter. Lücken — weggetippte oder ausserhalb liegende Module —
 * fallen einfach heraus; die Reihenfolge der übrigen bleibt.
 */
export function bogenfolge(g: Modulgruppe): Zelle[] {
  const aktiv = aktiveZellen(g);
  const jeReihe = new Map<number, Zelle[]>();
  for (const z of aktiv) {
    const liste = jeReihe.get(z.reihe);
    if (liste) liste.push(z);
    else jeReihe.set(z.reihe, [z]);
  }
  const raus: Zelle[] = [];
  for (const reihe of [...jeReihe.keys()].sort((a, b) => a - b)) {
    const liste = jeReihe.get(reihe)!.sort((a, b) => a.spalte - b.spalte);
    raus.push(...(reihe % 2 === 1 ? liste.reverse() : liste));
  }
  return raus;
}

/**
 * Eine Menge Module möglichst gleichmässig aufteilen.
 *
 * `anzahl` Module, höchstens `max` je String: Erst steht die Zahl der
 * Strings fest, dann werden die Module darauf verteilt. Der Rest wird
 * auf die vorderen Strings gelegt, damit die Grössen um höchstens eins
 * auseinanderliegen.
 */
export function aufteilung(anzahl: number, max: number): number[] {
  if (anzahl <= 0) return [];
  const strings = Math.max(1, Math.ceil(anzahl / Math.max(1, max)));
  const grund = Math.floor(anzahl / strings);
  const rest = anzahl - grund * strings;
  return Array.from({ length: strings }, (_, i) => grund + (i < rest ? 1 : 0));
}

export interface VerlegeGrenzen {
  /** Höchstzahl Module je String aus der Kaltspannung. */
  max: number;
  /** Mindestzahl aus dem MPP-Fenster — nur für die Rückmeldung. */
  min: number;
  /** Zahl der MPP-Tracker am gewählten Wechselrichter. */
  mppt: number;
}

export interface Verlegung {
  strings: Strang[];
  /** Was der Betrieb danach lesen soll — eine Zeile, kein Protokoll. */
  hinweis: string | null;
}

/**
 * Alle Module des Plans auf Strings verteilen.
 *
 * Ersetzt die bestehende Verlegung vollständig. Das ist Absicht: Eine
 * Verlegung, die alte Strings stehen lässt und nur die neuen Module
 * anhängt, erzeugt genau die halb von Hand, halb automatisch
 * verdrahtete Anlage, die hinterher niemand mehr prüfen kann.
 *
 * Die MPP-Tracker werden reihum vergeben. Bei zwei Dachflächen und
 * zwei Trackern landet damit jede Fläche auf einem eigenen Tracker —
 * das ist genau die Auslegung, die man von Hand auch wählt.
 */
export function verlegeStrings(plan: Plan, grenzen: VerlegeGrenzen): Verlegung {
  const max = Math.max(1, Math.floor(grenzen.max));
  const mpptAnzahl = Math.max(1, Math.floor(grenzen.mppt));

  const strings: Strang[] = [];
  const belegt: string[] = [];
  let zuKurz = 0;

  for (const g of plan.gruppen) {
    const folge = bogenfolge(g);
    if (folge.length === 0) continue;

    let ab = 0;
    for (const laenge of aufteilung(folge.length, max)) {
      const stueck = folge.slice(ab, ab + laenge);
      ab += laenge;
      if (stueck.length < grenzen.min) zuKurz++;
      strings.push({
        id: naechsteId([...strings.map((s) => s.id), ...belegt], "s"),
        name: `String ${strings.length + 1}`,
        /*
         * Reihum, aber erst NACH dem Anlegen gezählt: Der erste String
         * gehört auf MPPT 1. Mit `strings.length` vor dem Anlegen wäre
         * er auf MPPT 1 gelandet, der zweite auf 2 — dasselbe Ergebnis,
         * nur bei einer leeren Gruppe dazwischen nicht mehr.
         */
        mppt: strings.length % mpptAnzahl,
        module: stueck.map((z) => modulSchluessel(g.id, z.reihe, z.spalte)),
      });
    }
  }

  // Nicht `module`: In Next.js ist der Name gesperrt.
  const anzahl = strings.reduce((n, s) => n + s.module.length, 0);
  let hinweis: string | null = null;
  if (strings.length === 0) hinweis = "Es sind noch keine Module belegt.";
  else if (zuKurz > 0) {
    hinweis =
      `${strings.length} Strings für ${anzahl} Module — ` +
      `${zuKurz} davon unter der Mindestlänge. Prüfung unten beachten.`;
  } else {
    hinweis = `${strings.length} Strings für ${anzahl} Module verlegt.`;
  }
  return { strings, hinweis };
}

/**
 * Der Kabelweg eines Strings als Punktfolge in Metern.
 *
 * Ein Punkt je Modulmitte, in der Reihenfolge des Strings. Module, die
 * es nicht mehr gibt — Gruppe gelöscht, Zelle weggetippt —, fallen
 * heraus; ein Weg, der ins Leere zeigt, ist schlimmer als ein kurzer.
 */
export function strangWeg(
  plan: Plan,
  strang: Strang,
): { punkte: Meter[]; flaeche: string | null } {
  const punkte: Meter[] = [];
  let flaeche: string | null = null;

  for (const schluessel of strang.module) {
    const trenner = schluessel.lastIndexOf("/");
    if (trenner < 0) continue;
    const gruppeId = schluessel.slice(0, trenner);
    const [r, c] = schluessel.slice(trenner + 1).split(":");
    const reihe = Number(r);
    const spalte = Number(c);
    if (!Number.isFinite(reihe) || !Number.isFinite(spalte)) continue;

    const g = plan.gruppen.find((x) => x.id === gruppeId);
    if (!g) continue;
    const f = plan.flaechen.find((x) => x.id === g.flaeche);
    if (!f) continue;
    if (reihe < 0 || reihe >= g.reihen || spalte < 0 || spalte >= g.spalten) continue;

    punkte.push(modulMitte(g, f, reihe, spalte));
    flaeche ??= f.id;
  }

  return { punkte, flaeche };
}

/**
 * Ein Modul einem String zuschlagen — oder herausnehmen.
 *
 * Ein Modul gehört zu genau einem String. Deshalb wird es beim
 * Zuschlagen aus allen anderen entfernt: Sonst zählt die elektrische
 * Prüfung dasselbe Modul zweimal, und die Anlage rechnet sich auf dem
 * Papier grösser, als sie ist.
 *
 * Eine Stelle für beide Ansichten — in der Draufsicht wird gemalt, in
 * der räumlichen Ansicht getippt.
 */
export function strangUmschalten(plan: Plan, strangId: string, schluessel: string): Plan {
  const strang = plan.strings.find((x) => x.id === strangId);
  if (!strang) return plan;
  const drin = strang.module.includes(schluessel);

  return {
    ...plan,
    strings: plan.strings.map((x) => {
      if (x.id === strangId) {
        return {
          ...x,
          module: drin ? x.module.filter((m) => m !== schluessel) : [...x.module, schluessel],
        };
      }
      return drin ? x : { ...x, module: x.module.filter((m) => m !== schluessel) };
    }),
  };
}
