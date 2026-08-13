/*
 * Modulbelegung — das Herzstück (Briefing 4).
 *
 * Module gehören immer zu einer GRUPPE. Eine Gruppe hat ihr eigenes
 * Raster: Modultyp, Ausrichtung, Abstände, Drehwinkel, Ankerpunkt. Eine
 * Dachfläche kann beliebig viele Gruppen tragen, und die dürfen
 * unterschiedlich gedreht sein — genau dafür ist die Gruppe da.
 *
 * Der wichtigste Satz dieser Datei steht in Briefing 1.2 und ist die
 * häufigste Fehlerquelle solcher Werkzeuge:
 *
 *   GESPEICHERT und GERECHNET wird mit den WAHREN Massen.
 *   VERKÜRZT wird nur beim ZEICHNEN.
 *
 * Ein Modul mit 1,762 m Höhe liegt auf einem 45°-Dach in der Draufsicht
 * nur 1,246 m tief. Wer mit dem verkürzten Mass weiterrechnet, verliert
 * bei der Fläche ein Drittel und bei der Leistung genauso viel.
 */

import {
  abstandZuKante,
  type Dachflaeche,
  falllinie,
  imInnenbereich,
  kanten,
  naechsterAufStrecke,
  punktInPolygon,
  schwerpunkt,
} from "./flaeche";
import type { Meter } from "./geo";

export interface Modultyp {
  /** Kante quer zur Modulhöhe, in Metern. */
  breite: number;
  /** Lange Kante, in Metern. */
  hoehe: number;
  wp: number;
  bezeichnung: string;
}

/** Bis die Stammdaten kommen (Stufe 4): ein handelsübliches Modul. */
export const STANDARD_MODUL: Modultyp = {
  breite: 1.134,
  hoehe: 1.762,
  wp: 440,
  bezeichnung: "440 Wp · 1762 × 1134",
};

export interface Aufstaenderung {
  art: "sued" | "ost-west";
  /** Neigung der Aufständerung in Grad. */
  winkel: number;
}

export interface Modulgruppe {
  id: string;
  name: string;
  /** Zu welcher Dachfläche die Gruppe gehört. */
  flaeche: string;
  typ: Modultyp;
  ausrichtung: "hoch" | "quer";
  /** Luft zwischen den Reihen bzw. Spalten, in Metern. */
  reihenabstand: number;
  spaltenabstand: number;
  /** Drehung des Rasters gegen die Traufe, in Grad. */
  winkel: number;
  /** Linke untere Ecke des Rasters im lokalen Metersystem. */
  anker: Meter;
  spalten: number;
  reihen: number;
  /** Nur beim Flachdach (Briefing 4.4). */
  aufstaenderung: Aufstaenderung | null;
  /**
   * Zellen, in die geometrisch kein Modul passt: über den Rand, in
   * einem Hindernis oder auf einer fremden Gruppe. Wird bei jeder
   * Bewegung neu bestimmt und darf deshalb NICHT die Entscheidungen des
   * Planers enthalten.
   */
  aus: string[];
  /**
   * Zellen, die jemand von Hand weggetippt hat.
   *
   * Getrennt von `aus`, und das ist keine Feinheit: `nachfuehren`
   * überschreibt `aus` komplett. Solange beides in einem Feld lag, kamen
   * weggetippte Module zurück, sobald die Gruppe verschoben oder gedreht
   * wurde — die Belegung sah nach jedem Zug anders aus, als der Planer
   * sie hinterlassen hatte.
   */
  entfernt: string[];
  /** Aus dem Raster gezogene Module: "reihe:spalte" → Mittelpunkt. */
  frei: Record<string, Meter>;
}

export function zelle(reihe: number, spalte: number): string {
  return `${reihe}:${spalte}`;
}

/*
 * ── Masse ──────────────────────────────────────────────────────────
 */

/** Wahre Kantenlängen: quer zur Falllinie und in Falllinienrichtung. */
export function wahreMasse(g: Modulgruppe): { quer: number; laengs: number } {
  return g.ausrichtung === "hoch"
    ? { quer: g.typ.breite, laengs: g.typ.hoehe }
    : { quer: g.typ.hoehe, laengs: g.typ.breite };
}

/**
 * Der Winkel, um den in der Draufsicht verkürzt wird.
 *
 * Auf dem geneigten Dach ist es die Dachneigung. Auf dem Flachdach liegt
 * das Modul nicht in der Fläche, sondern auf einem Gestell — dort zählt
 * der Aufständerungswinkel, nicht die (null) Dachneigung.
 */
export function verkuerzungsWinkel(g: Modulgruppe, f: Dachflaeche): number {
  if (g.aufstaenderung) return g.aufstaenderung.winkel;
  return f.neigung;
}

/** Masse in der Draufsicht: quer bleibt, längs wird verkürzt. */
export function planMasse(g: Modulgruppe, f: Dachflaeche): { quer: number; laengs: number } {
  const wahr = wahreMasse(g);
  const w = (verkuerzungsWinkel(g, f) * Math.PI) / 180;
  return { quer: wahr.quer, laengs: wahr.laengs * Math.cos(w) };
}

