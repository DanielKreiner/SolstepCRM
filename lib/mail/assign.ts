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
  quoteId: string | null;
  jobId: string | null;
  grund: "token" | "reply_to" | "address" | null;
};

const LEER: Zuordnung = {
  customerId: null,
  quoteId: null,
  jobId: null,
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
      .select("quote_id, job_id, invoice_id")
      .eq("company_id", companyId)
      .eq("track_token", token)
      .maybeSingle();

    if (data) {
      const kunde = await kundeZu(admin, companyId, data);
      return {
        customerId: kunde,
        quoteId: (data.quote_id as string | null) ?? null,
        jobId: (data.job_id as string | null) ?? null,
        grund: "token",
      };
    }
  }

  // 2. Antwort auf eine eigene Mail.
  if (mail.inReplyTo) {
    const { data } = await admin
      .from("mail_message")
      .select("customer_id, quote_id, job_id")
      .eq("company_id", companyId)
      .eq("message_id", mail.inReplyTo)
      .maybeSingle();

    if (data) {
      return {
        customerId: (data.customer_id as string | null) ?? null,
        quoteId: (data.quote_id as string | null) ?? null,
        jobId: (data.job_id as string | null) ?? null,
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
        quoteId: null,
        jobId: null,
        grund: "address",
      };
    }
  }

  return LEER;
}

async function kundeZu(
  admin: SupabaseClient,
  companyId: string,
  bezug: { quote_id?: unknown; job_id?: unknown; invoice_id?: unknown },
): Promise<string | null> {
  if (bezug.quote_id) {
    const { data } = await admin
      .from("quote")
      .select("customer_id")
      .eq("id", bezug.quote_id as string)
      .maybeSingle();
    if (data) return data.customer_id as string;
  }
  if (bezug.job_id) {
    const { data } = await admin
      .from("job")
      .select("customer_id")
      .eq("id", bezug.job_id as string)
      .maybeSingle();
    if (data) return data.customer_id as string;
  }
  if (bezug.invoice_id) {
    const { data } = await admin
      .from("invoice")
      .select("job:job_id ( customer_id )")
      .eq("id", bezug.invoice_id as string)
      .maybeSingle();
    const job = data?.job as unknown as { customer_id: string } | null;
    if (job) return job.customer_id;
  }
  void companyId;
  return null;
}
