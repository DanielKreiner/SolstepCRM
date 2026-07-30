import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { PageHeader } from "@/components/ui/PageHeader";
import { PhasePill } from "@/components/ui/PhasePill";
import { Pill } from "@/components/ui/Pill";
import { Stat } from "@/components/ui/Stat";
import { date, eur, eurShort } from "@/lib/format";
import { requireMe } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Kunde" };

type JobRow = {
  id: string;
  number: string;
  scheduled_from: string | null;
  value_net: string;
  phase: { label: string; system_key: string | null } | null;
};

export default async function KundePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireMe();
  const { id } = await params;
  const supabase = await createClient();

  const { data: customer } = await supabase
    .from("customer")
    .select(
      "id, type, number, name, contact_person, email, phone, address, zip, city, source, crm_pipeline, crm_stage, notes, created_at",
    )
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();

  if (!customer) notFound();

  const { data: jobs } = await supabase
    .from("job")
    .select(
      "id, number, scheduled_from, value_net, phase:phase_id ( label, system_key )",
    )
    .eq("customer_id", id)
    .order("number", { ascending: false });

  const rows = (jobs ?? []) as unknown as JobRow[];
  const volumen = rows.reduce((s, j) => s + Number(j.value_net), 0);

  const columns: Column<JobRow>[] = [
    {
      key: "nr",
      header: "Auftrag",
      width: "140px",
      render: (j) => (
        <span className="num text-[13px] font-semibold">{j.number}</span>
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
      width: "130px",
      render: (j) => (
        <span className="num text-[12.5px] text-muted">
          {date(j.scheduled_from)}
        </span>
      ),
    },
    {
      key: "wert",
      header: "Wert",
      width: "1fr",
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
        title={customer.name as string}
        subtitle={`${customer.type === "customer" ? "Kunde" : "Lead"}${customer.number ? ` · ${customer.number as string}` : ""} · Beträge exkl. USt.`}
        actions={
          <Link
            href="/crm"
            className="rounded-pill border border-line bg-surface px-5 py-[13px] text-sm font-medium text-ink transition-colors hover:bg-sunk"
          >
            Zur Liste
          </Link>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-[10px] lg:grid-cols-4">
        <Stat label="Aufträge" value={rows.length} />
        <Stat label="Volumen" value={eur(volumen)} />
        <Stat
          label="Status"
          value={
            <Pill tone={customer.type === "customer" ? "done" : "waiting"}>
              {customer.type === "customer" ? "Kunde" : "Lead"}
            </Pill>
          }
        />
        <Stat label="Angelegt" value={date(customer.created_at as string)} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_1.7fr] xl:items-start">
        <div className="rounded-[20px] bg-surface p-5 shadow-soft">
          <h2 className="mb-3 text-[15px] font-semibold">Kontakt</h2>
          <dl className="flex flex-col gap-[9px] text-[13px]">
            <Row label="Ansprechpartner">
              {(customer.contact_person as string) ?? "—"}
            </Row>
            <Row label="E-Mail">
              <span className="num break-all">
                {(customer.email as string) ?? "—"}
              </span>
            </Row>
            <Row label="Telefon">
              <span className="num">{(customer.phone as string) ?? "—"}</span>
            </Row>
            <Row label="Adresse">
              {[
                customer.address,
                [customer.zip, customer.city].filter(Boolean).join(" "),
              ]
                .filter(Boolean)
                .join(", ") || "—"}
            </Row>
            <Row label="Quelle">{(customer.source as string) ?? "—"}</Row>
            <Row label="Pipeline">
              {(customer.crm_pipeline as string) ?? "—"}
            </Row>
          </dl>
          {customer.notes ? (
            <p className="mt-4 border-t border-line pt-3 text-[13px] text-muted">
              {customer.notes as string}
            </p>
          ) : null}
        </div>

        <section>
          <h2 className="mb-2 text-[15px] font-semibold">Aufträge</h2>
          <DataTable
            columns={columns}
            rows={rows}
            getKey={(j) => j.id}
            hrefFor={(j) => `/auftraege/${j.id}`}
            empty="Für diesen Kunden gibt es noch keinen Auftrag."
            compact
          />
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
