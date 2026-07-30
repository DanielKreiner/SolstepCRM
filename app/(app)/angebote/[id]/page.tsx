import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { PhasePill } from "@/components/ui/PhasePill";
import { Pill } from "@/components/ui/Pill";
import { Stat } from "@/components/ui/Stat";
import { date, dateTime, eur } from "@/lib/format";
import { requireMe } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Angebot" };

const STATUS_LABEL: Record<string, string> = {
  draft: "Entwurf",
  sent: "gesendet",
  opened: "geöffnet",
  accepted: "angenommen",
  lost: "verloren",
  expired: "abgelaufen",
};

export default async function AngebotPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireMe();
  const { id } = await params;
  const supabase = await createClient();

  const { data: quote } = await supabase
    .from("quote")
    .select(
      `id, number, status, net_total, cost_total, margin_pct, valid_until,
       sent_at, opened_at, accepted_at, accepted_name, reminder_enabled, created_at,
       phase:phase_id ( label, system_key ),
       customer:customer_id ( id, name, contact_person, email, phone, zip, city ),
       owner:owner_id ( name )`,
    )
    .eq("id", id)
    .maybeSingle();

  if (!quote) notFound();

  const { data: items } = await supabase
    .from("quote_item")
    .select(
      "id, pos, text, qty, unit, purchase_price, sale_price, vat_rate, unmatched, article:article_id ( sku )",
    )
    .eq("quote_id", id)
    .order("pos");

  const phase = quote.phase as unknown as {
    label: string;
    system_key: string | null;
  } | null;
  const customer = quote.customer as unknown as {
    id: string;
    name: string;
    contact_person: string | null;
    email: string | null;
    phone: string | null;
    zip: string | null;
    city: string | null;
  } | null;
  const owner = quote.owner as unknown as { name: string } | null;

  const netto = Number(quote.net_total);
  const kosten = Number(quote.cost_total);

  return (
    <>
      <PageHeader
        title={quote.number as string}
        subtitle={`${customer?.name ?? "—"} · Beträge exkl. USt.`}
        actions={
          <>
            {phase ? (
              <PhasePill label={phase.label} systemKey={phase.system_key} />
            ) : null}
            <Link
              href="/pipelines/vertrieb"
              className="rounded-pill border border-line bg-surface px-5 py-[13px] text-sm font-medium text-ink transition-colors hover:bg-sunk"
            >
              Zur Pipeline
            </Link>
          </>
        }
      />

      <div className="mb-4 grid gap-[10px] sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Angebotssumme" value={eur(netto)} />
        <Stat label="Kalkulierte Kosten" value={eur(kosten)} />
        <Stat
          label="Rohertrag"
          value={eur(netto - kosten)}
          tone={netto - kosten <= 0 ? "crit" : "done"}
          hint={`${Number(quote.margin_pct ?? 0)} %`}
        />
        <Stat
          label="Gültig bis"
          value={date(quote.valid_until as string | null)}
          tone={
            quote.valid_until &&
            new Date(quote.valid_until as string) < new Date()
              ? "crit"
              : undefined
          }
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr] xl:items-start">
        <section className="rounded-[20px] bg-surface p-5 shadow-soft">
          <h2 className="mb-3 text-[15px] font-semibold">
            Positionen{" "}
            <span className="num font-normal text-muted">
              ({(items ?? []).length})
            </span>
          </h2>
          {(items ?? []).length === 0 ? (
            <p className="text-[13px] text-muted">
              Noch keine Positionen. Der Step-Planer-Import kommt in
              Meilenstein 3.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {(items ?? []).map((it) => (
                <li
                  key={it.id as string}
                  className="flex flex-wrap items-center gap-3 rounded-input bg-panel px-4 py-3"
                >
                  <span className="num w-[110px] shrink-0 text-[12px] text-muted">
                    {(it.article as unknown as { sku: string } | null)?.sku ?? "—"}
                  </span>
                  <span className="min-w-0 flex-1 text-[13px]">
                    {it.text as string}
                    {it.unmatched ? (
                      <Pill tone="crit" className="ml-2">
                        nicht zuordenbar
                      </Pill>
                    ) : null}
                  </span>
                  <span className="num text-[12.5px] text-muted">
                    {Number(it.qty)} {(it.unit as string) ?? ""}
                  </span>
                  <span className="num text-[13px] font-semibold">
                    {eur(Number(it.qty) * Number(it.sale_price))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="flex flex-col gap-4">
          <section className="rounded-[20px] bg-surface p-5 shadow-soft">
            <h2 className="mb-3 text-[15px] font-semibold">Verlauf</h2>
            <dl className="flex flex-col gap-[9px] text-[13px]">
              <Row label="Status">
                <Pill
                  tone={
                    quote.status === "accepted"
                      ? "done"
                      : quote.status === "lost" || quote.status === "expired"
                        ? "crit"
                        : quote.status === "draft"
                          ? "neutral"
                          : "doing"
                  }
                >
                  {STATUS_LABEL[quote.status as string] ?? (quote.status as string)}
                </Pill>
              </Row>
              <Row label="Angelegt">{dateTime(quote.created_at as string)}</Row>
              <Row label="Gesendet">
                {quote.sent_at ? dateTime(quote.sent_at as string) : "—"}
              </Row>
              <Row label="Geöffnet">
                {quote.opened_at ? dateTime(quote.opened_at as string) : "—"}
              </Row>
              <Row label="Angenommen">
                {quote.accepted_at ? dateTime(quote.accepted_at as string) : "—"}
              </Row>
              {quote.accepted_name ? (
                <Row label="Durch">{quote.accepted_name as string}</Row>
              ) : null}
              <Row label="Betreut von">{owner?.name ?? "—"}</Row>
            </dl>
            <p className="mt-3 border-t border-line pt-3 text-[12px] text-faint">
              {"„Gesendet“"} heißt gesendet, nicht zugestellt — die
              Mail läuft über das Postfach des Betriebs, es gibt kein
              Zustellereignis.
            </p>
          </section>

          <section className="rounded-[20px] bg-surface p-5 shadow-soft">
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
              <Row label="Ansprechpartner">
                {customer?.contact_person ?? "—"}
              </Row>
              <Row label="E-Mail">
                <span className="num break-all">{customer?.email ?? "—"}</span>
              </Row>
              <Row label="Ort">
                {[customer?.zip, customer?.city].filter(Boolean).join(" ") || "—"}
              </Row>
            </dl>
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
