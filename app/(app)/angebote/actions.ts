"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { matchPositions, plannerPayloadSchema } from "@/lib/planner";
import { createClient } from "@/lib/supabase/server";
import { requireMe } from "@/lib/session";

export type QuoteState = { error: string | null; ok: string | null };

/* ------------------------------------------------------------ IMPORT */

const importSchema = z.object({
  quoteId: z.string().uuid(),
  payload: z.string().min(2),
});

export async function importPlanning(
  _prev: QuoteState,
  formData: FormData,
): Promise<QuoteState> {
  const me = await requireMe();
  if (me.perms.angebote !== "write") {
    return { error: "Keine Berechtigung für Angebote.", ok: null };
  }

  const parsed = importSchema.safeParse({
    quoteId: formData.get("quoteId"),
    payload: formData.get("payload"),
  });
  if (!parsed.success) return { error: "Eingabe unvollständig.", ok: null };

  let json: unknown;
  try {
    json = JSON.parse(parsed.data.payload);
  } catch {
    return { error: "Die Datei ist kein gültiges JSON.", ok: null };
  }

  const payload = plannerPayloadSchema.safeParse(json);
  if (!payload.success) {
    const feld = payload.error.issues[0]?.path.join(".") ?? "?";
    return {
      error: `Planung passt nicht zum erwarteten Format (${feld}).`,
      ok: null,
    };
  }

  const supabase = await createClient();
  const [{ data: articles }, { data: aliasRows }] = await Promise.all([
    supabase
      .from("article")
      .select("id, sku, name, unit, purchase_price, sale_price")
      .eq("active", true),
    supabase.from("article_alias").select("alias, article_id"),
  ]);

  const aliases = new Map(
    (aliasRows ?? []).map((a) => [
      String(a.alias).trim().toLowerCase(),
      a.article_id as string,
    ]),
  );

  const preview = matchPositions(
    payload.data,
    (articles ?? []).map((a) => ({
      id: a.id as string,
      sku: a.sku as string,
      name: a.name as string,
      unit: a.unit as string,
      purchase_price: Number(a.purchase_price),
      sale_price: Number(a.sale_price),
    })),
    aliases,
  );

  // Bestehende Positionen ersetzen — ein zweiter Import derselben Planung
  // soll nicht die doppelte Stückliste ergeben.
  await supabase.from("quote_item").delete().eq("quote_id", parsed.data.quoteId);

  const rows = preview.positionen.map((p) => ({
    company_id: me.companyId,
    quote_id: parsed.data.quoteId,
    pos: p.pos,
    article_id: p.articleId,
    text: p.bezeichnung,
    qty: p.menge,
    unit: p.einheit,
    purchase_price: p.einkauf,
    sale_price: p.verkauf,
    unmatched: p.unmatched,
  }));

  const { error: insErr } = await supabase.from("quote_item").insert(rows);
  if (insErr) return { error: `Import fehlgeschlagen: ${insErr.message}`, ok: null };

  const { error: updErr } = await supabase
    .from("quote")
    .update({
      net_total: preview.summeVerkauf,
      cost_total: preview.summeEinkauf,
      planner_ref: preview.planungId,
      planner_payload: payload.data,
    })
    .eq("id", parsed.data.quoteId);

  if (updErr) return { error: `Import fehlgeschlagen: ${updErr.message}`, ok: null };

  revalidatePath(`/angebote/${parsed.data.quoteId}`);
  revalidatePath("/angebote");
  revalidatePath("/pipelines/vertrieb");

  return {
    error: null,
    ok:
      `${preview.erkannt} Positionen erkannt` +
      (preview.nichtZuordenbar > 0
        ? `, ${preview.nichtZuordenbar} nicht zuordenbar (rot markiert)`
        : ""),
  };
}

/* -------------------------------------------------------------- SENDEN */

const sendSchema = z.object({ quoteId: z.string().uuid() });

