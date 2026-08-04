import type { Metadata } from "next";
import Link from "next/link";
import { Pill, type Tone } from "@/components/ui/Pill";
import { date, hhmm, time, viennaDay } from "@/lib/format";
import { konten } from "@/lib/zeiten/daten";
import { requireMe } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { addDays } from "@/lib/time";
import { Korrekturantrag } from "./Korrekturantrag";

export const metadata: Metadata = { title: "Meine Zeiten" };

/**
 * Die eigenen Zeiten.
 *
 * Zwei Zahlen oben — Saldo und Resturlaub —, darunter die Liste. Wer
 * etwas ändern will, beantragt es; entschieden wird im Büro.
 */

const TON: Record<string, Tone> = {
  running: "doing",
  booked: "warn",
  approved: "done",
  flagged: "crit",
  replaced: "neutral",
};

const TEXT: Record<string, string> = {
  running: "läuft",
  booked: "gebucht",
  approved: "genehmigt",
  flagged: "zu prüfen",
  replaced: "ersetzt",
};

export default async function MeineZeitenPage({
  searchParams,
}: {
  searchParams: Promise<{ zeitraum?: string }>;
}) {
  const me = await requireMe();
  const { zeitraum } = await searchParams;
  const supabase = await createClient();

  const heute = viennaDay();
  const monat = zeitraum === "monat";
  const ab = monat ? addDays(heute, -30) : addDays(heute, -7);

  const [{ data: roh }, { data: antraege }, kontoliste] = await Promise.all([
    supabase
      .from("time_entry")
      .select(
        `id, started_at, ended_at, duration_min, auto_break_min, status, quelle,
         einsatz:einsatz_id ( titel, vorgang:vorgang_id ( number, customer:customer_id ( name ) ) )`,
      )
      .eq("user_id", me.id)
      .gte("started_at", `${ab}T00:00:00Z`)
      .order("started_at", { ascending: false }),
    supabase
      .from("time_correction")
      .select("time_entry_id")
      .eq("user_id", me.id)
      .eq("status", "requested"),
    konten(supabase, { bis: heute }),
  ]);

  const meins = kontoliste.find((k) => k.userId === me.id);
  const offeneAntraege = new Set(
    ((antraege ?? []) as { time_entry_id: string }[]).map((a) => a.time_entry_id),
  );

  const zeilen = ((roh ?? []) as unknown as {
    id: string;
    started_at: string;
    ended_at: string | null;
    duration_min: number | null;
    auto_break_min: number;
    status: string;
    quelle: string;
    einsatz: {
      titel: string | null;
      vorgang: { number: string; customer: { name: string } | null } | null;
    } | null;
  }[]).map((z) => ({
    id: z.id,
    von: z.started_at,
    bis: z.ended_at,
    minuten: Math.max(0, (z.duration_min ?? 0) - (z.auto_break_min ?? 0)),
    status: z.status,
    quelle: z.quelle,
    wo: z.einsatz?.vorgang?.customer?.name ?? z.einsatz?.titel ?? "ohne Einsatz",
    nummer: z.einsatz?.vorgang?.number ?? null,
  }));

  return (
    <>
      <h1 className="mb-1 text-[24px] font-bold tracking-[-0.02em]">
        Meine Zeiten
      </h1>
      <p className="mb-4 text-[13px] text-muted">
        Stimmt etwas nicht, sag Bescheid — geändert wird im Büro.
      </p>

      <div className="mb-4 grid grid-cols-2 gap-[10px]">
        <div className="rounded-[20px] bg-surface p-5 shadow-soft">
          <p
            className={`num text-[30px] leading-none font-semibold ${
              (meins?.saldoMin ?? 0) < 0 ? "text-s-crit" : "text-s-done"
            }`}
          >
            {(meins?.saldoMin ?? 0) >= 0 ? "+" : "−"}
            {hhmm(Math.abs(meins?.saldoMin ?? 0))}
          </p>
          <p className="mt-1 text-[12.5px] text-muted">Saldo</p>
        </div>
        <div className="rounded-[20px] bg-surface p-5 shadow-soft">
          <p className="num text-[30px] leading-none font-semibold">
            {(meins?.resturlaub ?? 0).toLocaleString("de-AT", {
              maximumFractionDigits: 1,
            })}
          </p>
          <p className="mt-1 text-[12.5px] text-muted">Tage Resturlaub</p>
        </div>
      </div>

      <div className="mb-4 flex gap-2">
        {[
          ["woche", "Woche"],
          ["monat", "Monat"],
        ].map(([wert, label]) => (
          <Link
            key={wert}
            href={`/m/zeiten?zeitraum=${wert}`}
            className={[
              "min-h-[44px] flex-1 rounded-pill px-4 py-[11px] text-center text-[14px] font-semibold",
              (monat ? "monat" : "woche") === wert
                ? "bg-ink text-app hover:text-app"
                : "border border-line bg-surface text-ink hover:text-ink",
            ].join(" ")}
          >
            {label}
          </Link>
        ))}
      </div>

      {zeilen.length === 0 ? (
        <p className="rounded-[20px] bg-surface p-6 text-[13px] text-muted shadow-soft">
          In diesem Zeitraum ist nichts gebucht.
        </p>
      ) : (
        <ul className="flex flex-col gap-[8px]">
          {zeilen.map((z) => (
            <li key={z.id} className="rounded-[20px] bg-surface p-4 shadow-soft">
              <div className="flex flex-wrap items-center gap-2">
                <span className="num text-[13px] font-semibold">{date(z.von)}</span>
                <span className="num text-[13px] text-muted">
                  {time(z.von)}–{z.bis ? time(z.bis) : "läuft"}
                </span>
                <span className="num ml-auto text-[14px] font-semibold">
                  {hhmm(z.minuten)}
                </span>
              </div>

              <p className="mt-1 text-[13px]">
                {z.wo}
                {z.nummer ? <span className="num text-faint"> · {z.nummer}</span> : null}
              </p>

              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Pill tone={TON[z.status] ?? "neutral"}>
                  {TEXT[z.status] ?? z.status}
                </Pill>
                {z.quelle === "korrektur" ? (
                  <Pill tone="waiting">korrigiert</Pill>
                ) : null}

                {z.bis && z.status !== "replaced" ? (
                  <span className="ml-auto">
                    <Korrekturantrag
                      entryId={z.id}
                      vonVorgabe={time(z.von)}
                      bisVorgabe={time(z.bis)}
                      laeuftAntrag={offeneAntraege.has(z.id)}
                    />
                  </span>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
