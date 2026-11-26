import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/*
 * Signierte Links — das Handwerkszeug, einmal.
 *
 * Es gibt in dieser Anwendung mehrere Arten von Link ohne Anmeldung:
 * das Kundenportal (lib/portal/token.ts) und der Einrichtungslink
 * (lib/einrichtung/zugang.ts). Beide signieren einen kurzen Text mit
 * HMAC und prüfen die Signatur in konstanter Laufzeit. Diese Rechnung
 * darf es nur einmal geben — eine zweite Fassung wäre die, in der der
 * Vergleich irgendwann mit === geschrieben wird.
 *
 * ZWECKGEBUNDENE SCHLÜSSEL. Jede Art bekommt ihren eigenen Schlüssel,
 * abgeleitet aus demselben Geheimnis. Ohne das könnte ein Portal-Token
 * als Einrichtungslink durchgehen, sobald die eine Seite den Inhalt
 * etwas lockerer liest als die andere — und niemand würde es merken,
 * weil die Signatur ja stimmt. Mit abgeleiteten Schlüsseln ist das
 * nicht eine Frage von sorgfältigem Parsen, sondern unmöglich.
 *
 * Das Kundenportal bleibt beim ungeleiteten Geheimnis. Nicht aus
 * Nachlässigkeit: Es sind Links im Umlauf, bei Kunden in Mailpostfächern,
 * 90 Tage gültig. Ein anderer Schlüssel würde sie alle entwerten.
 */

export function geheimnis(): string {
  const s = process.env.PORTAL_TOKEN_SECRET;
  if (!s || s.length < 32) {
    throw new Error("PORTAL_TOKEN_SECRET fehlt oder ist zu kurz.");
  }
  return s;
}

/** Ein Schlüssel je Zweck, abgeleitet aus dem Geheimnis. */
export function zweckSchluessel(zweck: string): Buffer {
  return createHmac("sha256", geheimnis()).update(`zweck:${zweck}`).digest();
}

export function signiere(schluessel: string | Buffer, body: string): string {
  return createHmac("sha256", schluessel).update(body).digest("base64url");
}

/** Hash für die Ablage in der Datenbank — nie der Token selbst. */
export function hashe(schluessel: string | Buffer, token: string): string {
  return createHmac("sha256", schluessel).update(token).digest("hex");
}

/**
 * Vergleich in konstanter Laufzeit.
 *
 * Ein Vergleich mit === verrät über die Dauer, wie viele Zeichen
 * gestimmt haben, und damit lässt sich eine Signatur Zeichen für
 * Zeichen erraten.
 */
export function gleich(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function base64url(v: string): string {
  return Buffer.from(v, "utf8").toString("base64url");
}

export function ausBase64url(v: string): string | null {
  try {
    return Buffer.from(v, "base64url").toString("utf8");
  } catch {
    return null;
  }
}
