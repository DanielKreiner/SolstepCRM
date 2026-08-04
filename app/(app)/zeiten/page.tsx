import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pill, type Tone } from "@/components/ui/Pill";
import { Reiter } from "@/components/ui/Reiter";
import { Stat } from "@/components/ui/Stat";
import { date, hhmm, time, viennaDay } from "@/lib/format";
import { konten, tagesbild, wochenbild } from "@/lib/zeiten/daten";
import { requireMe } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { addDays, startOfViennaWeek } from "@/lib/time";
import { Nacherfassen, Wochenabschluss, Korrekturen } from "./Formulare";

export const metadata: Metadata = { title: "Zeiten" };

/**
 * Das Zeiten-Modul.
 *
 * Vorher waren es vier Seiten — Zeiterfassung, Stundenkonto, Meine
 * Zeiten, Korrekturanträge — mit eigenen Abfragen und damit eigenen
 * Wahrheiten. Jetzt ist es eine Seite mit drei Blicken auf dieselbe
 * Quelle: heute, die Woche, die Konten.
 */

const TABS = ["heute", "woche", "konten"] as const;
type Tab = (typeof TABS)[number];

const LABEL: Record<Tab, string> = {
  heute: "Heute",
  woche: "Woche",
  konten: "Konten",
};

const STATUS_TON: Record<string, Tone> = {
  running: "doing",
  booked: "warn",
  approved: "done",
  flagged: "crit",
  replaced: "neutral",
};

const STATUS_TEXT: Record<string, string> = {
  running: "läuft",
  booked: "gebucht",
  approved: "genehmigt",
  flagged: "zu prüfen",
  replaced: "ersetzt",
};