/** Wahre Modulfläche — für Belegungsgrad und Ertrag, nie die verkürzte. */
export function modulflaeche(g: Modulgruppe): number {
  const w = wahreMasse(g);
  return w.quer * w.laengs;
}

/*
 * ── Rasterachsen ───────────────────────────────────────────────────
 */

export interface Achsen {
  /** Einheitsvektor entlang der Reihen (traufparallel, plus Drehwinkel). */
  quer: Meter;
  /** Einheitsvektor bergauf — in diese Richtung wachsen die Reihen. */
  laengs: Meter;
}

function drehe(v: Meter, grad: number): Meter {
  const r = (grad * Math.PI) / 180;
  return { x: v.x * Math.cos(r) - v.y * Math.sin(r), y: v.x * Math.sin(r) + v.y * Math.cos(r) };
}

/**
 * Richtungen des Rasters.
 *
 * Ohne Traufe (Flachdach) gibt es keine natürliche Vorzugsrichtung —
 * dann liegt das Raster nach Osten/Norden und wird über den Drehwinkel
 * ausgerichtet.
 */
export function achsen(g: Modulgruppe, f: Dachflaeche): Achsen {
  const fall = falllinie(f);
  const quer: Meter = fall ? { x: -fall.y, y: fall.x } : { x: 1, y: 0 };
  return {
    quer: drehe(quer, g.winkel),
    // Bergauf ist der Falllinie entgegengesetzt: Reihen wachsen von der
    // Traufe zum First, wie sie auch montiert werden.
    laengs: drehe(fall ? { x: -fall.x, y: -fall.y } : { x: 0, y: 1 }, g.winkel),
  };
}

/** Mittelpunkt einer Rasterzelle, ohne Rücksicht auf freie Positionen. */
export function rasterMitte(g: Modulgruppe, f: Dachflaeche, reihe: number, spalte: number): Meter {
  const a = achsen(g, f);
  const m = planMasse(g, f);
  const du = (spalte + 0.5) * (m.quer + g.spaltenabstand);
  const dv = (reihe + 0.5) * (m.laengs + g.reihenabstand);
  return {
    x: g.anker.x + a.quer.x * du + a.laengs.x * dv,
    y: g.anker.y + a.quer.y * du + a.laengs.y * dv,
  };
}

/** Tatsächlicher Mittelpunkt: freie Position schlägt das Raster. */
export function modulMitte(g: Modulgruppe, f: Dachflaeche, reihe: number, spalte: number): Meter {
  return g.frei[zelle(reihe, spalte)] ?? rasterMitte(g, f, reihe, spalte);
}

/** Die vier Ecken in der Draufsicht — zum Zeichnen und für Kollisionen. */
export function modulEcken(g: Modulgruppe, f: Dachflaeche, reihe: number, spalte: number): Meter[] {
  const mitte = modulMitte(g, f, reihe, spalte);
  return eckenUm(mitte, g, f);
}

export function eckenUm(mitte: Meter, g: Modulgruppe, f: Dachflaeche): Meter[] {
  const a = achsen(g, f);
  const m = planMasse(g, f);
  const hq = m.quer / 2;
  const hl = m.laengs / 2;
  return [
    { x: mitte.x - a.quer.x * hq - a.laengs.x * hl, y: mitte.y - a.quer.y * hq - a.laengs.y * hl },
    { x: mitte.x + a.quer.x * hq - a.laengs.x * hl, y: mitte.y + a.quer.y * hq - a.laengs.y * hl },
    { x: mitte.x + a.quer.x * hq + a.laengs.x * hl, y: mitte.y + a.quer.y * hq + a.laengs.y * hl },
    { x: mitte.x - a.quer.x * hq + a.laengs.x * hl, y: mitte.y - a.quer.y * hq + a.laengs.y * hl },
  ];
}

/*
 * ── Passt das Modul? ───────────────────────────────────────────────
 */

/** Kürzester Abstand zweier Strecken — 0, wenn sie sich schneiden. */
export function abstandStrecken(a1: Meter, a2: Meter, b1: Meter, b2: Meter): number {
  const richtung = (p: Meter, q: Meter, r: Meter) =>
    (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = richtung(b1, b2, a1);
  const d2 = richtung(b1, b2, a2);
  const d3 = richtung(a1, a2, b1);
  const d4 = richtung(a1, a2, b2);
  if ((d1 > 0) !== (d2 > 0) && (d3 > 0) !== (d4 > 0)) return 0;
  return Math.min(
    abstandZuKante(a1, b1, b2),
    abstandZuKante(a2, b1, b2),
    abstandZuKante(b1, a1, a2),
    abstandZuKante(b2, a1, a2),
  );
}

function ueberlappen(a: Meter[], b: Meter[]): boolean {
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      const s = abstandStrecken(
        a[i]!,
        a[(i + 1) % a.length]!,
        b[j]!,
        b[(j + 1) % b.length]!,
      );
      if (s === 0) return true;
    }
  }
  // Vollständig ineinander liegende Rechtecke haben keinen Kantenschnitt.
  return punktInPolygon(a[0]!, b) || punktInPolygon(b[0]!, a);
}

