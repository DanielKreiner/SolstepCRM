import type { Metadata } from "next";
import Link from "next/link";
import { Abschnitt } from "@/components/ui/Abschnitt";
import { LinkButton } from "@/components/ui/Button";
import { KpiKarte } from "@/components/ui/KpiKarte";
import { PageHeader } from "@/components/ui/PageHeader";
import { date, dateTime, eur, eurShort, viennaDay } from "@/lib/format";
import {
  EVENT_LABEL,
  mailStatus,
  tage,
  type QuoteEvent,
} from "@/lib/quote-status";
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
  accepted_at: string | null;
  accepted_name: string | null;
  phase: { label: string; system_key: string | null } | null;
  customer: {
    id: string;
    name: string;
    city: string | null;
    email: string | null;
  } | null;
};

const TON_KLASSE: Record<string, string> = {
  neutral: "bg-sunk text-muted",
  doing: "bg-s-doing/12 text-s-doing",
  waiting: "bg-s-waiting/12 text-s-waiting",
  done: "bg-s-done/12 text-s-done",
  warn: "bg-accent/14 text-accent-ink",
  crit: "bg-s-crit/12 text-s-crit",
};

export default async function AngebotePage({
  searchParams,
}: {
  searchParams: Promise<{ angebot?: string }>;
}) {
  const me = await requireMe();
  const darfSchreiben = me.perms.angebote === "write";
  const supabase = await createClient();
  const heute = viennaDay();
  const { angebot: gewaehlt } = await searchParams;

  const [{ data }, { data: events }, { data: anlagen }] = await Promise.all([
    supabase
      .from("quote")
      .select(
        `id, number, status, net_total, cost_total, margin_pct, valid_until,
         sent_at, accepted_at, accepted_name,
         phase:phase_id ( label, system_key ),
         customer:customer_id ( id, name, city, email )`,
      )
      .order("number", { ascending: false }),
    supabase
      .from("quote_event")
      .select("quote_id, kind, meta_json, created_at")
      .order("created_at", { ascending: false }),
    supabase.from("plant").select("customer_id, kwp, storage_kwh"),
  ]);

  const rows = (data ?? []) as unknown as Row[];

  const eventsJe = new Map<string, QuoteEvent[]>();
  for (const e of events ?? []) {
    const id = e.quote_id as string;
    if (!eventsJe.has(id)) eventsJe.set(id, []);
    eventsJe.get(id)!.push({
      kind: e.kind as string,
      created_at: e.created_at as string,
    });
  }

  const anlageJe = new Map<string, { kwp: number | null; speicher: number | null }>();
  for (const p of anlagen ?? []) {
    const cid = p.customer_id as string;
    if (anlageJe.has(cid)) continue;
    anlageJe.set(cid, {
      kwp: p.kwp === null ? null : Number(p.kwp),
      speicher: p.storage_kwh === null ? null : Number(p.storage_kwh),
    });
  }

  const anlagenText = (kundeId: string | undefined): string => {
    if (!kundeId) return "";
    const a = anlageJe.get(kundeId);
    if (!a) return "";
    return [
      a.kwp ? `${a.kwp} kWp` : null,
      a.speicher ? `${a.speicher} kWh Speicher` : null,
    ]
      .filter(Boolean)
      .join(" + ");
  };

  const status = (r: Row) =>
    mailStatus(
      {
        status: r.status,
        sent_at: r.sent_at,
        accepted_at: r.accepted_at,
        valid_until: r.valid_until,
      },
      eventsJe.get(r.id) ?? [],
      heute,
    );

  // --- Kennzahlen wie in der Vorlage ---
  const versendet = rows.filter(
    (r) => r.sent_at && !r.accepted_at && r.status !== "lost",
  );
  const volumenVersendet = versendet.reduce((s, r) => s + Number(r.net_total), 0);

  const geoeffnet = versendet.filter(
    (r) => (eventsJe.get(r.id) ?? []).some((e) => e.kind === "opened"),
  );
  const oeffnungsrate =
    versendet.length > 0
      ? Math.round((geoeffnet.length / versendet.length) * 100)
      : 0;

  const vor90 = new Date(`${heute}T12:00:00Z`);
  vor90.setUTCDate(vor90.getUTCDate() - 90);
  const grenze90 = vor90.toISOString().slice(0, 10);

  const entschieden90 = rows.filter(
    (r) =>
      r.sent_at !== null &&
      r.sent_at.slice(0, 10) >= grenze90 &&
      (r.accepted_at !== null || r.status === "lost"),
  );
  const angenommen90 = entschieden90.filter((r) => r.accepted_at !== null);
  const annahmequote =
    entschieden90.length > 0
      ? Math.round((angenommen90.length / entschieden90.length) * 100)
      : 0;

  const laufzeiten = rows
    .filter((r) => r.sent_at && r.accepted_at)
    .map((r) => tage(r.sent_at!, r.accepted_at!.slice(0, 10)));
  const schnitt =
    laufzeiten.length > 0
      ? Math.round((laufzeiten.reduce((s, t) => s + t, 0) / laufzeiten.length) * 10) /
        10
      : null;

  const detail = gewaehlt
    ? (rows.find((r) => r.id === gewaehlt) ?? null)
    : (rows[0] ?? null);

  return (
    <>
      <PageHeader
        title="Angebote"
        subtitle="Versand, Öffnungen und digitale Annahme"
        actions={
          <>
            {darfSchreiben ? (
              <LinkButton href="/angebote/neu">Angebot erstellen</LinkButton>
            ) : null}
            <LinkButton href="/pipelines/vertrieb" variant="ghost">
              Als Board
            </LinkButton>
          </>
        }
      />

      <div className="mb-4 grid gap-[10px] sm:grid-cols-2 xl:grid-cols-4">
        <KpiKarte
          akzent
          label="Offen versendet"
          wert={versendet.length}
          pille={eurShort(volumenVersendet)}
          notiz="Volumen exkl. USt."
        />
        <KpiKarte
          label="Öffnungsrate"
          wert={`${oeffnungsrate} %`}
          pille={`${geoeffnet.length} von ${versendet.length} geöffnet`}
          ton={oeffnungsrate >= 60 ? "gut" : "neutral"}
          notiz="Öffnungen werden über ein Zählpixel erfasst"
        />
        <KpiKarte
          label="Annahmequote 90 Tage"
          wert={`${annahmequote} %`}
          pille={`${angenommen90.length} von ${entschieden90.length}`}
          ton={annahmequote >= 40 ? "gut" : "neutral"}
          notiz="nur entschiedene Angebote"
        />
        <KpiKarte
          label="Ø Zeit bis Annahme"
          wert={schnitt === null ? "—" : `${schnitt} Tage`}
          pille="Erinnerung nach 7 Tagen"
          notiz={
            schnitt === null ? "noch keine Annahme" : "vom Versand bis zur Zusage"
          }
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr] xl:items-start">
        {/* --- Liste --- */}
        <div className="overflow-x-auto rounded-[20px] bg-surface shadow-soft">
          {/*
            Die festen Spalten summieren sich auf 660 px. Bei einer zu
            knappen Mindestbreite bleibt für den Kundennamen nichts übrig —
            er stand hier auf "L.." zusammengeschnitten.
          */}
          <div className="min-w-[900px]">
            <div className="grid grid-cols-[150px_1.6fr_130px_170px_120px_90px] border-b border-line px-4 text-[11px] tracking-[0.07em] text-faint uppercase">
              {["Nummer", "Kunde", "Summe", "Mail-Status", "Gültig bis", "Marge"].map(
                (h, i) => (
                  <div
                    key={h}
                    className={`px-2 py-[14px] ${i >= 2 && i !== 3 ? "text-right" : ""}`}
                  >
                    {h}
                  </div>
                ),
              )}
            </div>

            {rows.length === 0 ? (
              <p className="px-6 py-8 text-[13.5px] text-muted">
                Noch kein Angebot angelegt.
              </p>
            ) : (
              rows.map((r) => {
                const s = status(r);
                const aktiv = detail?.id === r.id;
                const anlage = anlagenText(r.customer?.id);
                return (
                  <Link
                    key={r.id}
                    href={`/angebote?angebot=${r.id}`}
                    scroll={false}
                    className={[
                      "grid grid-cols-[150px_1.6fr_130px_170px_120px_90px] items-center border-b border-line px-4 text-ink last:border-b-0",
                      "transition-colors duration-200 hover:bg-panel hover:text-ink",
                      aktiv ? "bg-accent-sunk" : "",
                    ].join(" ")}
                  >
                    <div className="num px-2 py-3 text-[12.5px] font-semibold">
                      {r.number}
                    </div>
                    <div className="min-w-0 px-2 py-3">
                      <div className="truncate text-[13.5px] font-medium">
                        {r.customer?.name ?? "—"}
                      </div>
                      <div className="num truncate text-[11.5px] text-faint">
                        {anlage || r.customer?.city || "—"}
                      </div>
                    </div>
                    <div className="num px-2 py-3 text-right text-[13px] font-semibold">
                      {eurShort(r.net_total)}
                    </div>
                    <div className="px-2 py-3">
                      <span
                        className={`inline-block rounded-pill px-[9px] py-[3px] text-[11px] font-medium ${TON_KLASSE[s.ton]}`}
                      >
                        {s.label}
                      </span>
                      <div className="num mt-[3px] truncate text-[10.5px] text-faint">
                        {s.detail}
                      </div>
                    </div>
                    <div className="num px-2 py-3 text-right text-[12px] text-muted">
                      {r.valid_until ? date(r.valid_until) : "—"}
                    </div>
                    <div
                      className={`num px-2 py-3 text-right text-[12.5px] ${Number(r.margin_pct) < 15 ? "text-s-crit" : ""}`}
                    >
                      {Number(r.margin_pct)} %
                    </div>
                  </Link>
                );
              })
            )}
          </div>
        </div>

        {/* --- Detailpanel --- */}
        {detail ? (
          <Detailpanel
            quote={detail}
            events={eventsJe.get(detail.id) ?? []}
            anlage={anlagenText(detail.customer?.id)}
            heute={heute}
          />
        ) : null}
      </div>
    </>
  );
}

