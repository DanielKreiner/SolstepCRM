import type { Metadata } from "next";
import Link from "next/link";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { PageHeader } from "@/components/ui/PageHeader";
import { PhasePill } from "@/components/ui/PhasePill";
import { KpiKarte } from "@/components/ui/KpiKarte";
import { date, eur, eurShort } from "@/lib/format";
import { requireMe } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Angebote" };

type Row = {
  id: string;
  number: string;
  status: string;
  net_total: string;
  cost_total: string;
  margin_pct: string;
  valid_until: string | null;
  sent_at: string | null;
  phase: { label: string; system_key: string | null } | null;
  customer: { id: string; name: string; city: string | null } | null;
};

export default async function AngebotePage() {
  await requireMe();
  const supabase = await createClient();

  const { data } = await supabase
    .from("quote")
    .select(
      `id, number, status, net_total, cost_total, margin_pct, valid_until, sent_at,
       phase:phase_id ( label, system_key ),
       customer:customer_id ( id, name, city )`,
    )
    .order("number", { ascending: false });

  const rows = (data ?? []) as unknown as Row[];

  const offen = rows.filter(
    (r) => r.phase?.system_key !== "won" && r.phase?.system_key !== "lost",
  );
  const volumen = offen.reduce((s, r) => s + Number(r.net_total), 0);
  const gewonnen = rows.filter((r) => r.phase?.system_key === "won");
  const abgelaufen = offen.filter(
    (r) => r.valid_until && new Date(r.valid_until) < new Date(),
  );

  const columns: Column<Row>[] = [
    {
      key: "nr",
      header: "Angebot",
      width: "150px",
      render: (r) => (
        <span className="num text-[13px] font-semibold">{r.number}</span>
      ),
    },
    {
      key: "kunde",
      header: "Kunde",
      width: "1.6fr",
      render: (r) => (
        <>
          <div className="text-sm font-medium">{r.customer?.name ?? "—"}</div>
          <div className="text-[12px] text-muted">{r.customer?.city ?? "—"}</div>
        </>
      ),
    },
    {
      key: "phase",
      header: "Phase",
      width: "185px",
      render: (r) =>
        r.phase ? (
          <PhasePill label={r.phase.label} systemKey={r.phase.system_key} />
        ) : (
          "—"
        ),
    },
    {
      key: "gueltig",
      header: "Gültig bis",
      width: "130px",
      render: (r) => {
        const abgelaufen =
          r.valid_until && new Date(r.valid_until) < new Date();
        return (
          <span
            className={`num text-[12.5px] ${abgelaufen ? "text-s-crit" : "text-muted"}`}
          >
            {date(r.valid_until)}
          </span>
        );
      },
    },
    {
      key: "marge",
      header: "Marge",
      width: "100px",
      align: "right",
      render: (r) => {
        const m = Number(r.margin_pct ?? 0);
        return (
          <span
            className={`num text-[12.5px] ${m < 15 ? "text-s-warn" : "text-ink"}`}
          >
            {m} %
          </span>
        );
      },
    },
    {
      key: "summe",
      header: "Summe",
      width: "140px",
      align: "right",
      render: (r) => (
        <span className="num text-[13px] font-semibold">{eur(r.net_total)}</span>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Angebote"
        subtitle={`${rows.length} Angebote · Beträge exkl. USt.`}
        actions={
          <Link
            href="/pipelines/vertrieb"
            className="rounded-pill border border-line bg-surface px-5 py-[13px] text-sm font-medium text-ink transition-colors hover:bg-sunk"
          >
            Als Board
          </Link>
        }
      />

      <div className="mb-4 grid gap-[10px] sm:grid-cols-2 xl:grid-cols-4">
        <KpiKarte
          akzent
          label="Volumen offen"
          wert={eurShort(volumen)}
          pille={`${offen.length} ${offen.length === 1 ? "Angebot" : "Angebote"}`}
          notiz="exkl. USt."
        />
        <KpiKarte
          label="Offen beim Kunden"
          wert={offen.length}
          notiz="versendet oder geöffnet, noch keine Antwort"
        />
        <KpiKarte
          label="Gewonnen"
          wert={gewonnen.length}
          ton="gut"
          notiz="angenommen, Auftrag angelegt"
        />
        <KpiKarte
          label="Abgelaufen"
          wert={abgelaufen.length}
          pille={abgelaufen.length > 0 ? "nachfassen" : "nichts abgelaufen"}
          ton={abgelaufen.length > 0 ? "kritisch" : "gut"}
          notiz="Gültigkeit überschritten"
        />
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        getKey={(r) => r.id}
        hrefFor={(r) => `/angebote/${r.id}`}
        empty="Noch kein Angebot angelegt."
      />
    </>
  );
}
