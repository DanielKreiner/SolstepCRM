import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashToken, verifyToken } from "./token";

/*
 * Datenzugriff des Kundenportals.
 *
 * CLAUDE.md 4.3: das Laden läuft ausschließlich über den Service-Role-Client
 * mit explizitem where customer_id — der Portal-Pfad darf niemals den
 * anon-Client benutzen, weil es keine Supabase-Session gibt, an der RLS
 * greifen könnte.
 *
 * Damit liegt die gesamte Mandantentrennung dieses Pfades in diesem Modul.
 * Jede Abfrage hier schränkt selbst ein. Es gibt keine zweite Sicherung.
 */

export type PortalSession = {
  customerId: string;
  companyId: string;
  customerName: string;
  companyName: string;
  accessId: string;
};

export async function resolvePortal(
  token: string,
): Promise<PortalSession | null> {
  const payload = verifyToken(token);
  if (!payload) return null;

  const admin = createAdminClient();

  const { data: access } = await admin
    .from("portal_access")
    .select("id, company_id, customer_id, expires_at, revoked_at")
    .eq("token_hash", hashToken(token))
    .maybeSingle();

  if (!access) return null;
  if (access.revoked_at) return null;
  if (new Date(access.expires_at as string) < new Date()) return null;
  // Doppelt gesichert: der Token sagt customer X, die Datenbank muss
  // dasselbe sagen.
  if (access.customer_id !== payload.customerId) return null;

  const [{ data: customer }, { data: company }] = await Promise.all([
    admin
      .from("customer")
      .select("id, name")
      .eq("id", access.customer_id)
      .maybeSingle(),
    admin
      .from("company")
      .select("id, name")
      .eq("id", access.company_id)
      .maybeSingle(),
  ]);

  if (!customer || !company) return null;

  await admin
    .from("portal_access")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("id", access.id);

  return {
    customerId: customer.id as string,
    companyId: company.id as string,
    customerName: customer.name as string,
    companyName: company.name as string,
    accessId: access.id as string,
  };
}

export async function portalJobs(session: PortalSession) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("job")
    .select(
      "id, number, city, zip, scheduled_from, scheduled_to, next_step, phase:phase_id ( label, system_key, sort )",
    )
    .eq("customer_id", session.customerId)
    .eq("company_id", session.companyId)
    .order("scheduled_from", { ascending: false, nullsFirst: false });
  return data ?? [];
}

export async function portalQuotes(session: PortalSession) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("quote")
    .select(
      "id, number, net_total, valid_until, status, accepted_at, accepted_name, phase:phase_id ( label, system_key )",
    )
    .eq("customer_id", session.customerId)
    .eq("company_id", session.companyId)
    .order("number", { ascending: false });
  return data ?? [];
}

/**
 * Die Phasen der Projektpipeline, für die Fortschrittsleiste (SPEC 5.1).
 *
 * Die Leiste zeigt den Weg des Projekts, nicht nur den aktuellen Stand.
 * Deshalb kommen alle Phasen mit, nicht bloß die erreichte — der Kunde soll
 * sehen, was noch aussteht.
 *
 * Verlorene und abgebrochene Phasen bleiben draußen: eine Leiste, die dem
 * Kunden "Verloren" als kommenden Schritt anzeigt, ist absurd.
 */
export async function portalPhases(session: PortalSession) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("pipeline_phase")
    .select("id, label, sort, system_key, pipeline:pipeline_id ( kind )")
    .eq("company_id", session.companyId)
    .order("sort");

  return (data ?? [])
    .filter(
      (p) =>
        (p.pipeline as unknown as { kind: string } | null)?.kind === "projekte" &&
        p.system_key !== "lost",
    )
    .map((p) => ({
      id: p.id as string,
      label: p.label as string,
      sort: p.sort as number,
      systemKey: (p.system_key as string | null) ?? null,
    }));
}

/** Anlagendaten des Kunden — Leistung, Speicher, Module. */
export async function portalPlant(session: PortalSession) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("plant")
    .select("kwp, storage_kwh, modules, inverter, commissioned_on")
    .eq("customer_id", session.customerId)
    .eq("company_id", session.companyId)
    .order("kwp", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  return data;
}

/**
 * Kommende Termine beim Kunden.
 *
 * Nur was in der Zukunft liegt: ein Portal, das vergangene Termine als
 * "nächster Termin" führt, verwirrt mehr als es hilft. `customer_confirmed`
 * entscheidet, ob der Bestätigen-Knopf noch etwas zu tun hat.
 */
export async function portalAppointments(session: PortalSession) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("job_appointment")
    .select(
      "id, starts_at, ends_at, title, customer_confirmed, job:job_id ( id, number )",
    )
    .eq("company_id", session.companyId)
    .gte("starts_at", new Date().toISOString())
    .order("starts_at")
    .limit(20);

  /*
   * job_appointment trägt kein customer_id. Der Bezug läuft über den
   * Auftrag — deshalb wird hier gegen die Aufträge dieses Kunden gefiltert
   * und nicht auf die Abfrage vertraut.
   */
  const meine = await admin
    .from("job")
    .select("id")
    .eq("customer_id", session.customerId)
    .eq("company_id", session.companyId);

  const erlaubt = new Set((meine.data ?? []).map((j) => j.id as string));

  return (data ?? []).filter((t) => {
    const job = t.job as unknown as { id: string } | null;
    return job !== null && erlaubt.has(job.id);
  });
}

export async function portalTickets(session: PortalSession) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("service_ticket")
    .select("id, number, category, severity, body, response, created_at, status")
    .eq("customer_id", session.customerId)
    .eq("company_id", session.companyId)
    .order("created_at", { ascending: false });
  return data ?? [];
}
