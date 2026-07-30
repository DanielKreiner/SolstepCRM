"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { resolvePortal } from "@/lib/portal/data";
import { createAdminClient } from "@/lib/supabase/admin";

export type PortalState = { error: string | null; ok: string | null };

const acceptSchema = z.object({
  token: z.string().min(10),
  quoteId: z.string().uuid(),
  name: z.string().trim().min(2, "Bitte den Namen eintragen."),
});

/**
 * Digitale Annahme durch den Kunden.
 *
 * Festgehalten werden Name, Zeitpunkt und IP (CLAUDE.md Meilenstein 8).
 * Die IP ist der schwächste der drei Belege, aber zusammen mit dem
 * signierten Token und dem Namen reicht die Kette für den Nachweis, dass
 * die Annahme aus dem Zugang dieses Kunden kam.
 */
export async function acceptFromPortal(
  _prev: PortalState,
  formData: FormData,
): Promise<PortalState> {
  const parsed = acceptSchema.safeParse({
    token: formData.get("token"),
    quoteId: formData.get("quoteId"),
    name: formData.get("name"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Eingabe fehlt.", ok: null };
  }

  const session = await resolvePortal(parsed.data.token);
  if (!session) return { error: "Der Zugang ist abgelaufen.", ok: null };

  const admin = createAdminClient();

  // Das Angebot muss diesem Kunden gehören — der Token allein reicht nicht.
  const { data: quote } = await admin
    .from("quote")
    .select("id, number, accepted_at, customer_id, company_id")
    .eq("id", parsed.data.quoteId)
    .eq("customer_id", session.customerId)
    .eq("company_id", session.companyId)
    .maybeSingle();

  if (!quote) return { error: "Angebot nicht gefunden.", ok: null };
  if (quote.accepted_at) {
    return { error: null, ok: "Dieses Angebot ist bereits angenommen." };
  }

  const kopf = await headers();
  const ip =
    kopf.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    kopf.get("x-real-ip") ??
    null;

  const { data: won } = await admin
    .from("pipeline_phase")
    .select("id, system_key, pipeline:pipeline_id ( kind )")
    .eq("company_id", session.companyId)
    .eq("system_key", "won");

  const zielPhase = (won ?? []).find(
    (p) => (p.pipeline as unknown as { kind: string } | null)?.kind === "vertrieb",
  );

  const { error } = await admin
    .from("quote")
    .update({
      ...(zielPhase ? { phase_id: zielPhase.id } : {}),
      accepted_at: new Date().toISOString(),
      accepted_name: parsed.data.name,
      accepted_ip: ip,
    })
    .eq("id", quote.id);

  if (error) return { error: `Annahme fehlgeschlagen: ${error.message}`, ok: null };

  await admin.from("quote_event").insert({
    company_id: session.companyId,
    quote_id: quote.id,
    kind: "accepted",
    meta_json: { by: parsed.data.name, ip, via: "portal" },
  });

  await admin.from("notification").insert({
    company_id: session.companyId,
    kind: "quote_accepted_portal",
    title: `Angebot ${quote.number as string} im Portal angenommen`,
    body: `Angenommen durch ${parsed.data.name}.`,
    link: `/angebote/${quote.id}`,
  });

  revalidatePath(`/portal/${parsed.data.token}`);
  return {
    error: null,
    ok: `Danke. Die Annahme von ${quote.number as string} ist erfasst.`,
  };
}

const ticketSchema = z.object({
  token: z.string().min(10),
  category: z.enum(["stoerung", "frage", "beschwerde", "rechnung"]),
  body: z.string().trim().min(10, "Bitte beschreiben Sie das Anliegen kurz."),
});

/** Anliegen melden — erzeugt ein Serviceticket im Betrieb. */
export async function createTicketFromPortal(
  _prev: PortalState,
  formData: FormData,
): Promise<PortalState> {
  const parsed = ticketSchema.safeParse({
    token: formData.get("token"),
    category: formData.get("category"),
    body: formData.get("body"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Eingabe fehlt.", ok: null };
  }

  const session = await resolvePortal(parsed.data.token);
  if (!session) return { error: "Der Zugang ist abgelaufen.", ok: null };

  const admin = createAdminClient();

  const { data: nummer, error: nrErr } = await admin.rpc("next_number", {
    p_company: session.companyId,
    p_kind: "ticket",
  });
  if (nrErr) return { error: "Nummer konnte nicht vergeben werden.", ok: null };

  const { data: phase } = await admin
    .from("pipeline_phase")
    .select("id, key, pipeline:pipeline_id ( kind )")
    .eq("company_id", session.companyId)
    .eq("key", "offen");

  const start = (phase ?? []).find(
    (p) => (p.pipeline as unknown as { kind: string } | null)?.kind === "service",
  );

  const { data: ticket, error } = await admin
    .from("service_ticket")
    .insert({
      company_id: session.companyId,
      customer_id: session.customerId,
      number: nummer as string,
      source: "portal",
      category: parsed.data.category,
      severity: parsed.data.category === "stoerung" ? 1 : 3,
      body: parsed.data.body,
      ...(start ? { phase_id: start.id } : {}),
    })
    .select("id, number")
    .single();

  if (error) return { error: `Meldung fehlgeschlagen: ${error.message}`, ok: null };

  await admin.from("notification").insert({
    company_id: session.companyId,
    kind: "ticket_created",
    title: `Neues Anliegen ${ticket.number as string}`,
    body: parsed.data.body.slice(0, 160),
    link: `/service/${ticket.id}`,
  });

  revalidatePath(`/portal/${parsed.data.token}`);
  return {
    error: null,
    ok: `Ihr Anliegen ist unter ${ticket.number as string} erfasst.`,
  };
}
