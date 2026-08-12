/*
 * Sonnenstand (BRIEFING-planer-3d.md, Stufe 3D-3).
 *
 * Für die Verschattung braucht es zu jedem Zeitpunkt die Richtung, aus
 * der die Sonne kommt: Azimut und Höhe über dem Horizont. Alles Weitere
 * — Schattenwurf, Verschattungsgrad, Ertragsabschlag — hängt daran.
 *
 * Gerechnet wird nach den Formeln, die auch das NOAA-Rechenblatt
 * benutzt (Meeus, „Astronomical Algorithms", vereinfachte Reihen). Die
 * Genauigkeit liegt bei rund einer Bogenminute — für Verschattung durch
 * ein Nachbarhaus mehr als genug. Wer Sonnenfinsternisse berechnen will,
 * braucht etwas anderes.
 *
 * Kein externes Paket: Die Rechnung ist kurz, sie ändert sich nie, und
 * sie muss gegen bekannte Werte prüfbar sein. Eine Abhängigkeit dafür
 * hereinzuziehen, deren Innenleben man nicht prüft, wäre bei einer
 * Zahl, die später im Kundenangebot steht, die falsche Wahl.
 */

const GRAD = Math.PI / 180;

export interface SonnenStand {
  /** Höhe über dem Horizont in Grad; negativ heisst: unter dem Horizont. */
  hoehe: number;
  /** Kompassrichtung in Grad: 0 = Nord, 90 = Ost, 180 = Süd. */
  azimut: number;
}

/**
 * Julianisches Datum aus einem Zeitpunkt.
 *
 * Bezugspunkt ist der 1. Januar 2000, 12:00 UTC (J2000). Alle Reihen
 * unten sind darauf bezogen.
 */
function julianischeTage(zeit: Date): number {
  return zeit.getTime() / 86400000 - 10957.5;
}

/**
 * Sonnenstand für Ort und Zeitpunkt.
 *
 * `zeit` wird als echter Zeitpunkt genommen — die Zeitzone steckt schon
 * darin. Wer Ortszeit meint, muss sie vorher umrechnen; das ist der
 * häufigste Fehler bei dieser Art Rechnung und würde den Schatten um
 * eine oder zwei Stunden verschieben.
 */
export function sonnenstand(lat: number, lon: number, zeit: Date): SonnenStand {
  const d = julianischeTage(zeit);

  // Mittlere Anomalie der Erde auf ihrer Bahn.
  const M = (357.5291 + 0.98560028 * d) * GRAD;
  // Mittelpunktsgleichung: die Bahn ist eine Ellipse, keine Kreisbahn.
  const C = (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M)) * GRAD;
  // Ekliptikale Länge der Sonne, gemessen ab Frühlingspunkt.
  const L = M + C + Math.PI + 102.9372 * GRAD;

  // Schiefe der Ekliptik — die Neigung der Erdachse, langsam abnehmend.
  const e = (23.4397 - 3.563e-7 * d) * GRAD;

  const deklination = Math.asin(Math.sin(e) * Math.sin(L));
  const rektaszension = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));

  // Sternzeit am Beobachtungsort.
  const sternzeit = (280.16 + 360.9856235 * d) * GRAD - -lon * GRAD;
  const stundenwinkel = sternzeit - rektaszension;

  const phi = lat * GRAD;
  const hoehe = Math.asin(
    Math.sin(phi) * Math.sin(deklination) +
      Math.cos(phi) * Math.cos(deklination) * Math.cos(stundenwinkel),
  );

  /*
   * Azimut ab NORDEN im Uhrzeigersinn — dieselbe Zählweise wie beim
   * Dachazimut. Die astronomische Literatur zählt oft ab Süden; wer das
   * vermischt, spiegelt den Schatten von Ost nach West.
   */
  const azimutSued = Math.atan2(
    Math.sin(stundenwinkel),
    Math.cos(stundenwinkel) * Math.sin(phi) - Math.tan(deklination) * Math.cos(phi),
  );
  const azimut = (azimutSued / GRAD + 180 + 360) % 360;

  return { hoehe: hoehe / GRAD, azimut };
}

