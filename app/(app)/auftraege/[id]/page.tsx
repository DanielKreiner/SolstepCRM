import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { PageHeader } from "@/components/ui/PageHeader";
import { PhasePill } from "@/components/ui/PhasePill";
import { Pill } from "@/components/ui/Pill";
import { RingStat, Stat } from "@/components/ui/Stat";
import { StockMoveForm } from "@/app/(app)/lager/StockMoveForm";
import { date, dateTime, eur, hhmm, num, time } from "@/lib/format";
import { requireMe } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Auftrag" };

type TimeRow = {
  id: string;
  kind: string;
  started_at: string;
  ended_at: string | null;
  duration_min: number | null;
  status: string;
  note: string | null;
  person: { name: string } | null;
};

type MoveRow = {
  id: string;
  qty: string;
  kind: string;
  note: string | null;
  created_at: string;
  article: { id: string; sku: string; name: string; unit: string; purchase_price: string } | null;
  person: { name: string } | null;
};

const KIND_LABEL: Record<string, string> = {
  work: "Arbeit",
  travel: "Fahrt",
  break: "Pause",
  errand: "Besorgung",
  training: "Schulung",
  leave_comp: "Zeitausgleich",
};

const MOVE_LABEL: Record<string, string> = {
  out: "Entnahme",
  return: "Rückgabe",
  goods_in: "Wareneingang",
  correction: "Korrektur",
};