/**
 * Liegt das Modul vollständig in der belegbaren Innenfläche?
 *
 * Drei Bedingungen, alle nötig:
 *   1. jede Ecke liegt im Innenbereich (innerhalb, Randabstand
 *      eingehalten, nicht im Hindernissaum),
 *   2. keine Begrenzungskante läuft NÄHER als der Randabstand am Modul
 *      vorbei — sonst rutschte ein Modul über eine Einbuchtung hinweg,
 *      deren Ecken es gar nicht berührt,
 *   3. dasselbe für jedes Hindernis mit seinem eigenen Saum.
 */
export function modulPasst(ecken: Meter[], f: Dachflaeche): boolean {
  for (const e of ecken) if (!imInnenbereich(e, f)) return false;

  for (const k of kanten(f.punkte)) {
    for (let i = 0; i < ecken.length; i++) {
      if (abstandStrecken(ecken[i]!, ecken[(i + 1) % ecken.length]!, k.a, k.b) < f.randabstand) {
        return false;
      }
    }
  }

  for (const h of f.hindernisse) {
    for (const k of kanten(h.punkte)) {
      for (let i = 0; i < ecken.length; i++) {
        if (abstandStrecken(ecken[i]!, ecken[(i + 1) % ecken.length]!, k.a, k.b) < h.abstand) {
          return false;
        }
      }
    }
  }
  return true;
}

/** Stösst das Modul mit einem anderen zusammen? */
export function stoesstAn(ecken: Meter[], andere: Meter[][]): boolean {
  return andere.some((a) => ueberlappen(ecken, a));
}

/*
 * ── Zählen ─────────────────────────────────────────────────────────
 */

/** Alle Zellen, die kein Modul tragen — beide Gründe zusammen. */
export function leereZellen(g: Modulgruppe): Set<string> {
  return new Set([...g.aus, ...(g.entfernt ?? [])]);
}

export function aktiveZellen(g: Modulgruppe): Array<{ reihe: number; spalte: number }> {
  const leer = leereZellen(g);
  const raus: Array<{ reihe: number; spalte: number }> = [];
  for (let r = 0; r < g.reihen; r++) {
    for (let c = 0; c < g.spalten; c++) {
      if (!leer.has(zelle(r, c))) raus.push({ reihe: r, spalte: c });
    }
  }
  return raus;
}

export function anzahlModule(g: Modulgruppe): number {
  return g.reihen * g.spalten - leereZellen(g).size;
}

export function kwp(g: Modulgruppe): number {
  return (anzahlModule(g) * g.typ.wp) / 1000;
}

/*
 * ── Flachdach ──────────────────────────────────────────────────────
 */

/**
 * Sonnenhöhe am 21. Dezember zu Mittag, aus der geografischen Breite.
 *
 * Die Erdachse steht 23,44° schief; zur Wintersonnenwende steht die
 * Sonne über dem südlichen Wendekreis. In Österreich bleiben damit
 * knapp 19° — der Grund, warum aufgeständerte Reihen im Winter so weit
 * auseinander müssen.
 */
export function sonnenhoeheWinter(breitengrad: number): number {
  return 90 - Math.abs(breitengrad) - 23.44;
}

/**
 * Vorschlag für den Reihenabstand gegen Winterverschattung
 * (Briefing 4.4). Vereinfachte Formel: der Schatten, den eine Reihe
 * wirft, muss vor der nächsten enden.
 *
 *   Schattenlänge = Höhe über Grund / tan(Sonnenhöhe)
 *   Höhe über Grund = Modullänge · sin(Aufständerungswinkel)
 *
 * Das ist ein VORSCHLAG, kein Zwang — wer enger stellt, nimmt im
 * Dezember Verluste in Kauf und weiss das meist selbst am besten.
 */
export function reihenabstandVorschlag(
  modullaenge: number,
  aufstaenderungswinkel: number,
  breitengrad: number,
): number {
  const alpha = sonnenhoeheWinter(breitengrad);
  // Über dem Polarkreis geht die Sonne im Winter nicht auf; dann hilft
  // keine Formel, und wir geben einen sichtbar grossen Abstand zurück.
  if (alpha <= 1) return modullaenge * 6;
  const hoehe = modullaenge * Math.sin((aufstaenderungswinkel * Math.PI) / 180);
  return Math.round((hoehe / Math.tan((alpha * Math.PI) / 180)) * 100) / 100;
}

/*
 * ── Automatische Belegung ──────────────────────────────────────────
 */

export interface BelegOptionen {
  typ: Modultyp;
  ausrichtung: "hoch" | "quer";
  reihenabstand: number;
  spaltenabstand: number;
  winkel: number;
  aufstaenderung: Aufstaenderung | null;
  /** Module anderer Gruppen, die frei bleiben müssen. */
  besetzt?: Meter[][];
}

