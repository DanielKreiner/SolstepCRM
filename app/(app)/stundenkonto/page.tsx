import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pill } from "@/components/ui/Pill";
import { Stat } from "@/components/ui/Stat";
import { date, hhmm, hhmmSigned, initials, time, viennaDay } from "@/lib/format";
import { requireMe } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { DecideCorrectionForm, RequestCorrectionForm } from "./CorrectionForms";

export const metadata: Metadata = { title: "Stundenkonto" };

export default async function StundenkontoPage() {
  const me = await requireMe();
  const supabase = await createClient();

  const darfSehen = me.perms.zeiterfassung !== "none";

  const [{ data: balances }, { data: users }, { data: korrekturen }, { data: letzte }] =
    await Promise.all([
      supabase.from("v_time_balance").select("user_id, actual_min, adjust_min"),
      supabase
        .from("app_user")
        .select("id, name, weekly_hours")
        .eq("active", true)
        .order("name"),
      supabase
        .from("time_correction")
        .select(
          `id, status, reason, requested_change_json, approver_comment, created_at,
           entry:time_entry_id ( id, started_at, ended_at, duration_min, status ),
           person:user_id ( name )`,
        )
        .order("created_at", { ascending: false })
        .limit(30),
      supabase
        .from("time_entry")
        .select("id, started_at, ended_at, duration_min, status, note")
        .eq("user_id", me.id)
        .not("ended_at", "is", null)
        .neq("status", "replaced")
        .order("started_at", { ascending: false })
        .limit(10),
    ]);

  const saldoMap = new Map(
    (balances ?? []).map((b) => [
      b.user_id as string,
      Number(b.actual_min ?? 0) + Number(b.adjust_min ?? 0),
    ]),
  );

  const meinSaldo = saldoMap.get(me.id) ?? 0;
  const offeneKorrekturen = (korrekturen ?? []).filter(
    (k) => k.status === "requested",
  );
  const darfEntscheiden = me.perms.zeiterfassung === "write";

  return (
    <>
      <PageHeader
        title="Stundenkonto"
        subtitle="Ist-Zeit aus gebuchten und genehmigten Einträgen, plus manuelle Bewegungen"
      />

      <div className="mb-4 grid grid-cols-2 gap-[10px] lg:grid-cols-4">
        <Stat label="Meine Iststunden" value={hhmm(meinSaldo)} />
        <Stat label="Meine Wochenstunden" value={`${me.weeklyHours} h`} />
        <Stat
          label="Offene Korrekturen"
          value={offeneKorrekturen.length}
          tone={offeneKorrekturen.length > 0 ? "warn" : "done"}
        />
        <Stat
          label="Personen"
          value={darfSehen ? (users ?? []).length : 1}
        />
      </div>

      {offeneKorrekturen.length > 0 && darfEntscheiden ? (
        <section className="mb-4 rounded-[20px] bg-surface p-5 shadow-soft">
          <h2 className="mb-1 text-[15px] font-semibold">Offene Korrekturen</h2>
          <p className="mb-3 text-[12px] text-faint">
            Eine Genehmigung ersetzt die Buchung, löscht sie aber nicht — der
            alte Eintrag bleibt als ersetzt erhalten.
          </p>
          <ul className="flex flex-col gap-3">
            {offeneKorrekturen.map((k) => {
              const wunsch = k.requested_change_json as {
                started_at: string;
                ended_at: string;
              };
              const alt = k.entry as unknown as {
                started_at: string;
                ended_at: string | null;
                duration_min: number | null;
              } | null;

              return (
                <li key={k.id as string} className="rounded-input bg-panel p-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-[13px] font-medium">
                      {(k.person as unknown as { name: string } | null)?.name ?? "—"}
                    </span>
                    <span className="num text-[12.5px] text-muted line-through">
                      {alt ? `${time(alt.started_at)}–${alt.ended_at ? time(alt.ended_at) : "?"}` : "—"}
                    </span>
                    <span className="num text-[13px] font-semibold">
                      {time(wunsch.started_at)}–{time(wunsch.ended_at)}
                    </span>
                    <span className="num text-[12px] text-faint">
                      {date(wunsch.started_at)}
                    </span>
                  </div>
                  <p className="mt-1 text-[12.5px] text-muted">{k.reason as string}</p>
                  <div className="mt-2">
                    <DecideCorrectionForm correctionId={k.id as string} />
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[1fr_1.4fr] xl:items-start">
        {darfSehen ? (
          <section className="rounded-[20px] bg-surface p-5 shadow-soft">
            <h2 className="mb-3 text-[15px] font-semibold">Salden</h2>
            <ul className="flex flex-col gap-2">
              {(users ?? []).map((u) => {
                const saldo = saldoMap.get(u.id as string) ?? 0;
                return (
                  <li
                    key={u.id as string}
                    className="flex items-center gap-3 rounded-input bg-panel px-4 py-3"
                  >
                    <span
                      aria-hidden
                      className="flex h-7 w-7 items-center justify-center rounded-pill bg-s-doing text-[11px] font-semibold text-white"
                    >
                      {initials(u.name as string)}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[13px]">
                      {u.name as string}
                    </span>
                    <span className="num text-[13px] font-semibold">
                      {hhmm(saldo)}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        <section className="rounded-[20px] bg-surface p-5 shadow-soft">
          <h2 className="mb-1 text-[15px] font-semibold">Meine letzten Buchungen</h2>
          <p className="mb-3 text-[12px] text-faint">
            Stimmt eine Zeit nicht, wird sie nicht überschrieben, sondern
            korrigiert.
          </p>

          {(letzte ?? []).length === 0 ? (
            <p className="text-[13px] text-muted">Noch nichts gebucht.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {(letzte ?? []).map((e) => (
                <li
                  key={e.id as string}
                  data-entry={e.id as string}
                  className="rounded-input bg-panel p-4"
                >
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="num text-[12.5px] text-muted">
                      {date(e.started_at as string)}
                    </span>
                    <span className="num text-[13px] font-semibold">
                      {time(e.started_at as string)}–
                      {time(e.ended_at as string)}
                    </span>
                    <span className="num text-[13px]">
                      {hhmm(e.duration_min as number | null)}
                    </span>
                    {e.status === "approved" ? (
                      <Pill tone="done">genehmigt</Pill>
                    ) : e.status === "flagged" ? (
                      <Pill tone="crit">geprüft</Pill>
                    ) : null}
                    {e.note ? (
                      <span className="min-w-0 flex-1 truncate text-[12.5px] text-muted">
                        {e.note as string}
                      </span>
                    ) : null}
                  </div>
                  <RequestCorrectionForm
                    entryId={e.id as string}
                    day={viennaDay(e.started_at as string)}
                    from={time(e.started_at as string)}
                    to={time(e.ended_at as string)}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <p className="mt-4 text-[12px] text-faint">
        Saldo = {hhmmSigned(meinSaldo)} Iststunden. Ein Sollwertvergleich
        braucht den Dienstplan und kommt mit der Jahresauswertung.
      </p>
    </>
  );
}
