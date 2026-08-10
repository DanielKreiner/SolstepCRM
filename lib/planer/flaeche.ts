/*
 * Polygongeometrie für Dachflächen und Hindernisse.
 *
 * Alles in Metern im lokalen System aus geo.ts: x nach Osten, y nach
 * Norden. Keine Funktion hier weiss etwas von Pixeln oder Zoomstufen.
 *
 * Eine Dachfläche ist ein beliebiges einfaches Polygon — konvex oder
 * konkav, drei bis beliebig viele Punkte. Damit ist jede Dachform
 * abbildbar (Briefing 3.1); es gibt keinen Sonderfall „Walmdach", nur
 * mehrere Flächen.
 */

import type { Meter } from "./geo";

export interface Hindernis {
  id: string;
  art: "rechteck" | "polygon";
  /** Bezeichnung, z. B. „Kamin" — frei. */
  name: string;
  punkte: Meter[];
  /** Sperrsaum ringsum in Metern. */
  abstand: number;
}

export interface Dachflaeche {
  id: string;
  name: string;
  punkte: Meter[];
  /** 0–75°. 0 = Flachdach. */
  neigung: number;
  /** 0–359°, 180 = Süd. */
  azimut: number;
  /**
   * Index der Kante, die Traufe ist (Kante i geht von Punkt i zu i+1).
   * Sie legt die Falllinie fest. Beim Flachdach null.
   */
  traufe: number | null;
  /** Randabstand in Metern; definiert die belegbare Innenfläche. */
  randabstand: number;
  hindernisse: Hindernis[];
}

/*
 * ── Grundgrössen ───────────────────────────────────────────────────
 */

/**
 * Vorzeichenbehaftete Fläche (Gauss'sche Trapezformel). Positiv bei
 * Umlauf gegen den Uhrzeigersinn — im lokalen System, in dem y nach
 * Norden zeigt.
 */
export function flaecheMitVorzeichen(punkte: Meter[]): number {
  let s = 0;
  for (let i = 0; i < punkte.length; i++) {
    const a = punkte[i]!;
    const b = punkte[(i + 1) % punkte.length]!;
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

/**
 * Grundfläche in der Draufsicht. Das ist NICHT die Dachfläche: ein
 * geneigtes Dach ist um 1/cos(Neigung) grösser als sein Schatten.
 * Siehe `dachflaeche`.
 */
export function grundflaeche(punkte: Meter[]): number {
  return Math.abs(flaecheMitVorzeichen(punkte));
}

/**
 * Wahre Fläche des geneigten Dachs. Gezeichnet wird in der Draufsicht,
 * gerechnet wird mit der wahren Fläche — sonst fehlen bei 45° rund 29 %.
 */
export function dachflaeche(punkte: Meter[], neigungGrad: number): number {
  return grundflaeche(punkte) / Math.cos((neigungGrad * Math.PI) / 180);
}

export function umlaufGegenUhrzeiger(punkte: Meter[]): boolean {
  return flaecheMitVorzeichen(punkte) > 0;
}

export function schwerpunkt(punkte: Meter[]): Meter {
  const a = flaecheMitVorzeichen(punkte);
  // Entartetes Polygon (Fläche 0): Mittel der Ecken statt Division durch 0.
  if (Math.abs(a) < 1e-12) {
    return {
      x: punkte.reduce((s, p) => s + p.x, 0) / punkte.length,
      y: punkte.reduce((s, p) => s + p.y, 0) / punkte.length,
    };
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < punkte.length; i++) {
    const p = punkte[i]!;
    const q = punkte[(i + 1) % punkte.length]!;
    const kreuz = p.x * q.y - q.x * p.y;
    cx += (p.x + q.x) * kreuz;
    cy += (p.y + q.y) * kreuz;
  }
  return { x: cx / (6 * a), y: cy / (6 * a) };
}

export function umfang(punkte: Meter[]): number {
  let s = 0;
  for (let i = 0; i < punkte.length; i++) {
    s += laenge(punkte[i]!, punkte[(i + 1) % punkte.length]!);
  }
  return s;
}

export function laenge(a: Meter, b: Meter): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Kanten als Indexpaare — Kante i geht von Punkt i zu Punkt i+1. */
export function kanten(punkte: Meter[]): Array<{ i: number; a: Meter; b: Meter }> {
  return punkte.map((a, i) => ({ i, a, b: punkte[(i + 1) % punkte.length]! }));
}

/*
 * ── Lage von Punkten ───────────────────────────────────────────────
 */

/**
 * Strahlenverfahren: eine Halbgerade nach Osten, Anzahl der
 * Kantendurchstösse. Ungerade = innen. Funktioniert auch bei konkaven
 * Polygonen — der Grund, warum L- und U-Häuser keinen Sonderfall
 * brauchen.
 */
export function punktInPolygon(p: Meter, punkte: Meter[]): boolean {
  let drin = false;
  for (let i = 0, j = punkte.length - 1; i < punkte.length; j = i++) {
    const a = punkte[i]!;
    const b = punkte[j]!;
    const schneidet = a.y > p.y !== b.y > p.y;
    if (!schneidet) continue;
    const x = ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x;
    if (p.x < x) drin = !drin;
  }
  return drin;
}

/** Nächstgelegener Punkt auf der Strecke a–b (nicht auf der Geraden). */
export function naechsterAufStrecke(p: Meter, a: Meter, b: Meter): Meter {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const quadrat = dx * dx + dy * dy;
  if (quadrat < 1e-12) return a;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / quadrat));
  return { x: a.x + t * dx, y: a.y + t * dy };
}

