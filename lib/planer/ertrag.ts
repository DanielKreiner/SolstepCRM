/*
 * Ertragsberechnung (Briefing 6).
 *
 * Die Zahlen kommen von PVGIS — der Datenbank der EU-Kommission, die
 * aus Satelliten-Einstrahlungsdaten den spezifischen Ertrag je Standort
 * und Ausrichtung liefert. Der Aufruf passiert serverseitig und wird
 * gecacht; diese Datei enthält, was auch ohne Netz funktionieren muss:
 * die Umrechnung der Ausrichtung, den Fallback und die Summe über die
 * Modulgruppen.
 *
 * Grundsatz: ein Planer darf nie an einer fremden API hängenbleiben.
 * Ist PVGIS nicht erreichbar, rechnet der Fallback weiter — sichtbar
 * als „geschätzt", nicht heimlich.
 */

/** Woher der spezifische Ertrag stammt. Steht so auch in der Oberfläche. */
export type Quelle = "pvgis" | "geschaetzt";

export interface ErtragAnfrage {
  lat: number;
  lon: number;
  /** Kompassrichtung der Fläche: 0 = Nord, 90 = Ost, 180 = Süd. */
  azimut: number;
  /** Dachneigung in Grad, 0 = flach. */
  neigung: number;
  /** Systemverluste in Prozent (Leitungen, Wechselrichter, Verschmutzung). */
  verlustProzent: number;
}

export interface ErtragAntwort {
  /** Spezifischer Jahresertrag in kWh je kWp. */
  spezifisch: number;
  /** Zwölf Monatswerte in kWh je kWp; Index 0 = Jänner. */
  monate: number[];
  quelle: Quelle;
}

/*
 * ── Ausrichtung ────────────────────────────────────────────────────
 */

/**
 * Unseren Azimut in die Zählweise von PVGIS übersetzen.
 *
 * Wir zählen vom Norden im Uhrzeigersinn (0 = Nord, 180 = Süd), PVGIS
 * zählt ab Süden (0 = Süd, −90 = Ost, +90 = West). Wer das verwechselt,
 * plant ein Süddach als Norddach und liegt beim Ertrag um 40 % daneben.
 */
export function pvgisAspekt(azimut: number): number {
  const normiert = ((azimut % 360) + 360) % 360;
  const ab = normiert - 180;
  return ab > 180 ? ab - 360 : ab <= -180 ? ab + 360 : ab;
}

/**
 * Referenzertrag bei Südausrichtung und optimaler Neigung, kWh/kWp.
 *
 * Nicht geraten, sondern bei PVGIS abgefragt und gemittelt (35° Süd,
 * 14 % Verlust):
 *
 *   AT  Linz 1123 · Wien 1176 · Graz 1206 · Innsbruck 1242 · Salzburg 1055
 *   DE  Hamburg 974 · Kassel 1009 · München 1116 · Köln 1035 · Leipzig 1067
 *
 * Die Spanne innerhalb eines Landes ist grösser als der Unterschied
 * zwischen den Ländern — Innsbruck liegt 18 % über Salzburg. Ein
 * Landesmittel kann das nicht auflösen, und genau deshalb heisst das
 * Ergebnis in der Oberfläche „geschätzt" und nicht „berechnet".
 */
export const REFERENZ = {
  AT: 1160,
  DE: 1040,
} as const;

export type Region = keyof typeof REFERENZ;

/**
 * Wie viel eine Ausrichtung vom Optimum übrig lässt.
 *
 * Die Werte stammen NICHT aus einer Faustformel, sondern aus 31
 * PVGIS-Abfragen für Linz, geteilt durch das dortige Optimum (45° Süd,
 * 1118 kWh/kWp). Der erste Anlauf war eine Schätzung aus dem Kopf und
 * lag bei Ost/West um neun und bei Nord um sechzehn Prozentpunkte zu
 * hoch — bei einem Ostdach hätte der Fallback rund 90 kWh/kWp zu viel
 * versprochen, und beim Umschalten von „geschätzt" auf PVGIS wäre der
 * Ertrag vor den Augen des Kunden gesunken.
 *
 * Zeilen sind Neigungen in 15°-Schritten, Spalten die Abweichung von
 * Süden in 45°-Schritten. Dazwischen wird bilinear interpoliert, womit
 * jede 5°-Stufe zur Verfügung steht.
 *
 * Ost und West stehen in einer gemeinsamen Spalte, als Mittel aus
 * beiden Abfragen. Sie sind NICHT gleich: Westen bringt rund zwei
 * Prozent mehr als Osten, weil der Nachmittag im Mittel wärmer und
 * klarer ist. Der erste Kalibrierlauf hatte versehentlich nur die
 * West-Werte genommen und damit jedes Ostdach um zwei Prozent zu gut
 * gerechnet — aufgefallen ist das erst beim Abgleich gegen eine
 * unabhängige Ost-Abfrage.
 */