export default async function AuftragPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const me = await requireMe();
  const { id } = await params;
  const supabase = await createClient();

  const { data: job } = await supabase
    .from("job")
    .select(
      `id, number, address, zip, city, scheduled_from, scheduled_to, planned_hours,
       value_net, material_planned, next_step, closed_at,
       phase:phase_id ( id, key, label, system_key ),
       customer:customer_id ( id, name, contact_person, email, phone ),
       site_manager:site_manager_id ( id, name ),
       location:location_id ( id, name )`,
    )
    .eq("id", id)
    .maybeSingle();

  if (!job) notFound();

  const [{ data: times }, { data: moves }, { data: kpi }, { data: articles }] =
    await Promise.all([
      supabase
        .from("time_entry")
        .select(
          `id, kind, started_at, ended_at, duration_min, status, note,
           person:user_id ( name )`,
        )
        .eq("job_id", id)
        .order("started_at", { ascending: false }),
      supabase
        .from("stock_move")
        .select(
          `id, qty, kind, note, created_at,
           article:article_id ( id, sku, name, unit, purchase_price ),
           person:user_id ( name )`,
        )
        .eq("job_id", id)
        .order("created_at", { ascending: false }),
      supabase.from("v_job_kpi").select("*").eq("job_id", id).maybeSingle(),
      supabase
        .from("article")
        .select("id, sku, name")
        .eq("active", true)
        .order("name"),
    ]);

  const timeRows = (times ?? []) as unknown as TimeRow[];
  const moveRows = (moves ?? []) as unknown as MoveRow[];

  const stundenIst = Number(kpi?.hours_actual ?? 0);
  const stundenPlan = Number(job.planned_hours ?? 0);
  const materialIst = Number(kpi?.material_actual ?? 0);
  const materialPlan = Number(job.material_planned ?? 0);
  const wert = Number(job.value_net ?? 0);

  const phase = job.phase as unknown as {
    label: string;
    system_key: string | null;
  } | null;
  const customer = job.customer as unknown as {
    id: string;
    name: string;
    contact_person: string | null;
    email: string | null;
    phone: string | null;
  } | null;
  const siteManager = job.site_manager as unknown as { name: string } | null;
  const location = job.location as unknown as { name: string } | null;

  const timeColumns: Column<TimeRow>[] = [
    {
      key: "tag",
      header: "Tag",
      width: "120px",
      render: (t) => <span className="num text-[12.5px]">{date(t.started_at)}</span>,
    },
    {
      key: "person",
      header: "Person",
      width: "1fr",
      render: (t) => <span className="text-[13px]">{t.person?.name ?? "—"}</span>,
    },
    {
      key: "zeit",
      header: "Von – bis",
      width: "140px",
      render: (t) => (
        <span className="num text-[12.5px] text-muted">
          {time(t.started_at)} – {t.ended_at ? time(t.ended_at) : "läuft"}
        </span>
      ),
    },
    {
      key: "art",
      header: "Art",
      width: "110px",
      render: (t) => <Pill tone="doing">{KIND_LABEL[t.kind] ?? t.kind}</Pill>,
    },
    {
      key: "dauer",
      header: "Dauer",
      width: "90px",
      align: "right",
      render: (t) => (
        <span className="num text-[13px] font-semibold">{hhmm(t.duration_min)}</span>
      ),
    },
  ];

  const moveColumns: Column<MoveRow>[] = [
    {
      key: "zeit",
      header: "Gebucht",
      width: "150px",
      render: (m) => (
        <span className="num text-[12.5px]">{dateTime(m.created_at)}</span>
      ),
    },
    {
      key: "artikel",
      header: "Artikel",
      width: "1.4fr",
      render: (m) => (
        <>
          <div className="text-[13px] font-medium">{m.article?.name ?? "—"}</div>
          <div className="num text-[11.5px] text-muted">{m.article?.sku}</div>
        </>
      ),
    },
    {
      key: "art",
      header: "Art",
      width: "130px",
      render: (m) => (
        <Pill tone={m.kind === "out" ? "warn" : "done"}>
          {MOVE_LABEL[m.kind] ?? m.kind}
        </Pill>
      ),
    },
    {
      key: "menge",
      header: "Menge",
      width: "110px",
      align: "right",
      render: (m) => (
        <span className="num text-[13px] font-semibold">
          {num(m.qty)} {m.article?.unit ?? ""}
        </span>
      ),
    },
    {
      key: "wert",
      header: "EK-Wert",
      width: "120px",
      align: "right",
      render: (m) => (
        <span className="num text-[12.5px] text-muted">
          {eur(Number(m.qty) * Number(m.article?.purchase_price ?? 0))}
        </span>
      ),
    },
  ];

  const deckung = wert - materialIst;

  return (
    <>
      <PageHeader
        title={job.number as string}
        subtitle={`${customer?.name ?? "—"} · ${[job.zip, job.city].filter(Boolean).join(" ")} · Beträge exkl. USt.`}
        actions={
          <>
            {phase ? (
              <PhasePill label={phase.label} systemKey={phase.system_key} />
            ) : null}
            <Link
              href="/auftraege"
              className="rounded-pill border border-line bg-surface px-5 py-[13px] text-sm font-medium text-ink transition-colors hover:bg-sunk"
            >
              Zur Liste
            </Link>
          </>
        }
      />

      <div className="mb-4 grid gap-[10px] sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Stunden ist / plan"
          value={`${num(Math.round(stundenIst * 10) / 10)} / ${num(stundenPlan)}`}
          tone={stundenPlan > 0 && stundenIst > stundenPlan ? "crit" : "done"}
          hint={
            stundenPlan > 0
              ? `${Math.round((stundenIst / stundenPlan) * 100)} % verbraucht`
              : "kein Planwert"
          }
        />
        <Stat
          label="Material ist / plan"
          value={`${eur(materialIst)} / ${eur(materialPlan)}`}
          tone={materialPlan > 0 && materialIst > materialPlan ? "crit" : "done"}
        />
        <Stat label="Auftragswert" value={eur(wert)} />
        <Stat
          label="Nach Material"
          value={eur(deckung)}
          tone={deckung < 0 ? "crit" : undefined}
          hint="ohne Lohnkosten"
        />
      </div>

      <div className="mb-4 grid gap-4 lg:grid-cols-[1fr_1fr_1fr]">
        <div className="rounded-[20px] bg-surface p-5 shadow-soft">
          <h2 className="mb-3 text-[15px] font-semibold">Fortschritt</h2>
          <div className="flex flex-wrap gap-5">
            <RingStat
              label="Stunden"
              percent={stundenPlan > 0 ? (stundenIst / stundenPlan) * 100 : 0}
              center={`${Math.round(stundenPlan > 0 ? (stundenIst / stundenPlan) * 100 : 0)}%`}
              tone={stundenIst > stundenPlan && stundenPlan > 0 ? "crit" : "accent"}
            />
            <RingStat
              label="Material"
              percent={materialPlan > 0 ? (materialIst / materialPlan) * 100 : 0}
              center={`${Math.round(materialPlan > 0 ? (materialIst / materialPlan) * 100 : 0)}%`}
              tone={materialIst > materialPlan && materialPlan > 0 ? "crit" : "accent"}
            />
          </div>
        </div>

        <div className="rounded-[20px] bg-surface p-5 shadow-soft">
          <h2 className="mb-3 text-[15px] font-semibold">Eckdaten</h2>
          <dl className="flex flex-col gap-[9px] text-[13px]">
            <Row label="Termin">
              {date(job.scheduled_from as string | null)}
              {job.scheduled_to ? ` – ${date(job.scheduled_to as string)}` : ""}
            </Row>
            <Row label="Standort">{location?.name ?? "—"}</Row>
            <Row label="Bauleitung">{siteManager?.name ?? "—"}</Row>
            <Row label="Adresse">
              {[job.address, [job.zip, job.city].filter(Boolean).join(" ")]
                .filter(Boolean)
                .join(", ") || "—"}
            </Row>
            <Row label="Nächster Schritt">{(job.next_step as string) ?? "—"}</Row>
          </dl>
        </div>

        <div className="rounded-[20px] bg-surface p-5 shadow-soft">
          <h2 className="mb-3 text-[15px] font-semibold">Kunde</h2>
          <dl className="flex flex-col gap-[9px] text-[13px]">
            <Row label="Name">
              {customer ? (
                <Link
                  href={`/crm/${customer.id}`}
                  className="text-accent-ink hover:underline"
                >
                  {customer.name}
                </Link>
              ) : (
                "—"
              )}
            </Row>
            <Row label="Ansprechpartner">{customer?.contact_person ?? "—"}</Row>
            <Row label="E-Mail">
              <span className="num">{customer?.email ?? "—"}</span>
            </Row>
            <Row label="Telefon">
              <span className="num">{customer?.phone ?? "—"}</span>
            </Row>
          </dl>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.7fr_1fr] xl:items-start">
        <div className="flex flex-col gap-4">
          <section>
            <h2 className="mb-2 text-[15px] font-semibold">
              Zeiten{" "}
              <span className="num font-normal text-muted">
                ({timeRows.length})
              </span>
            </h2>
            <DataTable
              columns={timeColumns}
              rows={timeRows}
              getKey={(t) => t.id}
              empty="Auf diesen Auftrag ist noch keine Zeit gebucht."
              compact
            />
          </section>

          <section>
            <h2 className="mb-2 text-[15px] font-semibold">
              Material{" "}
              <span className="num font-normal text-muted">
                ({moveRows.length})
              </span>
            </h2>
            <DataTable
              columns={moveColumns}
              rows={moveRows}
              getKey={(m) => m.id}
              empty="Für diesen Auftrag ist noch kein Material gebucht."
              compact
            />
          </section>
        </div>

        {me.perms.lager === "write" ? (
          <StockMoveForm
            articles={(articles ?? []).map((a) => ({
              id: a.id as string,
              label: `${a.sku as string} · ${a.name as string}`,
            }))}
            jobs={[]}
            fixedJobId={job.id as string}
          />
        ) : null}
      </div>
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}
