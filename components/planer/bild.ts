"use client";

/*
 * Ein Bild der Planung erzeugen (Briefing 8.1 und 8.3).
 *
 * Die Zeichenfläche besteht aus zwei Schichten: den Kacheln als
 * gewöhnliche <img>-Elemente und der Geometrie auf einem Canvas
 * darüber. Für die Projektliste und das Kunden-PDF müssen beide in
 * EINEM Bild zusammenkommen.
 *
 * Warum nicht serverseitig rendern: der Server müsste dafür Kacheln
 * nachladen, die Kameraposition kennen und ein Canvas nachbauen — also
 * die halbe Zeichenlogik ein zweites Mal, mit der sicheren Aussicht,
 * dass beide Fassungen auseinanderlaufen. Der Browser hat das Bild
 * bereits fertig vor sich.
 */

export interface BildOptionen {
  /** Die Kachelschicht (DOM-Container mit den <img>-Elementen). */
  kacheln: HTMLElement | null;
  /** Das Canvas mit Flächen, Gruppen und Modulen. */
  canvas: HTMLCanvasElement | null;
  /** Zielbreite in Pixeln; die Höhe folgt dem Seitenverhältnis. */
  breite?: number;
}

/**
 * Karte und Geometrie in ein PNG zusammenfassen.
 *
 * Gibt `null` zurück, wenn kein Bild entstehen kann — etwa weil noch
 * nichts geladen ist oder der Browser das Canvas wegen fehlender
 * CORS-Zustimmung sperrt. Ein fehlendes Vorschaubild ist unschön; ein
 * abgestürzter Planer wäre schlimmer.
 */
export async function planungAlsBild(o: BildOptionen): Promise<string | null> {
  const quelle = o.canvas;
  if (!quelle || quelle.width === 0 || quelle.height === 0) return null;

  const breite = o.breite ?? 960;
  const hoehe = Math.round((quelle.height / quelle.width) * breite);

  const ziel = document.createElement("canvas");
  ziel.width = breite;
  ziel.height = hoehe;
  const ctx = ziel.getContext("2d");
  if (!ctx) return null;

  // Der Hintergrund der Zeichenfläche, damit unbedeckte Ecken nicht
  // durchsichtig bleiben — im PDF wären sie sonst weiss.
  ctx.fillStyle = "#17150f";
  ctx.fillRect(0, 0, breite, hoehe);

  /*
   * Die Kacheln liegen als absolut positionierte Bilder mit einer
   * `translate3d`-Transformation. Statt die Transformationsmatrix zu
   * parsen, wird die tatsächliche Lage im Dokument abgefragt — sie
   * stimmt immer, auch wenn sich die Umsetzung der Schicht ändert.
   */
  if (o.kacheln) {
    const rahmen = o.kacheln.getBoundingClientRect();
    const skala = breite / rahmen.width;

    for (const bild of Array.from(o.kacheln.querySelectorAll("img"))) {
      if (!bild.complete || bild.naturalWidth === 0) continue;
      const r = bild.getBoundingClientRect();
      try {
        ctx.drawImage(
          bild,
          (r.left - rahmen.left) * skala,
          (r.top - rahmen.top) * skala,
          r.width * skala,
          r.height * skala,
        );
      } catch {
        // Eine einzelne Kachel, die sich sperrt, darf das Bild nicht
        // verhindern — der Rest wird trotzdem gezeichnet.
      }
    }
  }

  ctx.drawImage(quelle, 0, 0, breite, hoehe);

  try {
    return ziel.toDataURL("image/jpeg", 0.82);
  } catch {
    /*
     * SecurityError: irgendeine Kachel kam ohne CORS-Zustimmung. Dann
     * lieber gar kein Bild als ein Absturz — der Aufrufer zeigt in dem
     * Fall die Kennzahlen ohne Vorschau.
     */
    return null;
  }
}
