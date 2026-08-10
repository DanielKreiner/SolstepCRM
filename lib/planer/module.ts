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
  /** Abgeschaltete Zellen, als "reihe:spalte". */
  aus: string[];
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

export function aktiveZellen(g: Modulgruppe): Array<{ reihe: number; spalte: number }> {
  const aus = new Set(g.aus);
  const raus: Array<{ reihe: number; spalte: number }> = [];
  for (let r = 0; r < g.reihen; r++) {
    for (let c = 0; c < g.spalten; c++) {
      if (!aus.has(zelle(r, c))) raus.push({ reihe: r, spalte: c });
    }
  }
  return raus;
}

export function anzahlModule(g: Modulgruppe): number {
  return g.reihen * g.spalten - g.aus.length;
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