/**
 * Belegt eine Fläche mit einem Raster (Briefing 4.3).
 *
 * Startpunkt ist die Traufe: das Raster beginnt an der untersten Kante
 * und wächst nach oben, weil so auch montiert wird. Gesucht wird der
 * Ankerpunkt, der die meisten Module trägt — dafür wird das Raster in
 * kleinen Schritten quer und längs verschoben. Ein festes Raster ab
 * Polygonecke verschenkt sonst je nach Zuschnitt eine ganze Reihe.
 *
 * Ergebnis ist eine GANZ NORMALE Gruppe: verschiebbar, drehbar,
 * teilbar. Der Vorschlag ist ein Startpunkt, kein Endzustand.
 */
export function autoBelegen(
  f: Dachflaeche,
  id: string,
  name: string,
  opt: BelegOptionen,
): Modulgruppe | null {
  const vorlage: Modulgruppe = {
    id,
    name,
    flaeche: f.id,
    typ: opt.typ,
    ausrichtung: opt.ausrichtung,
    reihenabstand: opt.reihenabstand,
    spaltenabstand: opt.spaltenabstand,
    winkel: opt.winkel,
    anker: { x: 0, y: 0 },
    spalten: 0,
    reihen: 0,
    aufstaenderung: opt.aufstaenderung,
    aus: [],
    entfernt: [],
    frei: {},
  };

  const a = achsen(vorlage, f);
  const m = planMasse(vorlage, f);
  const schrittQuer = m.quer + opt.spaltenabstand;
  const schrittLaengs = m.laengs + opt.reihenabstand;
  if (schrittQuer <= 0 || schrittLaengs <= 0) return null;

  // Ausdehnung der Fläche in Rasterrichtung bestimmen.
  const mitte = schwerpunkt(f.punkte);
  const projektionen = f.punkte.map((p) => ({
    u: (p.x - mitte.x) * a.quer.x + (p.y - mitte.y) * a.quer.y,
    v: (p.x - mitte.x) * a.laengs.x + (p.y - mitte.y) * a.laengs.y,
  }));
  const uMin = Math.min(...projektionen.map((p) => p.u));
  const uMax = Math.max(...projektionen.map((p) => p.u));
  const vMin = Math.min(...projektionen.map((p) => p.v));
  const vMax = Math.max(...projektionen.map((p) => p.v));

  const spaltenMax = Math.floor((uMax - uMin) / schrittQuer) + 1;
  const reihenMax = Math.floor((vMax - vMin) / schrittLaengs) + 1;
  if (spaltenMax < 1 || reihenMax < 1) return null;

  /*
   * Versatz suchen. Fünf Schritte je Richtung reichen: feiner wird das
   * Ergebnis kaum, und die Laufzeit steigt quadratisch.
   */
  const STUFEN = 5;
  let beste: { anker: Meter; aus: string[]; anzahl: number } | null = null;

  for (let i = 0; i < STUFEN; i++) {
    for (let j = 0; j < STUFEN; j++) {
      const du = (i / STUFEN) * schrittQuer;
      const dv = (j / STUFEN) * schrittLaengs;
      const anker: Meter = {
        x: mitte.x + a.quer.x * (uMin + du) + a.laengs.x * (vMin + dv),
        y: mitte.y + a.quer.y * (uMin + du) + a.laengs.y * (vMin + dv),
      };

      const kandidat: Modulgruppe = {
        ...vorlage,
        anker,
        spalten: spaltenMax,
        reihen: reihenMax,
      };
      const aus: string[] = [];
      let anzahl = 0;

      for (let r = 0; r < reihenMax; r++) {
        for (let c = 0; c < spaltenMax; c++) {
          const ecken = modulEcken(kandidat, f, r, c);
          const passt =
            modulPasst(ecken, f) && !stoesstAn(ecken, opt.besetzt ?? []);
          if (passt) anzahl++;
          else aus.push(zelle(r, c));
        }
      }

      if (!beste || anzahl > beste.anzahl) beste = { anker, aus, anzahl };
    }
  }

  if (!beste || beste.anzahl === 0) return null;
  return {
    ...vorlage,
    anker: beste.anker,
    spalten: spaltenMax,
    reihen: reihenMax,
    aus: beste.aus,
  };
}

/**
 * Nach dem Verschieben oder Drehen: Module, die nicht mehr passen,
 * abschalten — und solche, die wieder Platz haben, zurückholen.
 *
 * Nicht löschen (Briefing 4.1): wer eine Gruppe über den Kamin und
 * wieder zurückzieht, will seine Module wiederhaben.
 */
export function nachfuehren(g: Modulgruppe, f: Dachflaeche, besetzt: Meter[][] = []): Modulgruppe {
  const aus: string[] = [];
  for (let r = 0; r < g.reihen; r++) {
    for (let c = 0; c < g.spalten; c++) {
      const ecken = modulEcken(g, f, r, c);
      if (!modulPasst(ecken, f) || stoesstAn(ecken, besetzt)) aus.push(zelle(r, c));
    }
  }
  return { ...g, aus };
}


