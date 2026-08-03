import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pill } from "@/components/ui/Pill";
import { Stat } from "@/components/ui/Stat";
import { date, dateTime, eur, eurShort } from "@/lib/format";
import { requireMe } from "@/lib/session";
import { PHASE_LABEL, type Phase } from "@/lib/vorgang/modell";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Kunde" };

const AKTIVITAET_LABEL: Record<string, string> = {
  quote: "Angebot",
  portal: "Kundenportal",
  mail: "E-Mail",
  call: "Telefonat",
  note: "Notiz",
  system: "System",
};

const AKTIVITAET_FARBE: Record<string, string> = {
  quote: "var(--s-warn)",
  portal: "var(--s-waiting)",
  mail: "var(--s-doing)",
  call: "var(--s-doing)",
  note: "var(--s-new)",
  system: "var(--s-done)",
};

type VorgangRow = {
  id: string;
  number: string;
  phase: Phase;
  wert: number;
  termin: string | null;
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

  const [
    { data: vorgaenge },
    { data: werte },
    { data: termine },
    { data: aktivitaeten },
  ] = await Promise.all([
    supabase
      .from("vorgang")
      .select("id, number, phase")
      .eq("customer_id", id)
      .order("number", { ascending: false }),
    supabase.from("v_vorgang_kpi").select("vorgang_id, auftragswert_netto"),
    supabase.from("vorgang_termin").select("vorgang_id, von").order("von"),
    supabase
      .from("contact_activity")
      .select("id, kind, body, created_at, meta_json")
      .eq("customer_id", id)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  /*
   * Der Wert kommt aus v_vorgang_kpi, weil authenticated auf
   * auftragswert_netto kein Spaltenrecht hat (0025). Rollen ohne
   * Angebotsrecht sehen die Vorgänge des Kunden ohne Beträge.
   */
  const wertJe = new Map(
    (werte ?? []).map((w) => [
      w.vorgang_id as string,
      Number(w.auftragswert_netto ?? 0),
    ]),
  );
  const terminJe = new Map<string, string>();
  for (const t of termine ?? []) {
    const vid = t.vorgang_id as string;
    if (!terminJe.has(vid)) terminJe.set(vid, t.von as string);
  }

  const rows: VorgangRow[] = (vorgaenge ?? []).map((v) => ({
    id: v.id as string,
    number: v.number as string,
    phase: v.phase as Phase,
    wert: wertJe.get(v.id as string) ?? 0,
    termin: terminJe.get(v.id as string) ?? null,
  }));
  const volumen = rows.reduce((s, v) => s + v.wert, 0);

  const columns: Column<VorgangRow>[] = [
    {
      key: "nr",
      header: "Vorgang",
      width: "140px",
      render: (v) => (
        <span className="num text-[13px] font-semibold">{v.number}</span>
      ),
    },
    {
      key: "phase",
      header: "Phase",
      width: "180px",
      render: (v) => (
        <Pill tone={v.phase === "verloren" ? "crit" : "doing"}>
          {PHASE_LABEL[v.phase]}
        </Pill>
      ),
    },
    {
      key: "termin",
      header: "Termin",
      width: "130px",
      render: (v) => (
        <span className="num text-[12.5px] text-muted">{date(v.termin)}</span>
      ),
    },
    {
      key: "wert",
      header: "Wert",
      width: "1fr",
      align: "right",
      render: (v) => (
        <span className="num text-[13px] font-semibold">
          {eurShort(v.wert)}
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

        <div className="flex flex-col gap-4">
          <section>
            <h2 className="mb-2 text-[15px] font-semibold">Vorgänge</h2>
            <DataTable
              columns={columns}
              rows={rows}
              getKey={(v) => v.id}
              hrefFor={(v) => `/vorgaenge/${v.id}`}
              empty="Für diesen Kunden gibt es noch keinen Vorgang."
              compact
            />
          </section>

          <section className="rounded-[20px] bg-surface p-5 shadow-soft">
            <h2 className="mb-1 text-[15px] font-semibold">
              Aktivitäten{" "}
              <span className="num font-normal text-muted">
                ({(aktivitaeten ?? []).length})
              </span>
            </h2>
            <p className="mb-3 text-[12px] text-faint">
              Laufen automatisch ein: Angebotsstatus, Kundenportal, Mail und
              Phasenwechsel.
            </p>

            {(aktivitaeten ?? []).length === 0 ? (
              <p className="text-[13px] text-muted">Noch keine Aktivität.</p>
            ) : (
              <ol className="flex flex-col gap-[10px]">
                {(aktivitaeten ?? []).map((a) => (
                  <li key={a.id as string} className="flex gap-3">
                    <span
                      aria-hidden
                      className="mt-[6px] h-2 w-2 shrink-0 rounded-pill"
                      style={{ background: AKTIVITAET_FARBE[a.kind as string] ?? "var(--s-new)" }}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px]">{a.body as string}</p>
                      <p className="num text-[11.5px] text-faint">
                        {AKTIVITAET_LABEL[a.kind as string] ?? (a.kind as string)}
                        {" · "}
                        {dateTime(a.created_at as string)}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
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
