"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { AktionsStatus } from "@/components/ui/Formular";
import { round2, totals } from "@/lib/money";
import { requireMe } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

/*
 * Angebote und ihre Positionen.
 *
 * Ein Angebot entsteht jetzt hier — von Hand, wie in einem Angebotswerkzeug.
 * Der Planungsimport ist entfallen.
 *
 * Zwei Dinge zieht jede Änderung an einer Position nach:
 *
 *   net_total   die Summe der Positionen. Sie steht am Angebot, weil Listen
 *               und Kennzahlen sie ohne Join brauchen.
 *   cost_total  die Summe der Einkaufspreise. Daraus rechnet die Datenbank
 *               margin_pct als generierte Spalte — die Marge ist damit nie
 *               von Hand gepflegt und kann nicht auseinanderlaufen.
 *
 * Beide werden nach jeder Positionsänderung neu gerechnet und nie
 * inkrementell fortgeschrieben: eine Summe, die man addiert und subtrahiert,
 * driftet irgendwann von ihren Zeilen weg.
 */

const leerZuNull = (v: string | undefined): string | null =>
  v && v.trim() !== "" ? v.trim() : null;

async function darfSchreiben() {
  const me = await requireMe();
  if (me.perms.angebote !== "write") {
    return {
      ok: false as const,
      status: {
        error: "Für Angebote fehlt deiner Rolle das Schreibrecht.",
        ok: null,
      },
    };
  }
  return { ok: true as const, me };
}

/**
 * Summen des Angebots neu rechnen.
 *
 * Ein bereits angenommenes Angebot wird nicht mehr angefasst: es ist die
 * Grundlage des Auftrags, und eine nachträglich verschobene Summe würde
 * einen Vertrag rückwirkend ändern.
 */
async function summenNachziehen(
  supabase: Awaited<ReturnType<typeof createClient>>,
  quoteId: string,
): Promise<void> {
  const { data: positionen } = await supabase
    .from("quote_item")
    .select("qty, sale_price, purchase_price, vat_rate")
    .eq("quote_id", quoteId);

  const zeilen = positionen ?? [];

  const summe = totals(
    zeilen.map((p) => ({
      qty: Number(p.qty),
      unitPrice: Number(p.sale_price),
      vatRate: Number(p.vat_rate),
    })),
  );

  const kosten = round2(
    zeilen.reduce((s, p) => s + Number(p.qty) * Number(p.purchase_price), 0),
  );

  await supabase
    .from("quote")
    .update({
      net_total: summe.net,
      cost_total: kosten,
      updated_at: new Date().toISOString(),
    })
    .eq("id", quoteId);
}

// --------------------------------------------------------------------------
// Angebot
// --------------------------------------------------------------------------

const angebotSchema = z.object({
  customerId: z.string().uuid("Kunde fehlt."),
  validUntil: z.string().trim().optional().or(z.literal("")),
  ownerId: z.string().uuid().optional().or(z.literal("")),
});

export async function createQuote(
  _prev: AktionsStatus,
  formData: FormData,
): Promise<AktionsStatus> {
  const zugang = await darfSchreiben();
  if (!zugang.ok) return zugang.status;

  const parsed = angebotSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Eingabe fehlt.", ok: null };
  }
  const d = parsed.data;

  const supabase = await createClient();

  const { data: nummer, error: nummerFehler } = await supabase.rpc("next_number", {
    p_company: zugang.me.companyId,
    p_kind: "quote",
  });
  if (nummerFehler || !nummer) {
    return {
      error: `Nummernvergabe fehlgeschlagen: ${nummerFehler?.message ?? "keine Nummer"}`,
      ok: null,
    };
  }

  /* Ohne Angabe 30 Tage gültig — die übliche Frist im Handwerk. */
  const gueltig = leerZuNull(d.validUntil);
  const standard = new Date();
  standard.setDate(standard.getDate() + 30);

  const { data, error } = await supabase
    .from("quote")
    .insert({
      company_id: zugang.me.companyId,
      customer_id: d.customerId,
      number: nummer as string,
      status: "draft",
      valid_until: gueltig ?? standard.toISOString().slice(0, 10),
      owner_id: leerZuNull(d.ownerId) ?? zugang.me.id,
      net_total: 0,
      cost_total: 0,
    })
    .select("id, number")
    .single();

  if (error) return { error: `Anlegen fehlgeschlagen: ${error.message}`, ok: null };

  revalidatePath("/angebote");
  revalidatePath("/pipelines/vertrieb");
  return { error: null, ok: `Angebot ${data.number as string} angelegt.` };
}

