import type { Metadata } from "next";
import Link from "next/link";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pill } from "@/components/ui/Pill";
import { KpiKarte } from "@/components/ui/KpiKarte";
import { date } from "@/lib/format";
import { requireMe } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "CRM" };

type Row = {
  id: string;
  type: string;
  number: string | null;
  name: string;
  contact_person: string | null;
  email: string | null;
  phone: string | null;
  zip: string | null;
  city: string | null;
  source: string | null;
  crm_stage: string | null;
  created_at: string;
};

export default async function CrmPage({
  searchParams,
}: {
  searchParams: Promise<{ typ?: string }>;
}) {
  await requireMe();
  const { typ } = await searchParams;
  const supabase = await createClient();

  let query = supabase
    .from("customer")
    .select(
      "id, type, number, name, contact_person, email, phone, zip, city, source, crm_stage, created_at",
    )
    .is("deleted_at", null)
    .order("name");

  if (typ === "lead" || typ === "customer") query = query.eq("type", typ);

  const { data } = await query;
  const rows = (data ?? []) as unknown as Row[];

  const leads = rows.filter((r) => r.type === "lead").length;
  const kunden = rows.filter((r) => r.type === "customer").length;

  const columns: Column<Row>[] = [
    {
      key: "name",
      header: "Name",
      width: "1.6fr",
      render: (c) => (
        <>
          <div className="text-sm font-medium">{c.name}</div>
          <div className="text-[12px] text-muted">
            {c.contact_person ?? "—"}
          </div>
        </>
      ),
    },
    {
      key: "typ",
      header: "Typ",
      width: "120px",
      render: (c) => (
        <Pill tone={c.type === "customer" ? "done" : "waiting"}>
          {c.type === "customer" ? "Kunde" : "Lead"}
        </Pill>
      ),
    },
    {
      key: "nummer",
      header: "Nr.",
      width: "110px",
      render: (c) => (
        <span className="num text-[12.5px] text-muted">{c.number ?? "—"}</span>
      ),
    },
    {
      key: "ort",
      header: "Ort",
      width: "160px",
      render: (c) => (
        <span className="text-[13px]">
          {[c.zip, c.city].filter(Boolean).join(" ") || "—"}
        </span>
      ),
    },
    {
      key: "kontakt",
      header: "Kontakt",
      width: "1.2fr",
      render: (c) => (
        <span className="num text-[12.5px] text-muted">
          {c.email ?? c.phone ?? "—"}
        </span>
      ),
    },
    {
      key: "seit",
      header: "Angelegt",
      width: "120px",
      align: "right",
      render: (c) => (
        <span className="num text-[12.5px] text-muted">{date(c.created_at)}</span>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="CRM"
        subtitle={`${rows.length} Einträge${typ ? " · gefiltert" : ""}`}
      />

      <div className="mb-4 grid gap-[10px] sm:grid-cols-2 xl:grid-cols-4">
        <KpiKarte
          akzent
          label="Kunden und Leads"
          wert={rows.length}
          pille={`${leads} ${leads === 1 ? "Lead" : "Leads"}`}
          notiz="im Bestand geführt"
        />
        <KpiKarte
          label="Bestandskunden"
          wert={kunden}
          ton="gut"
          notiz="mindestens ein Auftrag abgeschlossen"
        />
        <KpiKarte
          label="Leads"
          wert={leads}
          notiz="noch kein Auftrag, Vertrieb offen"
        />
        <KpiKarte
          label="Orte"
          wert={new Set(rows.map((r) => r.city).filter(Boolean)).size}
          notiz="Einzugsgebiet nach Gemeinden"
        />
      </div>

      <nav className="mb-4 flex gap-[3px] rounded-pill bg-surface p-1 shadow-soft">
        <Tab href="/crm" label="Alle" active={!typ} />
        <Tab href="/crm?typ=customer" label="Kunden" active={typ === "customer"} />
        <Tab href="/crm?typ=lead" label="Leads" active={typ === "lead"} />
      </nav>

      <DataTable
        columns={columns}
        rows={rows}
        getKey={(c) => c.id}
        hrefFor={(c) => `/crm/${c.id}`}
        empty="Noch keine Kunden angelegt."
      />
    </>
  );
}

function Tab({
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
