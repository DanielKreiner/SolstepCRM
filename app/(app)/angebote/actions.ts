"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireMe } from "@/lib/session";
import { angebotAnnehmen } from "@/lib/quote-accept";

export type QuoteState = { error: string | null; ok: string | null };

const sendSchema = z.object({ quoteId: z.string().uuid() });

export async function sendQuote(
  _prev: QuoteState,
  formData: FormData,
): Promise<QuoteState> {
  const me = await requireMe();
  if (me.perms.angebote !== "write") {
    return { error: "Keine Berechtigung für Angebote.", ok: null };
  }

  const parsed = sendSchema.safeParse({ quoteId: formData.get("quoteId") });
  if (!parsed.success) return { error: "Angebot nicht gefunden.", ok: null };

  const supabase = await createClient();

  const { data: quote } = await supabase
    .from("quote")
    .select("id, number, net_total, customer:customer_id ( name, email )")
    .eq("id", parsed.data.quoteId)
    .maybeSingle();

  if (!quote) return { error: "Angebot nicht gefunden.", ok: null };

  const customer = quote.customer as unknown as {
    name: string;
    email: string | null;
  } | null;

  if (!customer?.email) {
    return {
      error: "Der Kunde hat keine E-Mail-Adresse hinterlegt.",
      ok: null,
    };
  }

  const { count: items } = await supabase
    .from("quote_item")
    .select("id", { count: "exact", head: true })
    .eq("quote_id", parsed.data.quoteId);

  if ((items ?? 0) === 0) {
    return { error: "Das Angebot hat noch keine Positionen.", ok: null };
  }

  const { data: account } = await supabase
    .from("v_mail_account")
    .select("id, address")
    .eq("is_default", true)
    .maybeSingle();

  if (!account) {
    return {
      error:
        "Es ist kein Postfach eingehängt. Ohne Postfach kann nichts versendet werden.",
      ok: null,
    };
  }

  const { error: outboxErr } = await supabase.from("mail_outbox").insert({
    company_id: me.companyId,
    mail_account_id: account.id,
    to_addrs: [customer.email],
    subject: `Ihr Angebot ${quote.number as string}`,
    body_html: `<p>Guten Tag,</p><p>anbei unser Angebot ${quote.number as string}.</p>`,
    body_text: `Guten Tag,\n\nanbei unser Angebot ${quote.number as string}.`,
    quote_id: quote.id,
  });

  if (outboxErr) {
    return { error: `Versand fehlgeschlagen: ${outboxErr.message}`, ok: null };
  }

  await supabase
    .from("quote")
    .update({ status: "sent", sent_at: new Date().toISOString() })
    .eq("id", parsed.data.quoteId);

  await supabase.from("quote_event").insert({
    company_id: me.companyId,
    quote_id: quote.id,
    kind: "sent",
    meta_json: { to: customer.email },
  });

  revalidatePath(`/angebote/${parsed.data.quoteId}`);
  return {
    error: null,
    ok: `In die Warteschlange gelegt an ${customer.email}. Versand über ${account.address}.`,
  };
}

/* ------------------------------------------------------------- ANNAHME */

const acceptSchema = z.object({
  quoteId: z.string().uuid(),
  name: z.string().trim().min(2, "Name fehlt."),
});

/**
 * Digitale Annahme.
 *
 * Definition of Done Meilenstein 3: die Annahme legt einen Auftrag an und
 * erzeugt die Aufgabe "Termin fixieren". Beides in einem Schritt, sonst
 * hängt ein angenommenes Angebot ohne Folgearbeit in der Pipeline.
 */
export async function acceptQuote(
  _prev: QuoteState,
  formData: FormData,
): Promise<QuoteState> {
  const me = await requireMe();
  if (me.perms.angebote !== "write") {
    return { error: "Keine Berechtigung für Angebote.", ok: null };
  }

  const parsed = acceptSchema.safeParse({
    quoteId: formData.get("quoteId"),
    name: formData.get("name"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Eingabe fehlt.", ok: null };
  }

  const supabase = await createClient();
  const ergebnis = await angebotAnnehmen(supabase, {
    quoteId: parsed.data.quoteId,
    companyId: me.companyId,
    name: parsed.data.name,
    via: "backoffice",
    userId: me.id,
  });

  if (!ergebnis.ok) return { error: ergebnis.grund, ok: null };

  if (!ergebnis.neu) {
    return {
      error: null,
      ok: `War bereits angenommen. Auftrag ${ergebnis.jobNumber}.`,
    };
  }

  await supabase.from("notification").insert({
    company_id: me.companyId,
    user_id: me.id,
    kind: "quote_accepted",
    title: `Angebot ${ergebnis.quoteNumber} angenommen`,
    body: `Auftrag ${ergebnis.jobNumber} angelegt. Nächster Schritt: Termin fixieren.`,
    link: `/auftraege/${ergebnis.jobId}`,
  });

  revalidatePath(`/angebote/${parsed.data.quoteId}`);
  revalidatePath("/angebote");
  revalidatePath("/auftraege");
  revalidatePath("/pipelines/vertrieb");
  revalidatePath("/pipelines/projekte");

  return {
    error: null,
    ok: `Angenommen. Auftrag ${ergebnis.jobNumber} angelegt, Aufgabe „Termin fixieren“ gesetzt.`,
  };
}
