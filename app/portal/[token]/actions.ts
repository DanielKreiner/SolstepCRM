"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { portalTicketAntwort, resolvePortal } from "@/lib/portal/data";
import { createAdminClient } from "@/lib/supabase/admin";

export type PortalState = { error: string | null; ok: string | null };

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

  /*
   * Die Meldung ist die erste Nachricht im Verlauf. Ohne sie beginnt der
   * Thread mit der Antwort des Betriebs, und der Kunde sieht nicht mehr,
   * was er selbst geschrieben hat.
   */
  await admin.from("service_message").insert({
    company_id: session.companyId,
    ticket_id: ticket.id,
    author: "kunde",
    author_name: session.customerName,
    body: parsed.data.body,
    internal: false,
  });

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

const confirmSchema = z.object({
  token: z.string().min(10),
  appointmentId: z.string().uuid(),
});

/**
 * Terminbestätigung durch den Kunden (SPEC 5.1).
 *
 * Der Termin muss zu einem Vorgang DIESES Kunden gehören. vorgang_termin
 * trägt selbst kein customer_id, deshalb wird der Vorgang mitgelesen und
 * gegen die Sitzung geprüft — ein Token allein darf keinen fremden Termin
 * bestätigen können.
 *
 * Verschieben gibt es hier bewusst nicht: ein Kunde, der einen Termin
 * eigenmächtig verlegt, kollidiert mit der Einsatzplanung und mit der
 * Ruhezeitprüfung. Der Weg führt über ein Anliegen, das jemand sieht.
 */
export async function confirmAppointmentFromPortal(
  _prev: PortalState,
  formData: FormData,
): Promise<PortalState> {
  const parsed = confirmSchema.safeParse({
    token: formData.get("token"),
    appointmentId: formData.get("appointmentId"),
  });
  if (!parsed.success) return { error: "Eingabe fehlt.", ok: null };

  const session = await resolvePortal(parsed.data.token);
  if (!session) return { error: "Der Zugang ist abgelaufen.", ok: null };

  const admin = createAdminClient();

  const { data: termin } = await admin
    .from("vorgang_termin")
    .select(
      "id, von, kunde_bestaetigt_am, vorgang:vorgang_id ( id, number, customer_id )",
    )
    .eq("id", parsed.data.appointmentId)
    .eq("company_id", session.companyId)
    .maybeSingle();

  const vorgang = termin?.vorgang as unknown as
    | { id: string; number: string; customer_id: string }
    | null;

  if (!termin || !vorgang || vorgang.customer_id !== session.customerId) {
    return { error: "Termin nicht gefunden.", ok: null };
  }

  if (termin.kunde_bestaetigt_am) {
    return { error: null, ok: "Der Termin ist bereits bestätigt." };
  }

  const { error } = await admin
    .from("vorgang_termin")
    .update({ kunde_bestaetigt_am: new Date().toISOString() })
    .eq("id", termin.id);

  if (error) {
    return { error: `Bestätigung fehlgeschlagen: ${error.message}`, ok: null };
  }

  const wann = new Date(termin.von as string).toLocaleDateString("de-AT");

  // Der Betrieb soll es mitbekommen, ohne ins Portal schauen zu müssen.
  await admin.from("notification").insert({
    company_id: session.companyId,
    kind: "appointment_confirmed",
    title: `Termin bestätigt — ${session.customerName}`,
    body: `${vorgang.number} am ${wann}`,
    link: `/vorgaenge/${vorgang.id}`,
  });

  await admin.from("vorgang_event").insert({
    company_id: session.companyId,
    vorgang_id: vorgang.id,
    typ: "termin",
    titel: "Termin bestätigt",
    body: `${session.customerName} hat den Termin am ${wann} im Portal bestätigt.`,
    kunde_sichtbar: true,
  });

  await admin.from("contact_activity").insert({
    company_id: session.companyId,
    customer_id: session.customerId,
    kind: "portal",
    body: `Termin zu ${vorgang.number} im Kundenportal bestätigt.`,
  });

  revalidatePath(`/portal/${parsed.data.token}`);
  revalidatePath(`/portal/${parsed.data.token}/vorgang/${vorgang.id}`);
  return { error: null, ok: "Danke, der Termin ist bestätigt." };
}

const nachfrageSchema = z.object({
  token: z.string().min(10),
  ticketId: z.string().uuid(),
  body: z.string().trim().min(2, "Bitte etwas schreiben."),
});

/**
 * Nachfrage des Kunden zu einem bestehenden Anliegen.
 *
 * Damit wird aus der Einbahnstrasse ein Gespräch: bisher konnte der Kunde
 * ein Anliegen melden und danach nichts mehr sagen.
 */
export async function nachfrageSenden(
  _prev: PortalState,
  formData: FormData,
): Promise<PortalState> {
  const parsed = nachfrageSchema.safeParse({
    token: formData.get("token"),
    ticketId: formData.get("ticketId"),
    body: formData.get("body"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Eingabe fehlt.", ok: null };
  }

  const session = await resolvePortal(parsed.data.token);
  if (!session) return { error: "Der Zugang ist abgelaufen.", ok: null };

  const ergebnis = await portalTicketAntwort(
    session,
    parsed.data.ticketId,
    parsed.data.body,
  );
  if (!ergebnis.ok) return { error: ergebnis.grund ?? "Fehlgeschlagen.", ok: null };

  revalidatePath(`/portal/${parsed.data.token}`, "layout");
  return { error: null, ok: "Ihre Nachricht ist angekommen." };
}
