import type { SupabaseClient } from "@supabase/supabase-js";
import { ausBytea, entschluesseln } from "@/lib/mail/crypto";

/*
 * Microsoft-Graph-Subscriptions (CLAUDE.md 6.2).
 *
 * Multi-Tenant-App mit Authorization-Code-Flow: jedes Postfach hat sein
 * eigenes Refresh-Token, verschlüsselt in mail_account.secret_enc. Kein
 * Client-Credentials-Flow auf dem eigenen Tenant — das wäre für ein
 * Mietmodell falsch, weil die Mandanten eigene M365-Tenants haben.
 *
 * Subscriptions laufen nach höchstens 4230 Minuten ab. Erneuert wird auf
 * 4200, damit ein Rundungsfehler nicht zum Ablauf führt.
 */

const MAX_MINUTEN = 4200;
const GRAPH = "https://graph.microsoft.com/v1.0";

async function zugriffstoken(refreshToken: string): Promise<string> {
  const antwort = await fetch(
    "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.MS_CLIENT_ID!,
        client_secret: process.env.MS_CLIENT_SECRET!,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        scope:
          "offline_access User.Read Mail.Send Mail.ReadWrite Calendars.ReadWrite",
      }),
    },
  );

  if (!antwort.ok) {
    throw new Error(`Token-Erneuerung fehlgeschlagen: ${antwort.status}`);
  }

  const daten = (await antwort.json()) as { access_token?: string };
  if (!daten.access_token) throw new Error("Kein Zugriffstoken erhalten.");
  return daten.access_token;
}

/** Verlängert die Subscription und gibt das neue Ablaufdatum zurück. */
export async function erneuereSubscription(
  admin: SupabaseClient,
  accountId: string,
): Promise<string> {
  const { data: konto, error } = await admin
    .from("mail_account")
    .select("id, subscription_id, secret_enc")
    .eq("id", accountId)
    .single();

  if (error) throw new Error(error.message);
  if (!konto.subscription_id) throw new Error("Keine Subscription hinterlegt.");

  const paket = ausBytea(konto.secret_enc);
  if (!paket) throw new Error("Kein Refresh-Token hinterlegt.");

  const token = await zugriffstoken(entschluesseln(paket));

  const neuesEnde = new Date(Date.now() + MAX_MINUTEN * 60_000).toISOString();
  const antwort = await fetch(
    `${GRAPH}/subscriptions/${konto.subscription_id as string}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ expirationDateTime: neuesEnde }),
    },
  );

  if (!antwort.ok) {
    const text = await antwort.text();
    throw new Error(`Graph ${antwort.status}: ${text.slice(0, 200)}`);
  }

  const daten = (await antwort.json()) as { expirationDateTime?: string };
  return daten.expirationDateTime ?? neuesEnde;
}
