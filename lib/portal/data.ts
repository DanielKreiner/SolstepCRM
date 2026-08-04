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
  /* Für den Kunden ist das Portal die Seite seines Elektrikers. */
  logoUrl: string | null;
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
      .select("id, name, pdf_settings")
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
    logoUrl:
      typeof (company.pdf_settings as Record<string, unknown> | null)?.logo_url ===
      "string"
        ? ((company.pdf_settings as Record<string, unknown>).logo_url as string)
        : null,
    accessId: access.id as string,
  };
}

/** Die Anlage des Kunden — Leistung, Speicher, Inbetriebnahme. */
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

export async function portalTickets(session: PortalSession) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("service_ticket")
    .select("id, number, category, severity, body, created_at, status")
    .eq("customer_id", session.customerId)
    .eq("company_id", session.companyId)
    .order("created_at", { ascending: false });

  const tickets = data ?? [];
  if (tickets.length === 0) return [];

  /*
   * Der Verlauf gehört zum Ticket. Interne Notizen bleiben draussen —
   * das wird hier gefiltert und nicht erst in der Anzeige, damit sie gar
   * nicht erst über die Leitung gehen.
   */
  const { data: verlauf } = await admin
    .from("service_message")
    .select("id, ticket_id, author, author_name, body, created_at")
    .in("ticket_id", tickets.map((t) => t.id as string))
    .eq("internal", false)
    .order("created_at");

  const nachMap = new Map<string, unknown[]>();
  for (const m of verlauf ?? []) {
    const key = m.ticket_id as string;
    nachMap.set(key, [...(nachMap.get(key) ?? []), m]);
  }

  return tickets.map((t) => ({
    ...t,
    verlauf: nachMap.get(t.id as string) ?? [],
  }));
}

/**
 * Nachfrage des Kunden an ein bestehendes Anliegen.
 *
 * Der Kunde darf nur an seine eigenen Tickets schreiben — geprüft wird
 * über customer_id und company_id, nicht über die ticket_id allein.
 */
export async function portalTicketAntwort(
  session: PortalSession,
  ticketId: string,
  body: string,
): Promise<{ ok: boolean; grund?: string }> {
  const admin = createAdminClient();

  const { data: ticket } = await admin
    .from("service_ticket")
    .select("id, status")
    .eq("id", ticketId)
    .eq("customer_id", session.customerId)
    .eq("company_id", session.companyId)
    .maybeSingle();

  if (!ticket) return { ok: false, grund: "Anliegen nicht gefunden." };

  const { error } = await admin.from("service_message").insert({
    company_id: session.companyId,
    ticket_id: ticket.id,
    author: "kunde",
    author_name: session.customerName,
    body,
    internal: false,
  });

  if (error) return { ok: false, grund: "Das hat nicht geklappt." };

  /*
   * Ein erledigtes Anliegen, zu dem der Kunde nachfragt, ist wieder
   * offen. Sonst schreibt er in etwas hinein, das im Büro als abgehakt
   * gilt und niemand mehr ansieht.
   */
  if (ticket.status === "behoben") {
    await admin
      .from("service_ticket")
      .update({ status: "offen" })
      .eq("id", ticket.id);
  }

  await admin.from("notification").insert({
    company_id: session.companyId,
    kind: "ticket_reply",
    title: `Nachfrage von ${session.customerName}`,
    body,
    link: `/service/${ticket.id}`,
  });

  return { ok: true };
}
