import type { Metadata } from "next";
import Link from "next/link";
import { DecideCorrectionForm } from "@/app/(app)/stundenkonto/CorrectionForms";
import { Abschnitt, Zaehler } from "@/components/ui/Abschnitt";
import { Avatar, AvatarStapel } from "@/components/ui/Avatar";
import { KpiKarte } from "@/components/ui/KpiKarte";
import { PageHeader } from "@/components/ui/PageHeader";
import { dateShort, hhmm, hhmmSigned, time, viennaDay } from "@/lib/format";
import { liveText, tagesbild, type Buchung } from "@/lib/rules/tagesbild";
import { addDays, endOfViennaDay, startOfViennaDay } from "@/lib/time";
import { requireMe } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { BookingForm } from "./BookingForm";

export const metadata: Metadata = { title: "Zeiterfassung" };

const STATUS_TEXT: Record<string, string> = {
  eingestempelt: "eingestempelt",
  pause: "Pause",
  dienstgang: "Dienstgang",
  abwesend: "abwesend",
  unplausibel: "unplausibel",
  pruefen: "prüfen",
  gebucht: "gebucht",
  offen: "nicht gestempelt",
};

const STATUS_TON: Record<string, string> = {
  eingestempelt: "bg-s-done/12 text-s-done",
  pause: "bg-accent/14 text-accent-ink",
  dienstgang: "bg-s-doing/12 text-s-doing",
  abwesend: "bg-s-crit/12 text-s-crit",
  unplausibel: "bg-s-crit/12 text-s-crit",
  pruefen: "bg-accent/14 text-accent-ink",
  gebucht: "bg-sunk text-muted",
  offen: "bg-sunk text-faint",
};

const ABWESENHEIT_TEXT: Record<string, string> = {
  vacation: "Urlaub",
  sick: "Krankenstand",
  leave_comp: "Zeitausgleich",
  care: "Pflegefreistellung",
  school: "Berufsschule",
  special: "Sonderurlaub",
};

const SPALTEN = "1.5fr 90px 90px 90px 90px 100px 1.2fr 140px";

