import type { Metadata } from "next";
import Link from "next/link";
import { Pill } from "@/components/ui/Pill";
import { date, hhmm, time, viennaDay } from "@/lib/format";
import { requireMe } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { endOfViennaDay, startOfViennaDay } from "@/lib/time";

export const metadata: Metadata = { title: "Heute" };

type Zeile = {
  termin: {
    id: string;
    art: string;
    von: string;
    bis: string;
    notiz: string | null;
    vorgang: {
      id: string;
      number: string;
      phase: string;
      adresse: string | null;
      plz: string | null;
      ort: string | null;
      customer: { name: string } | null;
    } | null;
  } | null;
};

const ART: Record<string, string> = {
  aufnahme: "Aufnahme",
  montage: "Montage",
  service: "Service",
};

/**
 * Der Tag der Montage.
 *
 * Gezeigt werden die eigenen Termine, nicht alle des Betriebs. Vorher
 * stand hier jede Baustelle, die heute läuft — auf einem Handy, das
 * jemand um 6:30 im Auto aufmacht, ist das eine Liste, in der die eigene
 * Zeile untergeht.
 */
export default async function HeutePage() {
  const me = await requireMe();
  const supabase = await createClient();
  const heute = viennaDay();

  const [{ data: zuordnungen }, { data: zeiten }] = await Promise.all([
    supabase
      .from("vorgang_termin_person")
      .select(
        `termin:termin_id (
           id, art, von, bis, notiz,
           vorgang:vorgang_id (
             id, number, phase, adresse, plz, ort,
             customer:customer_id ( name )
           )
         )`,
      )
      .eq("user_id", me.id),
    supabase
      .from("time_entry")
      .select("id, kind, started_at, ended_at, duration_min, status")
      .eq("user_id", me.id)
      .gte("started_at", startOfViennaDay(heute).toISOString())
      .lt("started_at", endOfViennaDay(heute).toISOString())
      .order("started_at"),
  ]);

  const von = startOfViennaDay(heute).toISOString();
  const bis = endOfViennaDay(heute).toISOString();

  const termine = ((zuordnungen ?? []) as unknown as Zeile[])
    .map((z) => z.termin)
    .filter((t): t is NonNullable<Zeile["termin"]> => t !== null && t.vorgang !== null)
    .filter((t) => t.von <= bis && t.bis >= von)
    .sort((a, b) => (a.von < b.von ? -1 : 1));

  const gebucht = (zeiten ?? [])
    .filter((z) => z.kind !== "break")
    .reduce((s, z) => s + Number(z.duration_min ?? 0), 0);

  return (
    <>
      <h1 className="mb-1 text-[24px] font-bold tracking-[-0.02em]">Heute</h1>
      <p className="mb-4 text-[13px] text-muted">{date(heute)}</p>

      <div className="mb-4 rounded-[20px] bg-surface p-5 shadow-soft">
        <p className="text-[12.5px] text-muted">Heute gebucht</p>
        <p className="num text-[28px] font-semibold">{hhmm(gebucht)}</p>
      </div>

      <h2 className="mb-2 text-[15px] font-semibold">Meine Baustellen</h2>
      {termine.length === 0 ? (
        <p className="rounded-[20px] bg-surface p-5 text-[13px] text-muted shadow-soft">
          Für heute ist nichts für dich eingeteilt.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {termine.map((t) => {
            const v = t.vorgang!;
            return (
              <li key={t.id}>
                <Link
                  href={`/m/auftrag/${v.id}`}
                  className="block rounded-[20px] bg-surface p-5 text-ink shadow-soft"
                >
                  <div className="flex items-center gap-2">
                    <span className="num text-[13px] font-semibold">
                      {v.number}
                    </span>
                    <Pill tone="doing">{ART[t.art] ?? t.art}</Pill>
                    <span className="num ml-auto text-[13px] font-semibold">
                      {time(t.von)}
                    </span>
                  </div>
                  <p className="mt-1 text-[16px] font-semibold">
                    {v.customer?.name ?? "—"}
                  </p>
                  <p className="text-[13px] text-muted">
                    {[v.adresse, [v.plz, v.ort].filter(Boolean).join(" ")]
                      .filter(Boolean)
                      .join(", ")}
                  </p>
                  {t.notiz ? (
                    <p className="mt-2 text-[13px]">{t.notiz}</p>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      <h2 className="mt-6 mb-2 text-[15px] font-semibold">Meine Zeiten</h2>
      {(zeiten ?? []).length === 0 ? (
        <p className="rounded-[20px] bg-surface p-5 text-[13px] text-muted shadow-soft">
          Heute noch nichts gebucht.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {(zeiten ?? []).map((z) => (
            <li
              key={z.id as string}
              className="flex items-center gap-3 rounded-input bg-surface px-4 py-3 shadow-soft"
            >
              <span className="num text-[13px]">
                {time(z.started_at as string)} –{" "}
                {z.ended_at ? time(z.ended_at as string) : "läuft"}
              </span>
              <span className="flex-1" />
              {z.status === "flagged" ? <Pill tone="crit">geprüft</Pill> : null}
              <span className="num text-[13px] font-semibold">
                {hhmm(z.duration_min as number | null)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
