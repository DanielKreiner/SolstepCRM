import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { PhasePill } from "@/components/ui/PhasePill";
import { PhasenWechsel } from "@/components/ui/PhasenWechsel";
import { Pill } from "@/components/ui/Pill";
import { date, dateTime, eur } from "@/lib/format";
import { requireMe } from "@/lib/session";
import { KpiKarte } from "@/components/ui/KpiKarte";
import { AngebotKopf, PositionenEditor } from "../PositionenEditor";
import { QuoteActions } from "./QuoteActions";
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
  const me = await requireMe();
  const { id } = await params;
  const supabase = await createClient();

  const { data: quote } = await supabase
    .from("quote")
    .select(
      `id, number, status, net_total, cost_total, margin_pct, valid_until,
       intro_text, price_display, delivery_net,
       sent_at, opened_at, accepted_at, accepted_name, reminder_enabled, created_at,
       phase:phase_id ( id, label, system_key ),
       customer:customer_id ( id, name, contact_person, email, phone, zip, city ),
       owner:owner_id ( name )`,
    )
    .eq("id", id)
    .maybeSingle();

  if (!quote) notFound();

  const [{ data: items }, { data: kunden }, { data: artikel }] =
    await Promise.all([
      supabase
        .from("quote_item")
        .select(
          "id, pos, text, qty, unit, purchase_price, sale_price, vat_rate, kind, group_key, category, manufacturer, description, image_url, article:article_id ( sku )",
        )
        .eq("quote_id", id)
        .order("pos"),
      supabase
        .from("customer")
        .select("id, name, city")
        .is("deleted_at", null)
        .order("name"),
      supabase
        .from("article")
        .select("id, sku, name, sale_price, image_url")
        .eq("active", true)
        .order("name"),
    ]);

  const { data: phasenRoh } = await supabase
    .from("pipeline_phase")
    .select("id, label, system_key, pipeline:pipeline_id ( kind )")
    .order("sort");

  const vertriebsPhasen = ((phasenRoh ?? []) as unknown as {
    id: string;
    label: string;
    system_key: string | null;
    pipeline: { kind: string } | null;
  }[])
    .filter((p) => p.pipeline?.kind === "vertrieb")
    .map((p) => ({ id: p.id, label: p.label, systemKey: p.system_key }));

  const phase = quote.phase as unknown as {
    id: string;
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
            <a
              href={`/api/pdf/quote/${quote.id as string}`}
              className="rounded-pill border border-line bg-surface px-5 py-[13px] text-sm font-medium text-ink transition-colors hover:bg-sunk"
            >
              PDF
            </a>
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
        <KpiKarte
          akzent
          label="Angebotssumme"
          wert={eur(netto)}
          pille={`${(items ?? []).length} Positionen`}
          notiz="netto, exkl. USt."
        />
        <KpiKarte
          label="Kalkulierte Kosten"
          wert={eur(kosten)}
          notiz="Summe der Einkaufspreise"
        />
        <KpiKarte
          label="Rohertrag"
          wert={eur(netto - kosten)}
          pille={`${Number(quote.margin_pct ?? 0)} %`}
          ton={netto - kosten <= 0 ? "kritisch" : "gut"}
          notiz="Verkauf minus Einkauf"
        />
        <KpiKarte
          label="Gültig bis"
          wert={date(quote.valid_until as string | null)}
          ton={
            quote.valid_until &&
            new Date(quote.valid_until as string) < new Date()
              ? "kritisch"
              : "neutral"
          }
          notiz="danach nachfassen oder verlängern"
        />
      </div>

      {/*
        Phasenwechsel ohne Umweg über das Board — dieselbe Server Action
        wie beim Ziehen einer Karte.
      */}
      <div className="mb-4">
        <PhasenWechsel
          kind="vertrieb"
          cardId={quote.id as string}
          gesperrt={me.perms.angebote !== "write"}
          aktuelleId={phase?.id ?? null}
          phasen={vertriebsPhasen}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr] xl:items-start">
        <PositionenEditor
          quoteId={quote.id as string}
          gesperrt={Boolean(quote.accepted_at)}
          positionen={(items ?? []).map((it) => ({
            id: it.id as string,
            pos: it.pos as number,
            text: it.text as string,
            qty: Number(it.qty),
            unit: (it.unit as string) ?? "Stk",
            purchasePrice: Number(it.purchase_price),
            salePrice: Number(it.sale_price),
            vatRate: Number(it.vat_rate),
            kind: (it.kind as string) ?? "position",
            groupKey: (it.group_key as string | null) ?? null,
            category: (it.category as string | null) ?? null,
            manufacturer: (it.manufacturer as string | null) ?? null,
            description: (it.description as string | null) ?? null,
            imageUrl: (it.image_url as string | null) ?? null,
            sku:
              ((it.article as unknown as { sku: string } | null)?.sku ?? null),
          }))}
          artikel={(artikel ?? []).map((a) => ({
            wert: a.id as string,
            /*
             * Name voran, Nummer darunter: gesucht wird nach dem Namen,
             * die Nummer ist die Bestätigung, dass es der richtige ist.
             */
            text: a.name as string,
            zusatz: `${a.sku as string} · ${eur(a.sale_price)}`,
            ...(a.image_url ? { bild: a.image_url as string } : {}),
          }))}
        />

        <div className="flex flex-col gap-4">
          {me.perms.angebote === "write" ? (
            <AngebotKopf
              quoteId={quote.id as string}
              nummer={quote.number as string}
              customerId={(customer?.id as string) ?? ""}
              validUntil={(quote.valid_until as string | null) ?? null}
              introText={(quote.intro_text as string | null) ?? null}
              priceDisplay={(quote.price_display as string) ?? "positionen"}
              deliveryNet={Number(quote.delivery_net ?? 0)}
              gesperrt={Boolean(quote.accepted_at)}
              kunden={(kunden ?? []).map((k) => ({
                wert: k.id as string,
                text: [k.name as string, k.city as string | null]
                  .filter(Boolean)
                  .join(" · "),
              }))}
            />
          ) : null}

          <QuoteActions
            quoteId={quote.id as string}
            accepted={Boolean(quote.accepted_at)}
            canWrite={me.perms.angebote === "write"}
          />

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