export default async function ZeitenPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; tag?: string; woche?: string }>;
}) {
  const me = await requireMe();
  const { tab: tabRoh, tag: tagRoh, woche: wocheRoh } = await searchParams;

  const tab: Tab = TABS.includes(tabRoh as Tab) ? (tabRoh as Tab) : "heute";
  const tag = tagRoh ?? viennaDay();
  const montag = wocheRoh ?? startOfViennaWeek(viennaDay());

  const supabase = await createClient();
  const darfSchreiben = me.perms.zeiterfassung === "write";

  const bild = await tagesbild(supabase, { tag });

  return (
    <>
      <PageHeader
        title="Zeiten"
        subtitle="Wer arbeitet gerade, was steht in dieser Woche, wie stehen die Konten"
      />

      <div className="mb-4 grid gap-[10px] sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Jetzt eingestempelt"
          value={String(bild.eingestempelt)}
          tone={bild.eingestempelt > 0 ? "done" : undefined}
        />
        <Stat label="Ist heute" value={hhmm(bild.istGesamtMin)} />
        <Stat
          label="Zu prüfen"
          value={String(bild.zuPruefen)}
          tone={bild.zuPruefen > 0 ? "warn" : undefined}
        />
        <Stat
          label="Offene Korrekturen"
          value={String(bild.offeneKorrekturen)}
          tone={bild.offeneKorrekturen > 0 ? "warn" : undefined}
        />
      </div>

      <Reiter
        aktiv={tab}
        eintraege={TABS.map((t) => ({
          key: t,
          label: LABEL[t],
          href: `/zeiten?tab=${t}`,
          ...(t === "konten" && bild.offeneKorrekturen > 0
            ? { anzahl: bild.offeneKorrekturen }
            : {}),
        }))}
      />

      {tab === "heute" ? (
        <div className="grid gap-4 xl:grid-cols-[1.7fr_1fr] xl:items-start">
          <section className="min-w-0 rounded-[20px] bg-surface p-5 shadow-soft">
            <h2 className="mb-3 text-[15px] font-semibold">{date(tag)}</h2>

            {bild.personen.every((p) => p.zeilen.length === 0) ? (
              <p className="text-[13px] text-muted">
                Für diesen Tag ist noch nichts gebucht.
              </p>
            ) : (
              <ul className="flex flex-col gap-[6px]">
                {bild.personen
                  .filter((p) => p.zeilen.length > 0 || p.sollMin > 0)
                  .map((p) => (
                    <li
                      key={p.userId}
                      className="rounded-card border border-line bg-panel px-3 py-[10px]"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[13.5px] font-semibold">{p.name}</span>
                        {p.laeuftSeit ? (
                          <Pill tone="doing">seit {time(p.laeuftSeit)} dabei</Pill>
                        ) : null}
                        <span className="num ml-auto text-[13px]">
                          {hhmm(p.istMin)}
                          <span className="text-faint"> / {hhmm(p.sollMin)}</span>
                        </span>
                        <span
                          className={`num w-[64px] text-right text-[12.5px] ${
                            p.istMin - p.sollMin < 0 ? "text-s-crit" : "text-s-done"
                          }`}
                        >
                          {p.istMin - p.sollMin >= 0 ? "+" : "−"}
                          {hhmm(Math.abs(p.istMin - p.sollMin))}
                        </span>
                      </div>

                      {p.zeilen.length > 0 ? (
                        <ul className="mt-2 flex flex-col gap-1">
                          {p.zeilen.map((z) => (
                            <li
                              key={z.id}
                              className="flex flex-wrap items-center gap-2 text-[12.5px]"
                            >
                              <span className="num w-[104px] shrink-0">
                                {time(z.von)}–{z.bis ? time(z.bis) : "läuft"}
                              </span>
                              <span className="min-w-0 flex-1 truncate text-muted">
                                {z.kunde ?? z.einsatzTitel ?? "ohne Einsatz"}
                                {z.vorgangNummer ? ` · ${z.vorgangNummer}` : ""}
                              </span>
                              <Pill tone={STATUS_TON[z.status] ?? "neutral"}>
                                {STATUS_TEXT[z.status] ?? z.status}
                              </Pill>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </li>
                  ))}
              </ul>
            )}
          </section>

          {darfSchreiben ? (
            <Nacherfassen
              tag={tag}
              personen={bild.personen.map((p) => ({ id: p.userId, name: p.name }))}
              einsaetze={await einsaetzeAmTag(supabase, tag)}
            />
          ) : null}
        </div>
      ) : null}

      {tab === "woche" ? (
        <Wochentafel
          montag={montag}
          bild={await wochenbild(supabase, { montag })}
          darfSchreiben={darfSchreiben}
        />
      ) : null}

      {tab === "konten" ? (
        <Kontentafel
          konten={await konten(supabase, { bis: viennaDay() })}
          antraege={await antraegeLaden(supabase)}
          darfSchreiben={darfSchreiben}
        />
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------- WOCHE */

async function Wochentafel({
  montag,
  bild,
  darfSchreiben,
}: {
  montag: string;
  bild: Awaited<ReturnType<typeof wochenbild>>;
  darfSchreiben: boolean;
}) {
  return (
    <section className="rounded-[20px] bg-surface p-5 shadow-soft">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h2 className="text-[15px] font-semibold">
          {date(montag)} – {date(addDays(montag, 6))}
        </h2>
        <div className="ml-auto flex gap-2">
          <a
            href={`/zeiten?tab=woche&woche=${addDays(montag, -7)}`}
            className="rounded-pill border border-line bg-surface px-[14px] py-[7px] text-[12.5px] text-ink hover:bg-sunk"
          >
            Vorige
          </a>
          <a
            href={`/zeiten?tab=woche&woche=${addDays(montag, 7)}`}
            className="rounded-pill border border-line bg-surface px-[14px] py-[7px] text-[12.5px] text-ink hover:bg-sunk"
          >
            Nächste
          </a>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-line text-left">
              <th className="pb-2 text-[11px] font-semibold tracking-wide text-faint uppercase">
                Person
              </th>
              {bild.tage.map((t) => (
                <th
                  key={t}
                  className="pb-2 text-right text-[11px] font-semibold tracking-wide text-faint uppercase"
                >
                  {new Date(`${t}T12:00:00Z`).toLocaleDateString("de-AT", {
                    weekday: "short",
                  })}
                </th>
              ))}
              <th className="pb-2 text-right text-[11px] font-semibold tracking-wide text-faint uppercase">
                Summe
              </th>
              {darfSchreiben ? <th /> : null}
            </tr>
          </thead>
          <tbody>
            {bild.personen.map((p) => (
              <tr key={p.userId} className="border-b border-line/60">
                <td className="py-[9px] pr-3">{p.name}</td>
                {p.tage.map((t) => (
                  <td
                    key={t.tag}
                    className={`num py-[9px] text-right ${
                      t.istMin === 0 ? "text-faint" : ""
                    }`}
                  >
                    {t.istMin === 0 ? "—" : hhmm(t.istMin)}
                  </td>
                ))}
                <td className="num py-[9px] text-right font-semibold">
                  {hhmm(p.istMin)}
                  <span className="text-faint"> / {hhmm(p.sollMin)}</span>
                </td>
                {darfSchreiben ? (
                  <td className="py-[9px] pl-3 text-right">
                    <Wochenabschluss
                      userId={p.userId}
                      montag={montag}
                      offen={p.offen}
                    />
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------ KONTEN */

function Kontentafel({
  konten: liste,
  antraege,
  darfSchreiben,
}: {
  konten: Awaited<ReturnType<typeof konten>>;
  antraege: Antrag[];
  darfSchreiben: boolean;
}) {
  const groesste = Math.max(
    60,
    ...liste.flatMap((k) => k.verlauf.map((m) => Math.abs(m.istMin - m.sollMin))),
  );

  return (
    <div className="flex flex-col gap-4">
      {antraege.length > 0 ? (
        <Korrekturen antraege={antraege} darfSchreiben={darfSchreiben} />
      ) : null}

      {liste.map((k) => (
        <section key={k.userId} className="rounded-[20px] bg-surface p-5 shadow-soft">
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <h2 className="text-[15px] font-semibold">{k.name}</h2>
            <Pill tone={k.saldoMin >= 0 ? "done" : "crit"}>
              {k.saldoMin >= 0 ? "+" : "−"}
              {hhmm(Math.abs(k.saldoMin))}
            </Pill>
            <span className="num text-[12.5px] text-muted">
              {k.resturlaub.toLocaleString("de-AT", { maximumFractionDigits: 1 })}{" "}
              Tage Resturlaub
            </span>
          </div>

          {/*
            Zwölf Monate Ist gegen Soll. Die Nulllinie ist die Aussage:
            ein Konto, das im Herbst kippt, sieht man nur im Verlauf.
          */}
          <div className="flex h-[92px] items-center gap-[6px]">
            {k.verlauf.map((m) => {
              const diff = m.istMin - m.sollMin;
              const hoehe = Math.round((Math.abs(diff) / groesste) * 38);
              return (
                <span
                  key={m.monat}
                  title={`${m.monat}: ${hhmm(m.istMin)} von ${hhmm(m.sollMin)}`}
                  className="flex flex-1 flex-col items-center justify-center gap-[2px]"
                >
                  <span className="flex h-[40px] w-full items-end justify-center">
                    {diff > 0 ? (
                      <span
                        className="w-full rounded-t-[4px] bg-s-done/70"
                        style={{ height: `${Math.max(2, hoehe)}px` }}
                      />
                    ) : null}
                  </span>
                  <span className="h-px w-full bg-line-strong" />
                  <span className="flex h-[40px] w-full items-start justify-center">
                    {diff < 0 ? (
                      <span
                        className="w-full rounded-b-[4px] bg-s-crit/70"
                        style={{ height: `${Math.max(2, hoehe)}px` }}
                      />
                    ) : null}
                  </span>
                </span>
              );
            })}
          </div>
          <div className="mt-1 flex gap-[6px]">
            {k.verlauf.map((m) => (
              <span
                key={m.monat}
                className="flex-1 text-center text-[10px] text-faint"
              >
                {new Date(`${m.monat}-01T12:00:00Z`).toLocaleDateString("de-AT", {
                  month: "short",
                })}
              </span>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

export type Antrag = {
  id: string;
  person: string;
  grund: string;
  vonAlt: string;
  bisAlt: string | null;
  vonNeu: string | null;
  bisNeu: string | null;
};

async function antraegeLaden(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
): Promise<Antrag[]> {
  const { data } = await supabase
    .from("time_correction")
    .select(
      `id, reason, requested_change_json,
       person:user_id ( name ),
       eintrag:time_entry_id ( started_at, ended_at )`,
    )
    .eq("status", "requested")
    .order("created_at");

  return ((data ?? []) as {
    id: string;
    reason: string;
    requested_change_json: { von?: string; bis?: string } | null;
    person: { name: string } | null;
    eintrag: { started_at: string; ended_at: string | null } | null;
  }[]).map((a) => ({
    id: a.id,
    person: a.person?.name ?? "—",
    grund: a.reason,
    vonAlt: a.eintrag?.started_at ?? "",
    bisAlt: a.eintrag?.ended_at ?? null,
    vonNeu: a.requested_change_json?.von ?? null,
    bisNeu: a.requested_change_json?.bis ?? null,
  }));
}

async function einsaetzeAmTag(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  tag: string,
): Promise<{ id: string; label: string }[]> {
  const { data } = await supabase
    .from("einsatz")
    .select("id, art, titel, von, vorgang:vorgang_id ( number, customer:customer_id ( name ) )")
    .gte("von", `${tag}T00:00:00Z`)
    .lte("von", `${tag}T23:59:59Z`)
    .order("von");

  return ((data ?? []) as {
    id: string;
    art: string;
    titel: string | null;
    von: string;
    vorgang: { number: string; customer: { name: string } | null } | null;
  }[]).map((e) => ({
    id: e.id,
    label: `${time(e.von)} · ${e.vorgang?.customer?.name ?? e.titel ?? "Einsatz"}`,
  }));
}
