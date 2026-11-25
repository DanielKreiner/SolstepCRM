/**
 * Bilder vor dem Hochladen verkleinern.
 *
 * Grund dafür ist ein Fehler aus dem Betrieb: Ein Kunde hat im Portal auf
 * eine Rückfrage mit einem Foto vom Zählerkasten geantwortet und statt
 * einer Bestätigung einen Fehlerbildschirm bekommen. Die Ursache lag
 * nicht im Portal, sondern an einer Grenze, die niemand gesetzt hat —
 * eine Server Action nimmt ohne Angabe höchstens 1 MB, und ein
 * Handyfoto ist drei- bis fünfmal so gross. Die Datei kam nie am Server
 * an, die Grössenprüfung lief nie, und der Kunde sah einen Absturz.
 *
 * Die Grenze höher zu setzen reicht nicht: Serverlose Funktionen nehmen
 * ohnehin nur rund 4,5 MB Rumpf. Der Ausweg ist, das Bild gar nicht so
 * gross zu verschicken. Ein Zählerkasten braucht keine zwölf Megapixel,
 * und auf der Baustelle mit einem Balken Empfang ist ein kleines Bild
 * der Unterschied zwischen „gesendet" und „aufgegeben".
 *
 * Was hier NICHT passiert: PDFs anfassen. Die bleiben, wie sie sind, und
 * stossen bei Überlänge an die ehrliche Meldung in `passtDurch`.
 */

/**
 * Was eine Server Action durchlässt.
 *
 * Bewusst unter der Plattformgrenze von rund 4,5 MB. Darüber bricht die
 * Anfrage ab, bevor irgendein eigener Code sie sieht — also muss die
 * Grenze vorher greifen, im Browser, mit einem verständlichen Satz.
 */
export const UPLOAD_MAX_BYTES = 4 * 1024 * 1024;

/** Längste Kante nach dem Verkleinern. */
export const ZIEL_KANTE = 2000;

/** JPEG-Qualität. 82 ist dieselbe Stufe wie beim Planer-Schnappschuss. */
const QUALITAET = 0.82;

/**
 * Zielmasse bei gegebener längster Kante, Seitenverhältnis erhalten.
 *
 * Eigene Funktion, weil sie die einzige Rechnung in dieser Datei ist und
 * sich ohne Browser prüfen lässt. Bilder, die schon klein genug sind,
 * kommen unverändert zurück — ein Bild hochzurechnen macht es grösser,
 * ohne es besser zu machen.
 */
export function zielMasse(
  breite: number,
  hoehe: number,
  maxKante: number = ZIEL_KANTE,
): { breite: number; hoehe: number } {
  if (breite <= 0 || hoehe <= 0) return { breite: 0, hoehe: 0 };

  const laengste = Math.max(breite, hoehe);
  if (laengste <= maxKante) return { breite, hoehe };

  const faktor = maxKante / laengste;
  return {
    /* Mindestens 1 Pixel: ein 4000x1-Panorama darf nicht auf 0 fallen. */
    breite: Math.max(1, Math.round(breite * faktor)),
    hoehe: Math.max(1, Math.round(hoehe * faktor)),
  };
}

/** Ob die Datei so, wie sie ist, durch eine Server Action passt. */
export function passtDurch(groesse: number): boolean {
  return groesse <= UPLOAD_MAX_BYTES;
}

/** Megabyte mit einer Dezimalstelle, für Meldungen an den Benutzer. */
export function mb(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1).replace(".", ",");
}

/**
 * Verkleinert ein Bild im Browser; gibt alles andere unverändert zurück.
 *
 * Schlägt irgendetwas fehl — HEIC kann nicht jeder Browser decodieren —,
 * kommt das Original zurück. Dann greift die Grössenprüfung davor, und
 * der Benutzer bekommt eine Meldung statt eines Absturzes.
 */
export async function verkleinern(datei: File): Promise<File> {
  if (!datei.type.startsWith("image/")) return datei;
  if (typeof createImageBitmap !== "function") return datei;

  try {
    /*
     * imageOrientation: "from-image" ist hier nicht Kosmetik. Ohne das
     * verliert das neu gezeichnete Bild die EXIF-Ausrichtung, und jedes
     * Hochformat-Foto vom Handy liegt danach quer — ein Fehler, der dem
     * Kunden auffällt und uns nicht, weil Vorschauen im Browser die
     * Ausrichtung von sich aus beachten.
     */
    const bild = await createImageBitmap(datei, { imageOrientation: "from-image" });
    const ziel = zielMasse(bild.width, bild.height);

    /* Schon klein genug und ohnehin leicht: nichts anfassen. */
    if (
      ziel.breite === bild.width &&
      ziel.hoehe === bild.height &&
      passtDurch(datei.size)
    ) {
      bild.close();
      return datei;
    }

    const flaeche = document.createElement("canvas");
    flaeche.width = ziel.breite;
    flaeche.height = ziel.hoehe;

    const stift = flaeche.getContext("2d");
    if (!stift) {
      bild.close();
      return datei;
    }
    stift.drawImage(bild, 0, 0, ziel.breite, ziel.hoehe);
    bild.close();

    const klein = await new Promise<Blob | null>((fertig) =>
      flaeche.toBlob(fertig, "image/jpeg", QUALITAET),
    );
    if (!klein || klein.size === 0) return datei;

    /* Grösser geworden? Kommt bei kleinen PNG-Screenshots vor. */
    if (klein.size >= datei.size) return datei;

    const name = datei.name.replace(/\.[^.]+$/, "") + ".jpg";
    return new File([klein], name, {
      type: "image/jpeg",
      lastModified: datei.lastModified,
    });
  } catch {
    return datei;
  }
}