/**
 * Ein einzelnes Modul an einer Stelle — als Gruppe aus genau einem.
 *
 * Fuer den Fall, den ein Betrieb am haeufigsten hat und der bisher
 * fehlte: erst EIN Modul hinsetzen und von dort weiterbauen. Bisher gab
 * es nur "Dach voll belegen" und danach das Wegtippen — wer eine kleine
 * Anlage plante, entfernte dreissig Module von Hand.
 *
 * Das Raster richtet sich nach der Flaeche (Traufe = quer, Falllinie =
 * laengs); die angegebene Stelle wird zur MITTE des Moduls. Passt es
 * dort nicht aufs Dach, kommt null zurueck — der Aufrufer zeigt das
 * Geistermodul dann rot und legt nichts an.
 */
export function einzelnesModul(
  f: Dachflaeche,
  mitte: Meter,
  id: string,
  name: string,
  opt: Omit<BelegOptionen, "besetzt"> & { besetzt?: Meter[][] },
): Modulgruppe | null {
  const gruppe = modulLage(f, mitte, id, name, opt);
  const ecken = modulEcken(gruppe, f, 0, 0);
  if (!modulPasst(ecken, f)) return null;
  if (opt.besetzt && stoesstAn(ecken, opt.besetzt)) return null;
  return gruppe;
}

/**
 * Dieselbe Lage OHNE Prüfung.
 *
 * Gebraucht fürs Geisterbild: Es soll auch dort erscheinen, wo das
 * Modul nicht hinpasst — dann eben rot. Ein Zeiger ohne Rückmeldung
 * lässt einen raten, warum der Klick nichts tut.
 */
export function modulLage(
  f: Dachflaeche,
  mitte: Meter,
  id: string,
  name: string,
  opt: Omit<BelegOptionen, "besetzt"> & { besetzt?: Meter[][] },
): Modulgruppe {
  const vorlage: Modulgruppe = {
    id,
    name,
    flaeche: f.id,
    typ: opt.typ,
    ausrichtung: opt.ausrichtung,
    reihenabstand: opt.reihenabstand,
    spaltenabstand: opt.spaltenabstand,
    winkel: opt.winkel,
    anker: { x: 0, y: 0 },
    spalten: 1,
    reihen: 1,
    aufstaenderung: opt.aufstaenderung,
    aus: [],
    entfernt: [],
    frei: {},
  };

  /*
   * Der Anker ist die linke untere Ecke des Rasters, gefragt ist die
   * Mitte: eine halbe Modulbreite und -hoehe zurueck, in den Achsen der
   * Flaeche.
   */
  const a = achsen(vorlage, f);
  const m = planMasse(vorlage, f);
  const halbQuer = (m.quer + opt.spaltenabstand) / 2;
  const halbLaengs = (m.laengs + opt.reihenabstand) / 2;
  const gruppe: Modulgruppe = {
    ...vorlage,
    anker: {
      x: mitte.x - a.quer.x * halbQuer - a.laengs.x * halbLaengs,
      y: mitte.y - a.quer.y * halbQuer - a.laengs.y * halbLaengs,
    },
  };

  return gruppe;
}


/**
 * Wohin ein Modulfeld tatsaechlich schaut — Ausrichtung und Neigung.
 *
 * Auf dem Schraegdach ist das die Flaeche selbst. Auf dem Flachdach
 * nicht: Dort liegt das Modul auf einem Gestell, und das Gestell
 * bestimmt beides.
 *
 * - Sued-Aufstaenderung: alles schaut nach Sueden, im Gestellwinkel —
 *   egal, wie das Flachdach selbst orientiert ist.
 * - Ost/West: die Haelfte schaut nach Osten, die Haelfte nach Westen.
 *   Das ist der Grund, warum diese Bauart ueberhaupt gewaehlt wird
 *   (breiterer Tagesgang, mehr Module je Quadratmeter) — und es MUSS
 *   getrennt gerechnet werden. Ein Mittelwert aus 90 und 270 Grad ist
 *   Sueden, und der Ertrag laege gut zehn Prozent zu hoch.
 */
export function ausrichtungen(
  g: Modulgruppe,
  f: Dachflaeche,
): Array<{ azimut: number; neigung: number; anteil: number }> {
  if (!g.aufstaenderung) return [{ azimut: f.azimut, neigung: f.neigung, anteil: 1 }];
  if (g.aufstaenderung.art === "sued") {
    return [{ azimut: 180, neigung: g.aufstaenderung.winkel, anteil: 1 }];
  }
  return [
    { azimut: 90, neigung: g.aufstaenderung.winkel, anteil: 0.5 },
    { azimut: 270, neigung: g.aufstaenderung.winkel, anteil: 0.5 },
  ];
}

/** Nächste freie Rasterzelle zu einem Punkt — für „ins Raster zurück". */
export function naechsteZelle(
  g: Modulgruppe,
  f: Dachflaeche,
  ziel: Meter,
): { reihe: number; spalte: number } | null {
  let beste: { reihe: number; spalte: number; d: number } | null = null;
  for (let r = 0; r < g.reihen; r++) {
    for (let c = 0; c < g.spalten; c++) {
      if (g.frei[zelle(r, c)]) continue;
      const p = rasterMitte(g, f, r, c);
      const d = Math.hypot(p.x - ziel.x, p.y - ziel.y);
      if (!beste || d < beste.d) beste = { reihe: r, spalte: c, d };
    }
  }
  return beste ? { reihe: beste.reihe, spalte: beste.spalte } : null;
}