const ABWEICHUNGEN = [0, 45, 90, 135, 180] as const;
const NEIGUNGEN = [0, 15, 30, 45, 60, 75, 90] as const;

// prettier-ignore
const FAKTOR: number[][] = [
  /* Neigung   Süd     ±45°    Ost/W   ±135°   Nord  */
  /*  0° */  [0.846,  0.846,  0.846,  0.846,  0.846],
  /* 15° */  [0.946,  0.913,  0.833,  0.745,  0.707],
  /* 30° */  [0.998,  0.942,  0.803,  0.638,  0.565],
  /* 45° */  [1.000,  0.929,  0.754,  0.539,  0.426],
  /* 60° */  [0.951,  0.875,  0.683,  0.448,  0.309],
  /* 75° */  [0.851,  0.779,  0.590,  0.359,  0.229],
  /* 90° */  [0.703,  0.647,  0.482,  0.276,  0.170],
];

/** Lineare Lage eines Werts zwischen zwei Stützstellen. */
function stelle(wert: number, gitter: readonly number[]): { i: number; j: number; t: number } {
  const letzte = gitter.length - 1;
  if (wert <= gitter[0]!) return { i: 0, j: 0, t: 0 };
  if (wert >= gitter[letzte]!) return { i: letzte, j: letzte, t: 0 };
  for (let k = 0; k < letzte; k++) {
    const a = gitter[k]!;
    const b = gitter[k + 1]!;
    if (wert <= b) return { i: k, j: k + 1, t: (wert - a) / (b - a) };
  }
  return { i: letzte, j: letzte, t: 0 };
}

/**
 * Ertragsfaktor für eine Ausrichtung, 0 bis 1.
 *
 * `azimut` in unserer Zählweise (180 = Süd), `neigung` in Grad.
 */
export function ausrichtungsFaktor(azimut: number, neigung: number): number {
  // Abweichung von Süden, unabhängig davon, ob nach Osten oder Westen.
  const abweichung = Math.abs(pvgisAspekt(azimut));
  const n = stelle(Math.max(0, Math.min(90, neigung)), NEIGUNGEN);
  const a = stelle(abweichung, ABWEICHUNGEN);

  const obenLinks = FAKTOR[n.i]![a.i]!;
  const obenRechts = FAKTOR[n.i]![a.j]!;
  const untenLinks = FAKTOR[n.j]![a.i]!;
  const untenRechts = FAKTOR[n.j]![a.j]!;

  const oben = obenLinks + (obenRechts - obenLinks) * a.t;
  const unten = untenLinks + (untenRechts - untenLinks) * a.t;
  return oben + (unten - oben) * n.t;
}

/**
 * Monatsverteilung des Jahresertrags in Mitteleuropa.
 *
 * Anteile am Jahresertrag, Jänner bis Dezember — gemittelt über zehn
 * PVGIS-Abfragen in AT und DE. Der Juli trägt gut das Dreifache des
 * Dezembers; für die Wirtschaftlichkeit ist das der entscheidende
 * Punkt, denn im Winter hilft auch ein grosser Speicher wenig.
 */
const GEMESSEN = [
  0.0394, 0.0569, 0.0883, 0.1125, 0.1144, 0.1148, 0.1188, 0.1108, 0.0941, 0.0723, 0.0428, 0.035,
];

/*
 * Auf exakt 1 normiert. Die gerundeten Messwerte summieren sich auf
 * 1,0001 — unbedeutend für die Anzeige, aber genug, damit die Summe der
 * Monatswerte nicht mehr dem Jahresertrag entspricht. Solche
 * Kleinigkeiten fallen später als „die Monate ergeben nicht die
 * Jahreszahl" auf und kosten eine Stunde Suche.
 */
const MONATSANTEILE = GEMESSEN.map((a) => a / GEMESSEN.reduce((s, x) => s + x, 0));

/**
 * Fallback, wenn PVGIS nicht antwortet.
 *
 * Der Systemverlust wird hier abgezogen; PVGIS rechnet ihn selbst ein,
 * wenn man ihn mitgibt. Deshalb muss beim Fallback dasselbe passieren,
 * sonst springt der Ertrag beim Umschalten zwischen den Quellen.
 */
