import { deflateSync } from "node:zlib";

/*
 * Echte, dekodierbare PNG für Tests.
 *
 * Kein Stub aus ein paar Bytes: Die Oberfläche liest die Bildmasse mit
 * `createImageBitmap` oder `new Image()`, bevor sie etwas hochlädt. Ein
 * nicht dekodierbares Bild käme deshalb nie beim Server an, und der Test
 * prüfte nichts.
 *
 * Erzeugt statt mitgeliefert: Ein Testbild im Repo wäre Ballast in jedem
 * Checkout, und bei einem Bild über einem Megabyte merkt man das.
 *
 * Steht in einer eigenen Datei, weil zwei Suiten dieselben Bilder
 * brauchen: der Planer für das Drohnenfoto und die Anhänge für die
 * Grössengrenze der Server Actions. Zwei Kopien wären zwei Wahrheiten.
 */

function crc32(daten: Buffer): number {
  let c = ~0;
  for (const b of daten) {
    c ^= b;
    for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function block(typ: string, inhalt: Buffer): Buffer {
  const kopf = Buffer.alloc(4);
  kopf.writeUInt32BE(inhalt.length, 0);
  const koerper = Buffer.concat([Buffer.from(typ, "ascii"), inhalt]);
  const pruef = Buffer.alloc(4);
  pruef.writeUInt32BE(crc32(koerper), 0);
  return Buffer.concat([kopf, koerper, pruef]);
}

function zusammensetzen(
  breite: number,
  hoehe: number,
  roh: Buffer,
  stufe: number,
): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(breite, 0);
  ihdr.writeUInt32BE(hoehe, 4);
  ihdr[8] = 8; // Bittiefe
  ihdr[9] = 2; // Truecolor
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    block("IHDR", ihdr),
    block("IDAT", deflateSync(roh, { level: stufe })),
    block("IEND", Buffer.alloc(0)),
  ]);
}

/** Ein kleines Schachbrett, auf dem man im Bild etwas erkennt. */
export function png(breite: number, hoehe: number): Buffer {
  const roh = Buffer.alloc(hoehe * (1 + breite * 3));
  for (let y = 0; y < hoehe; y++) {
    const zeile = y * (1 + breite * 3);
    roh[zeile] = 0; // Filter „keiner"
    for (let x = 0; x < breite; x++) {
      const p = zeile + 1 + x * 3;
      const hell = (Math.floor(x / 40) + Math.floor(y / 40)) % 2 === 0;
      roh[p] = hell ? 190 : 90;
      roh[p + 1] = hell ? 185 : 88;
      roh[p + 2] = hell ? 175 : 82;
    }
  }
  return zusammensetzen(breite, hoehe, roh, 6);
}

/**
 * Ein Bild von über einem Megabyte — der Grösse nach ein Handyfoto.
 *
 * Ohne Kompression gespeichert und mit rauschendem Inhalt, damit es
 * sicher gross genug bleibt. Genau diese Grösse war der Fehler: Eine
 * Server Action nimmt ohne Angabe 1 MB, ein Handyfoto ist mehr, und die
 * Anfrage brach ab, bevor eigener Code sie sah. Jeder Test, der mit
 * einem 27-Byte-JPEG arbeitet, läuft an diesem Fehler vorbei.
 */
export function grossesBild(breite = 1600, hoehe = 1200): Buffer {
  const roh = Buffer.alloc(hoehe * (1 + breite * 3));
  for (let y = 0; y < hoehe; y++) {
    const zeile = y * (1 + breite * 3);
    roh[zeile] = 0;
    for (let x = 0; x < breite; x++) {
      const p = zeile + 1 + x * 3;
      roh[p] = (x * 7 + y) % 256;
      roh[p + 1] = (x + y * 5) % 256;
      roh[p + 2] = (x * y) % 256;
    }
  }
  return zusammensetzen(breite, hoehe, roh, 0);
}
