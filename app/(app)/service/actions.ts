"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireMe } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

export type ServiceStatus = { error: string | null; ok: string | null };

/**
 * Servicetickets im Backoffice.
 *
 * Anliegen aus dem Kundenportal landeten bisher in der Datenbank und
 * sonst nirgends — es gab keine Liste, keine Antwort, keinen Verlauf.
 * Der Kunde hat geschrieben und nie etwas gehört.
 */

async function zugang(): Promise<
  { ok: true; me: Awaited<ReturnType<typeof requireMe>> } | { ok: false; status: ServiceStatus }
> {
  const me = await requireMe();
  if (me.perms.pipelines !== "write") {
    return {
      ok: false,
      status: { error: "Für Service fehlt deiner Rolle das Schreibrecht.", ok: null },
    };
  }
  return { ok: true, me };
}

/* ------------------------------------------------------------- ANTWORTEN */

const antwortSchema = z.object({
  ticketId: z.string().uuid(),
  body: z.string().trim().min(2, "Die Antwort ist leer."),
  intern: z.enum(["ja", "nein"]).default("nein"),
});

/**
 * Antwort oder interne Notiz an ein Ticket hängen.
 *
 * Interne Notizen erreichen das Portal nie — sie sind für das Team. Der
 * Unterschied steckt in einer einzigen Spalte, deshalb liegt beides in
 * einer Aktion: zwei fast gleiche Funktionen laufen sonst auseinander.
 */
export async function antwortSenden(
  _prev: ServiceStatus,
  formData: FormData,
): Promise<ServiceStatus> {
  const z1 = await zugang();
  if (!z1.ok) return z1.status;

  const parsed = antwortSchema.safeParse({
    ticketId: formData.get("ticketId"),
    body: formData.get("body"),
    intern: formData.get("intern") ?? "nein",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Eingabe fehlt.", ok: null };
  }

  const supabase = await createClient();
  const intern = parsed.data.intern === "ja";

  const { error } = await supabase.from("service_message").insert({
    company_id: z1.me.companyId,
    ticket_id: parsed.data.ticketId,
    author: "betrieb",
    author_user_id: z1.me.id,
    author_name: z1.me.name,
    body: parsed.data.body,
    internal: intern,
  });

  if (error) return { error: `Senden fehlgeschlagen: ${error.message}`, ok: null };

  /*
   * Ein Ticket, auf das geantwortet wurde, ist nicht mehr unbearbeitet.
   * Eine interne Notiz ändert daran nichts — der Kunde hat nichts gehört.
   */
  if (!intern) {
    await supabase
      .from("service_ticket")
      .update({ responded_at: new Date().toISOString() })
      .eq("id", parsed.data.ticketId)
      .eq("status", "offen");

    await supabase
      .from("service_ticket")
      .update({ status: "diagnose" })
      .eq("id", parsed.data.ticketId)
      .eq("status", "offen");
  }

  revalidatePath(`/service/${parsed.data.ticketId}`);
  revalidatePath("/service");
  revalidatePath("/pipelines/service");

  return {
    error: null,
    ok: intern ? "Notiz gespeichert." : "Antwort gespeichert — der Kunde sieht sie im Portal.",
  };
}

/* ------------------------------------------------------------- BEARBEITEN */

const ticketSchema = z.object({
  ticketId: z.string().uuid(),
  status: z.enum(["offen", "diagnose", "termin_geplant", "behoben"]),
  severity: z.coerce.number().int().min(1).max(3),
  assigneeId: z.string().uuid().or(z.literal("")),
  jobId: z.string().uuid().or(z.literal("")),
});

export async function ticketSpeichern(
  _prev: ServiceStatus,
  formData: FormData,
): Promise<ServiceStatus> {
  const z1 = await zugang();
  if (!z1.ok) return z1.status;

  const parsed = ticketSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Eingabe fehlt.", ok: null };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("service_ticket")
    .update({
      status: parsed.data.status,
      severity: parsed.data.severity,
      assignee_id: parsed.data.assigneeId || null,
      job_id: parsed.data.jobId || null,
    })
    .eq("id", parsed.data.ticketId);

  if (error) return { error: `Speichern fehlgeschlagen: ${error.message}`, ok: null };

  revalidatePath(`/service/${parsed.data.ticketId}`);
  revalidatePath("/service");
  revalidatePath("/pipelines/service");
  return { error: null, ok: "Gespeichert." };
}

/* ------------------------------------------------------------- ANLEGEN */

const neuSchema = z.object({
  customerId: z.string().uuid({ message: "Bitte einen Kunden wählen." }),
  category: z.enum(["stoerung", "frage", "beschwerde", "rechnung"]),
  source: z.enum(["phone", "mail", "portal"]),
  severity: z.coerce.number().int().min(1).max(3),
  body: z.string().trim().min(5, "Bitte das Anliegen kurz beschreiben."),
});

/**
 * Ticket von Hand anlegen — der Kunde ruft an, und im Büro soll daraus
 * derselbe Vorgang werden wie bei einer Meldung über das Portal.
 */
export async function ticketAnlegen(
  _prev: ServiceStatus,
  formData: FormData,
): Promise<ServiceStatus> {
  const z1 = await zugang();
  if (!z1.ok) return z1.status;

  const parsed = neuSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Eingabe fehlt.", ok: null };
  }

  const supabase = await createClient();

  const { data: nummer, error: nrFehler } = await supabase.rpc("next_number", {
    p_company: z1.me.companyId,
    p_kind: "ticket",
  });
  if (nrFehler || typeof nummer !== "string") {
    return { error: "Nummer konnte nicht vergeben werden.", ok: null };
  }

  const { data: phasen } = await supabase
    .from("pipeline_phase")
    .select("id, sort, pipeline:pipeline_id ( kind )")
    .eq("company_id", z1.me.companyId)
    .order("sort");

  const start = ((phasen ?? []) as unknown as {
    id: string;
    pipeline: { kind: string } | null;
  }[]).find((p) => p.pipeline?.kind === "service");

  if (!start) {
    return { error: "Die Service-Pipeline hat keine Startphase.", ok: null };
  }

  const { data: ticket, error } = await supabase
    .from("service_ticket")
    .insert({
      company_id: z1.me.companyId,
      customer_id: parsed.data.customerId,
      number: nummer,
      phase_id: start.id,
      source: parsed.data.source,
      category: parsed.data.category,
      severity: parsed.data.severity,
      body: parsed.data.body,
    })
    .select("id, number")
    .single();

  if (error || !ticket) {
    return { error: `Anlegen fehlgeschlagen: ${error?.message ?? "unbekannt"}`, ok: null };
  }

  /*
   * Die Meldung selbst ist die erste Nachricht im Verlauf. Sonst beginnt
   * der Thread im Portal mit der Antwort und der Kunde sieht nicht mehr,
   * was er eigentlich gemeldet hat.
   */
  await supabase.from("service_message").insert({
    company_id: z1.me.companyId,
    ticket_id: ticket.id,
    author: "betrieb",
    author_user_id: z1.me.id,
    author_name: z1.me.name,
    body: parsed.data.body,
    internal: true,
  });

  revalidatePath("/service");
  revalidatePath("/pipelines/service");
  return { error: null, ok: `Ticket ${ticket.number as string} angelegt.` };
}
