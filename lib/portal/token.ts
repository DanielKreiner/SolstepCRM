import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/*
 * Portal-Zugang.
 *
 * Kein Supabase-Auth (CLAUDE.md 4.3): der Kunde bekommt einen signierten
 * Link. Der Token trägt customer_id und Ablauf und ist HMAC-signiert; in
 * portal_access liegt nur der Hash, nie der Token selbst. Wer die Datenbank
 * liest, kann daraus keinen gültigen Link bauen.
 *
 * Ablauf 90 Tage, widerrufbar über revoked_at.
 */

const ABLAUF_TAGE = 90;

function secret(): string {
  const s = process.env.PORTAL_TOKEN_SECRET;
  if (!s || s.length < 32) {
    throw new Error("PORTAL_TOKEN_SECRET fehlt oder ist zu kurz.");
  }
  return s;
}

export type TokenPayload = { customerId: string; exp: number };

/** Erzeugt einen Token. Der Rückgabewert wird nur einmal ausgegeben. */
export function createToken(customerId: string, tage = ABLAUF_TAGE): string {
  const exp = Math.floor(Date.now() / 1000) + tage * 86400;
  const nonce = randomBytes(6).toString("base64url");
  const body = `${customerId}.${exp}.${nonce}`;
  return `${base64url(body)}.${sign(body)}`;
}

/** Prüft Signatur und Ablauf. Gibt null zurück, wenn irgendetwas nicht stimmt. */
export function verifyToken(token: string): TokenPayload | null {
  const teile = token.split(".");
  if (teile.length !== 2) return null;

  const [kopf, signatur] = teile as [string, string];
  let body: string;
  try {
    body = Buffer.from(kopf, "base64url").toString("utf8");
  } catch {
    return null;
  }

  const erwartet = sign(body);
  // Konstante Laufzeit: ein Vergleich mit === verrät über die Dauer, wie
  // viele Zeichen gestimmt haben.
  const a = Buffer.from(signatur);
  const b = Buffer.from(erwartet);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  const [customerId, expStr] = body.split(".");
  if (!customerId || !expStr) return null;

  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp * 1000 < Date.now()) return null;

  return { customerId, exp };
}

/** Nur der Hash landet in der Datenbank. */
export function hashToken(token: string): string {
  return createHmac("sha256", secret()).update(token).digest("hex");
}

function sign(body: string): string {
  return createHmac("sha256", secret()).update(body).digest("base64url");
}

function base64url(v: string): string {
  return Buffer.from(v, "utf8").toString("base64url");
}