/**
 * Punkt aufs Raster fangen: liegt er nahe genug an einer Zellmitte,
 * rastet er ein (Briefing 4.2, freies Ziehen mit Snapping).
 */
export function fangeAufRaster(
  g: Modulgruppe,
  f: Dachflaeche,
  ziel: Meter,
  toleranz: number,
): Meter {
  const z = naechsteZelle(g, f, ziel);
  if (!z) return ziel;
  const p = rasterMitte(g, f, z.reihe, z.spalte);
  return Math.hypot(p.x - ziel.x, p.y - ziel.y) <= toleranz ? p : ziel;
}

/** Wie viel der belegbaren Fläche tatsächlich Modul ist. */
export function belegungsgrad(gruppen: Modulgruppe[], f: Dachflaeche): number {
  const eigen = gruppen.filter((g) => g.flaeche === f.id);
  const modulflaechen = eigen.reduce((s, g) => s + anzahlModule(g) * modulflaeche(g), 0);
  const dach = f.punkte.length >= 3 ? flaecheGeneigt(f) : 0;
  return dach > 0 ? modulflaechen / dach : 0;
}

function flaecheGeneigt(f: Dachflaeche): number {
  const w = (f.neigung * Math.PI) / 180;
  let s = 0;
  for (let i = 0; i < f.punkte.length; i++) {
    const a = f.punkte[i]!;
    const b = f.punkte[(i + 1) % f.punkte.length]!;
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s / 2) / Math.cos(w);
}

/** Punkt auf dem Modulrand — für Trefferprüfung beim Ziehen. */
export function naechsterRandpunkt(p: Meter, ecken: Meter[]): Meter {
  let beste = ecken[0]!;
  let d = Infinity;
  for (let i = 0; i < ecken.length; i++) {
    const q = naechsterAufStrecke(p, ecken[i]!, ecken[(i + 1) % ecken.length]!);
    const dd = Math.hypot(q.x - p.x, q.y - p.y);
    if (dd < d) {
      d = dd;
      beste = q;
    }
  }
  return beste;
}

/*
 * ── Gruppe umformen ────────────────────────────────────────────────
 */

export type Richtung = "oben" | "unten" | "links" | "rechts";

/**
 * Gruppe an einer Kante erweitern oder verkleinern (Briefing 4.1).
 *
 * Nach oben und rechts wächst das Raster einfach weiter. Nach unten und
 * links muss der Anker mitwandern UND alle Zellnummern verschieben sich
 * — sonst zeigen abgeschaltete und frei gesetzte Module plötzlich auf
 * andere Plätze. Genau daran scheitert so etwas sonst still.
 */
export function erweitere(
  g: Modulgruppe,
  f: Dachflaeche,
  richtung: Richtung,
  anzahl = 1,
): Modulgruppe {
  if (anzahl === 0) return g;
  const a = achsen(g, f);
  const m = planMasse(g, f);
  const schrittQuer = m.quer + g.spaltenabstand;
  const schrittLaengs = m.laengs + g.reihenabstand;

  const laengsRichtung = richtung === "oben" || richtung === "unten";
  const neueZahl = Math.max(
    0,
    (laengsRichtung ? g.reihen : g.spalten) + anzahl,
  );
  if (neueZahl === 0) return g;

  // Wächst die Gruppe nach unten oder links, verschiebt sich der Nullpunkt.
  const verschiebt = richtung === "unten" || richtung === "links";
  const versatz = verschiebt ? anzahl : 0;

  let anker = g.anker;
  if (verschiebt) {
    const achse = laengsRichtung ? a.laengs : a.quer;
    const schritt = laengsRichtung ? schrittLaengs : schrittQuer;
    anker = { x: g.anker.x - achse.x * schritt * anzahl, y: g.anker.y - achse.y * schritt * anzahl };
  }

  const verschiebeSchluessel = (s: string): string | null => {
    const [r, c] = s.split(":").map(Number) as [number, number];
    const neuR = laengsRichtung ? r + versatz : r;
    const neuC = laengsRichtung ? c : c + versatz;
    const grenzeR = laengsRichtung ? neueZahl : g.reihen;
    const grenzeC = laengsRichtung ? g.spalten : neueZahl;
    if (neuR < 0 || neuC < 0 || neuR >= grenzeR || neuC >= grenzeC) return null;
    return zelle(neuR, neuC);
  };

  const aus = g.aus.map(verschiebeSchluessel).filter((s): s is string => s !== null);
  /*
   * Die weggetippten Zellen wandern mit: Beim Anbauen einer Reihe oben
   * verschieben sich alle Nummern um eins. Bliebe die Liste stehen,
   * verschöbe sich die Lücke im Feld um eine Reihe.
   */
  const entfernt = (g.entfernt ?? [])
    .map(verschiebeSchluessel)
    .filter((s): s is string => s !== null);
  const frei: Record<string, Meter> = {};
  for (const [s, p] of Object.entries(g.frei)) {
    const neu = verschiebeSchluessel(s);
    if (neu) frei[neu] = p;
  }

  return {
    ...g,
    anker,
    reihen: laengsRichtung ? neueZahl : g.reihen,
    spalten: laengsRichtung ? g.spalten : neueZahl,
    aus,
    entfernt,
    frei,
  };
}

