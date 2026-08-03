import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { PageHeader } from "@/components/ui/PageHeader";
import { PhasePill } from "@/components/ui/PhasePill";
import { Pill } from "@/components/ui/Pill";
import { RingKarte } from "@/components/ui/RingKarte";
import { StockMoveForm } from "@/app/(app)/lager/StockMoveForm";
import { date, dateTime, eur, hhmm, num, time } from "@/lib/format";
import { requireMe } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { AuftragBearbeiten } from "../AuftragForms";
import { ladeAuftragsListen } from "../listen";

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
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ bearbeiten?: string }>;
}) {
  const me = await requireMe();
  const { id } = await params;
  const { bearbeiten } = await searchParams;
  const darfSchreiben = me.perms.pipelines === "write";
  const supabase = await createClient();

  const { data: job } = await supabase
    .from("job")
    .select(
      `id, number, address, zip, city, scheduled_from, scheduled_to, planned_hours,
       value_net, material_planned, next_step, closed_at,
       plant_id, location_id, site_manager_id,
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
            {darfSchreiben ? (
              <Link
                href={
                  bearbeiten
                    ? `/auftraege/${id}`
                    : `/auftraege/${id}?bearbeiten=1`
                }
                className="rounded-pill bg-[linear-gradient(150deg,var(--accent-from),var(--accent-to))] px-5 py-[13px] text-sm font-semibold text-white shadow-[0_6px_18px_rgba(201,121,24,0.28)] hover:text-white"
              >
                {bearbeiten ? "Bearbeiten schließen" : "Bearbeiten"}
              </Link>
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

      {darfSchreiben && bearbeiten ? (
        <div className="mb-4">
          <AuftragBearbeiten
            nummer={job.number as string}
            listen={await ladeAuftragsListen()}
            auftrag={{
              id: job.id as string,
              customerId: (customer?.id as string) ?? "",
              phaseId: (job.phase as unknown as { id: string } | null)?.id ?? "",
              plantId: (job.plant_id as string | null) ?? null,
              locationId: (job.location_id as string | null) ?? null,
              siteManagerId: (job.site_manager_id as string | null) ?? null,
              plannedHours: Number(job.planned_hours ?? 0),
              valueNet: Number(job.value_net ?? 0),
              materialPlanned: Number(job.material_planned ?? 0),
              scheduledFrom: (job.scheduled_from as string | null) ?? null,
              scheduledTo: (job.scheduled_to as string | null) ?? null,
              address: (job.address as string | null) ?? null,
              zip: (job.zip as string | null) ?? null,
              city: (job.city as string | null) ?? null,
              nextStep: (job.next_step as string | null) ?? null,
            }}
          />
        </div>
      ) : null}

      {/*
        Die drei Ringkennzahlen aus der Vorlage (SPEC 4.3). Sie stehen ganz
        oben, weil sie zusammen die eine Frage beantworten, wegen der man
        einen Auftrag aufmacht: läuft er noch im Plan?

        Der Deckungsbeitrag ist der nach Material, nicht nach Lohn — der
        Stundensatz ist Personendatum (Migration 0009) und darf hier nicht
        durchschlagen. Das steht auch unter dem Ring.
      */}
      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        <RingKarte
          titel="Stunden ist / soll"
          prozent={stundenPlan > 0 ? (stundenIst / stundenPlan) * 100 : 0}
          ton={
            stundenPlan > 0 && stundenIst > stundenPlan ? "kritisch" : "doing"
          }
          fuss={
            stundenPlan > 0
              ? `${num(Math.round(stundenIst * 10) / 10)} von ${num(stundenPlan)} h`
              : "kein Planwert hinterlegt"
          }
        />
        <RingKarte
          titel="Material kalkuliert"
          prozent={materialPlan > 0 ? (materialIst / materialPlan) * 100 : 0}
          ton={
            materialPlan > 0 && materialIst > materialPlan ? "kritisch" : "done"
          }
          fuss={
            materialPlan > 0
              ? `${eur(materialIst)} von ${eur(materialPlan)}`
              : "keine Materialkalkulation"
          }
        />
        <RingKarte
          titel="Deckungsbeitrag"
          prozent={wert > 0 ? (deckung / wert) * 100 : 0}
          ton={deckung < 0 ? "kritisch" : "accent"}
          fuss={`${eur(deckung)} nach Material · ohne Lohn`}
        />
      </div>

      <div className="mb-4 grid gap-4 lg:grid-cols-[1fr_1fr]">
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
