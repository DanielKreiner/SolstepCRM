import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pill } from "@/components/ui/Pill";
import { Stat } from "@/components/ui/Stat";
import { date, eur } from "@/lib/format";
import { KIND_LABEL, round2, type InvoiceKind } from "@/lib/money";
import { requireMe } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { CreateInvoiceForm, InvoiceRowActions } from "./InvoiceActions";

export const metadata: Metadata = { title: "Rechnungen" };

const STATUS_LABEL: Record<string, string> = {
  draft: "Entwurf",
  sent: "versendet",
  partial: "teilbezahlt",
  paid: "bezahlt",
  overdue: "überfällig",
  cancelled: "storniert",
};

const STATUS_TONE: Record<string, "neutral" | "doing" | "done" | "crit"> = {
  draft: "neutral",
  sent: "doing",
  partial: "doing",
  paid: "done",
  overdue: "crit",
  cancelled: "neutral",
};

export default async function RechnungenPage() {
  const me = await requireMe();
  const supabase = await createClient();

  const [{ data: invoices }, { data: jobs }] = await Promise.all([
    supabase
      .from("invoice")
      .select(
        `id, number, kind, amount_net, vat_amount, issued_on, due_date, paid_at,
         status, dunning_level, last_dunned_at,
         job:job_id ( id, number, value_net, customer:customer_id ( name ) )`,
      )
      .order("issued_on", { ascending: false }),
    supabase
      .from("job")
      .select("id, number, value_net, customer:customer_id ( name )")
      .order("number", { ascending: false })
      .limit(50),
  ]);

  type Row = {
    id: string;
    number: string;
    kind: InvoiceKind;
    amount_net: string;
    vat_amount: string;
    issued_on: string;
    due_date: string;
    paid_at: string | null;
    status: string;
    dunning_level: number;
    last_dunned_at: string | null;
    job: {
      id: string;
      number: string;
      value_net: string;
      customer: { name: string } | null;
    } | null;
  };

  const rows = (invoices ?? []) as unknown as Row[];
  const aktiv = rows.filter((r) => r.status !== "cancelled");

  const offen = aktiv.filter((r) => r.status !== "paid");
  const offenSumme = round2(
    offen.reduce((s, r) => s + Number(r.amount_net) + Number(r.vat_amount), 0),
  );
  const ueberfaellig = offen.filter((r) => r.due_date < new Date().toISOString().slice(0, 10));
  const bezahlt = round2(
    aktiv
      .filter((r) => r.status === "paid")
      .reduce((s, r) => s + Number(r.amount_net), 0),
  );

  // Bereits fakturiert je Auftrag — Grundlage für die nächste Teilrechnung.
  const fakturiert = new Map<string, number>();
  for (const r of aktiv) {
    if (!r.job) continue;
    fakturiert.set(
      r.job.id,
      round2((fakturiert.get(r.job.id) ?? 0) + Number(r.amount_net)),
    );
  }

  return (
    <>
      <PageHeader
        title="Rechnungen"
        subtitle={`${rows.length} Rechnungen · Beträge netto, USt. gesondert`}
      />

      <div className="mb-4 grid grid-cols-2 gap-[10px] lg:grid-cols-4">
        <Stat label="Offen" value={offen.length} />
        <Stat label="Offener Betrag" value={eur(offenSumme)} hint="brutto" />
        <Stat
          label="Überfällig"
          value={ueberfaellig.length}
          tone={ueberfaellig.length > 0 ? "crit" : "done"}
        />
        <Stat label="Bezahlt (netto)" value={eur(bezahlt)} tone="done" />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.7fr_1fr] xl:items-start">
        <section className="flex flex-col gap-3">
          {rows.length === 0 ? (
            <div className="rounded-[20px] bg-surface p-6 text-[13.5px] text-muted shadow-soft">
              Noch keine Rechnung erzeugt.
            </div>
          ) : (
            rows.map((r) => (
              <article
                key={r.id}
                className="rounded-[20px] bg-surface p-5 shadow-soft"
              >
                <div className="flex flex-wrap items-center gap-3">
                  <span className="num text-[13px] font-semibold">{r.number}</span>
                  <Pill tone={STATUS_TONE[r.status] ?? "neutral"}>
                    {STATUS_LABEL[r.status] ?? r.status}
                  </Pill>
                  <Pill tone="neutral">{KIND_LABEL[r.kind]}</Pill>
                  {r.dunning_level > 0 ? (
                    <Pill tone="crit">Mahnstufe {r.dunning_level}</Pill>
                  ) : null}
                  <span className="min-w-0 flex-1 truncate text-[13px]">
                    {r.job?.customer?.name ?? "—"}
                  </span>
                  {r.job ? (
                    <Link
                      href={`/auftraege/${r.job.id}`}
                      className="num text-[12.5px] text-accent-ink hover:underline"
                    >
                      {r.job.number}
                    </Link>
                  ) : null}
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-[12.5px]">
                  <span className="num">
                    netto {eur(r.amount_net)} · USt. {eur(r.vat_amount)} ·{" "}
                    <strong>
                      brutto {eur(Number(r.amount_net) + Number(r.vat_amount))}
                    </strong>
                  </span>
                  <span className="num text-muted">
                    fällig {date(r.due_date)}
                  </span>
                  {r.paid_at ? (
                    <span className="num text-s-done">
                      bezahlt {date(r.paid_at)}
                    </span>
                  ) : null}
                  {r.last_dunned_at ? (
                    <span className="num text-s-crit">
                      gemahnt {date(r.last_dunned_at)}
                    </span>
                  ) : null}
                </div>

                {me.perms.rechnungen === "write" ? (
                  <div className="mt-3">
                    <InvoiceRowActions invoiceId={r.id} status={r.status} />
                  </div>
                ) : null}
              </article>
            ))
          )}
        </section>

        {me.perms.rechnungen === "write" ? (
          <CreateInvoiceForm
            jobs={(jobs ?? []).map((j) => {
              const wert = Number(j.value_net);
              const bereits = fakturiert.get(j.id as string) ?? 0;
              return {
                id: j.id as string,
                label: `${j.number as string} · ${(j.customer as unknown as { name: string } | null)?.name ?? ""} · offen ${round2(wert - bereits).toFixed(0)} EUR`,
                offen: round2(wert - bereits),
              };
            })}
          />
        ) : (
          <div className="rounded-[20px] bg-surface p-[22px] text-[13px] text-muted shadow-soft">
            Für Rechnungen fehlt deiner Rolle das Schreibrecht.
          </div>
        )}
      </div>
    </>
  );
}