export async function updateQuote(
  _prev: AktionsStatus,
  formData: FormData,
): Promise<AktionsStatus> {
  const zugang = await darfSchreiben();
  if (!zugang.ok) return zugang.status;

  const id = z.string().uuid().safeParse(formData.get("quoteId"));
  if (!id.success) return { error: "Angebot fehlt.", ok: null };

  const parsed = angebotSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Eingabe fehlt.", ok: null };
  }

  const supabase = await createClient();
  const gesperrt = await istAngenommen(supabase, id.data);
  if (gesperrt) return gesperrt;

  const { error } = await supabase
    .from("quote")
    .update({
      customer_id: parsed.data.customerId,
      valid_until: leerZuNull(parsed.data.validUntil),
      owner_id: leerZuNull(parsed.data.ownerId),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id.data);

  if (error) return { error: `Speichern fehlgeschlagen: ${error.message}`, ok: null };

  revalidatePath(`/angebote/${id.data}`);
  revalidatePath("/angebote");
  return { error: null, ok: "Gespeichert." };
}

export async function deleteQuote(
  _prev: AktionsStatus,
  formData: FormData,
): Promise<AktionsStatus> {
  const zugang = await darfSchreiben();
  if (!zugang.ok) return zugang.status;

  const id = z.string().uuid().safeParse(formData.get("quoteId"));
  if (!id.success) return { error: "Angebot fehlt.", ok: null };

  const supabase = await createClient();

  const { data: quote } = await supabase
    .from("quote")
    .select("number, accepted_at, sent_at")
    .eq("id", id.data)
    .maybeSingle();

  if (!quote) return { error: "Angebot nicht gefunden.", ok: null };

  if (quote.accepted_at) {
    return {
      error: "Ein angenommenes Angebot ist die Grundlage des Auftrags und bleibt.",
      ok: null,
    };
  }
  if (quote.sent_at) {
    return {
      error:
        "Dieses Angebot ist beim Kunden. Setz es auf verloren, statt es zu löschen — sonst fehlt der Vorgang in der Nachvollziehbarkeit.",
      ok: null,
    };
  }

  const { error } = await supabase.from("quote").delete().eq("id", id.data);
  if (error) return { error: `Löschen fehlgeschlagen: ${error.message}`, ok: null };

  revalidatePath("/angebote");
  return { error: null, ok: `${quote.number as string} gelöscht.` };
}

// --------------------------------------------------------------------------
// Positionen
// --------------------------------------------------------------------------

const positionSchema = z.object({
  quoteId: z.string().uuid(),
  articleId: z.string().uuid().optional().or(z.literal("")),
  text: z.string().trim().min(2, "Bezeichnung fehlt.").max(200),
  qty: z.coerce.number().gt(0, "Menge muss größer als null sein.").max(1000000),
  unit: z.string().trim().min(1).max(12),
  purchasePrice: z.coerce.number().min(0).max(10000000).default(0),
  salePrice: z.coerce.number().min(0).max(10000000).default(0),
  vatRate: z.coerce.number().min(0).max(30).default(20),
});

/** Prüft, ob das Angebot bereits angenommen ist — dann ist es eingefroren. */
async function istAngenommen(
  supabase: Awaited<ReturnType<typeof createClient>>,
  quoteId: string,
): Promise<AktionsStatus | null> {
  const { data } = await supabase
    .from("quote")
    .select("accepted_at")
    .eq("id", quoteId)
    .maybeSingle();

  if (data?.accepted_at) {
    return {
      error:
        "Das Angebot ist angenommen und damit die Grundlage des Auftrags. Änderungen daran würden einen Vertrag rückwirkend verschieben.",
      ok: null,
    };
  }
  return null;
}

export async function addQuoteItem(
  _prev: AktionsStatus,
  formData: FormData,
): Promise<AktionsStatus> {
  const zugang = await darfSchreiben();
  if (!zugang.ok) return zugang.status;

  const parsed = positionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Eingabe fehlt.", ok: null };
  }
  const d = parsed.data;

  const supabase = await createClient();
  const gesperrt = await istAngenommen(supabase, d.quoteId);
  if (gesperrt) return gesperrt;

  const { data: letzte } = await supabase
    .from("quote_item")
    .select("pos")
    .eq("quote_id", d.quoteId)
    .order("pos", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await supabase.from("quote_item").insert({
    company_id: zugang.me.companyId,
    quote_id: d.quoteId,
    pos: Number(letzte?.pos ?? 0) + 10,
    article_id: leerZuNull(d.articleId),
    text: d.text,
    qty: d.qty,
    unit: d.unit,
    purchase_price: d.purchasePrice,
    sale_price: d.salePrice,
    vat_rate: d.vatRate,
    unmatched: false,
  });

  if (error) return { error: `Anlegen fehlgeschlagen: ${error.message}`, ok: null };

  await summenNachziehen(supabase, d.quoteId);
  revalidatePath(`/angebote/${d.quoteId}`);
  revalidatePath("/angebote");
  return { error: null, ok: `Position „${d.text}“ hinzugefügt.` };
}

