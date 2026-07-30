import type { Metadata } from "next";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pill } from "@/components/ui/Pill";
import { Stat } from "@/components/ui/Stat";
import { date, hhmm, time } from "@/lib/format";
import { requireMe } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Meine Zeiten" };

const KIND_LABEL: Record<string, string> = {
  work: "Arbeit",
  travel: "Fahrt",
  break: "Pause",
  errand: "Besorgung",
  training: "Schulung",
  leave_comp: "Zeitausgleich",
};

type Row = {
  id: string;
  kind: string;
  started_at: string;
  ended_at: string | null;
  duration_min: number | null;
  status: string;
  note: string | null;
  job: { id: string; number: string } | null;
};

export default async function MeineZeitenPage() {
  const me = await requireMe();
  const supabase = await createClient();

  const jahr = new Date().getFullYear();

  const [{ data: eintraege }, { data: saldo }] = await Promise.all([
    supabase
      .from("time_entry")
      .select(
        "id, kind, started_at, ended_at, duration_min, status, note, job:job_id ( id, number )",
      )
      .eq("user_id", me.id)
      .gte("started_at", `${jahr}-01-01`)
      .order("started_at", { ascending: false })
      .limit(200),
    supabase
      .from("v_time_balance")
      .select("actual_min, adjust_min")
      .eq("user_id", me.id)
      .maybeSingle(),
  ]);

  const rows = (eintraege ?? []) as unknown as Row[];
  const gesamt = Number(saldo?.actual_min ?? 0) + Number(saldo?.adjust_min ?? 0);

  const dieserMonat = rows
    .filter(
      (r) =>
        r.started_at.slice(0, 7) === new Date().toISOString().slice(0, 7) &&
        r.kind !== "break",
    )
    .reduce((s, r) => s + (r.duration_min ?? 0), 0);

  const offen = rows.filter(
    (r) => r.status === "flagged" || r.status === "running",
  ).length;

  const columns: Column<Row>[] = [
    {
      key: "tag",
      header: "Tag",
      width: "120px",
      render: (r) => <span className="num text-[12.5px]">{date(r.started_at)}</span>,
    },
    {
      key: "zeit",
      header: "Von – bis",
      width: "150px",
      render: (r) => (
        <span className="num text-[13px]">
          {time(r.started_at)} – {r.ended_at ? time(r.ended_at) : "läuft"}
        </span>
      ),
    },
    {
      key: "art",
      header: "Art",
      width: "130px",
      render: (r) => (
        <Pill tone={r.kind === "break" ? "neutral" : "doing"}>
          {KIND_LABEL[r.kind] ?? r.kind}
        </Pill>
      ),
    },
    {
      key: "auftrag",
      header: "Auftrag",
      width: "1fr",
      render: (r) => (
        <span className="num text-[12.5px] text-muted">
          {r.job?.number ?? "—"}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      width: "130px",
      render: (r) =>
        r.status === "approved" ? (
          <Pill tone="done">genehmigt</Pill>
        ) : r.status === "flagged" ? (
          <Pill tone="crit">geprüft</Pill>
        ) : r.status === "replaced" ? (
          <Pill tone="neutral">ersetzt</Pill>
        ) : (
          <Pill tone="neutral">gebucht</Pill>
        ),
    },
    {
      key: "dauer",
      header: "Dauer",
      width: "100px",
      align: "right",
      render: (r) => (
        <span className="num text-[13px] font-semibold">
          {hhmm(r.duration_min)}
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Meine Zeiten"
        subtitle={`${jahr} · nur die eigenen Buchungen`}
      />

      <div className="mb-4 grid grid-cols-2 gap-[10px] lg:grid-cols-4">
        <Stat label="Iststunden gesamt" value={hhmm(gesamt)} />
        <Stat label="Dieser Monat" value={hhmm(dieserMonat)} />
        <Stat label="Wochenstunden" value={`${me.weeklyHours} h`} />
        <Stat
          label="Zu klären"
          value={offen}
          tone={offen > 0 ? "warn" : "done"}
        />
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        getKey={(r) => r.id}
        empty="In diesem Jahr noch nichts gebucht."
        compact
      />

      <p className="mt-3 text-[12px] text-faint">
        Stimmt eine Zeit nicht, wird sie nicht überschrieben. Im Stundenkonto
        lässt sich eine Korrektur beantragen; die alte Buchung bleibt als
        ersetzt erhalten.
      </p>
    </>
  );
}
