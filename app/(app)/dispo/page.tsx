import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pill } from "@/components/ui/Pill";
import { KpiKarte } from "@/components/ui/KpiKarte";
import { dateShort, initials, time, viennaDay } from "@/lib/format";
import { requireMe } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { addDays, isoWeek, startOfViennaWeek } from "@/lib/time";
import { loadConflicts } from "./actions";
import { PublishForm } from "./PublishForm";

export const metadata: Metadata = { title: "Einsatzplanung" };

const CODE_LABEL: Record<string, string> = {
  ruhezeit: "Ruhezeit",
  tageshoechst: "Tageshöchstzeit",
  wochenhoechst: "Wochenhöchstzeit",
  pause: "Pause",
  abwesenheit: "Abwesenheit",
  ueberschneidung: "Überschneidung",
};

export default async function DispoPage({
  searchParams,
}: {
  searchParams: Promise<{ woche?: string }>;
}) {
  const me = await requireMe();
  const supabase = await createClient();

  const { woche } = await searchParams;
  const montag = startOfViennaWeek(
    woche && /^\d{4}-\d{2}-\d{2}$/.test(woche) ? woche : viennaDay(),
  );
  const tage = Array.from({ length: 7 }, (_, i) => addDays(montag, i));

  const von = new Date(`${montag}T00:00:00.000Z`).toISOString();
  const bis = new Date(`${addDays(montag, 7)}T00:00:00.000Z`).toISOString();

  const [
    { data: users },
    { data: termine },
    { data: abwesenheiten },
    { data: veroeffentlicht },
    { conflicts },
  ] = await Promise.all([
    supabase
      .from("app_user")
      .select("id, name, role")
      .eq("active", true)
      .in("role", ["monteur", "bauleitung", "lager"])
      .order("name"),
    supabase
      .from("job_appointment")
      .select(
        "id, user_id, starts_at, ends_at, title, job:job_id ( id, number, city, customer:customer_id ( name ) )",
      )
      .gte("starts_at", von)
      .lt("starts_at", bis)
      .order("starts_at"),
    supabase
      .from("absence")
      .select("user_id, from_date, to_date, kind, status")
      .eq("status", "approved")
      .lte("from_date", addDays(montag, 6))
      .gte("to_date", montag),
    supabase
      .from("roster_publication")
      .select("published_at, warnings_json")
      .eq("iso_week", isoWeek(montag))
      .maybeSingle(),
    loadConflicts(montag),
  ]);

  type Termin = {
    id: string;
    user_id: string | null;
    starts_at: string;
    ends_at: string;
    title: string | null;
    job: {
      id: string;
      number: string;
      city: string | null;
      customer: { name: string } | null;
    } | null;
  };

  const alleTermine = (termine ?? []) as unknown as Termin[];
  const offen = alleTermine.filter((t) => !t.user_id);

  const konfliktProSchicht = new Map<string, typeof conflicts>();
  for (const c of conflicts) {
    for (const id of c.shiftIds) {
      if (!konfliktProSchicht.has(id)) konfliktProSchicht.set(id, []);
      konfliktProSchicht.get(id)!.push(c);
    }
  }

  const blockierende = conflicts.filter((c) => c.severity === "block");
  const warnungen = conflicts.filter((c) => c.severity === "warn");

  const abwesendAn = (userId: string, tag: string) =>
    (abwesenheiten ?? []).find(
      (a) =>
        a.user_id === userId &&
        tag >= (a.from_date as string) &&
        tag <= (a.to_date as string),
    );

  return (
    <>
      <PageHeader
        title="Einsatzplanung"
        subtitle={`${isoWeek(montag)} · ${dateShort(montag)} – ${dateShort(addDays(montag, 6))}`}
        actions={
          <div className="flex items-center gap-1 rounded-pill bg-surface p-1 shadow-soft">
            <Link
              href={`/dispo?woche=${addDays(montag, -7)}`}
              className="rounded-pill px-[15px] py-[9px] text-[13.5px] text-muted hover:text-ink"
            >
              ‹
            </Link>
            <Link
              href="/dispo"
              className="rounded-pill px-[15px] py-[9px] text-[13.5px] text-muted hover:text-ink"
            >
              Diese Woche
            </Link>
            <Link
              href={`/dispo?woche=${addDays(montag, 7)}`}
              className="rounded-pill px-[15px] py-[9px] text-[13.5px] text-muted hover:text-ink"
            >
              ›
            </Link>
          </div>
        }
      />

      <div className="mb-4 grid gap-[10px] sm:grid-cols-2 xl:grid-cols-4">
        <KpiKarte
          akzent
          label="Einsätze diese Woche"
          wert={alleTermine.length}
          pille={offen.length > 0 ? `${offen.length} im Pool` : "alles terminiert"}
          notiz="Blöcke im Wochenraster"
        />
        <KpiKarte
          label="Ohne Zuordnung"
          wert={offen.length}
          pille={offen.length > 0 ? "aus dem Pool ziehen" : "Pool leer"}
          ton={offen.length > 0 ? "warn" : "gut"}
          notiz="Aufträge und Tickets ohne Termin"
        />
        <KpiKarte
          label="Blockierende Verstöße"
          wert={blockierende.length}
          pille={
            blockierende.length > 0 ? "Veröffentlichung gesperrt" : "Plan ist sauber"
          }
          ton={blockierende.length > 0 ? "kritisch" : "gut"}
          notiz="Ruhezeit, Doppelbelegung, Wochenstunden"
        />
        <KpiKarte
          label="Veröffentlicht"
          wert={veroeffentlicht ? "ja" : "nein"}
          ton={veroeffentlicht ? "gut" : "warn"}
          notiz={
            veroeffentlicht
              ? "Mannschaft ist benachrichtigt"
              : "noch niemand benachrichtigt"
          }
        />
      </div>

      <div className="mb-4 overflow-x-auto rounded-[20px] bg-surface shadow-soft">
        <div className="min-w-[900px]">
          <div className="grid grid-cols-[180px_repeat(7,1fr)] border-b border-line px-4 text-[11px] tracking-[0.07em] text-faint uppercase">
            <div className="px-2 py-[14px]">Person</div>
            {tage.map((t) => (
              <div key={t} className="px-2 py-[14px]">
                {new Date(`${t}T12:00:00Z`).toLocaleDateString("de-AT", {
                  weekday: "short",
                })}{" "}
                <span className="num">{dateShort(t)}</span>
              </div>
            ))}
          </div>

          {(users ?? []).map((u) => (
            <div
              key={u.id as string}
              className="grid grid-cols-[180px_repeat(7,1fr)] items-stretch border-b border-line px-4 last:border-b-0"
            >
              <div className="flex items-center gap-2 px-2 py-3">
                <span
                  aria-hidden
                  className="flex h-7 w-7 items-center justify-center rounded-pill bg-s-doing text-[11px] font-semibold text-white"
                >
                  {initials(u.name as string)}
                </span>
                <span className="min-w-0 truncate text-[13px] font-medium">
                  {u.name as string}
                </span>
              </div>

              {tage.map((tag) => {
                const abwesend = abwesendAn(u.id as string, tag);
                const eintraege = alleTermine.filter(
                  (t) =>
                    t.user_id === u.id && t.starts_at.slice(0, 10) === tag,
                );

                return (
                  <div key={tag} className="flex flex-col gap-1 px-2 py-2">
                    {abwesend ? (
                      <span className="rounded-input bg-s-waiting/12 px-2 py-[6px] text-[11.5px] font-medium text-s-waiting">
                        abwesend
                      </span>
                    ) : null}
                    {eintraege.map((t) => {
                      const k = konfliktProSchicht.get(t.id) ?? [];
                      const blockiert = k.some((c) => c.severity === "block");
                      return (
                        <Link
                          key={t.id}
                          href={t.job ? `/auftraege/${t.job.id}` : "/dispo"}
                          className={[
                            "block rounded-input px-2 py-[6px] text-[11.5px] text-ink",
                            blockiert
                              ? "bg-s-crit/12 outline-1 outline-s-crit"
                              : "bg-panel",
                          ].join(" ")}
                        >
                          <span className="num block">
                            {time(t.starts_at)}–{time(t.ends_at)}
                          </span>
                          <span className="block truncate font-medium">
                            {t.job?.customer?.name ?? t.title ?? "Einsatz"}
                          </span>
                        </Link>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr] xl:items-start">
        <section className="rounded-[20px] bg-surface p-5 shadow-soft">
          <h2 className="mb-3 text-[15px] font-semibold">
            Konfliktprüfung{" "}
            <span className="num font-normal text-muted">
              ({conflicts.length})
            </span>
          </h2>

          {conflicts.length === 0 ? (
            <p className="text-[13px] text-muted">
              Keine Verstöße gegen die hinterlegten Arbeitszeitregeln.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {[...blockierende, ...warnungen].map((c, i) => {
                const person = (users ?? []).find((u) => u.id === c.userId);
                return (
                  <li
                    key={`${c.code}-${i}`}
                    className="flex flex-wrap items-center gap-3 rounded-input bg-panel px-4 py-3"
                  >
                    <Pill tone={c.severity === "block" ? "crit" : "warn"}>
                      {CODE_LABEL[c.code] ?? c.code}
                    </Pill>
                    <span className="text-[13px] font-medium">
                      {(person?.name as string) ?? "—"}
                    </span>
                    <span className="min-w-0 flex-1 text-[12.5px] text-muted">
                      {c.message}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <div className="flex flex-col gap-4">
          {me.perms.pipelines === "write" ? (
            <PublishForm week={montag} blockierende={blockierende.length} />
          ) : (
            <div className="rounded-[20px] bg-surface p-5 text-[13px] text-muted shadow-soft">
              Für die Veröffentlichung fehlt deiner Rolle das Schreibrecht.
            </div>
          )}

          {veroeffentlicht ? (
            <div className="rounded-[20px] bg-surface p-5 shadow-soft">
              <h2 className="mb-2 text-[15px] font-semibold">Letzte Freigabe</h2>
              <p className="num text-[12.5px] text-muted">
                {new Date(
                  veroeffentlicht.published_at as string,
                ).toLocaleString("de-AT")}
              </p>
              {(veroeffentlicht.warnings_json as { bestaetigt?: { durch: string; grund: string } })
                ?.bestaetigt ? (
                <p className="mt-2 rounded-input bg-s-warn/12 px-3 py-2 text-[12.5px]">
                  Trotz Verstößen freigegeben durch{" "}
                  {
                    (
                      veroeffentlicht.warnings_json as {
                        bestaetigt: { durch: string; grund: string };
                      }
                    ).bestaetigt.durch
                  }
                  :{" "}
                  {
                    (
                      veroeffentlicht.warnings_json as {
                        bestaetigt: { durch: string; grund: string };
                      }
                    ).bestaetigt.grund
                  }
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}