function Detailpanel({
  quote,
  events,
  anlage,
  heute,
}: {
  quote: Row;
  events: QuoteEvent[];
  anlage: string;
  heute: string;
}) {
  const s = mailStatus(
    {
      status: quote.status,
      sent_at: quote.sent_at,
      accepted_at: quote.accepted_at,
      valid_until: quote.valid_until,
    },
    events,
    heute,
  );

  return (
    <div className="flex flex-col gap-4">
      <Abschnitt
        titel={
          <span className="flex items-center gap-2">
            <span className="num text-[13px] font-semibold">{quote.number}</span>
            <span
              className={`rounded-pill px-[9px] py-[3px] text-[11px] font-medium ${TON_KLASSE[s.ton]}`}
            >
              {s.label}
            </span>
          </span>
        }
      >
        <p className="text-[17px] leading-snug font-semibold tracking-[-0.02em]">
          {quote.customer?.name ?? "—"}
        </p>
        <p className="num mt-1 text-[12.5px] text-muted">
          {[anlage, `${eur(quote.net_total)} netto`].filter(Boolean).join(" · ")}
        </p>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <div className="rounded-input bg-panel px-4 py-3">
            <div className="text-[11.5px] text-muted">Marge</div>
            <div
              className={`num mt-[2px] text-[17px] font-semibold ${Number(quote.margin_pct) < 15 ? "text-s-crit" : ""}`}
            >
              {Number(quote.margin_pct)} %
            </div>
          </div>
          <div className="rounded-input bg-panel px-4 py-3">
            <div className="text-[11.5px] text-muted">Gültig bis</div>
            <div className="num mt-[2px] text-[17px] font-semibold">
              {quote.valid_until ? date(quote.valid_until) : "—"}
            </div>
          </div>
        </div>
      </Abschnitt>

      <Abschnitt titel="Versand und Annahme">
        {events.length === 0 ? (
          <p className="text-[13px] text-muted">
            Noch kein Ereignis. Sobald das Angebot rausgeht, steht hier der
            Verlauf — Versand, Öffnungen, Klicks, Annahme.
          </p>
        ) : (
          <ol className="flex flex-col gap-3">
            {/*
              Gekappt: der Verlauf eines vielfach geöffneten Angebots hat
              schnell dreißig Einträge, und die untersten zwanzig sagen
              dasselbe wie der erste. Wer alles braucht, öffnet das Angebot.
            */}
            {events.slice(0, 8).map((e, i) => (
              <li key={`${e.kind}-${i}`} className="flex gap-[10px]">
                <span
                  aria-hidden
                  className={[
                    "mt-[6px] h-[7px] w-[7px] shrink-0 rounded-pill",
                    e.kind === "accepted"
                      ? "bg-s-done"
                      : e.kind === "bounced"
                        ? "bg-s-crit"
                        : e.kind === "opened" || e.kind === "link_clicked"
                          ? "bg-s-doing"
                          : "bg-line-strong",
                  ].join(" ")}
                />
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium">
                    {EVENT_LABEL[e.kind] ?? e.kind}
                  </span>
                  <span className="num block text-[11.5px] text-faint">
                    {dateTime(e.created_at)}
                  </span>
                </span>
              </li>
            ))}
            {events.length > 8 ? (
              <li className="num pl-[17px] text-[11.5px] text-faint">
                und {events.length - 8} weitere
              </li>
            ) : null}
          </ol>
        )}

        {/*
          Bewusst kein "zugestellt" in dieser Liste, auch wenn die Vorlage es
          zeigt: ohne Versanddienst gibt es keine Zustellbestätigung
          (CLAUDE.md 6.1). Was hier steht, ist beobachtet — nicht behauptet.
        */}
        <p className="mt-4 border-t border-line pt-3 text-[11.5px] text-faint">
          Öffnungen werden über ein Zählpixel erfasst und sind ein Hinweis,
          kein Beweis. Eine Zustellbestätigung gibt es nicht, weil die Mail
          über das Postfach des Betriebs läuft.
        </p>
      </Abschnitt>

      <Abschnitt titel="Nächster Schritt">
        <div className="flex flex-col gap-2">
          <LinkButton href={`/angebote/${quote.id}`} block>
            Angebot öffnen
          </LinkButton>
          {quote.customer ? (
            <LinkButton
              href={`/crm?kunde=${quote.customer.id}`}
              variant="ghost"
              block
            >
              Kunde im CRM
            </LinkButton>
          ) : null}
        </div>

        {quote.accepted_at ? (
          <p className="num mt-3 text-[12.5px] text-s-done">
            Angenommen {dateTime(quote.accepted_at)}
            {quote.accepted_name ? ` durch ${quote.accepted_name}` : ""}
          </p>
        ) : quote.customer?.email ? (
          <p className="num mt-3 text-[11.5px] text-faint">
            Kundenadresse {quote.customer.email}
          </p>
        ) : (
          <p className="mt-3 text-[11.5px] text-s-crit">
            Keine Mailadresse hinterlegt — Versand nicht möglich.
          </p>
        )}
      </Abschnitt>
    </div>
  );
}
