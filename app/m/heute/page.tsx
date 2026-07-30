import type { Metadata } from "next";
import Link from "next/link";
import { Pill } from "@/components/ui/Pill";
import { date, hhmm, time, viennaDay } from "@/lib/format";
import { requireMe } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { endOfViennaDay, startOfViennaDay } from "@/lib/time";

export const metadata: Metadata = { title: "Heute" };

export default async function HeutePage() {
  const me = await requireMe();
  const supabase = await createClient();
  const heute = viennaDay();

  const [{ data: jobs }, { data: zeiten }] = await Promise.all([
    supabase
      .from("job")
      .select(
        "id, number, address, zip, city, next_step, scheduled_from, scheduled_to, customer:customer_id ( name ), phase:phase_id ( label, system_key )",
      )
      .lte("scheduled_from", endOfViennaDay(heute).toISOString())
      .gte("scheduled_to", startOfViennaDay(heute).toISOString())
      .order("scheduled_from"),
    supabase
      .from("time_entry")
      .select("id, kind, started_at, ended_at, duration_min, status")
      .eq("user_id", me.id)
      .gte("started_at", startOfViennaDay(heute).toISOString())
      .lt("started_at", endOfViennaDay(heute).toISOString())
      .order("started_at"),
  ]);

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
      {(jobs ?? []).length === 0 ? (
        <p className="rounded-[20px] bg-surface p-5 text-[13px] text-muted shadow-soft">
          Für heute ist kein Auftrag terminiert.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {(jobs ?? []).map((j) => (
            <li key={j.id as string}>
              <Link
                href={`/m/auftrag/${j.id as string}`}
                className="block rounded-[20px] bg-surface p-5 text-ink shadow-soft"
              >
                <div className="flex items-center gap-2">
                  <span className="num text-[13px] font-semibold">
                    {j.number as string}
                  </span>
                  {j.phase ? (
                    <Pill tone="doing">
                      {(j.phase as unknown as { label: string }).label}
                    </Pill>
                  ) : null}
                </div>
                <p className="mt-1 text-[16px] font-semibold">
                  {(j.customer as unknown as { name: string } | null)?.name ?? "—"}
                </p>
                <p className="text-[13px] text-muted">
                  {[j.address, [j.zip, j.city].filter(Boolean).join(" ")]
                    .filter(Boolean)
                    .join(", ")}
                </p>
                {j.next_step ? (
                  <p className="mt-2 text-[13px]">{j.next_step as string}</p>
                ) : null}
              </Link>
            </li>
          ))}
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