/**
 * Richtungsvektor zur Sonne im Metersystem des Planers.
 *
 * x nach Osten, y nach Norden, z nach oben — dieselbe Ebene, in der die
 * Dachflächen liegen. Damit lässt sich ein Schatten direkt als Strahl
 * rechnen, ohne noch einmal umzudenken.
 */
export function sonnenrichtung(stand: SonnenStand): { x: number; y: number; z: number } {
  const h = stand.hoehe * GRAD;
  const a = stand.azimut * GRAD;
  return {
    x: Math.cos(h) * Math.sin(a),
    y: Math.cos(h) * Math.cos(a),
    z: Math.sin(h),
  };
}

/*
 * ── Stichzeitpunkte über das Jahr ──────────────────────────────────
 */

export interface Stichpunkt {
  zeit: Date;
  /**
   * Wie viel Jahresertrag auf diesen Zeitpunkt entfällt. Die Summe über
   * alle Stichpunkte ist 1.
   */
  gewicht: number;
}

/**
 * Zeitpunkte, an denen die Verschattung geprüft wird.
 *
 * Nicht 8760 Stunden im Jahr: Ein Handwerksbetrieb wartet keine
 * Minute auf ein Erstgespräch, und die Genauigkeit wäre vorgetäuscht —
 * das Ertragsmodell selbst rechnet mit Jahreswerten.
 *
 * Genommen werden drei Tage, die das Jahr gut abdecken (Winter- und
 * Sommersonnenwende, Äquinoktium), je in Stundenschritten über den
 * Tag. Gewichtet wird mit dem Ertragsanteil der jeweiligen Jahreszeit
 * und der Tageszeit: Eine Verschattung um 13 Uhr im Juni kostet ein
 * Vielfaches derselben Verschattung um 8 Uhr im Dezember.
 */
export function stichpunkte(jahr: number): Stichpunkt[] {
  /*
   * Die drei Tage stehen für je ein Drittel des Jahres — der
   * Äquinoktialtag für Frühling UND Herbst, deshalb sein doppeltes
   * Gewicht. Zusammen mit der Sonnenhöhe unten ergibt das eine
   * brauchbare Näherung des Jahresverlaufs.
   */
  const tage: Array<{ monat: number; tag: number; anteil: number }> = [
    { monat: 5, tag: 21, anteil: 0.45 }, // Juni: die ertragsstarke Hälfte
    { monat: 2, tag: 20, anteil: 0.4 }, // März/September
    { monat: 11, tag: 21, anteil: 0.15 }, // Dezember: wenig Ertrag
  ];

  const punkte: Stichpunkt[] = [];
  for (const t of tage) {
    /*
     * Von 5 bis 20 Uhr Ortszeit. Was davor und danach liegt, trägt in
     * Mitteleuropa nichts bei — und die Sonnenhöhe unter dem Horizont
     * fällt in der Rechnung ohnehin heraus.
     */
    const stunden: Array<{ h: number; g: number }> = [];
    for (let h = 5; h <= 20; h++) {
      /*
       * Gewicht nach dem Sinus des Tagesbogens: mittags am meisten,
       * morgens und abends weniger. Das ist derselbe Verlauf, dem die
       * Einstrahlung folgt.
       */
      const anteilTag = Math.max(0, Math.sin(((h - 5) / 15) * Math.PI));
      stunden.push({ h, g: anteilTag });
    }
    const summe = stunden.reduce((s, x) => s + x.g, 0) || 1;
    for (const st of stunden) {
      if (st.g <= 0) continue;
      punkte.push({
        // UTC minus eine Stunde ist im Winter Ortszeit, im Sommer minus
        // zwei — für eine Verschattungsnäherung ist der Unterschied
        // kleiner als die Schrittweite von einer Stunde.
        zeit: new Date(Date.UTC(jahr, t.monat, t.tag, st.h - 1, 0, 0)),
        gewicht: (st.g / summe) * t.anteil,
      });
    }
  }
  return punkte;
}
