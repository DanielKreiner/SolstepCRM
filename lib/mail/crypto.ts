import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/*
 * Verschlüsselung der Postfach-Zugangsdaten.
 *
 * AES-256-GCM, Format iv || tag || ciphertext (CLAUDE.md 6.1). GCM statt CBC,
 * weil das Tag die Nachricht auch gegen Veränderung schützt — bei einem
 * Passwort, das gleich an einen fremden Server geht, will man beides.
 *
 * Bewusst frei von Next-Abhängigkeiten: die Mail-Logik soll später
 * unverändert in einem Dauerworker laufen können (CLAUDE.md Abschnitt 7).
 */

const IV_LAENGE = 12;
const TAG_LAENGE = 16;

function schluessel(): Buffer {
  const hex = process.env.MAIL_CRED_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error(
      "MAIL_CRED_KEY fehlt oder ist nicht 32 Byte lang (64 Hex-Zeichen).",
    );
  }
  return Buffer.from(hex, "hex");
}

export function verschluesseln(klartext: string): Buffer {
  const iv = randomBytes(IV_LAENGE);
  const cipher = createCipheriv("aes-256-gcm", schluessel(), iv);
  const daten = Buffer.concat([
    cipher.update(klartext, "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), daten]);
}

export function entschluesseln(paket: Buffer | Uint8Array): string {
  const b = Buffer.from(paket);
  if (b.length <= IV_LAENGE + TAG_LAENGE) {
    throw new Error("Verschlüsseltes Paket ist zu kurz.");
  }

  const iv = b.subarray(0, IV_LAENGE);
  const tag = b.subarray(IV_LAENGE, IV_LAENGE + TAG_LAENGE);
  const daten = b.subarray(IV_LAENGE + TAG_LAENGE);

  const decipher = createDecipheriv("aes-256-gcm", schluessel(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(daten), decipher.final()]).toString(
    "utf8",
  );
}

/**
 * Postgres liefert bytea als "\x…"-Hexstring über PostgREST.
 * Ohne diese Umwandlung landet der String selbst im Entschlüsseler.
 */
export function ausBytea(wert: unknown): Buffer | null {
  if (wert === null || wert === undefined) return null;
  if (typeof wert === "string") {
    return Buffer.from(wert.startsWith("\\x") ? wert.slice(2) : wert, "hex");
  }
  if (wert instanceof Uint8Array) return Buffer.from(wert);
  return null;
}
