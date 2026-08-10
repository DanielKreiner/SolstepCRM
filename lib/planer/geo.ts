/*
 * Geometrische Grundlage des Planers.
 *
 * Die Kernentscheidung aus dem Briefing (Abschnitt 1.1): gerechnet wird in
 * METERN, nie in Pixeln. Jedes Projekt spannt beim Anlegen ein lokales
 * metrisches System um seinen Mittelpunkt auf. Dachflächen, Hindernisse,
 * Module — alles liegt als Meter-Koordinate relativ zu diesem Ursprung.
 * Pixel entstehen ausschliesslich beim Rendern.
 *
 * Warum das wichtig ist: Kartenanbieter wechseln, zoomen, das Fenster
 * anders gross ziehen — nichts davon darf je eine gespeicherte Geometrie
 * verändern. Läge die Geometrie in Pixeln, würde ein Zoomwechsel das Dach
 * umbauen.
 *
 * Zwei Systeme, die nicht verwechselt werden dürfen:
 *
 *   Meter   x nach Osten, y nach NORDEN  — so speichern wir
 *   Bildpunkt  x nach rechts, y nach UNTEN — so zeichnet der Bildschirm
 *
 * Die Umrechnung dreht y um. Das ist die häufigste Fehlerquelle bei
 * solchen Systemen, deshalb steht sie an genau einer Stelle.
 */

/** Äquatorradius WGS84 in Metern — der Wert, mit dem Web Mercator definiert ist. */
export const ERDRADIUS = 6378137;

/** Kantenlänge einer Kachel in Bildpunkten. Alle vier Anbieter liefern 256er. */
export const KACHEL = 256;

/**
 * Umfang der Erde am Äquator geteilt durch die Kachelgrösse: Meter pro
 * Bildpunkt auf Zoomstufe 0 am Äquator.
 */
export const METER_PRO_PIXEL_Z0 = (2 * Math.PI * ERDRADIUS) / KACHEL;

const GRAD = Math.PI / 180;

export interface LatLon {
  lat: number;
  lon: number;
}

/** Punkt im lokalen Metersystem: x nach Osten, y nach Norden. */
export interface Meter {
  x: number;
  y: number;
}

/** Punkt in Bildpunkten: x nach rechts, y nach unten. */
export interface Bildpunkt {
  x: number;
  y: number;
}

/*
 * ── Web Mercator ───────────────────────────────────────────────────
 *
 * Weltkoordinaten in Bildpunkten auf einer gegebenen Zoomstufe. Die
 * Kachel (x, y) auf Stufe z deckt den Bereich [x·256, (x+1)·256) ab —
 * damit lassen sich Kacheln und Geometrie im selben Raum platzieren.
 */

export function weltPixel(ort: LatLon, zoom: number): Bildpunkt {
  const groesse = KACHEL * Math.pow(2, zoom);
  const s = Math.sin(klemmeLat(ort.lat) * GRAD);
  return {
    x: groesse * (ort.lon / 360 + 0.5),
    // ln((1+s)/(1-s))/2 ist artanh(s) — die Mercator-Formel ohne tan/sec,
    // numerisch stabiler nahe den Polen.
    y: groesse * (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)),
  };
}

export function weltPixelZurueck(p: Bildpunkt, zoom: number): LatLon {
  const groesse = KACHEL * Math.pow(2, zoom);
  const lon = (p.x / groesse - 0.5) * 360;
  const n = Math.PI * (1 - (2 * p.y) / groesse);
  return { lat: Math.atan(Math.sinh(n)) / GRAD, lon };
}

/**
 * Mercator bildet die Pole ins Unendliche ab. Die übliche Grenze von
 * 85,051129° macht die Welt quadratisch — genau das erwarten die
 * Kachelserver.
 */
export function klemmeLat(lat: number): number {
  return Math.max(-85.05112878, Math.min(85.05112878, lat));
}

/**
 * Meter pro Bildpunkt. Hängt an der Breite, weil Mercator nach Norden
 * streckt: dieselbe Kachel deckt in Wien weniger Meter ab als in Kairo.
 */
