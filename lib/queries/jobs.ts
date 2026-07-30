import "server-only";
import { createClient } from "@/lib/supabase/server";

export type JobRow = {
  id: string;
  number: string;
  phase: { key: string; label: string; system_key: string | null };
  customer: { id: string; name: string };
  city: string | null;
  address: string | null;
  zip: string | null;
  scheduled_from: string | null;
  scheduled_to: string | null;
  value_net: string;
  planned_hours: string;
  material_planned: string;
  next_step: string | null;
  site_manager: { id: string; name: string } | null;
};

/*
 * Eine Abfrage, ein Screen. Keine generische Repository-Schicht — CLAUDE.md
 * Abschnitt 13 verbietet die CRUD-Abstraktion über alle Tabellen ausdrücklich.
 *
 * Gefiltert wird serverseitig, nicht im Client: die Liste eines Betriebs mit
 * 400 Aufträgen soll nicht komplett über die Leitung.
 */
export async function listJobs(opts: {
  phase?: string | undefined;
  q?: string | undefined;
  limit?: number;
}): Promise<JobRow[]> {
  const supabase = await createClient();

  let query = supabase
    .from("job")
    .select(
      `id, number, city, address, zip, scheduled_from, scheduled_to,
       value_net, planned_hours, material_planned, next_step,
       phase:phase_id ( key, label, system_key ),
       customer:customer_id ( id, name ),
       site_manager:site_manager_id ( id, name )`,
    )
    .order("scheduled_from", { ascending: true, nullsFirst: false })
    .limit(opts.limit ?? 200);

  if (opts.q) {
    query = query.or(`number.ilike.%${opts.q}%,city.ilike.%${opts.q}%`);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Aufträge konnten nicht geladen werden: ${error.message}`);

  const rows = (data ?? []) as unknown as JobRow[];
  return opts.phase ? rows.filter((r) => r.phase?.key === opts.phase) : rows;
}

export type JobKpi = {
  job_id: string;
  hours_actual: number;
  planned_hours: number;
  material_actual: number;
  material_planned: number;
  value_net: number;
};

export async function jobKpis(jobIds: string[]): Promise<Map<string, JobKpi>> {
  if (jobIds.length === 0) return new Map();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("v_job_kpi")
    .select("job_id, hours_actual, planned_hours, material_actual, material_planned, value_net")
    .in("job_id", jobIds);

  if (error) throw new Error(`Kennzahlen fehlgeschlagen: ${error.message}`);

  const map = new Map<string, JobKpi>();
  for (const r of data ?? []) {
    map.set(r.job_id as string, {
      job_id: r.job_id as string,
      hours_actual: Number(r.hours_actual ?? 0),
      planned_hours: Number(r.planned_hours ?? 0),
      material_actual: Number(r.material_actual ?? 0),
      material_planned: Number(r.material_planned ?? 0),
      value_net: Number(r.value_net ?? 0),
    });
  }
  return map;
}

/** Phasen der Projekte-Pipeline, für Filter und Phasenwechsel. */
export async function projectPhases() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("pipeline_phase")
    .select("id, key, label, sort, system_key, pipeline:pipeline_id ( kind )")
    .order("sort");

  if (error) throw new Error(error.message);

  return (data ?? [])
    .filter(
      (p) =>
        (p.pipeline as unknown as { kind: string } | null)?.kind === "projekte",
    )
    .map((p) => ({
      id: p.id as string,
      key: p.key as string,
      label: p.label as string,
      sort: p.sort as number,
      systemKey: (p.system_key as string | null) ?? null,
    }));
}
