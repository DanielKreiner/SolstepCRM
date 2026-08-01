import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pill } from "@/components/ui/Pill";
import { KpiKarte } from "@/components/ui/KpiKarte";
import { date, hhmm, hhmmSigned, initials, time, viennaDay } from "@/lib/format";
import { werktageImMonat } from "@/lib/absence";
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

  /*
   * Saldoverlauf der letzten zwölf Monate (SPEC 4.9). Gerechnet aus den
   * eigenen Buchungen: je Monat Iststunden minus Sollstunden, aufaddiert.
   *
   * Die Nulllinie ist betont — sie ist die Aussage. Ein Balken über der
   * Linie heißt Überstunden, einer darunter Minusstunden, und ein Konto,
   * das im Herbst kippt, sieht man nur im Verlauf, nicht am Endsaldo.
   */
  const heute = viennaDay();
  const monate: string[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(`${heute.slice(0, 8)}01T12:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - i);
    monate.push(d.toISOString().slice(0, 7));
  }

  const { data: verlaufRoh } = await supabase
    .from("time_entry")
    .select("started_at, duration_min, kind")
    .eq("user_id", me.id)
    .in("status", ["booked", "approved"])
    .gte("started_at", `${monate[0]}-01T00:00:00Z`);

  const istJeMonat = new Map<string, number>();
  for (const e of verlaufRoh ?? []) {
    if (e.kind === "break") continue;
    const m = (e.started_at as string).slice(0, 7);
    istJeMonat.set(m, (istJeMonat.get(m) ?? 0) + Number(e.duration_min ?? 0));
  }

  const tagessollMin = (me.weeklyHours / 5) * 60;
  const verlauf = monate.map((m) => {
    const werktage = werktageImMonat(m);
    const ist = istJeMonat.get(m) ?? 0;
    const soll = werktage * tagessollMin;
    return {
      monat: m,
      label: new Date(`${m}-01T12:00:00Z`).toLocaleDateString("de-AT", {
        month: "short",
      }),
      diffMin: Math.round(ist - soll),
      /* Monate ohne jede Buchung sind kein Minus, sondern unbekannt —
         etwa vor dem Eintritt. Sie bleiben leer statt tiefrot. */
      leer: ist === 0,
    };
  });

  const maxAbweichung = Math.max(
    60,
    ...verlauf.filter((v) => !v.leer).map((v) => Math.abs(v.diffMin)),
  );

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

      <div className="mb-4 grid gap-[10px] sm:grid-cols-2 xl:grid-cols-4">
        <KpiKarte
          akzent
          label="Meine Iststunden"
          wert={hhmm(meinSaldo)}
          pille={`${me.weeklyHours} h/Woche`}
          notiz="gebucht und genehmigt"
        />
        <KpiKarte
          label="Meine Wochenstunden"
          wert={`${me.weeklyHours} h`}
          notiz="vereinbartes Arbeitszeitmodell"
        />
        <KpiKarte
          label="Offene Korrekturen"
          wert={offeneKorrekturen.length}
          pille={
            offeneKorrekturen.length > 0 ? "warten auf Entscheidung" : "nichts offen"
          }
          ton={offeneKorrekturen.length > 0 ? "warn" : "gut"}
          notiz="Zeitkorrekturen brauchen eine Begründung"
        />
        <KpiKarte
          label="Personen"
          wert={darfSehen ? (users ?? []).length : 1}
          notiz={darfSehen ? "im Zugriff deiner Rolle" : "nur das eigene Konto"}
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

      {/* Saldoverlauf 12 Monate mit betonter Nulllinie (SPEC 4.9). */}
      <section className="mb-4 rounded-[20px] bg-surface p-5 shadow-soft">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[15px] font-semibold">Mein Saldoverlauf</h2>
          <span className="num text-[11.5px] text-muted">
            12 Monate · Ist gegen Soll je Monat
          </span>
        </div>

        <div className="relative h-[168px]">
          {/* Nulllinie: die Aussage der Grafik, deshalb durchgezogen. */}
          <div
            aria-hidden
            className="absolute right-0 left-0 border-t border-line-strong"
            style={{ top: "50%" }}
          />
          <div className="flex h-full items-stretch gap-[6px]">
            {verlauf.map((v) => {
              const anteil = v.leer
                ? 0
                : (Math.abs(v.diffMin) / maxAbweichung) * 50;
              const plus = v.diffMin >= 0;
              return (
                <div
                  key={v.monat}
                  className="flex flex-1 flex-col items-center"
                  title={
                    v.leer
                      ? `${v.label}: keine Buchung`
                      : `${v.label}: ${hhmmSigned(v.diffMin)}`
                  }
                >
                  <div className="relative w-full flex-1">
                    {!v.leer ? (
                      <div
                        className="absolute left-1/2 w-full max-w-[24px] -translate-x-1/2 rounded-pill"
                        style={{
                          height: `${Math.max(3, anteil)}%`,
                          [plus ? "bottom" : "top"]: "50%",
                          background: plus
                            ? "linear-gradient(180deg,var(--accent-from),var(--accent-to))"
                            : "var(--s-crit)",
                        }}
                      />
                    ) : null}
                  </div>
                  <span className="num mt-1 text-[10px] text-faint">
                    {v.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </section>

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