export function meterProPixel(lat: number, zoom: number): number {
  return (METER_PRO_PIXEL_Z0 * Math.cos(klemmeLat(lat) * GRAD)) / Math.pow(2, zoom);
}

/** Umkehrung: welche Zoomstufe liefert diese Auflösung? */
export function zoomFuerAufloesung(lat: number, meterProPunkt: number): number {
  return Math.log2((METER_PRO_PIXEL_Z0 * Math.cos(klemmeLat(lat) * GRAD)) / meterProPunkt);
}

/*
 * ── Lokales Metersystem ────────────────────────────────────────────
 *
 * Tangentialebene im Projektursprung. Über die Ausdehnung eines
 * Grundstücks ist der Fehler dieser Näherung vernachlässigbar: bei
 * 500 m Abstand vom Ursprung liegt er im Millimeterbereich, also weit
 * unter der Genauigkeit, mit der jemand eine Dachkante im Luftbild
 * abfährt.
 *
 * Bewusst NICHT über Mercator-Weltpixel gerechnet: dort steckt der
 * Streckungsfaktor 1/cos(lat) drin, eine Strecke in Nord-Süd-Richtung
 * käme zu lang heraus. Genau dieser Fehler macht sonst aus einem
 * 10-Meter-Dach ein 14-Meter-Dach.
 */

export function zuMeter(ursprung: LatLon, ort: LatLon): Meter {
  return {
    x: (ort.lon - ursprung.lon) * GRAD * ERDRADIUS * Math.cos(ursprung.lat * GRAD),
    y: (ort.lat - ursprung.lat) * GRAD * ERDRADIUS,
  };
}

export function zuLatLon(ursprung: LatLon, m: Meter): LatLon {
  return {
    lat: ursprung.lat + m.y / (ERDRADIUS * GRAD),
    lon: ursprung.lon + m.x / (ERDRADIUS * GRAD * Math.cos(ursprung.lat * GRAD)),
  };
}

/** Abstand zweier Punkte im lokalen System. */
export function abstand(a: Meter, b: Meter): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/*
 * ── Kamera ─────────────────────────────────────────────────────────
 *
 * Was gerade zu sehen ist: Mittelpunkt, Zoomstufe (fliessend, nicht nur
 * ganzzahlig) und die Grösse der Zeichenfläche. Daraus folgt jede
 * Umrechnung zwischen Meter und Bildschirm.
 */

export interface Kamera {
  /** Projektursprung — Nullpunkt des Metersystems. */
  ursprung: LatLon;
  /** Bildmitte in Metern relativ zum Ursprung. */
  mitte: Meter;
  /** Fliessende Zoomstufe, z. B. 19,4. */
  zoom: number;
  breite: number;
  hoehe: number;
}

/**
 * Massstab: Bildpunkte je Meter. Ein einziger Faktor für beide Achsen —
 * das lokale System ist metrisch isotrop, anders als Mercator.
 */
export function punkteProMeter(k: Kamera): number {
  return 1 / meterProPixel(k.ursprung.lat, k.zoom);
}

export function meterZuBild(k: Kamera, m: Meter): Bildpunkt {
  const s = punkteProMeter(k);
  return {
    x: k.breite / 2 + (m.x - k.mitte.x) * s,
    // Hier kippt Norden auf „oben": Bildschirm-y wächst nach unten.
    y: k.hoehe / 2 - (m.y - k.mitte.y) * s,
  };
}

export function bildZuMeter(k: Kamera, p: Bildpunkt): Meter {
  const s = punkteProMeter(k);
  return {
    x: k.mitte.x + (p.x - k.breite / 2) / s,
    y: k.mitte.y - (p.y - k.hoehe / 2) / s,
  };
}