export function fallbackErtrag(
  anfrage: ErtragAnfrage,
  region: Region = "AT",
): ErtragAntwort {
  /*
   * Die Referenz gilt bei 35° Süd. In der Faktortabelle steht dort
   * 0,972 (zwischen 30° und 45°) statt 1,0 — deshalb wird auf das
   * Tabellenoptimum hochgerechnet, sonst käme ein Süddach mit 35°
   * niedriger heraus als dieselbe Fläche mit 45°, obwohl die Referenz
   * genau für 35° gemessen wurde.
   */
  const referenzFaktor = ausrichtungsFaktor(180, 35);
  const roh =
    (REFERENZ[region] / referenzFaktor) * ausrichtungsFaktor(anfrage.azimut, anfrage.neigung);
  /*
   * PVGIS' Referenzwerte hier verstehen sich vor Systemverlusten; die
   * REFERENZ-Zahlen oben sind Werte einer Anlage mit den üblichen 14 %.
   * Abweichungen davon werden anteilig verrechnet.
   */
  const spezifisch = roh * ((100 - anfrage.verlustProzent) / (100 - 14));
  return {
    spezifisch,
    monate: MONATSANTEILE.map((a) => spezifisch * a),
    quelle: "geschaetzt",
  };
}

/**
 * Region aus den Koordinaten — reicht für die Wahl des Referenzwerts.
 *
 * Die Grenze verläuft in Wahrheit nicht auf einem Breitengrad; für
 * einen Schätzwert genügt sie. Wer exakt rechnen will, wartet auf
 * PVGIS.
 */
export function regionAus(lat: number): Region {
  return lat > 48.8 ? "DE" : "AT";
}

/*
 * ── Summe über die Anlage ──────────────────────────────────────────
 */

export interface GruppenErtrag {
  /** Leistung dieser Gruppe in kWp. */
  kwp: number;
  /** Spezifischer Ertrag ihrer Fläche in kWh/kWp. */
  spezifisch: number;
  monate?: number[];
}

export interface AnlagenErtrag {
  kwp: number;
  jahresertragKwh: number;
  /** Ertragsgewichteter Mittelwert über alle Gruppen, kWh/kWp. */
  spezifischMittel: number;
  monateKwh: number[];
}

/**
 * Gesamtertrag über alle Modulgruppen.
 *
 * Jede Gruppe liegt auf ihrer eigenen Fläche und hat damit ihre eigene
 * Ausrichtung — ein Ost-West-Dach mit zwei Gruppen darf nicht mit einem
 * gemittelten Azimut gerechnet werden. Genau das verlangt Abnahmetest
 * 12: „Ertrag nutzt beide Azimute."
 */
export function anlagenErtrag(gruppen: GruppenErtrag[]): AnlagenErtrag {
  const kwp = gruppen.reduce((s, g) => s + g.kwp, 0);
  const jahresertragKwh = gruppen.reduce((s, g) => s + g.kwp * g.spezifisch, 0);

  const monateKwh = Array.from({ length: 12 }, (_, m) =>
    gruppen.reduce((s, g) => {
      const anteil = g.monate?.[m] ?? g.spezifisch * MONATSANTEILE[m]!;
      return s + g.kwp * anteil;
    }, 0),
  );

  return {
    kwp,
    jahresertragKwh,
    spezifischMittel: kwp > 0 ? jahresertragKwh / kwp : 0,
    monateKwh,
  };
}

/**
 * Zwischenwert, solange die neue Anfrage noch läuft.
 *
 * Beim Ziehen am Neigungsregler wird PVGIS erst nach 800 ms gefragt.
 * Bis dahin bleibt die Anzeige nicht stehen, sondern rechnet aus dem
 * letzten bekannten Wert weiter — über das Verhältnis der
 * Ausrichtungsfaktoren. Die KPI-Leiste setzt in dieser Zeit ein „~"
 * davor, damit niemand einen Zwischenwert für gemessen hält.
 */
export function zwischenwert(
  letzte: ErtragAntwort,
  letzteAnfrage: { azimut: number; neigung: number },
  neu: { azimut: number; neigung: number },
): ErtragAntwort {
  const alt = ausrichtungsFaktor(letzteAnfrage.azimut, letzteAnfrage.neigung);
  const jetzt = ausrichtungsFaktor(neu.azimut, neu.neigung);
  if (alt <= 0) return letzte;
  const faktor = jetzt / alt;
  return {
    spezifisch: letzte.spezifisch * faktor,
    monate: letzte.monate.map((m) => m * faktor),
    quelle: letzte.quelle,
  };
}

/**
 * Cache-Schlüssel für eine Anfrage.
 *
 * Koordinaten auf vier Nachkommastellen — rund elf Meter. Feiner wäre
 * sinnlos: die Einstrahlung ändert sich über elf Meter nicht, und jeder
 * unnötig genaue Schlüssel bedeutet einen weiteren externen Aufruf.
 */
export function cacheSchluessel(a: ErtragAnfrage): string {
  return [
    a.lat.toFixed(4),
    a.lon.toFixed(4),
    Math.round(a.neigung),
    Math.round(a.azimut),
    Math.round(a.verlustProzent),
  ].join(":");
}
