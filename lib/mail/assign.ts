import type { SupabaseClient } from "@supabase/supabase-js";

/*
 * Zuordnung einer eingehenden Mail (CLAUDE.md 6.1).
 *
 * Reihenfolge, absteigend nach Verlässlichkeit:
 *   1. Reply-To-Token in den Kopfzeilen — eindeutig, weil wir ihn selbst
 *      gesetzt haben
 *   2. In-Reply-To gegen die message_id einer eigenen ausgehenden Mail
 *   3. Absenderadresse gegen customer.email
 *   4. nichts davon: Posteingang "nicht zugeordnet"
 *
 * Die Reihenfolge ist nicht beliebig. Eine Adresse kann mehreren Kunden
 * gehören (info@ bei einer Hausverwaltung), ein Token nicht.
 */

export type Eingang = {
  messageId: string;
  inReplyTo: string | null;
  from: string | null;
  subject: string | null;
};

export type Zuordnung = {
  customerId: string | null;
  vorgangId: string | null;
  grund: "token" | "reply_to" | "address" | null;
};

const LEER: Zuordnung = {
  customerId: null,
  vorgangId: null,
  grund: null,
};

/** office+q7f3a2@… — der Teil hinter dem Plus ist unser Token. */
export function tokenAusAdresse(adresse: string | null): string | null {
  if (!adresse) return null;
  const treffer = /\+([a-z0-9]{4,32})@/i.exec(adresse);
  return treffer?.[1] ?? null;
}

export async function ordneZu(
  admin: SupabaseClient,
  companyId: string,
  mail: Eingang,
): Promise<Zuordnung> {
  // 1. Token — der Kunde hat auf eine Adresse mit Plus-Teil geantwortet.
  const token = tokenAusAdresse(mail.from);
  if (token) {
    const { data } = await admin
      .from("mail_outbox")
      .select("vorgang_id")
      .eq("company_id", companyId)
      .eq("track_token", token)
      .maybeSingle();

    if (data) {
      return {
        customerId: await kundeZu(admin, data.vorgang_id as string | null),
        vorgangId: (data.vorgang_id as string | null) ?? null,
        grund: "token",
      };
    }
  }

  // 2. Antwort auf eine eigene Mail.
  if (mail.inReplyTo) {
    const { data } = await admin
      .from("mail_message")
      .select("customer_id, vorgang_id")
      .eq("company_id", companyId)
      .eq("message_id", mail.inReplyTo)
      .maybeSingle();

    if (data) {
      return {
        customerId: (data.customer_id as string | null) ?? null,
        vorgangId: (data.vorgang_id as string | null) ?? null,
        grund: "reply_to",
      };
    }
  }

  // 3. Absenderadresse. Nur bei genau einem Treffer — sonst rät man.
  if (mail.from) {
    const { data } = await admin
      .from("customer")
      .select("id")
      .eq("company_id", companyId)
      .eq("email", mail.from)
      .is("deleted_at", null)
      .limit(2);

    if ((data ?? []).length === 1) {
      return {
        customerId: data![0]!.id as string,
        vorgangId: null,
        grund: "address",
      };
    }
  }

  return LEER;
}

/** Der Kunde hinter einem Vorgang — für die Zuordnung über den Token. */
async function kundeZu(
  admin: SupabaseClient,
  vorgangId: string | null,
): Promise<string | null> {
  if (!vorgangId) return null;
  const { data } = await admin
    .from("vorgang")
    .select("customer_id")
    .eq("id", vorgangId)
    .maybeSingle();
  return (data?.customer_id as string | null) ?? null;
}