export function abstandZuKante(p: Meter, a: Meter, b: Meter): number {
  return laenge(p, naechsterAufStrecke(p, a, b));
}

/** Kürzester Abstand zum Rand — unabhängig davon, ob innen oder aussen. */
export function abstandZumRand(p: Meter, punkte: Meter[]): number {
  return Math.min(...kanten(punkte).map((k) => abstandZuKante(p, k.a, k.b)));
}

/**
 * Liegt der Punkt in der belegbaren Innenfläche?
 *
 * Bewusst als Prüfung statt über ein berechnetes Versatz-Polygon: „innen
 * UND mindestens d vom Rand entfernt" IST die Erosion des Polygons um d,
 * exakt und auch bei konkaven Formen. Ein echter Polygon-Offset müsste
 * dagegen Selbstüberschneidungen auflösen — viel Aufwand für ein
 * Ergebnis, das hier niemand braucht.
 */
export function imInnenbereich(p: Meter, flaeche: Dachflaeche): boolean {
  if (!punktInPolygon(p, flaeche.punkte)) return false;
  if (abstandZumRand(p, flaeche.punkte) < flaeche.randabstand) return false;
  for (const h of flaeche.hindernisse) {
    if (punktInPolygon(p, h.punkte)) return false;
    if (abstandZumRand(p, h.punkte) < h.abstand) return false;
  }
  return true;
}

/*
 * ── Gültigkeit ─────────────────────────────────────────────────────
 */

function strecken(
  a: Meter,
  b: Meter,
  c: Meter,
  d: Meter,
): boolean {
  const richtung = (p: Meter, q: Meter, r: Meter) =>
    (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = richtung(c, d, a);
  const d2 = richtung(c, d, b);
  const d3 = richtung(a, b, c);
  const d4 = richtung(a, b, d);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}

/**
 * Überschneidet sich der Umriss selbst? Eine Acht ist kein Dach — und
 * jede Flächen- und Belegungsrechnung liefert dafür Unsinn, ohne zu
 * murren. Deshalb wird beim Zeichnen geprüft, nicht hinterher.
 */
export function schneidetSichSelbst(punkte: Meter[]): boolean {
  const n = punkte.length;
  if (n < 4) return false;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      // Benachbarte Kanten teilen sich einen Punkt — das ist kein Schnitt.
      if (j === i || (i === 0 && j === n - 1) || j === i + 1) continue;
      if (strecken(punkte[i]!, punkte[(i + 1) % n]!, punkte[j]!, punkte[(j + 1) % n]!)) {
        return true;
      }
    }
  }
  return false;
}

/*
 * ── Bearbeiten ─────────────────────────────────────────────────────
 */

/**
 * Kante auf ein exaktes Mass setzen (Briefing 3.2, Maßeingabe).
 *
 * Der ZWEITE Punkt der Kante wandert, der erste bleibt liegen — sonst
 * verschöbe sich beim Tippen einer Länge die ganze Fläche. Für „ich
 * weiss, das Dach ist 12,40 m" ist das wichtiger als ein perfektes
 * Luftbild.
 */
