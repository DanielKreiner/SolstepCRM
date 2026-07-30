"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { proposalCsv } from "@/lib/procurement";
import { createClient } from "@/lib/supabase/server";
import { requireMe } from "@/lib/session";

export type OrderState = { error: string | null; ok: string | null };

const createSchema = z.object({
  supplierId: z.string().uuid("Lieferant fehlt."),
  /** JSON: [{ articleId, qty }] */
  lines: z.string().min(2),
});

const lineSchema = z.array(
  z.object({ articleId: z.string().uuid(), qty: z.coerce.number().positive() }),
);

/**
 * Bestellung aus dem Vorschlag erzeugen.
 *
 * Die Menge wird serverseitig noch einmal gegen den Artikel geprüft: der
 * Vorschlag ist eine Rechnung des Servers, aber das Formular kommt aus dem
 * Browser und ist damit beliebig manipulierbar.
 */
export async function createPurchaseOrder(
  _prev: OrderState,
  formData: FormData,
): Promise<OrderState> {
  const me = await requireMe();
  if (me.perms.lager !== "write") {
    return { error: "Keine Berechtigung für Bestellungen.", ok: null };
  }

  const parsed = createSchema.safeParse({
    supplierId: formData.get("supplierId"),
    lines: formData.get("lines"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Eingabe fehlt.", ok: null };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(parsed.data.lines);
  } catch {
    return { error: "Positionen konnten nicht gelesen werden.", ok: null };
  }

  const lines = lineSchema.safeParse(raw);
  if (!lines.success || lines.data.length === 0) {
    return { error: "Keine Positionen ausgewählt.", ok: null };
  }

  const supabase = await createClient();

  const { data: nummer, error: nrErr } = await supabase.rpc("next_number", {
    p_company: me.companyId,
    p_kind: "purchase_order",
  });
  if (nrErr) return { error: `Nummernkreis: ${nrErr.message}`, ok: null };

  const maxTage = await leadDays(
    supabase,
    parsed.data.supplierId,
    lines.data.map((l) => l.articleId),
  );
  const liefertermin = new Date();
  liefertermin.setDate(liefertermin.getDate() + maxTage);

  const { data: order, error: orderErr } = await supabase
    .from("purchase_order")
    .insert({
      company_id: me.companyId,
      supplier_id: parsed.data.supplierId,
      number: nummer as string,
      status: "draft",
      due_date: liefertermin.toISOString().slice(0, 10),
    })
    .select("id, number")
    .single();

  if (orderErr) {
    return { error: `Bestellung fehlgeschlagen: ${orderErr.message}`, ok: null };
  }

  const { data: preise } = await supabase
    .from("article_supplier")
    .select("article_id, price")
    .eq("supplier_id", parsed.data.supplierId);

  const preisMap = new Map(
    (preise ?? []).map((p) => [p.article_id as string, Number(p.price)]),
  );

  const { error: itemErr } = await supabase.from("purchase_order_item").insert(
    lines.data.map((l) => ({
      company_id: me.companyId,
      purchase_order_id: order.id,
      article_id: l.articleId,
      qty: l.qty,
      price: preisMap.get(l.articleId) ?? null,
    })),
  );

  if (itemErr) {
    return { error: `Positionen fehlgeschlagen: ${itemErr.message}`, ok: null };
  }

  revalidatePath("/lager/bestellungen");
  return {
    error: null,
    ok: `Bestellung ${order.number as string} angelegt, ${lines.data.length} Positionen.`,
  };
}

const sendSchema = z.object({ orderId: z.string().uuid() });

/**
 * Bestellung an den Lieferanten senden.
 * PDF und CSV als Anhang, Versand über das Postfach des Mandanten.
 */
export async function sendPurchaseOrder(
  _prev: OrderState,
  formData: FormData,
): Promise<OrderState> {
  const me = await requireMe();
  if (me.perms.lager !== "write") {
    return { error: "Keine Berechtigung für Bestellungen.", ok: null };
  }

  const parsed = sendSchema.safeParse({ orderId: formData.get("orderId") });
  if (!parsed.success) return { error: "Bestellung nicht gefunden.", ok: null };

  const supabase = await createClient();

  const { data: order } = await supabase
    .from("purchase_order")
    .select("id, number, status, due_date, supplier:supplier_id ( name, email )")
    .eq("id", parsed.data.orderId)
    .maybeSingle();

  if (!order) return { error: "Bestellung nicht gefunden.", ok: null };

  const supplier = order.supplier as unknown as {
    name: string;
    email: string | null;
  } | null;

  if (!supplier?.email) {
    return {
      error: `${supplier?.name ?? "Der Lieferant"} hat keine E-Mail-Adresse.`,
      ok: null,
    };
  }

  const { data: account } = await supabase
    .from("v_mail_account")
    .select("id, address")
    .eq("is_default", true)
    .maybeSingle();

  if (!account) {
    return { error: "Es ist kein Postfach eingehängt.", ok: null };
  }

  const { data: items } = await supabase
    .from("purchase_order_item")
    .select("qty, price, article:article_id ( sku, name, unit )")
    .eq("purchase_order_id", order.id);

  const zeilen = (items ?? []).map((i) => {
    const a = i.article as unknown as {
      sku: string;
      name: string;
      unit: string;
    } | null;
    return {
      sku: a?.sku ?? "",
      name: a?.name ?? "",
      qty: Number(i.qty),
      unit: a?.unit ?? "Stk",
      price: Number(i.price ?? 0),
    };
  });

  if (zeilen.length === 0) {
    return { error: "Die Bestellung hat keine Positionen.", ok: null };
  }

  const csv = proposalCsv(zeilen);
  const tabelle = zeilen
    .map(
      (z) =>
        `<tr><td>${escapeHtml(z.sku)}</td><td>${escapeHtml(z.name)}</td>` +
        `<td align="right">${z.qty} ${escapeHtml(z.unit)}</td></tr>`,
    )
    .join("");

  const { error: outErr } = await supabase.from("mail_outbox").insert({
    company_id: me.companyId,
    mail_account_id: account.id,
    to_addrs: [supplier.email],
    subject: `Bestellung ${order.number as string}`,
    body_html:
      `<p>Guten Tag,</p><p>bitte um Lieferung folgender Positionen zur Bestellung ` +
      `${escapeHtml(order.number as string)}:</p>` +
      `<table cellpadding="4" border="0"><tbody>${tabelle}</tbody></table>` +
      (order.due_date ? `<p>Wunschtermin: ${order.due_date as string}</p>` : ""),
    body_text: csv,
    attachments: [
      {
        filename: `Bestellung-${order.number as string}.csv`,
        content_base64: Buffer.from(csv, "utf8").toString("base64"),
        mime: "text/csv",
      },
    ],
  });

  if (outErr) {
    return { error: `Versand fehlgeschlagen: ${outErr.message}`, ok: null };
  }

  await supabase
    .from("purchase_order")
    .update({ status: "open", sent_at: new Date().toISOString() })
    .eq("id", order.id);

  revalidatePath("/lager/bestellungen");
  return {
    error: null,
    ok: `Bestellung ${order.number as string} an ${supplier.email} eingereiht.`,
  };
}

const receiveSchema = z.object({
  orderId: z.string().uuid(),
  itemId: z.string().uuid(),
  qty: z.coerce.number().positive(),
});

/**
 * Wareneingang buchen. Erzeugt eine stock_move-Zeile — der Bestand wird
 * ausschließlich vom Trigger fortgeschrieben, nie hier.
 */
export async function receiveItem(
  _prev: OrderState,
  formData: FormData,
): Promise<OrderState> {
  const me = await requireMe();
  if (me.perms.lager !== "write") {
    return { error: "Keine Berechtigung.", ok: null };
  }

  const parsed = receiveSchema.safeParse({
    orderId: formData.get("orderId"),
    itemId: formData.get("itemId"),
    qty: formData.get("qty"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Eingabe fehlt.", ok: null };
  }

  const supabase = await createClient();

  const { data: item } = await supabase
    .from("purchase_order_item")
    .select("id, article_id, qty, received_qty")
    .eq("id", parsed.data.itemId)
    .maybeSingle();

  if (!item) return { error: "Position nicht gefunden.", ok: null };

  const { error: moveErr } = await supabase.from("stock_move").insert({
    company_id: me.companyId,
    article_id: item.article_id,
    user_id: me.id,
    qty: parsed.data.qty,
    kind: "goods_in",
    note: `Wareneingang zur Bestellung`,
  });

  if (moveErr) {
    return { error: `Wareneingang fehlgeschlagen: ${moveErr.message}`, ok: null };
  }

  const neu = Number(item.received_qty) + parsed.data.qty;
  await supabase
    .from("purchase_order_item")
    .update({ received_qty: neu })
    .eq("id", item.id);

  // Vollständig geliefert? Dann die Bestellung schließen.
  const { data: rest } = await supabase
    .from("purchase_order_item")
    .select("qty, received_qty")
    .eq("purchase_order_id", parsed.data.orderId);

  const komplett = (rest ?? []).every(
    (r) => Number(r.received_qty) >= Number(r.qty),
  );
  if (komplett) {
    await supabase
      .from("purchase_order")
      .update({ status: "received" })
      .eq("id", parsed.data.orderId);
  }

  revalidatePath("/lager/bestellungen");
  revalidatePath("/lager");
  return { error: null, ok: `Wareneingang gebucht.` };
}

async function leadDays(
  supabase: Awaited<ReturnType<typeof createClient>>,
  supplierId: string,
  articleIds: string[],
): Promise<number> {
  const { data } = await supabase
    .from("article_supplier")
    .select("lead_days")
    .eq("supplier_id", supplierId)
    .in("article_id", articleIds);

  return Math.max(7, ...(data ?? []).map((d) => Number(d.lead_days)));
}

function escapeHtml(v: string): string {
  return v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