/**
 * Einen Teil der Gruppe abtrennen (Briefing 4.1, „Gruppe teilen").
 *
 * Aus dem Auswahlrechteck wird der umschliessende Zellblock genommen —
 * ein Raster lässt sich nicht in Zickzack teilen. Die neue Gruppe erbt
 * alle Raster-Einstellungen; in der alten werden die abgegebenen Zellen
 * abgeschaltet, nicht gelöscht, damit der Vorgang umkehrbar bleibt.
 */
export function teileGruppe(
  g: Modulgruppe,
  f: Dachflaeche,
  zellen: Array<{ reihe: number; spalte: number }>,
  neueId: string,
  neuerName: string,
): { alt: Modulgruppe; neu: Modulgruppe } | null {
  if (zellen.length === 0) return null;
  const r0 = Math.min(...zellen.map((z) => z.reihe));
  const r1 = Math.max(...zellen.map((z) => z.reihe));
  const c0 = Math.min(...zellen.map((z) => z.spalte));
  const c1 = Math.max(...zellen.map((z) => z.spalte));

  // Die ganze Gruppe zu „teilen" ergibt keine zwei Gruppen.
  if (r0 === 0 && c0 === 0 && r1 === g.reihen - 1 && c1 === g.spalten - 1) return null;

  const a = achsen(g, f);
  const m = planMasse(g, f);
  const anker: Meter = {
    x:
      g.anker.x +
      a.quer.x * c0 * (m.quer + g.spaltenabstand) +
      a.laengs.x * r0 * (m.laengs + g.reihenabstand),
    y:
      g.anker.y +
      a.quer.y * c0 * (m.quer + g.spaltenabstand) +
      a.laengs.y * r0 * (m.laengs + g.reihenabstand),
  };

  const altAus = new Set(g.aus);
  const altEntfernt = new Set(g.entfernt ?? []);
  const neuAus: string[] = [];
  const neuEntfernt: string[] = [];
  const neuFrei: Record<string, Meter> = {};
  const abgegeben: string[] = [];

  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const alt = zelle(r, c);
      const neu = zelle(r - r0, c - c0);
      abgegeben.push(alt);
      if (altAus.has(alt)) neuAus.push(neu);
      if (altEntfernt.has(alt)) neuEntfernt.push(neu);
      const frei = g.frei[alt];
      if (frei) neuFrei[neu] = frei;
    }
  }

  return {
    alt: {
      ...g,
      /*
       * Was die neue Gruppe übernimmt, ist für die alte weg — das ist
       * kein Platzproblem, sondern eine Entscheidung, gehört also in
       * `entfernt`. In `aus` würde `nachfuehren` es zurückholen, und
       * beide Gruppen zeigten dieselben Module.
       */
      entfernt: [...new Set([...(g.entfernt ?? []), ...abgegeben])],
      frei: Object.fromEntries(Object.entries(g.frei).filter(([s]) => !abgegeben.includes(s))),
    },
    neu: {
      ...g,
      id: neueId,
      name: neuerName,
      anker,
      reihen: r1 - r0 + 1,
      spalten: c1 - c0 + 1,
      aus: neuAus,
      frei: neuFrei,
    },
  };
}

/** Modul aus dem Raster lösen und frei setzen (Briefing 4.2). */
export function setzeFrei(g: Modulgruppe, reihe: number, spalte: number, pos: Meter): Modulgruppe {
  return { ...g, frei: { ...g.frei, [zelle(reihe, spalte)]: pos } };
}

/** Zurück ins Raster — auf den eigenen Platz, wenn er frei ist. */
export function insRasterZurueck(g: Modulgruppe, reihe: number, spalte: number): Modulgruppe {
  const frei = { ...g.frei };
  delete frei[zelle(reihe, spalte)];
  return { ...g, frei };
}

/*
 * ── Modulweise anbauen ─────────────────────────────────────────────
 *
 * Statt ganze Reihen zu erweitern: an eine bestehende Belegung EIN
 * Modul anfügen, dort wo Platz ist. Das ist die Bedienung, die man
 * beim Kunden braucht — ein Dach ist selten ein sauberes Rechteck, und
 * die letzte Reihe passt fast nie ganz.
 *
 * Die Anbaustellen sind die freien Nachbarplätze aktiver Module. Ein
 * Platz wird nur angeboten, wenn dort wirklich ein Modul liegen kann:
 * innerhalb der Fläche, mit Randabstand, ohne Hindernis und ohne
 * Kollision mit einer anderen Gruppe. Wer ein Modul entfernt, bekommt
 * an dieser Stelle wieder eine Anbaustelle — dieselbe Prüfung, kein
 * Sonderfall.
 */

