import type { Metadata } from "next";
import Link from "next/link";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { PageHeader } from "@/components/ui/PageHeader";
import { PhasePill } from "@/components/ui/PhasePill";
import { KpiKarte } from "@/components/ui/KpiKarte";
import { date, eurShort, hours, num } from "@/lib/format";
import { jobKpis, listJobs, projectPhases, type JobRow } from "@/lib/queries/jobs";
import { requireMe } from "@/lib/session";

export const metadata: Metadata = { title: "Aufträge" };

export default async function AuftraegePage({
  searchParams,
}: {
  searchParams: Promise<{ phase?: string; q?: string }>;
}) {
  await requireMe();
  const { phase, q } = await searchParams;

  const [jobs, phases] = await Promise.all([
    listJobs({ phase, q }),
    projectPhases(),
  ]);
  const kpis = await jobKpis(jobs.map((j) => j.id));

  const offen = jobs.filter((j) => j.phase?.system_key !== "closed");
  const volumen = offen.reduce((s, j) => s + Number(j.value_net), 0);
  const stundenIst = offen.reduce(
    (s, j) => s + (kpis.get(j.id)?.hours_actual ?? 0),
    0,
  );
  const stundenPlan = offen.reduce((s, j) => s + Number(j.planned_hours), 0);

  const columns: Column<JobRow>[] = [
    {
      key: "number",
      header: "Auftrag",
      width: "130px",
      render: (j) => (
        <span className="num text-[13px] font-semibold">{j.number}</span>
      ),
    },
    {
      key: "customer",
      header: "Kunde",
      width: "1.6fr",
      render: (j) => (
        <>
          <div className="text-sm font-medium">{j.customer?.name ?? "—"}</div>
          <div className="text-[12px] text-muted">
            {[j.zip, j.city].filter(Boolean).join(" ") || "—"}
          </div>
        </>
      ),
    },
    {
      key: "phase",
      header: "Phase",
      width: "180px",
      render: (j) =>
        j.phase ? (
          <PhasePill label={j.phase.label} systemKey={j.phase.system_key} />
        ) : (
          "—"
        ),
    },
    {
      key: "termin",
      header: "Termin",
      width: "120px",
      render: (j) => (
        <span className="num text-[12.5px] text-muted">
          {date(j.scheduled_from)}
        </span>
      ),
    },
    {
      key: "stunden",
      header: "Stunden",
      width: "150px",
      align: "right",
      render: (j) => {
        const k = kpis.get(j.id);
        const ist = k?.hours_actual ?? 0;
        const plan = Number(j.planned_hours);
        const über = plan > 0 && ist > plan;
        return (
          <span
            className={`num text-[12.5px] ${über ? "text-s-crit" : "text-ink"}`}
          >
            {num(Math.round(ist * 10) / 10)} / {num(plan)}
          </span>
        );
      },
    },
    {
      key: "wert",
      header: "Auftragswert",
      width: "140px",
      align: "right",
      render: (j) => (
        <span className="num text-[13px] font-semibold">
          {eurShort(j.value_net)}
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Aufträge"
        subtitle={`${jobs.length} ${jobs.length === 1 ? "Auftrag" : "Aufträge"}${phase ? " · gefiltert" : ""} · Beträge exkl. USt.`}
      />

      <div className="mb-4 grid gap-[10px] sm:grid-cols-2 xl:grid-cols-4">
        <KpiKarte
          akzent
          label="Volumen offen"
          wert={eurShort(volumen)}
          pille={`${offen.length} ${offen.length === 1 ? "Auftrag" : "Aufträge"}`}
          notiz="exkl. USt."
        />
        <KpiKarte
          label="Offene Aufträge"
          wert={offen.length}
          notiz="noch nicht abgeschlossen"
        />
        <KpiKarte
          label="Stunden ist / plan"
          wert={`${Math.round(stundenIst)} / ${Math.round(stundenPlan)}`}
          pille={
            stundenPlan > 0
              ? `${Math.round((stundenIst / stundenPlan) * 100)} %`
              : "kein Plan"
          }
          ton={
            stundenIst > stundenPlan && stundenPlan > 0 ? "kritisch" : "neutral"
          }
          notiz="gebucht gegen kalkuliert"
        />
        <KpiKarte
          label="Ø Stunden je Auftrag"
          wert={offen.length ? hours((stundenIst / offen.length) * 60) : "—"}
          notiz="Mittel über die offenen Aufträge"
        />
      </div>

      <nav className="mb-4 flex flex-wrap gap-[3px] rounded-pill bg-surface p-1 shadow-soft">
        <FilterPill href="/auftraege" label="Alle" active={!phase} />
        {phases.map((p) => (
          <FilterPill
            key={p.id}
            href={`/auftraege?phase=${p.key}`}
            label={p.label}
            active={phase === p.key}
          />
        ))}
      </nav>

      <DataTable
        columns={columns}
        rows={jobs}
        getKey={(j) => j.id}
        hrefFor={(j) => `/auftraege/${j.id}`}
        empty="Kein Auftrag in dieser Phase."
      />
    </>
  );
}

function FilterPill({
  href,
  label,
  active,
}: {
  href: string;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={[
        "rounded-pill px-[17px] py-[9px] text-[13.5px] transition-colors duration-200",
        active
          ? "bg-sunk font-semibold text-ink"
          : "font-normal text-muted hover:text-ink",
      ].join(" ")}
    >
      {label}
    </Link>
  );
}