export function setzeKantenlaenge(punkte: Meter[], kante: number, meter: number): Meter[] {
  const n = punkte.length;
  const a = punkte[kante % n]!;
  const b = punkte[(kante + 1) % n]!;
  const l = laenge(a, b);
  if (l < 1e-9 || meter <= 0) return punkte;
  const f = meter / l;
  const neu = punkte.slice();
  neu[(kante + 1) % n] = { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
  return neu;
}

/** Punkt auf einer Kante einfügen (Doppeltipp auf die Kante). */
export function punktEinfuegen(punkte: Meter[], kante: number, bei: Meter): Meter[] {
  const neu = punkte.slice();
  neu.splice(kante + 1, 0, bei);
  return neu;
}

/** Kante parallel verschieben: beide Endpunkte wandern gleich weit. */
export function kanteVerschieben(punkte: Meter[], kante: number, um: Meter): Meter[] {
  const n = punkte.length;
  const neu = punkte.slice();
  for (const i of [kante % n, (kante + 1) % n]) {
    neu[i] = { x: punkte[i]!.x + um.x, y: punkte[i]!.y + um.y };
  }
  return neu;
}

/*
 * ── Fangen ─────────────────────────────────────────────────────────
 *
 * Drei Hilfen beim Zeichnen (Briefing 3.2), einzeln abschaltbar:
 * rechte Winkel, Parallelität zu bestehenden Kanten, Raster.
 */

export interface FangOptionen {
  rechterWinkel: boolean;
  parallel: boolean;
  raster: boolean;
  /** Rastermass in Metern. */
  rasterMass: number;
  /** Toleranz für Winkel in Grad. */
  toleranz: number;
}

export const FANG_STANDARD: FangOptionen = {
  rechterWinkel: true,
  parallel: true,
  raster: true,
  rasterMass: 0.05,
  toleranz: 4,
};

function richtungGrad(von: Meter, nach: Meter): number {
  return (Math.atan2(nach.y - von.y, nach.x - von.x) * 180) / Math.PI;
}

function aufRichtung(von: Meter, ziel: Meter, grad: number): Meter {
  const l = laenge(von, ziel);
  const r = (grad * Math.PI) / 180;
  return { x: von.x + Math.cos(r) * l, y: von.y + Math.sin(r) * l };
}

/** Differenz zweier Winkel, immer in (−180, 180]. */
export function winkelDifferenz(a: number, b: number): number {
  let d = ((a - b + 180) % 360) - 180;
  if (d <= -180) d += 360;
  return d;
}

/**
 * Zieht den freien Punkt auf die nächste Hilfe. Reihenfolge zählt:
 * Winkelhilfen zuerst, Raster zuletzt — sonst zerlegt das Raster den
 * gerade eingerasteten rechten Winkel wieder.
 */
export function fange(
  ziel: Meter,
  vorheriger: Meter | null,
  bestehendeKanten: Array<{ a: Meter; b: Meter }>,
  opt: FangOptionen = FANG_STANDARD,
): { punkt: Meter; hinweis: "rechter-winkel" | "parallel" | "raster" | null } {
  let p = ziel;
  let hinweis: "rechter-winkel" | "parallel" | "raster" | null = null;

  if (vorheriger && laenge(vorheriger, ziel) > 1e-6) {
    const richtung = richtungGrad(vorheriger, ziel);

    if (opt.rechterWinkel) {
      for (const achse of [0, 90, 180, -90]) {
        if (Math.abs(winkelDifferenz(richtung, achse)) <= opt.toleranz) {
          p = aufRichtung(vorheriger, ziel, achse);
          hinweis = "rechter-winkel";
          break;
        }
      }
    }

    if (!hinweis && opt.parallel) {
      for (const k of bestehendeKanten) {
        const kr = richtungGrad(k.a, k.b);
        for (const kandidat of [kr, kr + 180]) {
          if (Math.abs(winkelDifferenz(richtung, kandidat)) <= opt.toleranz) {
            p = aufRichtung(vorheriger, ziel, kandidat);
            hinweis = "parallel";
            break;
          }
        }
        if (hinweis) break;
      }
    }
  }

  if (opt.raster && !hinweis) {
    const r = opt.rasterMass;
    p = { x: Math.round(p.x / r) * r, y: Math.round(p.y / r) * r };
    hinweis = "raster";
  }

  return { punkt: p, hinweis };
}

/*
 * ── Falllinie und Azimut ───────────────────────────────────────────
 */

/**
 * Richtung bergab, senkrecht zur Traufkante.
 *
 * Die Traufe ist die untere Kante. Bergab zeigt also von der Fläche WEG
 * — über die Traufe hinaus. Als Referenz dient der Schwerpunkt: die
 * Normale, die von ihm wegzeigt, ist die richtige.
 */
export function falllinie(flaeche: Dachflaeche): Meter | null {
  if (flaeche.traufe === null || flaeche.punkte.length < 3) return null;
  const n = flaeche.punkte.length;
  const a = flaeche.punkte[flaeche.traufe % n]!;
  const b = flaeche.punkte[(flaeche.traufe + 1) % n]!;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l = Math.hypot(dx, dy);
  if (l < 1e-9) return null;

  const normale = { x: dy / l, y: -dx / l };
  const mitte = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const s = schwerpunkt(flaeche.punkte);
  const zumSchwerpunkt = { x: s.x - mitte.x, y: s.y - mitte.y };
  const zeigtHin = normale.x * zumSchwerpunkt.x + normale.y * zumSchwerpunkt.y > 0;
  return zeigtHin ? { x: -normale.x, y: -normale.y } : normale;
}

/**
 * Kompassrichtung eines Vektors: 0 = Nord, 90 = Ost, 180 = Süd.
 * Achtung, das ist nicht atan2(y, x) — dort läge 0 im Osten.
 */
export function azimutVon(richtung: Meter): number {
  const grad = (Math.atan2(richtung.x, richtung.y) * 180) / Math.PI;
  return (grad + 360) % 360;
}

/** Azimut aus der Traufkante — Vorbelegung, vom Nutzer übersteuerbar. */
export function azimutAusTraufe(flaeche: Dachflaeche): number | null {
  const f = falllinie(flaeche);
  return f ? Math.round(azimutVon(f)) : null;
}

/**
 * Versatz der Umrisslinie, nur zum ZEICHNEN.
 *
 * Positives d rückt nach innen (Randabstand einer Dachfläche), negatives
 * nach aussen (Sperrsaum um ein Hindernis) — beim Hindernis liegt die
 * Sperrzone ja rings HERUM, nicht darin.
 *
 * Gehrungsversatz je Ecke, ohne Auflösen von Selbstüberschneidungen.
 * Bei spitzen Innenecken und grossem Abstand kann die Linie sich
 * überschlagen — sichtbar, aber folgenlos: geprüft wird ausschliesslich
 * mit `imInnenbereich`, nie gegen dieses Polygon.
 */
export function versatzNachInnen(punkte: Meter[], d: number): Meter[] {
  if (d === 0 || punkte.length < 3) return punkte;
  const n = punkte.length;
  const vorzeichen = umlaufGegenUhrzeiger(punkte) ? 1 : -1;

  return punkte.map((p, i) => {
    const vor = punkte[(i - 1 + n) % n]!;
    const nach = punkte[(i + 1) % n]!;
    const n1 = normaleInnen(vor, p, vorzeichen);
    const n2 = normaleInnen(p, nach, vorzeichen);
    const summe = { x: n1.x + n2.x, y: n1.y + n2.y };
    const l = Math.hypot(summe.x, summe.y);
    if (l < 1e-9) return p;
    // Gehrungslänge: d / cos(halber Winkel) — über das Skalarprodukt.
    const kosinus = Math.max(0.2, (n1.x * summe.x + n1.y * summe.y) / l);
    const f = d / kosinus;
    return { x: p.x + (summe.x / l) * f, y: p.y + (summe.y / l) * f };
  });
}

function normaleInnen(a: Meter, b: Meter, vorzeichen: number): Meter {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l = Math.hypot(dx, dy) || 1;
  return { x: (-dy / l) * vorzeichen, y: (dx / l) * vorzeichen };
}

/*
 * ── Draufsicht-Verkürzung ──────────────────────────────────────────
 */

/**
 * Ein Mass in Falllinienrichtung erscheint in der Draufsicht verkürzt:
 * 1,762 m Modulhöhe auf 45° sind von oben 1,246 m (Abnahmetest 5).
 * Die Kante parallel zur Traufe bleibt unverkürzt.
 *
 * Das ist REINE DARSTELLUNG. Flächen, Stückzahlen und Strings rechnen
 * immer mit den wahren Massen — die häufigste Fehlerquelle in solchen
 * Werkzeugen (Briefing 1.2).
 */
export function verkuerzt(masz: number, neigungGrad: number): number {
  return masz * Math.cos((neigungGrad * Math.PI) / 180);
}
