import "server-only";
import { randomBytes } from "node:crypto";
import {
  ausBase64url,
  base64url,
  geheimnis,
  gleich,
  hashe,
  signiere,
} from "@/lib/token/hmac";

/*
 * Portal-Zugang.
 *
 * Kein Supabase-Auth (CLAUDE.md 4.3): der Kunde bekommt einen signierten
 * Link. Der Token trägt customer_id und Ablauf und ist HMAC-signiert; in
 * portal_access liegt nur der Hash, nie der Token selbst. Wer die Datenbank
 * liest, kann daraus keinen gültigen Link bauen.
 *
 * Ablauf 90 Tage, widerrufbar über revoked_at.
 *
 * Die HMAC-Rechnung selbst steht in lib/token/hmac.ts, damit es sie nur
 * einmal gibt. Hier bleibt bewusst das ungeleitete Geheimnis als
 * Schlüssel: Es sind Links im Umlauf, und ein abgeleiteter Schlüssel
 * würde sie alle auf einmal entwerten.
 */

const ABLAUF_TAGE = 90;

export type TokenPayload = { customerId: string; exp: number };

/** Erzeugt einen Token. Der Rückgabewert wird nur einmal ausgegeben. */
export function createToken(customerId: string, tage = ABLAUF_TAGE): string {
  const exp = Math.floor(Date.now() / 1000) + tage * 86400;
  const nonce = randomBytes(6).toString("base64url");
  const body = `${customerId}.${exp}.${nonce}`;
  return `${base64url(body)}.${signiere(geheimnis(), body)}`;
}

/** Prüft Signatur und Ablauf. Gibt null zurück, wenn irgendetwas nicht stimmt. */
export function verifyToken(token: string): TokenPayload | null {
  const teile = token.split(".");
  if (teile.length !== 2) return null;

  const [kopf, signatur] = teile as [string, string];
  const body = ausBase64url(kopf);
  if (body === null) return null;

  if (!gleich(signatur, signiere(geheimnis(), body))) return null;

  const [customerId, expStr] = body.split(".");
  if (!customerId || !expStr) return null;

  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp * 1000 < Date.now()) return null;

  return { customerId, exp };
}

/** Nur der Hash landet in der Datenbank. */
export function hashToken(token: string): string {
  return hashe(geheimnis(), token);
}