export interface Anbaustelle {
  /** Rasterkoordinate; darf ausserhalb des heutigen Rasters liegen. */
  reihe: number;
  spalte: number;
}

/** Die vier Nachbarn einer Zelle. */
const NACHBARN = [
  { dr: 1, dc: 0 },
  { dr: -1, dc: 0 },
  { dr: 0, dc: 1 },
  { dr: 0, dc: -1 },
] as const;

/**
 * Rasterposition eines Moduls, auch ausserhalb des heutigen Rasters.
 *
 * `modulEcken` rechnet mit Indizes ab dem Anker; negative Werte sind
 * dabei kein Sonderfall, sondern liegen einfach vor dem Anker. Genau
 * das macht die Prüfung möglich, BEVOR das Raster wächst.
 */
function eckenAn(g: Modulgruppe, f: Dachflaeche, reihe: number, spalte: number): Meter[] {
  return modulEcken(g, f, reihe, spalte);
}

/**
 * Wo lässt sich ein Modul anbauen?
 *
 * `besetzt` sind die Modulflächen der anderen Gruppen — ohne sie würden
 * sich zwei Belegungen überlappen.
 */
export function anbaustellen(
  g: Modulgruppe,
  f: Dachflaeche,
  besetzt: Meter[][] = [],
): Anbaustelle[] {
  const aktiv = aktiveZellen(g);
  if (aktiv.length === 0) return [];

  const belegt = new Set(aktiv.map((z) => zelle(z.reihe, z.spalte)));
  const gesehen = new Set<string>();
  const stellen: Anbaustelle[] = [];

  for (const z of aktiv) {
    for (const n of NACHBARN) {
      const reihe = z.reihe + n.dr;
      const spalte = z.spalte + n.dc;
      const s = zelle(reihe, spalte);
      if (belegt.has(s) || gesehen.has(s)) continue;
      gesehen.add(s);

      const ecken = eckenAn(g, f, reihe, spalte);
      if (!modulPasst(ecken, f) || stoesstAn(ecken, besetzt)) continue;
      stellen.push({ reihe, spalte });
    }
  }

  return stellen;
}

/**
 * Ein einzelnes Modul an einer Anbaustelle setzen.
 *
 * Liegt die Stelle ausserhalb des Rasters, wächst das Raster um genau
 * eine Reihe oder Spalte — und alle dabei entstehenden Nachbarzellen
 * werden abgeschaltet. Ohne das käme mit einem Klick eine ganze Reihe
 * dazu, und über der Dachkante hingen Module, die niemand bestellt hat.
 */
export function modulAnbauen(
  g: Modulgruppe,
  f: Dachflaeche,
  stelle: Anbaustelle,
): Modulgruppe {
  let neu = g;
  let { reihe, spalte } = stelle;

  if (reihe < 0) {
    neu = erweitere(neu, f, "unten", 1);
    reihe = 0;
  } else if (reihe >= g.reihen) {
    neu = erweitere(neu, f, "oben", 1);
    reihe = g.reihen;
  }

  if (spalte < 0) {
    neu = erweitere(neu, f, "links", 1);
    spalte = 0;
  } else if (spalte >= g.spalten) {
    neu = erweitere(neu, f, "rechts", 1);
    spalte = g.spalten;
  }

  /*
   * Alles, was durch das Wachsen neu hinzukam, wird abgeschaltet —
   * ausser der einen gewünschten Zelle. `erweitere` fügt eine ganze
   * Reihe an; hier soll genau ein Modul entstehen.
   */
  const vorher = new Set(aktiveZellen(g).map((z) => zelle(z.reihe, z.spalte)));
  const versatzR = neu.reihen > g.reihen && stelle.reihe < 0 ? 1 : 0;
  const versatzC = neu.spalten > g.spalten && stelle.spalte < 0 ? 1 : 0;
  const vorherVerschoben = new Set(
    [...vorher].map((s) => {
      const [r, c] = s.split(":").map(Number) as [number, number];
      return zelle(r + versatzR, c + versatzC);
    }),
  );

  const aus: string[] = [];
  for (let r = 0; r < neu.reihen; r++) {
    for (let c = 0; c < neu.spalten; c++) {
      const s = zelle(r, c);
      if (r === reihe && c === spalte) continue;
      if (!vorherVerschoben.has(s)) aus.push(s);
    }
  }

  /*
   * Die Zielzelle wird auch aus `entfernt` genommen: Wer dort ein Modul
   * anbaut, will es dort haben — auch wenn er es vorher weggetippt hat.
   * Ohne das blieb die Lücke bestehen, das Pluszeichen verschwand, und
   * es sah aus, als hätte der Klick nichts bewirkt.
   */
  const ziel = zelle(reihe, spalte);
  return { ...neu, aus, entfernt: (neu.entfernt ?? []).filter((s) => s !== ziel) };
}
