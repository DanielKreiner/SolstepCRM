import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { PhasePill } from "@/components/ui/PhasePill";
import { Pill } from "@/components/ui/Pill";
import { RingStat, Stat } from "@/components/ui/Stat";
import { date, eur, eurShort, hhmm, num } from "@/lib/format";
import { requireMe } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { endOfViennaDay, startOfViennaDay } from "@/lib/time";
import { viennaDay } from "@/lib/format";

export const metadata: Metadata = { title: "Cockpit" };

export default async function CockpitPage() {
  const me = await requireMe();
  const supabase = await createClient();
  const today = viennaDay();

  const [
    { data: jobs },
    { data: kpis },
    { data: heute },
    { data: lowStock },
    { data: leads },
  ] = await Promise.all([
    supabase
      .from("job")
      .select(
        "id, number, city, zip, scheduled_from, value_net, planned_hours, next_step, phase:phase_id ( label, system_key ), customer:customer_id ( name )",
      )
      .order("scheduled_from", { ascending: true, nullsFirst: false })
      .limit(50),
    supabase.from("v_job_kpi").select("job_id, hours_actual, planned_hours"),
    supabase
      .from("time_entry")
      .select("duration_min, kind, user_id")
      .gte("started_at", startOfViennaDay(today).toISOString())
      .lt("started_at", endOfViennaDay(today).toISOString()),
    supabase.from("v_stock_alert").select("id, sku, name, stock, min_stock, unit"),
    supabase.from("customer").select("id").eq("type", "lead").is("deleted_at", null),
  ]);

  type Job = {
    id: string;
    number: string;
    city: string | null;
    zip: string | null;
    scheduled_from: string | null;
    value_net: string;
    planned_hours: string;
    next_step: string | null;
    phase: { label: string; system_key: string | null } | null;
    customer: { name: string } | null;
  };

  const jobRows = (jobs ?? []) as unknown as Job[];
  const offen = jobRows.filter((j) => j.phase?.system_key !== "closed");
  const inMontage = jobRows.filter((j) => j.phase?.system_key === "in_execution");
  const zuFakturieren = jobRows.filter(
    (j) => j.phase?.system_key === "ready_to_invoice",
  );

  const volumen = offen.reduce((s, j) => s + Number(j.value_net), 0);

  const kpiMap = new Map(
    (kpis ?? []).map((k) => [
      k.job_id as string,
      {
        ist: Number(k.hours_actual ?? 0),
        plan: Number(k.planned_hours ?? 0),
      },
    ]),
  );

  const stundenIst = offen.reduce((s, j) => s + (kpiMap.get(j.id)?.ist ?? 0), 0);
  const stundenPlan = offen.reduce((s, j) => s + Number(j.planned_hours), 0);

  const heuteMin = (heute ?? [])
    .filter((e) => e.kind !== "break")
    .reduce((s, e) => s + Number(e.duration_min ?? 0), 0);
  const heuteLeute = new Set((heute ?? []).map((e) => e.user_id as string)).size;

  const alerts = (lowStock ?? []) as unknown as {
    id: string;
    sku: string;
    name: string;
    stock: string;
    min_stock: string;
    unit: string;
  }[];

  return (
    <>
      <PageHeader
        title="Cockpit"
        subtitle={`${me.company.name} · ${new Date().toLocaleDateString("de-AT", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" })}`}
        actions={
          <Link
            href="/auftraege"
            className="rounded-pill bg-[linear-gradient(150deg,var(--accent-from),var(--accent-to))] px-[22px] py-[13px] text-sm font-semibold text-white shadow-[0_6px_18px_rgba(201,121,24,0.28)]"
          >
            Zu den Aufträgen
          </Link>
        }
      />

      <div className="mb-4 grid gap-[10px] sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Offene Aufträge" value={offen.length} />
        <Stat label="Volumen offen" value={eurShort(volumen)} hint="exkl. USt." />
        <Stat
          label="Heute gebucht"
          value={hhmm(heuteMin)}
          hint={`${heuteLeute} ${heuteLeute === 1 ? "Person" : "Personen"}`}
        />
        <Stat
          label="Unter Mindestbestand"
          value={alerts.length}
          tone={alerts.length > 0 ? "crit" : "done"}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr] xl:items-start">
        <div className="flex flex-col gap-4">
          <section className="rounded-[20px] bg-surface p-5 shadow-soft">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[15px] font-semibold">In Montage</h2>
              <span className="num text-[12px] text-muted">
                {inMontage.length}
              </span>
            </div>
            {inMontage.length === 0 ? (
              <p className="text-[13px] text-muted">
                Aktuell ist kein Auftrag in Montage.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {inMontage.map((j) => {
                  const k = kpiMap.get(j.id);
                  const pct =
                    k && k.plan > 0 ? Math.round((k.ist / k.plan) * 100) : 0;
                  return (
                    <li key={j.id}>
                      <Link
                        href={`/auftraege/${j.id}`}
                        className="flex flex-wrap items-center gap-3 rounded-input bg-panel px-4 py-3 transition-colors hover:bg-sunk"
                      >
                        <span className="num text-[13px] font-semibold">
                          {j.number}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-[13px]">
                          {j.customer?.name ?? "—"}
                        </span>
                        <span className="num text-[12px] text-muted">
                          {[j.zip, j.city].filter(Boolean).join(" ")}
                        </span>
                        <Pill tone={pct > 100 ? "crit" : "doing"} mono>
                          {pct} %
                        </Pill>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="rounded-[20px] bg-surface p-5 shadow-soft">
            <h2 className="mb-3 text-[15px] font-semibold">Nächste Termine</h2>
            {offen.filter((j) => j.scheduled_from).length === 0 ? (
              <p className="text-[13px] text-muted">Kein Termin gesetzt.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {offen
                  .filter((j) => j.scheduled_from)
                  .slice(0, 6)
                  .map((j) => (
                    <li key={j.id}>
                      <Link
                        href={`/auftraege/${j.id}`}
                        className="flex flex-wrap items-center gap-3 rounded-input bg-panel px-4 py-3 transition-colors hover:bg-sunk"
                      >
                        <span className="num w-[92px] shrink-0 text-[12.5px] text-muted">
                          {date(j.scheduled_from)}
                        </span>
                        <span className="num text-[13px] font-semibold">
                          {j.number}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-[13px]">
                          {j.next_step ?? j.customer?.name ?? "—"}
                        </span>
                        {j.phase ? (
                          <PhasePill
                            label={j.phase.label}
                            systemKey={j.phase.system_key}
                          />
                        ) : null}
                      </Link>
                    </li>
                  ))}
              </ul>
            )}
          </section>
        </div>

        <div className="flex flex-col gap-4">
          <section className="rounded-[20px] bg-surface p-5 shadow-soft">
            <h2 className="mb-4 text-[15px] font-semibold">Auslastung</h2>
            <div className="flex flex-wrap gap-5">
              <RingStat
                label="Stunden verbraucht"
                percent={stundenPlan > 0 ? (stundenIst / stundenPlan) * 100 : 0}
                center={`${Math.round(stundenPlan > 0 ? (stundenIst / stundenPlan) * 100 : 0)}%`}
                tone={stundenIst > stundenPlan && stundenPlan > 0 ? "crit" : "accent"}
              />
            </div>
            <p className="num mt-3 text-[12.5px] text-muted">
              {num(Math.round(stundenIst * 10) / 10)} von {num(stundenPlan)} h
            </p>
          </section>

          <section className="rounded-[20px] bg-surface p-5 shadow-soft">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[15px] font-semibold">Zu fakturieren</h2>
              <span className="num text-[12px] text-muted">
                {zuFakturieren.length}
              </span>
            </div>
            {zuFakturieren.length === 0 ? (
              <p className="text-[13px] text-muted">Nichts offen.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {zuFakturieren.map((j) => (
                  <li key={j.id}>
                    <Link
                      href={`/auftraege/${j.id}`}
                      className="flex items-center gap-3 rounded-input bg-panel px-4 py-3 transition-colors hover:bg-sunk"
                    >
                      <span className="num text-[13px] font-semibold">
                        {j.number}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[13px]">
                        {j.customer?.name ?? "—"}
                      </span>
                      <span className="num text-[12.5px]">
                        {eur(j.value_net)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {alerts.length > 0 ? (
            <section className="rounded-[20px] bg-surface p-5 shadow-soft">
              <h2 className="mb-3 text-[15px] font-semibold">Material knapp</h2>
              <ul className="flex flex-col gap-2">
                {alerts.slice(0, 6).map((a) => (
                  <li key={a.id}>
                    <Link
                      href={`/lager/${a.id}`}
                      className="flex items-center gap-3 rounded-input bg-panel px-4 py-3 transition-colors hover:bg-sunk"
                    >
                      <span className="num text-[12px] text-muted">{a.sku}</span>
                      <span className="min-w-0 flex-1 truncate text-[13px]">
                        {a.name}
                      </span>
                      <Pill tone="crit" mono>
                        {num(a.stock)} / {num(a.min_stock)}
                      </Pill>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="rounded-[20px] bg-surface p-5 shadow-soft">
            <h2 className="mb-1 text-[15px] font-semibold">Leads</h2>
            <p className="num text-[24px] font-semibold">
              {(leads ?? []).length}
            </p>
            <Link
              href="/crm?typ=lead"
              className="mt-2 inline-block text-[13px] text-accent-ink hover:underline"
            >
              Im CRM ansehen
            </Link>
          </section>
        </div>
      </div>
    </>
  );
}
