import "server-only";
import { createClient } from "@/lib/supabase/server";

/*
 * Die drei Pipelines sind Sichten auf drei verschiedene Entitäten, nicht eine
 * generische Pipeline-Tabelle (CLAUDE.md 5.1):
 *   vertrieb -> quote, projekte -> job, service -> service_ticket
 *
 * PipelineCard ist der gemeinsame Nenner. Board, Tabelle und Timeline sind
 * drei Renderer über dieselbe geladene Liste — nicht drei Abfragen.
 */

export const KINDS = ["vertrieb", "projekte", "service"] as const;
export type Kind = (typeof KINDS)[number];

export const KIND_LABEL: Record<Kind, string> = {
  vertrieb: "Vertrieb",
  projekte: "Projekte",
  service: "Service",
};

/** Auf welche Tabelle ein Phasenwechsel schreibt. */
export const KIND_TABLE: Record<Kind, string> = {
  vertrieb: "quote",
  projekte: "job",
  service: "service_ticket",
};

/** Wohin die Karte verlinkt. */
export const KIND_HREF: Record<Kind, (id: string) => string> = {
  vertrieb: (id) => `/angebote/${id}`,
  projekte: (id) => `/auftraege/${id}`,
  service: (id) => `/service/${id}`,
};

export function isKind(v: string): v is Kind {
  return (KINDS as readonly string[]).includes(v);
}

export type Phase = {
  id: string;
  key: string;
  label: string;
  sort: number;
  systemKey: string | null;
  isFinal: boolean;
};

export type PipelineCard = {
  id: string;
  kind: Kind;
  number: string;
  phaseId: string | null;
  customerId: string;
  customerName: string;
  valueNet: number;
  dueAt: string | null;
  city: string | null;
  note: string | null;
  ownerId: string | null;
};

export async function loadPhases(kind: Kind): Promise<Phase[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("pipeline_phase")
    .select("id, key, label, sort, system_key, is_final, pipeline:pipeline_id ( kind )")
    .order("sort");

  if (error) throw new Error(`Phasen konnten nicht geladen werden: ${error.message}`);

  return (data ?? [])
    .filter(
      (p) => (p.pipeline as unknown as { kind: string } | null)?.kind === kind,
    )
    .map((p) => ({
      id: p.id as string,
      key: p.key as string,
      label: p.label as string,
      sort: p.sort as number,
      systemKey: (p.system_key as string | null) ?? null,
      isFinal: Boolean(p.is_final),
    }));
}

export type CardFilter = {
  standort?: string | undefined;
  verantwortlich?: string | undefined;
  von?: string | undefined;
  bis?: string | undefined;
  q?: string | undefined;
};

export async function loadCards(
  kind: Kind,
  filter: CardFilter = {},
): Promise<PipelineCard[]> {
  const supabase = await createClient();

  let query = supabase
    .from("v_pipeline_card")
    .select(
      "id, kind, number, phase_id, customer_id, customer_name, value_net, due_at, city, note, owner_id",
    )
    .eq("kind", kind)
    .order("due_at", { ascending: true, nullsFirst: false })
    .limit(500);

  if (filter.verantwortlich) query = query.eq("owner_id", filter.verantwortlich);
  if (filter.von) query = query.gte("due_at", filter.von);
  if (filter.bis) query = query.lte("due_at", `${filter.bis}T23:59:59`);
  if (filter.q) {
    query = query.or(
      `number.ilike.%${filter.q}%,customer_name.ilike.%${filter.q}%,city.ilike.%${filter.q}%`,
    );
  }

  const { data, error } = await query;
  if (error) throw new Error(`Karten konnten nicht geladen werden: ${error.message}`);

  return (data ?? []).map((r) => ({
    id: r.id as string,
    kind: r.kind as Kind,
    number: r.number as string,
    phaseId: (r.phase_id as string | null) ?? null,
    customerId: r.customer_id as string,
    customerName: r.customer_name as string,
    valueNet: Number(r.value_net ?? 0),
    dueAt: (r.due_at as string | null) ?? null,
    city: (r.city as string | null) ?? null,
    note: (r.note as string | null) ?? null,
    ownerId: (r.owner_id as string | null) ?? null,
  }));
}

/** Farbe je Phase — hängt an system_key, nie am Label (CLAUDE.md 5.1a). */
export function phaseColor(systemKey: string | null): string {
  switch (systemKey) {
    case "won":
      return "var(--s-done)";
    case "lost":
      return "var(--s-crit)";
    case "in_execution":
      return "var(--s-doing)";
    case "ready_to_invoice":
      return "var(--s-warn)";
    case "closed":
      return "var(--s-done)";
    default:
      return "var(--s-new)";
  }
}
