import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { date, eurShort, num } from "@/lib/format";
import { requireMe } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import {
  PHASEN,
  STALE_SCHWELLE_STANDARD,
  VERLOREN_GRUND_LABEL,
  gateDurch,
  tageInPhase,
  type GateStatus,
  type Phase,
  type VerlorenGrund,
} from "@/lib/vorgang/modell";
import { VorgangAnlegen } from "./VorgangForms";

export const metadata: Metadata = { title: "Vorgänge" };

/*
 * Ein Farbstrich je Spalte, wie in der Vorlage. Die Farbe trägt keine
 * Bedeutung für sich — sie hilft nur, die Spalte beim Scrollen
 * wiederzufinden. Statusaussagen macht die Pille auf der Karte
 * (CLAUDE.md Abschnitt 9: nie Farbe allein).
 */
const PHASE_FARBE: Record<Phase, string> = {
  anfrage: "var(--s-new)",
  aufnahme: "var(--s-doing)",
  angebot: "var(--s-waiting)",
  beauftragt: "var(--accent)",
  montage: "var(--s-doing)",
  abschluss: "var(--s-done)",
  verloren: "var(--s-crit)",
};

const AVATAR_FARBEN = [
  "var(--s-doing)",
  "var(--s-waiting)",
  "var(--s-done)",
  "var(--accent-to)",
  "var(--s-new)",
];

/* Stabil über die Zeichensumme: dieselbe Person, immer dieselbe Farbe. */
function avatarFarbe(name: string): string {
  let summe = 0;
  for (const z of name) summe += z.codePointAt(0) ?? 0;
  return AVATAR_FARBEN[summe % AVATAR_FARBEN.length] as string;
}

/**
 * Das Board: sechs Spalten, eine je Phase.
 *
 * `verloren` ist keine Spalte, sondern ein eigener Reiter — verlorene
 * Vorgänge sollen auswertbar bleiben, aber nicht täglich im Blickfeld
 * stehen und die Summen verfälschen.
 *
 * Kein Drag & Drop zwischen den Spalten. Ein Phasenwechsel trägt
 * Automatik (Gates, Kaskade, Terminierung) und braucht Kontext — beim
 * Ziehen einer Karte gibt es keinen. Klick öffnet den Vorgang, dort steht
 * die passende Aktion.
 */
