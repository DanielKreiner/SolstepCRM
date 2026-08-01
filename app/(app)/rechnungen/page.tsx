import type { Metadata } from "next";
import Link from "next/link";
import { Abschnitt, Zaehler } from "@/components/ui/Abschnitt";
import { KpiKarte } from "@/components/ui/KpiKarte";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pill } from "@/components/ui/Pill";
import { date, eur, eurShort, viennaDay } from "@/lib/format";
import {
  DUNNING_LEVELS,
  KIND_LABEL,
  dueDunningLevel,
  round2,
  type InvoiceKind,
} from "@/lib/money";
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

type Row = {
  id: string;
  number: string;
  kind: InvoiceKind;
  amount_net: string;
  vat_amount: string;
  issued_on: string;
  due_date: string;
  paid_at: string | null;
  paid_amount: string;
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

const SPALTEN = "160px 1.5fr 140px 120px 160px 150px";

export default async function RechnungenPage({
  searchParams,
}: {
  searchParams: Promise<{ beleg?: string }>;
}) {
  const me = await requireMe();
  const supabase = await createClient();
  const heute = viennaDay();
  const { beleg: gewaehlt } = await searchParams;

  const [{ data: invoices }, { data: jobs }] = await Promise.all([
    supabase
      .from("invoice")
      .select(
        `id, number, kind, amount_net, vat_amount, issued_on, due_date, paid_at,
         paid_amount, status, dunning_level, last_dunned_at,
         job:job_id ( id, number, value_net, customer:customer_id ( name ) )`,
      )
      .order("issued_on", { ascending: false }),
    supabase
      .from("job")
      .select("id, number, value_net, customer:customer_id ( name )")
      .order("number", { ascending: false })
      .limit(50),
  ]);

  const rows = (invoices ?? []) as unknown as Row[];
  const aktiv = rows.filter((r) => r.status !== "cancelled");
  const offen = aktiv.filter((r) => r.status !== "paid");

  const offenSumme = round2(
    offen.reduce(
      (s, r) => s + Number(r.amount_net) + Number(r.vat_amount) - Number(r.paid_amount),
      0,
    ),
  );

  const ueberfaellig = offen.filter((r) => r.due_date < heute);
  const ueberfaelligSumme = round2(
    ueberfaellig.reduce(
      (s, r) => s + Number(r.amount_net) + Number(r.vat_amount),
      0,
    ),
  );
  const aeltester = ueberfaellig
    .map((r) => tage(r.due_date, heute))
    .sort((a, b) => b - a)[0];

  const monatsBeginn = `${heute.slice(0, 7)}-01`;
  const bezahltMonat = aktiv.filter(
    (r) => r.paid_at !== null && r.paid_at.slice(0, 10) >= monatsBeginn,
  );
  const bezahltSumme = round2(
    bezahltMonat.reduce((s, r) => s + Number(r.amount_net), 0),
  );

  /*
   * Mahnlauf-Vorschlag: was der Nachtlauf heute tun würde. Bewusst
   * dieselbe Funktion wie der Cron (lib/money.dueDunningLevel) — eine
   * zweite Implementierung würde hier etwas anderes vorschlagen, als
   * nachts passiert, und das merkt man erst am Kunden.
   */
  const vorschlag = ueberfaellig
    .map((r) => ({
      row: r,
      stufe: dueDunningLevel(r.due_date, r.dunning_level, heute),
    }))
    .filter((v): v is { row: Row; stufe: (typeof DUNNING_LEVELS)[number] } =>
      v.stufe !== null,
    );

  // Bereits fakturiert je Auftrag — Grundlage für Fortschritt und Formular.
  const fakturiert = new Map<string, number>();
  for (const r of aktiv) {
    if (!r.job) continue;
    fakturiert.set(
      r.job.id,
      round2((fakturiert.get(r.job.id) ?? 0) + Number(r.amount_net)),
    );
  }

  const detail = gewaehlt
    ? (rows.find((r) => r.id === gewaehlt) ?? null)
    : (offen[0] ?? rows[0] ?? null);

  const detailGeschwister = detail?.job
    ? aktiv
        .filter((r) => r.job?.id === detail.job!.id)
        .sort((a, b) => (a.issued_on < b.issued_on ? -1 : 1))
    : [];

  return (
    <>
      <PageHeader
        title="Rechnungen"
        subtitle={`${rows.length} Belege · Beträge netto, USt. gesondert`}
      />

      <div className="mb-4 grid gap-[10px] sm:grid-cols-2 xl:grid-cols-4">
        {/*
          Die Vorlage setzt hier nicht die Akzentkarte an die erste Stelle,
          sondern eine rote Alarmkarte auf "Überfällig" — und nur dann, wenn
          wirklich etwas überfällig ist. Ein Screen, auf dem dauerhaft eine
          rote Karte klebt, warnt nach zwei Wochen niemanden mehr.
        */}
        {ueberfaellig.length > 0 ? (
          <AlarmKarte
            label="Überfällig"
            wert={eurShort(ueberfaelligSumme)}
            pille={`${ueberfaellig.length} ${ueberfaellig.length === 1 ? "Beleg" : "Belege"}`}
            notiz={
              aeltester !== undefined
                ? `ältester Rückstand ${aeltester} Tage`
                : undefined
            }
          />
        ) : (
          <KpiKarte
            akzent
            label="Offener Betrag"
            wert={eurShort(offenSumme)}
            pille={`${offen.length} offen`}
            notiz="brutto, inkl. USt."
          />
        )}

        <KpiKarte
          label="Offene Rechnungen"
          wert={eurShort(offenSumme)}
          pille={`${offen.length} ${offen.length === 1 ? "Beleg" : "Belege"}`}
          notiz="brutto, inkl. USt."
        />
        <KpiKarte
          label="Diesen Monat bezahlt"
          wert={eurShort(bezahltSumme)}
          pille={`${bezahltMonat.length} ${bezahltMonat.length === 1 ? "Beleg" : "Belege"}`}
          ton="gut"
          notiz="netto"
        />
        <KpiKarte
          label="Mahnlauf heute"
          wert={vorschlag.length}
          pille={vorschlag.length > 0 ? "Vorschlag offen" : "nichts zu tun"}
          ton={vorschlag.length > 0 ? "warn" : "gut"}
          notiz="läuft nachts automatisch"
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.7fr_1fr] xl:items-start">
        <div className="overflow-x-auto rounded-[20px] bg-surface shadow-soft">
          <div className="min-w-[900px]">
            <div
              className="grid border-b border-line px-4 text-[11px] tracking-[0.07em] text-faint uppercase"
              style={{ gridTemplateColumns: SPALTEN }}
            >
              {[
                ["Nummer", false],
                ["Kunde", false],
                ["Betrag", true],
                ["Fällig", false],
                ["Fortschritt", false],
                ["Status", false],
              ].map(([h, rechts]) => (
                <div
                  key={h as string}
                  className={`px-2 py-[14px] ${rechts ? "text-right" : ""}`}
                >
                  {h as string}
                </div>
              ))}
            </div>

            {rows.length === 0 ? (
              <p className="px-6 py-8 text-[13.5px] text-muted">
                Noch keine Rechnung erzeugt.
              </p>
            ) : (
              rows.map((r) => {
                const auftragswert = Number(r.job?.value_net ?? 0);
                const bisher = r.job ? (fakturiert.get(r.job.id) ?? 0) : 0;
                const anteil =
                  auftragswert > 0
                    ? Math.min(100, Math.round((bisher / auftragswert) * 100))
                    : null;
                const spaet = r.status !== "paid" && r.due_date < heute;

                return (
                  <Link
                    key={r.id}
                    href={`/rechnungen?beleg=${r.id}`}
                    scroll={false}
                    className={[
                      "grid items-center border-b border-line px-4 text-ink last:border-b-0",
                      "transition-colors duration-200 hover:bg-panel hover:text-ink",
                      detail?.id === r.id ? "bg-accent-sunk" : "",
                    ].join(" ")}
                    style={{ gridTemplateColumns: SPALTEN }}
                  >
                    <div className="num px-2 py-3 text-[12.5px] font-semibold">
                      {r.number}
                    </div>
                    <div className="min-w-0 px-2 py-3">
                      <div className="truncate text-[13.5px] font-medium">
                        {r.job?.customer?.name ?? "—"}
                      </div>
                      <div className="num truncate text-[11px] text-faint">
                        {r.job?.number ?? ""} · {KIND_LABEL[r.kind]}
                      </div>
                    </div>
                    <div className="num px-2 py-3 text-right text-[13px] font-semibold">
                      {eur(Number(r.amount_net) + Number(r.vat_amount))}
                    </div>
                    <div
                      className={`num px-2 py-3 text-[12.5px] ${spaet ? "text-s-crit" : "text-muted"}`}
                    >
                      {date(r.due_date)}
                    </div>
                    <div className="px-2 py-3">
                      {anteil === null ? (
                        <span className="text-[11.5px] text-faint">—</span>
                      ) : (
                        <>
                          <div className="h-[5px] w-full max-w-[110px] overflow-hidden rounded-pill bg-sunk">
                            <div
                              className="h-full rounded-pill bg-[linear-gradient(90deg,var(--accent-from),var(--accent-to))]"
                              style={{ width: `${anteil}%` }}
                            />
                          </div>
                          <div className="num mt-[4px] text-[10.5px] text-faint">
                            {anteil} % fakturiert
                          </div>
                        </>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-1 px-2 py-3">
                      <Pill tone={STATUS_TONE[r.status] ?? "neutral"}>
                        {STATUS_LABEL[r.status] ?? r.status}
                      </Pill>
                      {r.dunning_level > 0 ? (
                        <Pill tone="crit" mono>
                          M{r.dunning_level}
                        </Pill>
                      ) : null}
                    </div>
                  </Link>
                );
              })
            )}
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <Abschnitt
            titel="Mahnlauf-Vorschlag"
            rechts={
              vorschlag.length > 0 ? <Zaehler>{vorschlag.length}</Zaehler> : null
            }
          >
            {vorschlag.length === 0 ? (
              <p className="text-[13px] text-muted">
                Nichts über Zahlungsziel. Der Lauf prüft jede Nacht und stuft
                immer nur eine Stufe hoch — ein vergessener Lauf überspringt
                die Zahlungserinnerung sonst.
              </p>
            ) : (
              <>
                <p className="-mt-1 mb-3 text-[12.5px] text-muted">
                  {vorschlag.length}{" "}
                  {vorschlag.length === 1 ? "Rechnung" : "Rechnungen"} über
                  Zahlungsziel
                  {vorschlag.some((v) => v.stufe.level >= 2)
                    ? `, höchster Fall in ${vorschlag.reduce((m, v) => (v.stufe.level > m ? v.stufe.level : m), 0)}. Stufe`
                    : ""}
                  .
                </p>
                <ul className="flex flex-col gap-2">
                  {vorschlag.map((v) => (
                    <li
                      key={v.row.id}
                      className="flex flex-wrap items-center gap-2 rounded-input bg-panel px-4 py-3"
                    >
                      <span className="num text-[12.5px] font-semibold">
                        {v.row.number}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[12.5px]">
                        {v.row.job?.customer?.name ?? "—"}
                      </span>
                      <Pill tone="crit">{v.stufe.label}</Pill>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-[11.5px] text-faint">
                  Der Nachtlauf erledigt das von selbst. Diese Liste zeigt nur,
                  was er tun wird.
                </p>
              </>
            )}
          </Abschnitt>

          {detail?.job ? (
            <Abschnitt titel={`Teilrechnungen ${detail.job.number}`}>
              <p className="-mt-1 mb-3 text-[12.5px] text-muted">
                Auftragswert {eur(detail.job.value_net)} netto · bereits
                fakturiert {eur(fakturiert.get(detail.job.id) ?? 0)}
              </p>
              <ul className="flex flex-col gap-2">
                {detailGeschwister.map((g) => (
                  <li
                    key={g.id}
                    className={[
                      "flex flex-wrap items-center gap-2 rounded-input px-4 py-3",
                      g.id === detail.id ? "bg-accent-sunk" : "bg-panel",
                    ].join(" ")}
                  >
                    <span className="text-[12.5px] font-medium">
                      {KIND_LABEL[g.kind]}
                    </span>
                    <span className="num flex-1 text-right text-[12.5px]">
                      {eur(g.amount_net)}
                    </span>
                    <Pill tone={STATUS_TONE[g.status] ?? "neutral"}>
                      {STATUS_LABEL[g.status] ?? g.status}
                    </Pill>
                  </li>
                ))}
              </ul>

              {me.perms.rechnungen === "write" ? (
                <div className="mt-4">
                  <InvoiceRowActions
                    invoiceId={detail.id}
                    status={detail.status}
                  />
                </div>
              ) : null}
            </Abschnitt>
          ) : null}

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
      </div>
    </>
  );
}

/** Rote Variante der Kennzahlkarte. Nur für echte Alarme, nie dauerhaft. */
function AlarmKarte({
  label,
  wert,
  pille,
  notiz,
}: {
  label: string;
  wert: string;
  pille: string;
  notiz?: string | undefined;
}) {
  return (
    <div className="rounded-[20px] bg-[linear-gradient(150deg,#DE6A54,#C13F2A)] px-5 py-[18px] shadow-[0_8px_24px_rgba(193,63,42,0.26)]">
      <div className="text-[12.5px] text-white/85">{label}</div>
      <div className="num mt-[10px] text-[32px] leading-[1.05] font-semibold tracking-[-0.03em] text-white">
        {wert}
      </div>
      <div className="mt-[10px] flex flex-wrap items-center gap-2">
        <span className="num rounded-pill bg-white/20 px-[9px] py-[3px] text-[11px] font-semibold text-white">
          {pille}
        </span>
        {notiz ? (
          <span className="text-[11.5px] text-white/80">{notiz}</span>
        ) : null}
      </div>
    </div>
  );
}

function tage(von: string, bis: string): number {
  return Math.round(
    (new Date(`${bis}T12:00:00Z`).getTime() -
      new Date(`${von}T12:00:00Z`).getTime()) /
      86400000,
  );
}