/**
 * Versand: erzeugt den Ausgangseintrag, setzt Status und protokolliert.
 * Tatsächlich verschickt wird über den Cron `mail-send` aus dem Postfach des
 * Mandanten — hier wird nichts direkt zugestellt (CLAUDE.md 6.1).
 */
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

  const { data: quote } = await supabase
    .from("quote")
    .select(
      "id, number, net_total, cost_total, customer_id, accepted_at, customer:customer_id ( name, address, zip, city )",
    )
    .eq("id", parsed.data.quoteId)
    .maybeSingle();

  if (!quote) return { error: "Angebot nicht gefunden.", ok: null };

  // Zweimal annehmen darf keinen zweiten Auftrag erzeugen.
  const { data: bestehend } = await supabase
    .from("job")
    .select("id, number")
    .eq("quote_id", quote.id)
    .maybeSingle();

  if (bestehend) {
    return {
      error: null,
      ok: `War bereits angenommen. Auftrag ${bestehend.number as string}.`,
    };
  }

  const [{ data: phase }, { data: nummer }, { data: location }] =
    await Promise.all([
      supabase
        .from("pipeline_phase")
        .select("id, pipeline:pipeline_id ( kind )")
        .eq("key", "beauftragt"),
      supabase.rpc("next_number", {
        p_company: me.companyId,
        p_kind: "job",
      }),
      supabase.from("location").select("id").limit(1).maybeSingle(),
    ]);

  const zielPhase = (phase ?? []).find(
    (p) => (p.pipeline as unknown as { kind: string } | null)?.kind === "projekte",
  );
  if (!zielPhase) {
    return { error: "Die Projekte-Pipeline hat keine Startphase.", ok: null };
  }

  const customer = quote.customer as unknown as {
    address: string | null;
    zip: string | null;
    city: string | null;
  } | null;

  const { data: job, error: jobErr } = await supabase
    .from("job")
    .insert({
      company_id: me.companyId,
      customer_id: quote.customer_id,
      quote_id: quote.id,
      location_id: location?.id ?? null,
      number: nummer as string,
      phase_id: zielPhase.id,
      value_net: quote.net_total,
      material_planned: quote.cost_total,
      address: customer?.address ?? null,
      zip: customer?.zip ?? null,
      city: customer?.city ?? null,
      next_step: "Termin fixieren",
      created_by: me.id,
    })
    .select("id, number")
    .single();

  if (jobErr) {
    return { error: `Auftrag konnte nicht angelegt werden: ${jobErr.message}`, ok: null };
  }

  // Die Aufgabe hängt am Auftrag, nicht an einer Notiz — sie muss abhakbar sein.
  await supabase.from("job_checklist_item").insert({
    company_id: me.companyId,
    job_id: job.id,
    sort: 1,
    label: "Termin fixieren",
  });

  // Angebot in die Gewonnen-Phase; der Trigger aus 0006 setzt den Status.
  const { data: wonPhase } = await supabase
    .from("pipeline_phase")
    .select("id, system_key, pipeline:pipeline_id ( kind )")
    .eq("system_key", "won");

  const won = (wonPhase ?? []).find(
    (p) => (p.pipeline as unknown as { kind: string } | null)?.kind === "vertrieb",
  );

  await supabase
    .from("quote")
    .update({
      ...(won ? { phase_id: won.id } : {}),
      accepted_name: parsed.data.name,
      accepted_at: new Date().toISOString(),
    })
    .eq("id", quote.id);

  await supabase.from("quote_event").insert({
    company_id: me.companyId,
    quote_id: quote.id,
    kind: "accepted",
    meta_json: { by: parsed.data.name, job: job.number },
  });

  await supabase.from("notification").insert({
    company_id: me.companyId,
    user_id: me.id,
    kind: "quote_accepted",
    title: `Angebot ${quote.number as string} angenommen`,
    body: `Auftrag ${job.number as string} angelegt. Nächster Schritt: Termin fixieren.`,
    link: `/auftraege/${job.id}`,
  });

  revalidatePath(`/angebote/${quote.id}`);
  revalidatePath("/angebote");
  revalidatePath("/auftraege");
  revalidatePath("/pipelines/vertrieb");
  revalidatePath("/pipelines/projekte");

  return {
    error: null,
    ok: `Angenommen. Auftrag ${job.number as string} angelegt, Aufgabe „Termin fixieren“ gesetzt.`,
  };
}
