/**
 * EXIF aus einem hochgeladenen Bild entfernen.
 *
 * CLAUDE.md Abschnitt 11: aus Kundenfotos wird EXIF-GPS entfernt. Der
 * Grund ist nicht theoretisch — ein Handyfoto vom Zählerkasten trägt die
 * Koordinaten des Wohnhauses, und dieses Foto liegt danach im Storage,
 * geht per Signed URL an Dritte und landet unter Umständen in einem
 * Angebots-PDF.
 *
 * Umgesetzt für JPEG, weil dort das Problem sitzt: Handys schreiben GPS
 * in ein APP1-Segment. Entfernt werden alle APP1- und APP2-Segmente
 * (EXIF, XMP, Flashpix) — der Bildinhalt bleibt unangetastet, weil nur
 * Metadatenblöcke zwischen den Markern herausgeschnitten werden.
 *
 * PNG und WebP werden unverändert durchgereicht. Beide können Metadaten
 * tragen, in der Praxis aber keine GPS-Daten aus Kamera-Apps. Das ist
 * eine bewusste Grenze und keine Vollständigkeit — wer sie verschiebt,
 * sollte hier ansetzen.
 */

/** Segmente, die Metadaten tragen und wegkönnen. */
const RAUS = new Set([
  0xffe1, // APP1 — EXIF und XMP, hier sitzt GPS
  0xffe2, // APP2 — Flashpix, teils Farbprofil-Erweiterungen
  0xffed, // APP13 — IPTC
  0xfffe, // COM — Kommentar
]);

export function istJpeg(bytes: Uint8Array): boolean {
  return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8;
}

/**
 * Gibt das Bild ohne Metadatensegmente zurück.
 *
 * Bei allem, was kein JPEG ist, kommt die Eingabe unverändert zurück —
 * ein halb verstandenes Format zu beschneiden richtet mehr Schaden an,
 * als es verhindert.
 */
export function exifEntfernen(bytes: Uint8Array): Uint8Array {
  if (!istJpeg(bytes)) return bytes;

  const teile: Uint8Array[] = [];
  /* SOI übernehmen. */
  teile.push(bytes.subarray(0, 2));

  let i = 2;
  while (i + 3 < bytes.length) {
    if (bytes[i] !== 0xff) {
      /*
       * Kein Marker an erwarteter Stelle — das Bild ist anders gebaut als
       * angenommen. Rest unverändert anhängen und aufhören: lieber ein
       * Bild mit Metadaten als ein zerschnittenes.
       */
      teile.push(bytes.subarray(i));
      return zusammen(teile);
    }

    const marker = ((bytes[i] as number) << 8) | (bytes[i + 1] as number);

    /* SOS — ab hier kommen die Bilddaten, dort wird nicht mehr gesucht. */
    if (marker === 0xffda) {
      teile.push(bytes.subarray(i));
      return zusammen(teile);
    }

    const laenge = ((bytes[i + 2] as number) << 8) | (bytes[i + 3] as number);
    if (laenge < 2 || i + 2 + laenge > bytes.length) {
      teile.push(bytes.subarray(i));
      return zusammen(teile);
    }

    if (!RAUS.has(marker)) {
      teile.push(bytes.subarray(i, i + 2 + laenge));
    }

    i += 2 + laenge;
  }

  return zusammen(teile);
}

function zusammen(teile: Uint8Array[]): Uint8Array {
  const laenge = teile.reduce((a, t) => a + t.length, 0);
  const ergebnis = new Uint8Array(laenge);
  let pos = 0;
  for (const t of teile) {
    ergebnis.set(t, pos);
    pos += t.length;
  }
  return ergebnis;
}

/** Erlaubte Uploads — Whitelist, nicht Blacklist (CLAUDE.md 11). */
export const ERLAUBTE_TYPEN: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "application/pdf": "pdf",
};

export const MAX_BYTES = 25 * 1024 * 1024;

export type PruefErgebnis =
  | { ok: true; endung: string }
  | { ok: false; grund: string };

/**
 * Typ und Grösse prüfen.
 *
 * Der Content-Type kommt vom Browser und ist damit eine Behauptung. Für
 * JPEG wird sie gegen die ersten Bytes gehalten — bei den übrigen Typen
 * begrenzt die Whitelist den Schaden, weil nichts Ausführbares dabei ist.
 */
export function pruefeDatei(
  mime: string,
  groesse: number,
  bytes: Uint8Array,
): PruefErgebnis {
  const endung = ERLAUBTE_TYPEN[mime];
  if (!endung) {
    return {
      ok: false,
      grund: "Dieses Dateiformat geht nicht. Erlaubt sind Bilder und PDF.",
    };
  }
  if (groesse <= 0) return { ok: false, grund: "Die Datei ist leer." };
  if (groesse > MAX_BYTES) {
    return { ok: false, grund: "Die Datei ist zu gross — höchstens 25 MB." };
  }
  if (mime === "image/jpeg" && !istJpeg(bytes)) {
    return { ok: false, grund: "Das ist kein JPEG, auch wenn es so heisst." };
  }
  return { ok: true, endung };
}
