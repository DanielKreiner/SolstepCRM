import type { Metadata } from "next";
import { Pill, type Tone } from "@/components/ui/Pill";
import { date } from "@/lib/format";
import { requireMe } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Abwesenheiten" };

/**
 * Die eigenen freien Tage.
 *
 * Nur ansehen: eingetragen wird im Büro. Wer selbst eintragen könnte,
 * hätte Urlaub, von dem die Planung nichts weiss.
 */

const ART: Record<string, string> = {
  urlaub: "Urlaub",
  krank: "Krankenstand",
  zeitausgleich: "Zeitausgleich",
  sonder: "Sonderurlaub",
  schulung: "Schulung",
  unbezahlt: "Unbezahlt",
};

const TON: Record<string, Tone> = {
  requested: "warn",
  approved: "done",
  rejected: "crit",
  cancelled: "neutral",
};

const STATUS: Record<string, string> = {
  requested: "beantragt",
  approved: "genehmigt",
  rejected: "abgelehnt",
  cancelled: "zurückgezogen",
};

export default async function AbwesenheitenPage() {
  const me = await requireMe();
  const supabase = await createClient();

  const jahr = new Date().getFullYear();

  const [{ data: eintraege }, { data: person }] = await Promise.all([
    supabase
      .from("absence")
      .select("id, kind, from_date, to_date, half_day, status, note")
      .eq("user_id", me.id)
      .gte("from_date", `${jahr}-01-01`)
      .order("from_date", { ascending: false }),
    supabase
      .from("app_user")
      .select("vacation_days_year, vacation_carry")
      .eq("id", me.id)
      .maybeSingle(),
  ]);

  const liste = (eintraege ?? []) as unknown as {
    id: string;
    kind: string;
    from_date: string;
    to_date: string;
    half_day: boolean;
    status: string;
    note: string | null;
  }[];

  /*
   * Verbrauchter Urlaub zählt nur, was genehmigt ist — ein Antrag ist
   * noch kein freier Tag.
   */
  const verbraucht = liste
    .filter((a) => a.kind === "urlaub" && a.status === "approved")
    .reduce((s, a) => {
      const tage =
        (new Date(a.to_date).getTime() - new Date(a.from_date).getTime()) /
          86_400_000 +
        1;
      return s + (a.half_day ? 0.5 : tage);
    }, 0);

  const anspruch =
    Number(person?.vacation_days_year ?? 0) + Number(person?.vacation_carry ?? 0);
  const rest = anspruch - verbraucht;

  return (
    <>
      <h1 className="mb-1 text-[24px] font-bold tracking-[-0.02em]">
        Abwesenheiten
      </h1>
      <p className="mb-4 text-[13px] text-muted">
        Eintragen kann sie das Büro — hier siehst du deinen Stand.
      </p>

      <div className="mb-4 grid grid-cols-2 gap-[10px]">
        <div className="rounded-[20px] bg-surface p-5 shadow-soft">
          <p className="num text-[30px] leading-none font-semibold">
            {rest.toLocaleString("de-AT", { maximumFractionDigits: 1 })}
          </p>
          <p className="mt-1 text-[12.5px] text-muted">Resturlaub {jahr}</p>
        </div>
        <div className="rounded-[20px] bg-surface p-5 shadow-soft">
          <p className="num text-[30px] leading-none font-semibold">
            {verbraucht.toLocaleString("de-AT", { maximumFractionDigits: 1 })}
          </p>
          <p className="mt-1 text-[12.5px] text-muted">genommen</p>
        </div>
      </div>

      {liste.length === 0 ? (
        <p className="rounded-[20px] bg-surface p-6 text-[13px] text-muted shadow-soft">
          Für {jahr} ist nichts eingetragen.
        </p>
      ) : (
        <ul className="flex flex-col gap-[8px]">
          {liste.map((a) => (
            <li
              key={a.id}
              className="rounded-[20px] bg-surface p-4 shadow-soft"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[14px] font-semibold">
                  {ART[a.kind] ?? a.kind}
                </span>
                <Pill tone={TON[a.status] ?? "neutral"}>
                  {STATUS[a.status] ?? a.status}
                </Pill>
              </div>
              <p className="num mt-1 text-[13px]">
                {date(a.from_date)}
                {a.to_date !== a.from_date ? ` – ${date(a.to_date)}` : ""}
                {a.half_day ? " · halber Tag" : ""}
              </p>
              {a.note ? (
                <p className="mt-1 text-[12.5px] text-muted">{a.note}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
