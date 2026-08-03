import { describe, expect, it } from "vitest";
import { ERLAUBTE_TYPEN, exifEntfernen, istJpeg, pruefeDatei } from "./exif";

/**
 * Ein JPEG von Hand bauen: SOI, beliebige Segmente, SOS mit Bilddaten.
 * Echte Kamerabilder als Testdaten wären grösser als das Modul und
 * würden nicht zeigen, worauf es ankommt.
 */
function jpeg(segmente: { marker: number; inhalt: number[] }[]): Uint8Array {
  const teile: number[] = [0xff, 0xd8];
  for (const s of segmente) {
    const laenge = s.inhalt.length + 2;
    teile.push(
      (s.marker >> 8) & 0xff,
      s.marker & 0xff,
      (laenge >> 8) & 0xff,
      laenge & 0xff,
      ...s.inhalt,
    );
  }
  /* SOS und ein bisschen Bilddaten. */
  teile.push(0xff, 0xda, 0x00, 0x03, 0x01, 0x11, 0x22, 0x33);
  return new Uint8Array(teile);
}

const EXIF_MIT_GPS = [
  0x45, 0x78, 0x69, 0x66, 0x00, 0x00, // "Exif\0\0"
  0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00,
  0x88, 0x25, 0x04, 0x00, // GPS-IFD-Tag 0x8825
];

describe("istJpeg", () => {
  it("erkennt die Signatur", () => {
    expect(istJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe(true);
    expect(istJpeg(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(false);
    expect(istJpeg(new Uint8Array([0xff]))).toBe(false);
  });
});

describe("exifEntfernen", () => {
  it("wirft das EXIF-Segment mit den Koordinaten weg", () => {
    /*
     * Der eigentliche Punkt: ein Handyfoto vom Zählerkasten trägt die
     * Koordinaten des Wohnhauses, und dieses Foto geht danach per Signed
     * URL an Dritte.
     */
    const mit = jpeg([{ marker: 0xffe1, inhalt: EXIF_MIT_GPS }]);
    const ohne = exifEntfernen(mit);

    expect(ohne.length).toBeLessThan(mit.length);
    expect(enthaelt(ohne, [0x88, 0x25])).toBe(false);
    expect(enthaelt(ohne, [0x45, 0x78, 0x69, 0x66])).toBe(false);
  });

  it("lässt das Farbprofil stehen", () => {
    // APP14 (Adobe) und APP0 (JFIF) gehören zum Bild, nicht zu den Daten.
    const bild = jpeg([
      { marker: 0xffe0, inhalt: [0x4a, 0x46, 0x49, 0x46, 0x00] },
      { marker: 0xffe1, inhalt: EXIF_MIT_GPS },
      { marker: 0xffee, inhalt: [0x41, 0x64, 0x6f, 0x62, 0x65] },
    ]);
    const ohne = exifEntfernen(bild);

    expect(enthaelt(ohne, [0x4a, 0x46, 0x49, 0x46])).toBe(true);
    expect(enthaelt(ohne, [0x41, 0x64, 0x6f, 0x62, 0x65])).toBe(true);
    expect(enthaelt(ohne, [0x45, 0x78, 0x69, 0x66])).toBe(false);
  });

  it("lässt die Bilddaten unangetastet", () => {
    const bild = jpeg([{ marker: 0xffe1, inhalt: EXIF_MIT_GPS }]);
    const ohne = exifEntfernen(bild);

    // SOI am Anfang, SOS mit den Daten am Ende.
    expect([ohne[0], ohne[1]]).toEqual([0xff, 0xd8]);
    expect(enthaelt(ohne, [0xff, 0xda, 0x00, 0x03, 0x01, 0x11, 0x22, 0x33])).toBe(
      true,
    );
  });

  it("entfernt auch XMP und Kommentare", () => {
    const bild = jpeg([
      { marker: 0xffe2, inhalt: [0x01, 0x02] },
      { marker: 0xfffe, inhalt: [0x67, 0x65, 0x68, 0x65, 0x69, 0x6d] },
    ]);
    const ohne = exifEntfernen(bild);
    expect(enthaelt(ohne, [0x67, 0x65, 0x68, 0x65, 0x69, 0x6d])).toBe(false);
  });

  it("reicht andere Formate unverändert durch", () => {
    /*
     * Ein halb verstandenes Format zu beschneiden richtet mehr Schaden
     * an, als es verhindert.
     */
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(exifEntfernen(png)).toEqual(png);
  });

  it("gibt kaputte Bilder zurück, statt sie zu zerschneiden", () => {
    const kaputt = new Uint8Array([0xff, 0xd8, 0x00, 0x01, 0x02, 0x03]);
    const raus = exifEntfernen(kaputt);
    expect(raus.length).toBe(kaputt.length);
  });

  it("kommt mit einem Bild ganz ohne Segmente zurecht", () => {
    const nackt = jpeg([]);
    expect(exifEntfernen(nackt)).toEqual(nackt);
  });
});

describe("pruefeDatei", () => {
  const echt = jpeg([]);

  it("lässt erlaubte Formate durch", () => {
    expect(pruefeDatei("image/jpeg", echt.length, echt)).toEqual({
      ok: true,
      endung: "jpg",
    });
    expect(pruefeDatei("application/pdf", 100, new Uint8Array([1]))).toMatchObject({
      ok: true,
    });
  });

  it("weist alles ab, was nicht auf der Liste steht", () => {
    // Whitelist, nicht Blacklist — nichts Ausführbares kommt durch.
    for (const mime of ["text/html", "application/x-msdownload", "image/svg+xml", ""]) {
      expect(pruefeDatei(mime, 100, new Uint8Array([1])).ok, mime).toBe(false);
    }
  });

  it("weist zu grosse und leere Dateien ab", () => {
    expect(pruefeDatei("image/png", 0, new Uint8Array()).ok).toBe(false);
    expect(pruefeDatei("image/png", 26 * 1024 * 1024, new Uint8Array([1])).ok).toBe(
      false,
    );
  });

  it("glaubt dem Browser nicht, dass etwas ein JPEG ist", () => {
    /*
     * Der Content-Type kommt vom Browser und ist eine Behauptung. Bei
     * JPEG lässt sie sich billig gegen die ersten Bytes halten.
     */
    const kein = new Uint8Array([0x3c, 0x68, 0x74, 0x6d, 0x6c]);
    expect(pruefeDatei("image/jpeg", kein.length, kein).ok).toBe(false);
  });

  it("kennt für jeden erlaubten Typ eine Endung", () => {
    for (const [mime, endung] of Object.entries(ERLAUBTE_TYPEN)) {
      expect(endung, mime).toMatch(/^[a-z0-9]+$/);
    }
  });
});

function enthaelt(heu: Uint8Array, nadel: number[]): boolean {
  for (let i = 0; i + nadel.length <= heu.length; i++) {
    let treffer = true;
    for (let j = 0; j < nadel.length; j++) {
      if (heu[i + j] !== nadel[j]) {
        treffer = false;
        break;
      }
    }
    if (treffer) return true;
  }
  return false;
}
