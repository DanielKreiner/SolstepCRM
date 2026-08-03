import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pill } from "@/components/ui/Pill";
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
  searchParams: Promise<{ tab?: string }>;
}) {
  const me = await requireMe();
  const { tab = "offen" } = await searchParams;
  const supabase = await createClient();

  const [{ data: vorgaenge }, { data: werte }, { data: gates }, { data: kunden }] =
    await Promise.all([
      supabase
        .from("vorgang")
        .select(
          `id, number, phase, phase_seit, kwp, ort, verloren_grund, verloren_am,
           customer:customer_id ( name ), zustaendig:zustaendig_user_id ( name )`,
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
    phase: Phase;
    phase_seit: string;
    kwp: string | null;
    ort: string | null;
    verloren_grund: string | null;
    verloren_am: string | null;
    customer: { name: string } | null;
    zustaendig: { name: string } | null;
  };

  const alle = (vorgaenge ?? []) as unknown as Zeile[];
  const offen = alle.filter((v) => v.phase !== "verloren");
  const verloren = alle.filter((v) => v.phase === "verloren");
  const jetzt = new Date();

  return (
    <>
      <PageHeader
        title="Vorgänge"
        subtitle="Ein Objekt von der Anfrage bis zur Schlussrechnung"
        actions={
          darfSchreiben ? (
            <VorgangAnlegen
              kunden={(kunden ?? []).map((k) => ({
                wert: k.id as string,
                text: k.name as string,
                ...(k.city ? { zusatz: k.city as string } : {}),
              }))}
            />
          ) : null
        }
      />

      <div className="mb-4 flex flex-wrap gap-2">
        {[
          ["offen", `Board · ${offen.length}`],
          ["verloren", `Verloren · ${verloren.length}`],
        ].map(([wert, label]) => (
          <Link
            key={wert}
            href={`/vorgaenge?tab=${wert}`}
            className={[
              "rounded-pill px-4 py-[9px] text-[12.5px] font-medium",
              tab === wert
                ? "bg-ink text-app hover:text-app"
                : "border border-line bg-surface text-ink hover:bg-sunk hover:text-ink",
            ].join(" ")}
          >
            {label}
          </Link>
        ))}
      </div>

      {tab === "verloren" ? (
        <VerlorenListe zeilen={verloren} darfBetraege={darfBetraege} wertJe={wertJe} />
      ) : (
        <div className="grid gap-3 lg:grid-cols-3 2xl:grid-cols-6">
          {PHASEN.map((p, i) => {
            const karten = offen.filter((v) => v.phase === p.key);
            const summe = karten.reduce(
              (a, v) => a + (wertJe.get(v.id) ?? 0),
              0,
            );

            return (
              <section
                key={p.key}
                className="rounded-[20px] bg-panel p-3"
                aria-label={p.label}
              >
                <div className="mb-3 px-1">
                  <div className="flex items-baseline gap-2">
                    <span className="num text-[10.5px] font-semibold text-faint">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <h2 className="text-[13.5px] font-semibold">{p.label}</h2>
                    <span className="num ml-auto rounded-pill bg-surface px-[8px] py-[2px] text-[11px] text-muted">
                      {karten.length}
                    </span>
                  </div>
                  <p className="num mt-[2px] text-[11.5px] text-faint">
                    {darfBetraege
                      ? summe > 0
                        ? eurShort(summe)
                        : "—"
                      : `${karten.length} Vorgänge`}
                  </p>
                </div>

                {karten.length === 0 ? (
                  <p className="px-1 py-2 text-[11.5px] text-faint">leer</p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {karten.map((v) => {
                      const tage = tageInPhase(v.phase_seit, jetzt);
                      const alt = tage > STALE_SCHWELLE_STANDARD;
                      const g = gateJe.get(v.id);
                      const wert = wertJe.get(v.id) ?? null;

                      return (
                        <li key={v.id}>
                          <Link
                            href={`/vorgaenge/${v.id}`}
                            className="block rounded-card bg-surface p-3 shadow-soft transition-colors hover:bg-sunk hover:text-ink"
                          >
                            <div className="flex items-baseline gap-2">
                              <span className="num text-[11.5px] font-semibold">
                                {v.number}
                              </span>
                              <span
                                className={[
                                  "num ml-auto rounded-pill px-[7px] py-px text-[10px]",
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

                            <p className="mt-[3px] truncate text-[13px] font-medium">
                              {v.customer?.name ?? "—"}
                            </p>
                            <p className="num truncate text-[11px] text-faint">
                              {[v.ort, v.kwp ? num(v.kwp, "kWp") : null]
                                .filter(Boolean)
                                .join(" · ") || "—"}
                            </p>

                            <div className="mt-2 flex flex-wrap items-center gap-[6px]">
                              {darfBetraege && wert !== null ? (
                                <span className="num text-[12px] font-semibold">
                                  {eurShort(wert)}
                                </span>
                              ) : null}
                              {/*
                                Die Mini-Ampel steht nur in der Phase, in
                                der Gates laufen. Anderswo wäre sie eine
                                Zahl ohne Bedeutung.
                              */}
                              {p.key === "beauftragt" && g ? (
                                <span className="num rounded-pill bg-s-warn/14 px-[7px] py-px text-[10px] font-semibold text-accent-ink">
                                  {g.durch}/{g.gesamt}
                                </span>
                              ) : null}
                              {v.zustaendig ? (
                                <span className="ml-auto text-[10.5px] text-faint">
                                  {kuerzel(v.zustaendig.name)}
                                </span>
                              ) : null}
                            </div>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}

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
    <ul className="flex flex-col gap-[10px]">
      {zeilen.map((v) => {
        const wert = wertJe.get(v.id) ?? null;
        return (
          <li key={v.id}>
            <Link
              href={`/vorgaenge/${v.id}`}
              className="block rounded-[20px] bg-surface p-5 shadow-soft transition-colors hover:bg-panel"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="num text-[13px] font-semibold">{v.number}</span>
                <Pill tone="crit">
                  {v.verloren_grund
                    ? (VERLOREN_GRUND_LABEL[v.verloren_grund as VerlorenGrund] ??
                      v.verloren_grund)
                    : "ohne Grund"}
                </Pill>
                <span className="num ml-auto text-[11.5px] text-faint">
                  {v.verloren_am ? date(v.verloren_am) : ""}
                </span>
              </div>
              <p className="mt-2 text-[14px] font-medium">
                {v.customer?.name ?? "—"}
              </p>
              <p className="num text-[12px] text-muted">
                {[v.ort, v.kwp ? num(v.kwp, "kWp") : null]
                  .filter(Boolean)
                  .join(" · ")}
                {darfBetraege && wert !== null ? ` · ${eurShort(wert)}` : ""}
              </p>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function kuerzel(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((t) => t[0]?.toUpperCase() ?? "")
    .join("");
}
