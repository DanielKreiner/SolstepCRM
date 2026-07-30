"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  KIND_LABEL,
  nextInvoiceAmount,
  round2,
  vatRate,
  type InvoiceKind,
} from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { requireMe } from "@/lib/session";

export type InvoiceState = { error: string | null; ok: string | null };

const createSchema = z.object({
  jobId: z.string().uuid("Auftrag fehlt."),
  kind: z.enum(["deposit", "partial", "final"]),
  dueDays: z.coerce.number().int().min(0).max(90).default(14),
});

/**
 * Teilrechnung erzeugen.
 *
 * Der Betrag wird serverseitig gerechnet, nie aus dem Formular übernommen.
 * Die Schlussrechnung ist immer der Rest — so geht die Summe der
 * Teilrechnungen exakt auf den Auftragswert auf.
 */
export async function createInvoice(
  _prev: InvoiceState,
  formData: FormData,
): Promise<InvoiceState> {
  const me = await requireMe();
  if (me.perms.rechnungen !== "write") {
    return { error: "Keine Berechtigung für Rechnungen.", ok: null };
  }

  const parsed = createSchema.safeParse({
    jobId: formData.get("jobId"),
    kind: formData.get("kind"),
    dueDays: formData.get("dueDays") ?? 14,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Eingabe fehlt.", ok: null };
  }

  const supabase = await createClient();

  const { data: job } = await supabase
    .from("job")
    // customer hat kein Länderfeld — die Steuer richtet sich nach dem
    // Firmensitz, bis Reverse Charge je Kunde hinterlegt wird.
    .select("id, number, value_net, customer:customer_id ( id, name )")
    .eq("id", parsed.data.jobId)
    .maybeSingle();

  if (!job) return { error: "Auftrag nicht gefunden.", ok: null };

  const { data: bestehende } = await supabase
    .from("invoice")
    .select("amount_net, status, kind")
    .eq("job_id", job.id)
    .neq("status", "cancelled");

  const bereits = round2(
    (bestehende ?? []).reduce((s, i) => s + Number(i.amount_net), 0),
  );

  if ((bestehende ?? []).some((i) => i.kind === parsed.data.kind)) {
    return {
      error: `Für diesen Auftrag gibt es bereits eine ${KIND_LABEL[parsed.data.kind as InvoiceKind]}.`,
      ok: null,
    };
  }

  const wert = Number(job.value_net);
  const betrag = nextInvoiceAmount(wert, bereits, parsed.data.kind as InvoiceKind);

  if (betrag <= 0) {
    return { error: "Der Auftrag ist bereits vollständig fakturiert.", ok: null };
  }

  const { data: company } = await supabase
    .from("company")
    .select("country")
    .maybeSingle();

  // Reverse Charge steht am Kunden; ohne Feld gilt Normalbesteuerung.
  const satz = vatRate({
    country: (company?.country as string | null) ?? "AT",
    reverseCharge: false,
  });

  const { data: nummer, error: nrErr } = await supabase.rpc("next_number", {
    p_company: me.companyId,
    p_kind: "invoice",
  });
  if (nrErr) return { error: `Nummernkreis: ${nrErr.message}`, ok: null };

  const faellig = new Date();
  faellig.setDate(faellig.getDate() + parsed.data.dueDays);

  const { error } = await supabase.from("invoice").insert({
    company_id: me.companyId,
    job_id: job.id,
    number: nummer as string,
    kind: parsed.data.kind,
    amount_net: betrag,
    vat_amount: round2((betrag * satz) / 100),
    due_date: faellig.toISOString().slice(0, 10),
    status: "draft",
  });

  if (error) return { error: `Rechnung fehlgeschlagen: ${error.message}`, ok: null };

  revalidatePath("/rechnungen");
  revalidatePath(`/auftraege/${job.id}`);

  return {
    error: null,
    ok: `${KIND_LABEL[parsed.data.kind as InvoiceKind]} ${nummer as string} über ${betrag.toFixed(2)} EUR netto angelegt.`,
  };
}

const markSchema = z.object({
  invoiceId: z.string().uuid(),
  aktion: z.enum(["send", "paid", "cancel"]),
});

export async function updateInvoice(
  _prev: InvoiceState,
  formData: FormData,
): Promise<InvoiceState> {
  const me = await requireMe();
  if (me.perms.rechnungen !== "write") {
    return { error: "Keine Berechtigung für Rechnungen.", ok: null };
  }

  const parsed = markSchema.safeParse({
    invoiceId: formData.get("invoiceId"),
    aktion: formData.get("aktion"),
  });
  if (!parsed.success) return { error: "Ungültige Aktion.", ok: null };

  const supabase = await createClient();
  const { data: invoice } = await supabase
    .from("invoice")
    .select("id, number, amount_net, vat_amount, status")
    .eq("id", parsed.data.invoiceId)
    .maybeSingle();

  if (!invoice) return { error: "Rechnung nicht gefunden.", ok: null };

  if (parsed.data.aktion === "send") {
    if (invoice.status !== "draft") {
      return { error: "Nur Entwürfe können versendet werden.", ok: null };
    }
    await supabase.from("invoice").update({ status: "sent" }).eq("id", invoice.id);
    revalidatePath("/rechnungen");
    return { error: null, ok: `Rechnung ${invoice.number as string} versendet.` };
  }

  if (parsed.data.aktion === "paid") {
    const brutto = round2(
      Number(invoice.amount_net) + Number(invoice.vat_amount),
    );
    await supabase
      .from("invoice")
      .update({
        status: "paid",
        paid_at: new Date().toISOString(),
        paid_amount: brutto,
        dunning_level: 0,
      })
      .eq("id", invoice.id);
    revalidatePath("/rechnungen");
    return { error: null, ok: `Zahlung zu ${invoice.number as string} erfasst.` };
  }

  /*
   * Storno statt Löschen: eine erzeugte Rechnung ist unveränderlich
   * (CLAUDE.md 6.4). Korrigiert wird über Storno und Neuausstellung.
   */
  await supabase
    .from("invoice")
    .update({ status: "cancelled" })
    .eq("id", invoice.id);

  revalidatePath("/rechnungen");
  return { error: null, ok: `Rechnung ${invoice.number as string} storniert.` };
}
