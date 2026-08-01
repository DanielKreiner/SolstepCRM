import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pill } from "@/components/ui/Pill";
import { KpiKarte } from "@/components/ui/KpiKarte";
import { daysInMonth, vacationBalance, type AbsenceRow } from "@/lib/absence";
import { date, initials, viennaDay } from "@/lib/format";
import { addDays, isoWeek, startOfViennaWeek } from "@/lib/time";
import { requireMe } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { DecideForm, RequestForm } from "./AbsenceForms";

export const metadata: Metadata = { title: "Abwesenheiten" };

const KIND_LABEL: Record<string, string> = {
  vacation: "Urlaub",
  sick: "Krankenstand",
  leave_comp: "Zeitausgleich",
  care: "Pflege",
  school: "Schulung",
  special: "Sonderurlaub",
};

const KIND_FARBE: Record<string, string> = {
  vacation: "var(--s-done)",
  sick: "var(--s-crit)",
  leave_comp: "var(--s-doing)",
  care: "var(--s-waiting)",
  school: "var(--s-new)",
  special: "var(--s-warn)",
};

const MONATE = [
  "Jän", "Feb", "Mär", "Apr", "Mai", "Jun",
  "Jul", "Aug", "Sep", "Okt", "Nov", "Dez",
];

export default async function AbwesenheitenPage({
  searchParams,
}: {
  searchParams: Promise<{ jahr?: string }>;
}) {
  const me = await requireMe();
  const supabase = await createClient();

  const { jahr } = await searchParams;
  const year = /^\d{4}$/.test(jahr ?? "")
    ? Number(jahr)
    : new Date().getFullYear();

  const [{ data: users }, { data: absences }, { data: standorte }] =
    await Promise.all([
    supabase
      .from("app_user")
      .select("id, name, role, vacation_days_year, vacation_carry")
      .eq("active", true)
      .order("name"),
    supabase
      .from("absence")
      .select("id, user_id, kind, from_date, to_date, half_day, status, note")
      .lte("from_date", `${year}-12-31`)
      .gte("to_date", `${year}-01-01`)
      .order("from_date"),
    supabase.from("location").select("min_staffing").order("name").limit(1),
  ]);

  const alle = (absences ?? []).map((a) => ({
    id: a.id as string,
    userId: a.user_id as string,
    kind: a.kind as string,
    from: a.from_date as string,
    to: a.to_date as string,
    halfDay: Boolean(a.half_day),
    status: a.status as string,
    note: (a.note as string | null) ?? null,
  }));

  const offen = alle.filter((a) => a.status === "requested");
  const darfEntscheiden = me.perms.mitarbeiter === "write";

  /*
   * Besetzung der kommenden zwölf Wochen. Gezählt werden Monteure — die
   * Mindestbesetzung des Standorts meint die Montage, nicht das Büro.
   */
  const monteure = (users ?? []).filter((u) => u.role === "monteur");
  const mindestbesetzung = Number(
    (standorte ?? [])[0]?.min_staffing ?? 4,
  );

  const startWoche = startOfViennaWeek(viennaDay());
  const besetzung = Array.from({ length: 12 }, (_, i) => {
    const montag = addDays(startWoche, i * 7);
    const sonntag = addDays(montag, 6);

    const abwesendeIds = new Set(
      alle
        .filter(
          (a) =>
            a.status === "approved" && a.from <= sonntag && a.to >= montag,
        )
        .map((a) => a.userId),
    );

    return {
      kw: `KW ${isoWeek(montag).slice(-2)}`,
      gesamt: monteure.length,
      verfuegbar: monteure.filter((m) => !abwesendeIds.has(m.id as string))
        .length,
    };
  });

  const eigene = alle.filter((a) => a.userId === me.id);
  const ich = (users ?? []).find((u) => u.id === me.id);
  const meinSaldo = vacationBalance(
    eigene as AbsenceRow[],
    Number(ich?.vacation_days_year ?? 25),
    Number(ich?.vacation_carry ?? 0),
    year,
  );

  return (
    <>
      <PageHeader
        title="Abwesenheiten"
        subtitle={`Jahresplaner ${year} · Werktage Montag bis Freitag, ohne Feiertage`}
        actions={
          <div className="flex items-center gap-1 rounded-pill bg-surface p-1 shadow-soft">
            <Link
              href={`/abwesenheiten?jahr=${year - 1}`}
              className="rounded-pill px-[15px] py-[9px] text-[13.5px] text-muted hover:text-ink"
            >
              {year - 1}
            </Link>
            <span className="num rounded-pill bg-sunk px-[15px] py-[9px] text-[13.5px] font-semibold">
              {year}
            </span>
            <Link
              href={`/abwesenheiten?jahr=${year + 1}`}
              className="rounded-pill px-[15px] py-[9px] text-[13.5px] text-muted hover:text-ink"
            >
              {year + 1}
            </Link>
          </div>
        }
      />

      <div className="mb-4 grid gap-[10px] sm:grid-cols-2 xl:grid-cols-4">
        <KpiKarte
          akzent
          label="Mein Resturlaub"
          wert={`${meinSaldo.rest} Tage`}
          pille={`${meinSaldo.genommen} genommen`}
          notiz={`${meinSaldo.beantragt} Tage beantragt, noch nicht genehmigt`}
        />
        <KpiKarte
          label="Jahresanspruch"
          wert={`${meinSaldo.anspruch} Tage`}
          notiz="aus dem Dienstvertrag"
        />
        <KpiKarte
          label="Übertrag aus dem Vorjahr"
          wert={`${meinSaldo.uebertrag} Tage`}
          notiz="wird zuerst verbraucht"
        />
        <KpiKarte
          label="Genommen und beantragt"
          wert={`${meinSaldo.genommen} / ${meinSaldo.beantragt}`}
          ton={meinSaldo.rest < 0 ? "kritisch" : "neutral"}
          notiz={
            meinSaldo.rest < 0
              ? "über dem Anspruch"
              : "genehmigt / offen"
          }
        />
      </div>

      {offen.length > 0 && darfEntscheiden ? (
        <section className="mb-4 rounded-[20px] bg-surface p-5 shadow-soft">
          <h2 className="mb-3 text-[15px] font-semibold">
            Offene Anträge{" "}
            <span className="num font-normal text-muted">({offen.length})</span>
          </h2>
          <ul className="flex flex-col gap-2">
            {offen.map((a) => {
              const person = (users ?? []).find((u) => u.id === a.userId);
              return (
                <li
                  key={a.id}
                  className="flex flex-wrap items-center gap-3 rounded-input bg-panel px-4 py-3"
                >
                  <span className="text-[13px] font-medium">
                    {(person?.name as string) ?? "—"}
                  </span>
                  <Pill tone="waiting">{KIND_LABEL[a.kind] ?? a.kind}</Pill>
                  <span className="num flex-1 text-[12.5px] text-muted">
                    {date(a.from)} – {date(a.to)}
                    {a.halfDay ? " (halber Tag)" : ""}
                  </span>
                  {a.note ? (
                    <span className="text-[12.5px] text-muted">{a.note}</span>
                  ) : null}
                  <DecideForm absenceId={a.id} />
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[1.7fr_1fr] xl:items-start">
        <section className="overflow-x-auto rounded-[20px] bg-surface p-5 shadow-soft">
          <h2 className="mb-3 text-[15px] font-semibold">Jahresplaner</h2>

          <div className="min-w-[860px]">
            {(users ?? []).map((u) => {
              const eigene = alle.filter(
                (a) => a.userId === u.id && a.status !== "rejected",
              );
              const saldo = vacationBalance(
                eigene as AbsenceRow[],
                Number(u.vacation_days_year ?? 25),
                Number(u.vacation_carry ?? 0),
                year,
              );

              return (
                <div key={u.id as string} className="mb-3 last:mb-0">
                  <div className="mb-1 flex items-center gap-2">
                    <span
                      aria-hidden
                      className="flex h-6 w-6 items-center justify-center rounded-pill bg-s-doing text-[10px] font-semibold text-white"
                    >
                      {initials(u.name as string)}
                    </span>
                    <span className="text-[13px] font-medium">
                      {u.name as string}
                    </span>
                    <span className="num text-[11.5px] text-muted">
                      Rest {saldo.rest} von {saldo.anspruch + saldo.uebertrag}
                    </span>
                  </div>

                  <div className="grid grid-cols-12 gap-[3px]">
                    {MONATE.map((m, monat) => {
                      const tageImMonat = new Date(
                        Date.UTC(year, monat + 1, 0),
                      ).getUTCDate();
                      const belegt = new Map<number, string>();
                      for (const a of eigene) {
                        for (const t of daysInMonth(a as AbsenceRow, year, monat)) {
                          belegt.set(t, a.kind);
                        }
                      }

                      return (
                        <div key={m}>
                          <div className="mb-[2px] text-[10px] text-faint">{m}</div>
                          <div className="flex flex-wrap gap-[1px]">
                            {Array.from({ length: tageImMonat }, (_, i) => i + 1).map(
                              (tag) => {
                                const kind = belegt.get(tag);
                                return (
                                  <span
                                    key={tag}
                                    title={
                                      kind
                                        ? `${tag}. ${m}: ${KIND_LABEL[kind] ?? kind}`
                                        : undefined
                                    }
                                    className="h-[7px] w-[7px] rounded-[2px]"
                                    style={{
                                      background: kind
                                        ? (KIND_FARBE[kind] ?? "var(--s-new)")
                                        : "var(--sunk)",
                                    }}
                                  />
                                );
                              },
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-4 flex flex-wrap gap-3 border-t border-line pt-3">
            {Object.entries(KIND_LABEL).map(([k, label]) => (
              <span key={k} className="flex items-center gap-[6px] text-[11.5px] text-muted">
                <span
                  aria-hidden
                  className="h-[9px] w-[9px] rounded-[2px]"
                  style={{ background: KIND_FARBE[k] }}
                />
                {label}
              </span>
            ))}
          </div>
        </section>

        <div className="flex flex-col gap-4">
          {/*
            Besetzung je Woche gegen Mindestbesetzung (SPEC 4.11). Die Zahl
            aus location.min_staffing ist die, an der ein Betrieb entscheidet,
            ob er einen Urlaub genehmigen kann — sie gehört neben die Anträge
            und nicht in die Einstellungen versteckt.
          */}
          <section className="rounded-[20px] bg-surface p-5 shadow-soft">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-[15px] font-semibold">Besetzung je Woche</h2>
              <span className="num text-[11.5px] text-muted">
                Minimum {mindestbesetzung}
              </span>
            </div>

            {besetzung.length === 0 ? (
              <p className="text-[13px] text-muted">Keine Monteure hinterlegt.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {besetzung.map((w) => {
                  const knapp = w.verfuegbar < mindestbesetzung;
                  return (
                    <li
                      key={w.kw}
                      className="flex items-center gap-3 rounded-input bg-panel px-4 py-[10px]"
                    >
                      <span className="num w-[54px] shrink-0 text-[12px] text-muted">
                        {w.kw}
                      </span>
                      <span className="h-[6px] flex-1 overflow-hidden rounded-pill bg-sunk">
                        <span
                          className="block h-full rounded-pill"
                          style={{
                            width: `${w.gesamt > 0 ? (w.verfuegbar / w.gesamt) * 100 : 0}%`,
                            background: knapp
                              ? "var(--s-crit)"
                              : "linear-gradient(90deg,var(--accent-from),var(--accent-to))",
                          }}
                        />
                      </span>
                      <span
                        className={`num shrink-0 text-[12px] font-semibold ${knapp ? "text-s-crit" : ""}`}
                      >
                        {w.verfuegbar} / {w.gesamt}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}

            <p className="mt-3 text-[11.5px] text-faint">
              Gezählt werden Monteure ohne genehmigte Abwesenheit in der Woche.
            </p>
          </section>

          <RequestForm
            meId={me.id}
            users={(users ?? []).map((u) => ({
              id: u.id as string,
              name: u.name as string,
            }))}
            canForOthers={darfEntscheiden}
          />
        </div>
      </div>
    </>
  );
}
