import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { PhasePill } from "@/components/ui/PhasePill";
import { Pill } from "@/components/ui/Pill";
import { Stat } from "@/components/ui/Stat";
import { dateTime } from "@/lib/format";
import { requireMe } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Serviceticket" };

const CATEGORY_LABEL: Record<string, string> = {
  stoerung: "Störung",
  frage: "Frage",
  beschwerde: "Beschwerde",
  rechnung: "Rechnung",
};

const SOURCE_LABEL: Record<string, string> = {
  portal: "Kundenportal",
  phone: "Telefon",
  mail: "E-Mail",
};

export default async function TicketPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireMe();
  const { id } = await params;
  const supabase = await createClient();

  const { data: ticket } = await supabase
    .from("service_ticket")
    .select(
      `id, number, source, category, severity, status, body, response, responded_at, created_at,
       phase:phase_id ( label, system_key ),
       customer:customer_id ( id, name, contact_person, email, phone, zip, city ),
       assignee:assignee_id ( name ),
       job:job_id ( id, number )`,
    )
    .eq("id", id)
    .maybeSingle();

  if (!ticket) notFound();

  const phase = ticket.phase as unknown as {
    label: string;
    system_key: string | null;
  } | null;
  const customer = ticket.customer as unknown as {
    id: string;
    name: string;
    contact_person: string | null;
    email: string | null;
    phone: string | null;
    zip: string | null;
    city: string | null;
  } | null;
  const assignee = ticket.assignee as unknown as { name: string } | null;
  const job = ticket.job as unknown as { id: string; number: string } | null;

  const severity = Number(ticket.severity ?? 3);

  return (
    <>
      <PageHeader
        title={ticket.number as string}
        subtitle={`${customer?.name ?? "—"} · ${CATEGORY_LABEL[ticket.category as string] ?? (ticket.category as string)}`}
        actions={
          <>
            {phase ? (
              <PhasePill label={phase.label} systemKey={phase.system_key} />
            ) : null}
            <Link
              href="/pipelines/service"
              className="rounded-pill border border-line bg-surface px-5 py-[13px] text-sm font-medium text-ink transition-colors hover:bg-sunk"
            >
              Zur Pipeline
            </Link>
          </>
        }
      />

      <div className="mb-4 grid gap-[10px] sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Dringlichkeit"
          value={
            <Pill tone={severity === 1 ? "crit" : severity === 2 ? "warn" : "neutral"}>
              {severity === 1 ? "hoch" : severity === 2 ? "mittel" : "normal"}
            </Pill>
          }
        />
        <Stat
          label="Eingegangen über"
          value={SOURCE_LABEL[ticket.source as string] ?? (ticket.source as string)}
        />
        <Stat label="Gemeldet" value={dateTime(ticket.created_at as string)} />
        <Stat label="Zuständig" value={assignee?.name ?? "—"} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr] xl:items-start">
        <section className="rounded-[20px] bg-surface p-5 shadow-soft">
          <h2 className="mb-3 text-[15px] font-semibold">Meldung</h2>
          <p className="text-[13.5px] leading-[1.55] whitespace-pre-line">
            {ticket.body as string}
          </p>

          {ticket.response ? (
            <>
              <h3 className="mt-5 mb-2 text-[13px] font-semibold">Antwort</h3>
              <p className="rounded-input bg-panel px-4 py-3 text-[13px] leading-[1.55] whitespace-pre-line">
                {ticket.response as string}
              </p>
              <p className="mt-2 text-[11.5px] text-faint">
                {dateTime(ticket.responded_at as string)}
              </p>
            </>
          ) : (
            <p className="mt-5 text-[13px] text-muted">
              Noch keine Antwort erfasst.
            </p>
          )}
        </section>

        <section className="rounded-[20px] bg-surface p-5 shadow-soft">
          <h2 className="mb-3 text-[15px] font-semibold">Kunde und Anlage</h2>
          <dl className="flex flex-col gap-[9px] text-[13px]">
            <Row label="Kunde">
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
              <span className="num break-all">{customer?.email ?? "—"}</span>
            </Row>
            <Row label="Telefon">
              <span className="num">{customer?.phone ?? "—"}</span>
            </Row>
            <Row label="Auftrag">
              {job ? (
                <Link
                  href={`/auftraege/${job.id}`}
                  className="num text-accent-ink hover:underline"
                >
                  {job.number}
                </Link>
              ) : (
                "—"
              )}
            </Row>
          </dl>
        </section>
      </div>
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className="min-w-0 text-right">{children}</dd>
    </div>
  );
}