export default async function ZeiterfassungPage({
  searchParams,
}: {
  searchParams: Promise<{ tag?: string }>;
}) {
  const me = await requireMe();
  const supabase = await createClient();

  const { tag } = await searchParams;
  const day = tag && /^\d{4}-\d{2}-\d{2}$/.test(tag) ? tag : viennaDay();
  /*
   * Wer fremde Zeiten sehen darf, entscheidet der Bereich 'mitarbeiter' —
   * nicht 'zeiterfassung' (Migration 0008: das braucht ein Monteur zum
   * eigenen Stempeln).
   *
   * Das ist hier keine Feinheit: die Tagesansicht listet eine Zeile je
   * Person. Für einen Monteur würden die Zeilen der Kollegen zwar keine
   * Zeiten zeigen — RLS filtert die Buchungen weg —, aber sie würden mit
   * "0:00, nicht gestempelt" dastehen. Das ist schlimmer als sie
   * wegzulassen: es behauptet, niemand arbeite.
   */
  const darfAlle = me.perms.mitarbeiter !== "none";

  const [
    { data: entries },
    { data: jobs },
    { data: users },
    { data: abwesenheiten },
    { data: korrekturen },
  ] = await Promise.all([
    supabase
      .from("time_entry")
      .select(
        `id, user_id, kind, started_at, ended_at, duration_min, status,
         job:job_id ( id, number )`,
      )
      .gte("started_at", startOfViennaDay(day).toISOString())
      .lt("started_at", endOfViennaDay(day).toISOString())
      .neq("status", "replaced")
      .order("started_at"),
    supabase
      .from("job")
      .select("id, number, customer:customer_id ( name )")
      .order("number", { ascending: false })
      .limit(100),
    darfAlle
      ? supabase
          .from("app_user")
          .select("id, name, weekly_hours")
          .eq("active", true)
          .order("name")
      : Promise.resolve({
          data: [{ id: me.id, name: me.name, weekly_hours: me.weeklyHours }],
        }),
    supabase
      .from("absence")
      .select("user_id, kind")
      .eq("status", "approved")
      .lte("from_date", day)
      .gte("to_date", day),
    supabase
      .from("time_correction")
      .select(
        `id, reason, requested_change_json, created_at, status,
         person:user_id ( name ),
         eintrag:time_entry_id ( started_at, ended_at )`,
      )
      .eq("status", "requested")
      .order("created_at", { ascending: false }),
  ]);

  type Eintrag = {
    id: string;
    user_id: string;
    kind: string;
    started_at: string;
    ended_at: string | null;
    duration_min: number | null;
    status: string;
    job: { id: string; number: string } | null;
  };

  const eintraege = (entries ?? []) as unknown as Eintrag[];

  const buchungen: Buchung[] = eintraege.map((e) => ({
    userId: e.user_id,
    kind: e.kind,
    startedAt: e.started_at,
    endedAt: e.ended_at,
    durationMin: e.duration_min,
    status: e.status,
    jobId: e.job?.id ?? null,
    jobNumber: e.job?.number ?? null,
  }));

  const abwesend = new Map<string, string>();
  for (const a of abwesenheiten ?? []) {
    abwesend.set(
      a.user_id as string,
      ABWESENHEIT_TEXT[a.kind as string] ?? "abwesend",
    );
  }

  const zeilen = tagesbild({
    personen: (users ?? []).map((u) => ({
      id: u.id as string,
      name: u.name as string,
      weeklyHours: Number(u.weekly_hours ?? 0),
    })),
    buchungen,
    abwesend,
    tagessollMin: Math.round((me.weeklyHours / 5) * 60),
  });

  const istGesamt = zeilen.reduce((s, z) => s + z.istMin, 0);
  const pauseGesamt = zeilen.reduce((s, z) => s + z.pauseMin, 0);
  const sollGesamt = zeilen.reduce((s, z) => s + z.sollMin, 0);
  const zuPruefen = zeilen.filter(
    (z) => z.status === "pruefen" || z.status === "unplausibel",
  );

  const aktiveNamen = zeilen
    .filter((z) => z.status === "eingestempelt" || z.status === "dienstgang")
    .map((z) => z.name);

  const jobOptions = (jobs ?? []).map((j) => ({
    id: j.id as string,
    label: `${j.number as string} · ${(j.customer as unknown as { name: string } | null)?.name ?? ""}`,
  }));

  const userOptions = (users ?? []).map((u) => ({
    id: u.id as string,
    label: u.name as string,
  }));

  return (
    <>
      <PageHeader
        title="Zeiterfassung"
        subtitle={`Tagesansicht · ${new Date(`${day}T12:00:00Z`).toLocaleDateString("de-AT", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" })}`}
        actions={
          <div className="flex items-center gap-1 rounded-pill bg-surface p-1 shadow-soft">
            <DayLink day={addDays(day, -1)} label="‹" />
            <DayLink day={viennaDay()} label="Heute" />
            <DayLink day={addDays(day, 1)} label="›" />
          </div>
        }
      />

      <div className="mb-4 grid gap-[10px] sm:grid-cols-2 xl:grid-cols-4">
        <KpiKarte
          akzent
          label="Gebucht heute"
          wert={hhmm(istGesamt)}
          pille={hhmmSigned(istGesamt - sollGesamt)}
          notiz={`Tagessoll ${hhmm(sollGesamt)} über ${zeilen.length} Personen`}
        />
        <KpiKarte
          label="Pause"
          wert={hhmm(pauseGesamt)}
          notiz="nicht als Arbeitszeit gezählt"
        />
        <KpiKarte
          label="Zu prüfen"
          wert={zuPruefen.length}
          pille={zuPruefen.length > 0 ? "Plausibilität" : "alles sauber"}
          ton={zuPruefen.length > 0 ? "warn" : "gut"}
          notiz="ohne Auftrag, über 10 h ohne Pause, markiert"
        />
        <KpiKarte
          label="Korrekturanträge"
          wert={(korrekturen ?? []).length}
          pille={
            (korrekturen ?? []).length > 0 ? "warten auf Entscheidung" : "nichts offen"
          }
          ton={(korrekturen ?? []).length > 0 ? "warn" : "gut"}
          notiz="Korrektur ersetzt, sie überschreibt nicht"
        />
      </div>

      {/* Live-Leiste der Vorlage: wer steht gerade auf der Uhr. */}
      <div className="mb-4 flex flex-wrap items-center gap-4 rounded-[20px] bg-surface px-5 py-4 shadow-soft">
        {aktiveNamen.length > 0 ? (
          <AvatarStapel namen={aktiveNamen} max={8} size={30} />
        ) : null}
        <span className="text-[13.5px] font-semibold">{liveText(zeilen)}</span>
        <span className="num ml-auto text-[12.5px] text-muted">
          {dateShort(day)}
        </span>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.7fr_1fr] xl:items-start">
        <div className="overflow-x-auto rounded-[20px] bg-surface shadow-soft">
          <div className="min-w-[980px]">
            <div
              className="grid border-b border-line px-4 text-[11px] tracking-[0.07em] text-faint uppercase"
              style={{ gridTemplateColumns: SPALTEN }}
            >
              {[
                ["Mitarbeiter", false],
                ["Kommt", false],
                ["Pause", true],
                ["Ist", true],
                ["Soll", true],
                ["Diff", true],
                ["Auftrag", false],
                ["Status", false],
              ].map(([h, rechts]) => (
                <div
                  key={h as string}
                  className={`px-2 py-[14px] ${rechts ? "text-right" : ""}`}
                >
                  {h as string}
                </div>
              ))}
            </div>

            {zeilen.length === 0 ? (
              <p className="px-6 py-8 text-[13.5px] text-muted">
                Keine aktiven Mitarbeiter.
              </p>
            ) : (
              zeilen.map((z) => (
                <div
                  key={z.userId}
                  className={[
                    "grid items-center border-b border-line px-4 last:border-b-0",
                    z.status === "unplausibel" || z.status === "pruefen"
                      ? "bg-accent/[0.05]"
                      : "",
                  ].join(" ")}
                  style={{ gridTemplateColumns: SPALTEN }}
                  title={z.hinweis ?? undefined}
                >
                  <div className="flex min-w-0 items-center gap-3 px-2 py-3">
                    <Avatar name={z.name} size={30} />
                    <span className="min-w-0">
                      <span className="block truncate text-[13.5px] font-medium">
                        {z.name}
                      </span>
                      {z.hinweis ? (
                        <span className="block truncate text-[11px] text-accent-ink">
                          {z.hinweis}
                        </span>
                      ) : null}
                    </span>
                  </div>
                  <div className="num px-2 py-3 text-[12.5px]">
                    {z.kommt ? time(z.kommt) : "—"}
                  </div>
                  <div className="num px-2 py-3 text-right text-[12.5px] text-muted">
                    {z.pauseMin > 0 ? hhmm(z.pauseMin) : "—"}
                  </div>
                  <div className="num px-2 py-3 text-right text-[13px] font-semibold">
                    {hhmm(z.istMin)}
                  </div>
                  <div className="num px-2 py-3 text-right text-[12.5px] text-muted">
                    {hhmm(z.sollMin)}
                  </div>
                  <div
                    className={`num px-2 py-3 text-right text-[12.5px] font-medium ${z.diffMin < 0 ? "text-s-crit" : "text-s-done"}`}
                  >
                    {hhmmSigned(z.diffMin)}
                  </div>
                  <div className="num min-w-0 truncate px-2 py-3 text-[12.5px]">
                    {z.auftrag ?? (
                      <span className="text-s-crit">keine Zuordnung</span>
                    )}
                  </div>
                  <div className="px-2 py-3">
                    <span
                      className={`inline-block rounded-pill px-[9px] py-[3px] text-[11px] font-medium ${STATUS_TON[z.status]}`}
                    >
                      {STATUS_TEXT[z.status]}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <Abschnitt
            titel="Offene Korrekturanträge"
            rechts={
              (korrekturen ?? []).length > 0 ? (
                <Zaehler>{(korrekturen ?? []).length}</Zaehler>
              ) : null
            }
          >
            {(korrekturen ?? []).length === 0 ? (
              <p className="text-[13px] text-muted">
                Nichts offen. Ein Antrag entsteht, wenn jemand eine gebuchte
                Zeit ändern will — die alte Buchung bleibt dabei erhalten.
              </p>
            ) : (
              <ul className="flex flex-col gap-4">
                {(korrekturen ?? []).map((k) => {
                  const wunsch = k.requested_change_json as Record<
                    string,
                    unknown
                  > | null;
                  const eintrag = k.eintrag as unknown as {
                    started_at: string;
                    ended_at: string | null;
                  } | null;
                  const person = k.person as unknown as { name: string } | null;

                  return (
                    <li
                      key={k.id as string}
                      className="border-b border-line pb-4 last:border-b-0 last:pb-0"
                    >
                      <div className="flex flex-wrap items-baseline gap-2">
                        <span className="text-[13.5px] font-medium">
                          {person?.name ?? "—"}
                        </span>
                        <span className="num text-[11.5px] text-faint">
                          {eintrag ? dateShort(eintrag.started_at) : ""}
                        </span>
                      </div>

                      {wunsch ? (
                        <p className="num mt-1 text-[12.5px] text-muted">
                          {beschreibeWunsch(wunsch, eintrag)}
                        </p>
                      ) : null}

                      {k.reason ? (
                        <p className="mt-1 text-[12.5px]">
                          {`„${k.reason as string}“`}
                        </p>
                      ) : null}

                      {me.perms.zeiterfassung === "write" ? (
                        <div className="mt-3">
                          <DecideCorrectionForm correctionId={k.id as string} />
                        </div>
                      ) : (
                        <p className="mt-2 text-[11.5px] text-faint">
                          Entscheiden darf die Bauleitung.
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Abschnitt>

          <BookingForm
            day={day}
            jobs={jobOptions}
            users={userOptions}
            meId={me.id}
            canBookOthers={me.perms.zeiterfassung === "write"}
          />
        </div>
      </div>
    </>
  );
}

/*
 * "Geht 18:20 → 16:20" statt eines JSON-Auszugs. Der Antrag enthält nur die
 * Felder, die sich ändern sollen — alles andere bleibt, wie es war.
 */
function beschreibeWunsch(
  wunsch: Record<string, unknown>,
  eintrag: { started_at: string; ended_at: string | null } | null,
): string {
  const teile: string[] = [];

  if (typeof wunsch.started_at === "string") {
    teile.push(
      `Kommt ${eintrag ? time(eintrag.started_at) : "—"} → ${time(wunsch.started_at)}`,
    );
  }
  if (typeof wunsch.ended_at === "string") {
    teile.push(
      `Geht ${eintrag?.ended_at ? time(eintrag.ended_at) : "—"} → ${time(wunsch.ended_at)}`,
    );
  }
  if (typeof wunsch.job_id === "string" || wunsch.job_id === null) {
    teile.push("Auftragszuordnung ändern");
  }
  if (typeof wunsch.kind === "string") {
    teile.push(`Art → ${wunsch.kind}`);
  }

  return teile.length > 0 ? teile.join(" · ") : "Änderung beantragt";
}

function DayLink({ day, label }: { day: string; label: string }) {
  return (
    <Link
      href={`/zeiterfassung?tag=${day}`}
      className="rounded-pill px-[15px] py-[9px] text-[13.5px] text-muted transition-colors hover:text-ink"
    >
      {label}
    </Link>
  );
}