export async function updateQuoteItem(
  _prev: AktionsStatus,
  formData: FormData,
): Promise<AktionsStatus> {
  const zugang = await darfSchreiben();
  if (!zugang.ok) return zugang.status;

  const itemId = z.string().uuid().safeParse(formData.get("itemId"));
  if (!itemId.success) return { error: "Position fehlt.", ok: null };

  const parsed = positionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Eingabe fehlt.", ok: null };
  }
  const d = parsed.data;

  const supabase = await createClient();
  const gesperrt = await istAngenommen(supabase, d.quoteId);
  if (gesperrt) return gesperrt;

  const { error } = await supabase
    .from("quote_item")
    .update({
      article_id: leerZuNull(d.articleId),
      text: d.text,
      qty: d.qty,
      unit: d.unit,
      purchase_price: d.purchasePrice,
      sale_price: d.salePrice,
      vat_rate: d.vatRate,
    })
    .eq("id", itemId.data);

  if (error) return { error: `Speichern fehlgeschlagen: ${error.message}`, ok: null };

  await summenNachziehen(supabase, d.quoteId);
  revalidatePath(`/angebote/${d.quoteId}`);
  revalidatePath("/angebote");
  return { error: null, ok: "Position gespeichert." };
}

export async function deleteQuoteItem(
  _prev: AktionsStatus,
  formData: FormData,
): Promise<AktionsStatus> {
  const zugang = await darfSchreiben();
  if (!zugang.ok) return zugang.status;

  const parsed = z
    .object({ itemId: z.string().uuid(), quoteId: z.string().uuid() })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Position fehlt.", ok: null };

  const supabase = await createClient();
  const gesperrt = await istAngenommen(supabase, parsed.data.quoteId);
  if (gesperrt) return gesperrt;

  const { error } = await supabase
    .from("quote_item")
    .delete()
    .eq("id", parsed.data.itemId);

  if (error) return { error: `Löschen fehlgeschlagen: ${error.message}`, ok: null };

  await summenNachziehen(supabase, parsed.data.quoteId);
  revalidatePath(`/angebote/${parsed.data.quoteId}`);
  revalidatePath("/angebote");
  return { error: null, ok: "Position gelöscht." };
}

/**
 * Position aus einem Artikel vorbelegen.
 *
 * Nimmt Bezeichnung, Einheit, Einkaufs- und Verkaufspreis sowie den
 * Steuersatz aus dem Artikelstamm. Die Werte werden KOPIERT, nicht
 * verknüpft: ändert sich der Artikelpreis nächstes Jahr, bleibt das
 * Angebot von damals, wie es war.
 */
export async function addQuoteItemFromArticle(
  _prev: AktionsStatus,
  formData: FormData,
): Promise<AktionsStatus> {
  const zugang = await darfSchreiben();
  if (!zugang.ok) return zugang.status;

  const parsed = z
    .object({
      quoteId: z.string().uuid(),
      articleId: z.string().uuid("Artikel fehlt."),
      qty: z.coerce.number().gt(0, "Menge muss größer als null sein."),
    })
    .safeParse(Object.fromEntries(formData));

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Eingabe fehlt.", ok: null };
  }
  const d = parsed.data;

  const supabase = await createClient();
  const gesperrt = await istAngenommen(supabase, d.quoteId);
  if (gesperrt) return gesperrt;

  const { data: artikel } = await supabase
    .from("article")
    .select("id, sku, name, unit, purchase_price, sale_price, vat_rate")
    .eq("id", d.articleId)
    .maybeSingle();

  if (!artikel) return { error: "Artikel nicht gefunden.", ok: null };

  const { data: letzte } = await supabase
    .from("quote_item")
    .select("pos")
    .eq("quote_id", d.quoteId)
    .order("pos", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await supabase.from("quote_item").insert({
    company_id: zugang.me.companyId,
    quote_id: d.quoteId,
    pos: Number(letzte?.pos ?? 0) + 10,
    article_id: artikel.id,
    text: `${artikel.name as string} (${artikel.sku as string})`,
    qty: d.qty,
    unit: artikel.unit as string,
    purchase_price: artikel.purchase_price,
    sale_price: artikel.sale_price,
    vat_rate: artikel.vat_rate,
    unmatched: false,
  });

  if (error) return { error: `Anlegen fehlgeschlagen: ${error.message}`, ok: null };

  await summenNachziehen(supabase, d.quoteId);
  revalidatePath(`/angebote/${d.quoteId}`);
  revalidatePath("/angebote");
  return { error: null, ok: `${artikel.name as string} übernommen.` };
}
