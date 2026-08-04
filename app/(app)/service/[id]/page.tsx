import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { PhasePill } from "@/components/ui/PhasePill";
import { PhasenWechsel } from "@/components/ui/PhasenWechsel";
import { Pill } from "@/components/ui/Pill";
import { Stat } from "@/components/ui/Stat";
import { dateTime } from "@/lib/format";
import { ROLE_LABEL } from "@/lib/nav";
import { requireMe } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { AntwortFeld, TicketBearbeiten } from "../ServiceForms";

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
  const me = await requireMe();
  const { id } = await params;
  const supabase = await createClient();

  const { data: ticket } = await supabase
    .from("service_ticket")
    .select(
      `id, number, source, category, severity, status, body, created_at, assignee_id,
       phase:phase_id ( id, label, system_key ),
       customer:customer_id ( id, name, contact_person, email, phone, zip, city ),
       assignee:assignee_id ( name ),
       vorgang:vorgang_id ( id, number )`,
    )
    .eq("id", id)
    .maybeSingle();

  if (!ticket) notFound();

  const darfSchreiben = me.perms.pipelines === "write";

  const [{ data: verlauf }, { data: team }, { data: auftraege }] =
    await Promise.all([
      supabase
        .from("service_message")
        .select("id, author, author_name, body, internal, created_at")
        .eq("ticket_id", id)
        .order("created_at"),
      supabase
        .from("app_user")
        .select("id, name, role")
        .eq("active", true)
        .order("name"),
      supabase
        .from("vorgang")
        .select("id, number, ort")
        .order("created_at", { ascending: false })
        .limit(200),
    ]);

  const nachrichten = (verlauf ?? []) as unknown as {
    id: string;
    author: string;
    author_name: string | null;
    body: string;
    internal: boolean;
    created_at: string;
  }[];

  const { data: phasenRoh } = await supabase
    .from("pipeline_phase")
    .select("id, label, system_key, pipeline:pipeline_id ( kind )")
    .order("sort");

  const servicePhasen = ((phasenRoh ?? []) as unknown as {
    id: string;
    label: string;
    system_key: string | null;
    pipeline: { kind: string } | null;
  }[])
    .filter((p) => p.pipeline?.kind === "service")
    .map((p) => ({ id: p.id, label: p.label, systemKey: p.system_key }));

  const phase = ticket.phase as unknown as {
    id: string;
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
  const job = ticket.vorgang as unknown as { id: string; number: string } | null;

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
              href="/service"
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

      <div className="mb-4">
        <PhasenWechsel
          cardId={ticket.id as string}
          gesperrt={!darfSchreiben}
          aktuelleId={phase?.id ?? null}
          phasen={servicePhasen}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr] xl:items-start">
        <section className="rounded-[20px] bg-surface p-5 shadow-soft">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-[15px] font-semibold">Verlauf</h2>
            <span className="text-[11.5px] text-faint">
              {nachrichten.length}{" "}
              {nachrichten.length === 1 ? "Eintrag" : "Einträge"}
            </span>
          </div>

          {nachrichten.length === 0 ? (
            <p className="text-[13.5px] leading-[1.55] whitespace-pre-line">
              {ticket.body as string}
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {nachrichten.map((m) => (
                <li
                  key={m.id}
                  className={[
                    "rounded-card px-4 py-3",
                    m.internal
                      ? "border border-s-warn/30 bg-s-warn/8"
                      : m.author === "kunde"
                        ? "bg-panel"
                        : "bg-accent-sunk",
                  ].join(" ")}
                >
                  <div className="mb-1 flex flex-wrap items-baseline gap-2">
                    <span className="text-[12px] font-semibold">
                      {m.author === "kunde"
                        ? (customer?.contact_person ?? customer?.name ?? "Kunde")
                        : (m.author_name ?? "Betrieb")}
                    </span>
                    {m.internal ? (
                      <Pill tone="warn">intern</Pill>
                    ) : null}
                    <span className="num ml-auto text-[11px] text-faint">
                      {dateTime(m.created_at)}
                    </span>
                  </div>
                  <p className="text-[13.5px] leading-[1.55] whitespace-pre-line">
                    {m.body}
                  </p>
                </li>
              ))}
            </ul>
          )}

          {darfSchreiben ? <AntwortFeld ticketId={ticket.id as string} /> : null}
        </section>

        <section className="rounded-[20px] bg-surface p-5 shadow-soft">
          <h2 className="mb-3 text-[15px] font-semibold">Kunde und Anlage</h2>
          <dl className="flex flex-col gap-[9px] text-[13px]">
            <Row label="Kunde">
              {customer ? (
                <Link
                  href={`/vorgaenge?kunde=${customer.id}`}
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
            <Row label="Vorgang">
              {job ? (
                <Link
                  href={`/vorgaenge/${job.id}`}
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

      {darfSchreiben ? (
        <div className="mt-4 grid gap-4 xl:grid-cols-[1.6fr_1fr] xl:items-start">
          <TicketBearbeiten
            ticketId={ticket.id as string}
            status={ticket.status as string}
            severity={severity}
            assigneeId={(ticket.assignee_id as string | null) ?? ""}
            jobId={job?.id ?? ""}
            mitarbeiter={((team ?? []) as unknown as {
              id: string;
              name: string;
              role: string;
            }[]).map((u) => ({
              wert: u.id,
              text: u.name,
              zusatz: ROLE_LABEL[u.role] ?? u.role,
            }))}
            auftraege={((auftraege ?? []) as unknown as {
              id: string;
              number: string;
              ort: string | null;
            }[]).map((j) => ({
              wert: j.id,
              text: j.number,
              ...(j.ort ? { zusatz: j.ort } : {}),
            }))}
          />
        </div>
      ) : null}
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