export default async function VorgaengePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; kunde?: string }>;
}) {
  const me = await requireMe();
  const { tab = "offen", kunde } = await searchParams;
  const supabase = await createClient();

  const [{ data: vorgaenge }, { data: werte }, { data: gates }, { data: kunden }] =
    await Promise.all([
      supabase
        .from("vorgang")
        .select(
          `id, number, phase, phase_seit, kwp, ort, verloren_grund, verloren_am,
           customer_id, customer:customer_id ( name ),
           zustaendig:zustaendig_user_id ( name )`,
        )
        .order("phase_seit", { ascending: true }),
      supabase
        .from("v_vorgang_wert")
        .select("vorgang_id, angebotswert_netto, auftragswert_netto"),
      supabase.from("vorgang_gate").select("vorgang_id, status, blocking"),
      supabase
        .from("customer")
        .select("id, name, city")
        .is("deleted_at", null)
        .order("name"),
    ]);

  const darfSchreiben = me.perms.pipelines === "write";
  /* Keine Zeile aus der View heisst: diese Rolle sieht keine Beträge. */
  const darfBetraege = (werte ?? []).length > 0;

  const wertJe = new Map<string, number | null>();
  for (const w of (werte ?? []) as unknown as {
    vorgang_id: string;
    angebotswert_netto: string | null;
    auftragswert_netto: string | null;
  }[]) {
    const v = w.auftragswert_netto ?? w.angebotswert_netto;
    wertJe.set(w.vorgang_id, v === null ? null : Number(v));
  }

  const gateJe = new Map<string, { durch: number; gesamt: number }>();
  for (const g of (gates ?? []) as unknown as {
    vorgang_id: string;
    status: GateStatus;
    blocking: boolean;
  }[]) {
    const e = gateJe.get(g.vorgang_id) ?? { durch: 0, gesamt: 0 };
    e.gesamt += 1;
    if (gateDurch({ status: g.status })) e.durch += 1;
    gateJe.set(g.vorgang_id, e);
  }

  type Zeile = {
    id: string;
    number: string;
    customer_id: string;
    phase: Phase;
    phase_seit: string;
    kwp: string | null;
    ort: string | null;
    verloren_grund: string | null;
    verloren_am: string | null;
    customer: { name: string } | null;
    zustaendig: { name: string } | null;
  };

  /*
   * Filter auf einen Kunden. Er ersetzt die Kundenakte des alten CRM:
   * wer wissen will, was bei diesem Kunden läuft, sieht dessen Vorgänge
   * — und nicht eine zweite Liste daneben.
   */
  const alleRoh = (vorgaenge ?? []) as unknown as Zeile[];
  const alle = kunde
    ? alleRoh.filter((v) => v.customer_id === kunde)
    : alleRoh;
  const kundenName = kunde
    ? (alleRoh.find((v) => v.customer_id === kunde)?.customer?.name ?? null)
    : null;
  const offen = alle.filter((v) => v.phase !== "verloren");
  const verloren = alle.filter((v) => v.phase === "verloren");
  const jetzt = new Date();

  const pipeline = offen.reduce((a, v) => a + (wertJe.get(v.id) ?? 0), 0);

  return (
    <>
      <PageHeader
        title="Vorgänge"
        subtitle={[
          kundenName
            ? `Nur ${kundenName}`
            : "Ein Objekt von der Anfrage bis zur Schlussrechnung",
          `${offen.length} offen`,
          darfBetraege && pipeline > 0 ? `${eurShort(pipeline)} Pipeline` : null,
        ]
          .filter(Boolean)
          .join(" · ")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {/*
              Offen und Verloren als Segment, nicht als zwei Knöpfe: es
              sind zwei Sichten auf dieselbe Liste, keine zwei Aktionen.
            */}
            {kunde ? (
              <Link
                href="/vorgaenge"
                className="rounded-pill border border-line bg-surface px-[15px] py-[8px] text-[12.5px] font-medium text-ink hover:bg-sunk hover:text-ink"
              >
                Filter aufheben
              </Link>
            ) : null}
            <nav className="flex gap-[3px] rounded-pill bg-surface p-1 shadow-soft">
              {(
                [
                  ["offen", "Offen", offen.length],
                  ["verloren", "Verloren", verloren.length],
                ] as const
              ).map(([wert, label, anzahl]) => (
                <Link
                  key={wert}
                  href={`/vorgaenge?tab=${wert}${kunde ? `&kunde=${kunde}` : ""}`}
                  aria-current={tab === wert ? "page" : undefined}
                  className={[
                    "rounded-pill px-[17px] py-[10px] text-[13.5px] transition-colors",
                    tab === wert
                      ? "bg-sunk font-semibold text-ink hover:text-ink"
                      : "text-muted hover:text-ink",
                  ].join(" ")}
                >
                  {label}{" "}
                  <span className="num text-[11px] opacity-60">{anzahl}</span>
                </Link>
              ))}
            </nav>
            {darfSchreiben ? (
              <VorgangAnlegen
                kunden={(kunden ?? []).map((k) => ({
                  wert: k.id as string,
                  text: k.name as string,
                  ...(k.city ? { zusatz: k.city as string } : {}),
                }))}
              />
            ) : null}
          </div>
        }
      />

      {tab === "verloren" ? (
        <VerlorenListe zeilen={verloren} darfBetraege={darfBetraege} wertJe={wertJe} />
      ) : (
        /*
         * Alle Phasen nebeneinander, waagrecht scrollbar. Maße aus
         * design/solstep-vorgang.html: Spalte 276px, Abstand 14px,
         * Kopfkarte und Karte je 18px Radius.
         *
         * Am Telefon untereinander: eine 276px-Spalte auf 375px Breite
         * zeigt anderthalb Phasen, und man wischt sich durch sechs.
         */
        <div className="-mx-1 px-1 pb-3 sm:overflow-x-auto">
          <div className="flex flex-col gap-[14px] sm:flex-row sm:items-start">
            {PHASEN.map((p, i) => {
              const karten = offen.filter((v) => v.phase === p.key);
              const summe = karten.reduce(
                (a, v) => a + (wertJe.get(v.id) ?? 0),
                0,
              );

              return (
                <section
                  key={p.key}
                  className="flex w-full shrink-0 flex-col gap-3 sm:w-[276px]"
                  aria-label={p.label}
                >
                  <header className="rounded-[18px] bg-surface px-4 py-[14px] shadow-soft">
                    <span
                      aria-hidden
                      className="block h-[4px] w-[44px] rounded-pill"
                      style={{ background: PHASE_FARBE[p.key] }}
                    />
                    <div className="mt-[11px] flex items-center gap-2">
                      <span className="num text-[11px] text-faint">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <h2 className="flex-1 text-[14.5px] font-semibold tracking-[-0.01em]">
                        {p.label}
                      </h2>
                      <span className="num rounded-pill bg-panel px-[9px] py-[2px] text-[11.5px] text-muted">
                        {karten.length}
                      </span>
                    </div>
                    <p className="num mt-1 text-[11.5px] text-faint">
                      {darfBetraege
                        ? summe > 0
                          ? eurShort(summe)
                          : "—"
                        : `${karten.length} Vorgänge`}
                    </p>
                  </header>

                  {karten.map((v) => {
                    const tage = tageInPhase(v.phase_seit, jetzt);
                    const alt = tage > STALE_SCHWELLE_STANDARD;
                    const g = gateJe.get(v.id);
                    const wert = wertJe.get(v.id) ?? null;

                    return (
                      <Link
                        key={v.id}
                        href={`/vorgaenge/${v.id}`}
                        className="flex flex-col gap-[9px] rounded-[18px] bg-surface p-[15px] text-ink shadow-soft transition-colors hover:bg-sunk hover:text-ink"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="num rounded-pill bg-panel px-[9px] py-[3px] text-[11px] text-muted">
                            {v.number}
                          </span>
                          <span
                            className={[
                              "num rounded-pill px-[9px] py-[3px] text-[11px]",
                              alt
                                ? "bg-s-crit/10 text-s-crit"
                                : "bg-panel text-faint",
                            ].join(" ")}
                            title={
                              alt
                                ? `Seit ${tage} Tagen ohne Phasenwechsel`
                                : "Tage in dieser Phase"
                            }
                          >
                            {tage} T
                          </span>
                        </div>

                        <p className="truncate text-[15.5px] leading-[1.25] font-semibold tracking-[-0.015em]">
                          {v.customer?.name ?? "—"}
                        </p>
                        <p className="truncate text-[12.5px] text-muted">
                          {v.ort ?? "—"}
                          {v.kwp ? (
                            <>
                              {" · "}
                              <span className="num">{num(v.kwp, "kWp")}</span>
                            </>
                          ) : null}
                        </p>

                        <div className="mt-[2px] flex items-center gap-[9px]">
                          {v.zustaendig ? (
                            <span
                              aria-hidden
                              title={v.zustaendig.name}
                              className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-pill text-[10px] font-semibold text-white"
                              style={{
                                background: avatarFarbe(v.zustaendig.name),
                              }}
                            >
                              {kuerzel(v.zustaendig.name)}
                            </span>
                          ) : null}
                          <span className="num flex-1 text-[12px] font-medium">
                            {darfBetraege && wert !== null ? eurShort(wert) : "—"}
                          </span>
                          {/*
                            Die Mini-Ampel steht nur in der Phase, in der
                            Gates laufen. Anderswo wäre sie eine Zahl ohne
                            Bedeutung.
                          */}
                          {p.key === "beauftragt" && g ? (
                            <span
                              className={[
                                "num rounded-pill px-[9px] py-[3px] text-[11px]",
                                g.durch === g.gesamt
                                  ? "bg-s-done/14 text-s-done"
                                  : "bg-s-warn/14 text-accent-ink",
                              ].join(" ")}
                              title="Erledigte Gates"
                            >
                              {g.durch}/{g.gesamt}
                            </span>
                          ) : null}
                        </div>
                      </Link>
                    );
                  })}
                </section>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}

/*
 * Verlorene Vorgänge als Tabelle, nicht als Karten (Vorlage).
 *
 * Sie stehen hier zum Auswerten, nicht zum Bearbeiten — dafür ist eine
 * dichte Zeile die richtige Form: sechs Spalten, 56px hoch, der Grund
 * als Pille mit Fläche und Text.
 */
const VERLOREN_SPALTEN = "130px 1.4fr 1fr 130px 1fr 140px";

/* Farbe je Grund, wie in der Vorlage. Die Pille trägt zusätzlich Text. */
const GRUND_TON: Record<string, string> = {
  preis: "var(--s-warn)",
  konkurrenz: "var(--s-crit)",
  keine_rueckmeldung: "var(--s-new)",
  nicht_machbar: "var(--s-waiting)",
  kunde_verschoben: "var(--s-doing)",
  sonstiges: "var(--text-3)",
};

function VerlorenListe({
  zeilen,
  darfBetraege,
  wertJe,
}: {
  zeilen: {
    id: string;
    number: string;
    ort: string | null;
    kwp: string | null;
    verloren_grund: string | null;
    verloren_am: string | null;
    customer: { name: string } | null;
  }[];
  darfBetraege: boolean;
  wertJe: Map<string, number | null>;
}) {
  if (zeilen.length === 0) {
    return (
      <p className="rounded-[20px] bg-surface p-6 text-[13px] text-muted shadow-soft">
        Kein verlorener Vorgang.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-[20px] bg-surface shadow-soft">
      <div className="min-w-[860px]">
        <div
          className="grid border-b border-line px-5 text-[11px] tracking-[0.07em] text-faint uppercase"
          style={{ gridTemplateColumns: VERLOREN_SPALTEN }}
        >
          <div className="px-[6px] py-[14px]">Nummer</div>
          <div className="px-[6px] py-[14px]">Kunde</div>
          <div className="px-[6px] py-[14px]">Ort · Anlage</div>
          <div className="px-[6px] py-[14px] text-right">Wert</div>
          <div className="px-[6px] py-[14px]">Grund</div>
          <div className="px-[6px] py-[14px]">Verloren am</div>
        </div>

        {zeilen.map((v) => {
          const wert = wertJe.get(v.id) ?? null;
          const grund = v.verloren_grund ?? "sonstiges";
          const ton = GRUND_TON[grund] ?? "var(--text-3)";

          return (
            <Link
              key={v.id}
              href={`/vorgaenge/${v.id}`}
              className="grid min-h-[56px] items-center border-b border-line px-5 text-ink transition-colors last:border-b-0 hover:bg-panel hover:text-ink"
              style={{ gridTemplateColumns: VERLOREN_SPALTEN }}
            >
              <div className="num px-[6px] py-2 text-[12.5px] text-muted">
                {v.number}
              </div>
              <div className="px-[6px] py-2 text-[14px] font-medium">
                {v.customer?.name ?? "—"}
              </div>
              <div className="px-[6px] py-2 text-[13px] text-muted">
                {[v.ort, v.kwp ? num(v.kwp, "kWp") : null]
                  .filter(Boolean)
                  .join(" · ") || "—"}
              </div>
              <div className="num px-[6px] py-2 text-right text-[12.5px]">
                {darfBetraege && wert !== null ? eurShort(wert) : "—"}
              </div>
              <div className="px-[6px] py-2">
                <span
                  className="rounded-pill px-[11px] py-[4px] text-[11.5px]"
                  style={{
                    background: `color-mix(in srgb, ${ton} 14%, transparent)`,
                    color: ton,
                  }}
                >
                  {VERLOREN_GRUND_LABEL[grund as VerlorenGrund] ?? grund}
                </span>
              </div>
              <div className="num px-[6px] py-2 text-[12.5px] text-muted">
                {v.verloren_am ? date(v.verloren_am) : "—"}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function kuerzel(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((t) => t[0]?.toUpperCase() ?? "")
    .join("");
}