/** Zoomen an einer festen Stelle: der Punkt unter dem Finger bleibt liegen. */
export function zoomeAn(k: Kamera, p: Bildpunkt, neuerZoom: number, grenzen = ZOOM_GRENZEN): Kamera {
  const zoom = Math.max(grenzen.min, Math.min(grenzen.max, neuerZoom));
  const vorher = bildZuMeter(k, p);
  const zwischen: Kamera = { ...k, zoom };
  const nachher = bildZuMeter(zwischen, p);
  return {
    ...zwischen,
    mitte: { x: k.mitte.x + (vorher.x - nachher.x), y: k.mitte.y + (vorher.y - nachher.y) },
  };
}

/**
 * Zoom 18–21 laut Briefing. Fliessend dazwischen, damit Pinch nicht
 * ruckelt; die Kacheln kommen von der nächstgelegenen ganzen Stufe.
 */
export const ZOOM_GRENZEN = { min: 17, max: 22.5 } as const;

/*
 * ── Kachelabdeckung ────────────────────────────────────────────────
 */

export interface Kachel {
  z: number;
  x: number;
  y: number;
  /** Position der linken oberen Ecke auf dem Bildschirm. */
  links: number;
  oben: number;
  /** Kantenlänge auf dem Bildschirm — 256 nur bei ganzzahligem Zoom. */
  groesse: number;
}

/**
 * Welche Kacheln decken die Zeichenfläche ab?
 *
 * Die Bildstufe ist ganzzahlig (Kachelserver kennen nur ganze Stufen),
 * der Rest des Zooms wird über die Darstellungsgrösse ausgeglichen. Ohne
 * das würde jeder Pinch eine neue Kachelrunde auslösen.
 */
export function kachelnFuer(k: Kamera, maxStufe = 21): Kachel[] {
  const stufe = Math.min(maxStufe, Math.max(0, Math.round(k.zoom)));
  const faktor = Math.pow(2, k.zoom - stufe);
  const groesse = KACHEL * faktor;

  // Bildmitte in Weltpixeln der Bildstufe.
  const mitteWelt = weltPixel(zuLatLon(k.ursprung, k.mitte), stufe);
  const linksWelt = mitteWelt.x - k.breite / 2 / faktor;
  const obenWelt = mitteWelt.y - k.hoehe / 2 / faktor;

  const proAchse = Math.pow(2, stufe);
  const vonX = Math.floor(linksWelt / KACHEL);
  const vonY = Math.floor(obenWelt / KACHEL);
  const bisX = Math.floor((linksWelt + k.breite / faktor) / KACHEL);
  const bisY = Math.floor((obenWelt + k.hoehe / faktor) / KACHEL);

  const raus: Kachel[] = [];
  for (let y = vonY; y <= bisY; y++) {
    // Ausserhalb von Nord/Süd gibt es keine Kacheln — anders als in
    // Ost/West-Richtung, wo die Welt umläuft.
    if (y < 0 || y >= proAchse) continue;
    for (let x = vonX; x <= bisX; x++) {
      raus.push({
        z: stufe,
        x: ((x % proAchse) + proAchse) % proAchse,
        y,
        links: (x * KACHEL - linksWelt) * faktor,
        oben: (y * KACHEL - obenWelt) * faktor,
        groesse,
      });
    }
  }
  return raus;
}

/*
 * ── Massstabsleiste ────────────────────────────────────────────────
 */

/**
 * Eine runde Zahl für die Massstabsleiste: 1, 2, 5, 10, 20, 50 … Meter.
 * „37 m" auf einer Leiste liest niemand.
 */
export function massstab(k: Kamera, maxPunkte = 120): { meter: number; punkte: number } {
  const roh = maxPunkte * meterProPixel(k.ursprung.lat, k.zoom);
  const zehner = Math.pow(10, Math.floor(Math.log10(roh)));
  const stufe = [1, 2, 5, 10].find((s) => roh < s * zehner) ?? 10;
  const meter = (stufe === 1 ? 1 : stufe === 2 ? 1 : stufe === 5 ? 2 : 5) * zehner;
  return { meter, punkte: meter * punkteProMeter(k) };
}
