import type { Metadata } from "next";
import Link from "next/link";
import { RequestForm } from "@/app/(app)/abwesenheiten/AbsenceForms";
import { SignForm } from "@/app/(app)/mitarbeiter/PersonalForms";
import { Pill } from "@/components/ui/Pill";
import { dateShort, hhmm, hhmmSigned, viennaDay } from "@/lib/format";
import { vacationBalance, workdays, type AbsenceRow } from "@/lib/absence";
import { qualifikationsstand } from "@/lib/rules/qualifikation";
import { requireMe } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { addDays, endOfViennaDay, startOfViennaDay } from "@/lib/time";

export const metadata: Metadata = { title: "Profil" };

const ABWESENHEIT_LABEL: Record<string, string> = {
  vacation: "Urlaub",
  sick: "Krankenstand",
  leave_comp: "Zeitausgleich",
  care: "Pflegefreistellung",
  school: "Berufsschule",
  special: "Sonderurlaub",
};

const STATUS_TON: Record<string, "doing" | "done" | "crit"> = {
  requested: "doing",
  approved: "done",
  rejected: "crit",
};

/*
 * Screen 5 der Monteur-App (SPEC 6.1): Abwesenheit und Monatsbericht.
 *
 * Der Monatsbericht zeigt den ABGESCHLOSSENEN Vormonat, nicht den laufenden.
 * Ein Bericht über einen Monat, in dem noch gebucht wird, ist nichts, was
 * jemand bestätigen kann — und die Bestätigung ist der Zweck des Screens.
 *
 * Die Bestätigung selbst läuft über dasselbe Signaturfeld wie jedes andere
 * Personaldokument (job_document.signature_status). Kein zweiter Mechanismus
 * für dieselbe Sache.
 */
export default async function ProfilPage() {
  const me = await requireMe();
  const supabase = await createClient();
  const heute = viennaDay();
  const jahr = Number(heute.slice(0, 4));

  // Vormonat als [von, bis] in Wiener Kalendertagen.
  const ersterDiesesMonats = `${heute.slice(0, 7)}-01`;
  const letzterVormonat = addDays(ersterDiesesMonats, -1);
  const ersterVormonat = `${letzterVormonat.slice(0, 7)}-01`;

  const [
    { data: abwesenheiten },
    { data: zeitenVormonat },
    { data: dokumente },
    { data: qualifikationen },
    { data: stammdaten },
  ] = await Promise.all([
    supabase
      .from("absence")
      .select("id, user_id, kind, from_date, to_date, half_day, status")
      .eq("user_id", me.id)
      .order("from_date", { ascending: false }),
    supabase
      .from("time_entry")
      .select("duration_min, kind")
      .eq("user_id", me.id)
      .in("status", ["booked", "approved"])
      .gte("started_at", startOfViennaDay(ersterVormonat).toISOString())
      .lt("started_at", endOfViennaDay(letzterVormonat).toISOString()),
    supabase
      .from("job_document")
      .select("id, filename, kind, signature_status, signed_at, created_at")
      .eq("user_id", me.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("qualification")
      .select("id, name, valid_until")
      .eq("user_id", me.id)
      .order("valid_until", { nullsFirst: false }),
    supabase
      .from("app_user")
      .select("vacation_days_year, vacation_carry")
      .eq("id", me.id)
      .maybeSingle(),
  ]);

  type AbwesenheitZeile = {
    id: string;
    kind: string;
    from_date: string;
    to_date: string;
    half_day: boolean;
    status: string;
  };
  const meineAbwesenheiten = (abwesenheiten ??
    []) as unknown as AbwesenheitZeile[];

  /*
   * Anspruch und Übertrag stehen am Mitarbeiter, nicht als Annahme im Code.
   * Ein Betrieb mit sechs Urlaubswochen bekäme sonst hier 25 Tage angezeigt
   * und im Backoffice 30.
   */
  const saldo = vacationBalance(
    meineAbwesenheiten.map((a) => ({
      kind: a.kind,
      from: a.from_date,
      to: a.to_date,
      halfDay: a.half_day,
      status: a.status,
    })) satisfies AbsenceRow[],
    Number(stammdaten?.vacation_days_year ?? 25),
    Number(stammdaten?.vacation_carry ?? 0),
    jahr,
  );

  const istMin = (zeitenVormonat ?? [])
    .filter((z) => z.kind !== "break")
    .reduce((s, z) => s + Number(z.duration_min ?? 0), 0);

  /*
   * Sollstunden des Vormonats: Werktage mal Tagessoll. Feiertage fehlen hier
   * noch — location.holiday_region ist gepflegt, aber nicht ausgewertet. Der
   * Wert liegt dadurch an Feiertagsmonaten zu hoch; das steht so auch in
   * docs/STATUS.md und ist kein stiller Fehler.
   */
  const tagessollMin = (me.weeklyHours / 5) * 60;
  const sollMin = workdays(ersterVormonat, letzterVormonat) * tagessollMin;

  const monatsbericht = (dokumente ?? []).find(
    (d) =>
      (d.kind as string) === "monatsbericht" &&
      String(d.filename).includes(letzterVormonat.slice(0, 7)),
  );

  const offeneUnterschriften = (dokumente ?? []).filter(
    (d) => d.signature_status === "pending",
  );

  return (
    <>
      <h1 className="mb-1 text-[24px] font-bold tracking-[-0.02em]">Profil</h1>
      <p className="mb-4 text-[13px] text-muted">
        {me.name} · {me.weeklyHours} h/Woche
      </p>

      {/* --- Monatsbericht --- */}
      <section className="mb-6 rounded-[20px] bg-surface p-5 shadow-soft">
        <h2 className="text-[15px] font-semibold">
          Monatsbericht{" "}
          {new Date(`${ersterVormonat}T12:00:00Z`).toLocaleDateString("de-AT", {
            month: "long",
            year: "numeric",
          })}
        </h2>

        <div className="mt-4 grid grid-cols-3 gap-2">
          <Kachel label="Ist" wert={hhmm(istMin)} />
          <Kachel label="Soll" wert={hhmm(sollMin)} />
          <Kachel
            label="Saldo"
            wert={hhmmSigned(istMin - sollMin)}
            ton={istMin - sollMin < 0 ? "crit" : "done"}
          />
        </div>

        <div className="mt-4">
          {monatsbericht ? (
            monatsbericht.signature_status === "signed" ? (
              <p className="text-[13px] text-s-done">
                Bestätigt am{" "}
                {dateShort(monatsbericht.signed_at as string)}.
              </p>
            ) : (
              <SignForm
                documentId={monatsbericht.id as string}
                filename={monatsbericht.filename as string}
              />
            )
          ) : (
            <p className="text-[12.5px] text-muted">
              Der Bericht wird zum Monatswechsel erzeugt und erscheint dann hier
              zur Bestätigung.
            </p>
          )}
        </div>
      </section>

      {/* --- Offene Unterschriften --- */}
      {offeneUnterschriften.length > 0 ? (
        <section className="mb-6 rounded-[20px] bg-surface p-5 shadow-soft">
          <h2 className="mb-3 text-[15px] font-semibold">
            Unterschrift offen
            <span className="num ml-2 rounded-pill bg-accent/14 px-[8px] py-[2px] text-[11px] font-normal text-accent-ink">
              {offeneUnterschriften.length}
            </span>
          </h2>
          <ul className="flex flex-col gap-3">
            {offeneUnterschriften.map((d) => (
              <li key={d.id as string} className="rounded-input bg-panel p-4">
                <p className="text-[13.5px] font-medium">{d.filename as string}</p>
                <p className="num mb-3 text-[11.5px] text-faint">
                  {dateShort(d.created_at as string)}
                </p>
                <SignForm
                  documentId={d.id as string}
                  filename={d.filename as string}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* --- Urlaubssaldo und Antrag --- */}
      <section className="mb-6 rounded-[20px] bg-surface p-5 shadow-soft">
        <h2 className="text-[15px] font-semibold">Urlaub</h2>
        <div className="mt-4 grid grid-cols-3 gap-2">
          <Kachel label="Anspruch" wert={`${saldo.anspruch}`} einheit="Tage" />
          <Kachel label="Genommen" wert={`${saldo.genommen}`} einheit="Tage" />
          <Kachel
            label="Rest"
            wert={`${saldo.rest}`}
            einheit="Tage"
            ton={saldo.rest < 0 ? "crit" : "done"}
          />
        </div>
      </section>

      <div className="mb-6">
        <RequestForm meId={me.id} users={[]} canForOthers={false} />
      </div>

      {/* --- Eigene Abwesenheiten --- */}
      <section className="mb-6">
        <h2 className="mb-2 text-[15px] font-semibold">Meine Abwesenheiten</h2>
        {meineAbwesenheiten.length === 0 ? (
          <p className="rounded-[20px] bg-surface p-5 text-[13px] text-muted shadow-soft">
            Nichts eingetragen.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {meineAbwesenheiten.slice(0, 12).map((a) => (
              <li
                key={a.id}
                className="flex flex-wrap items-center gap-2 rounded-input bg-surface px-4 py-3 shadow-soft"
              >
                <span className="text-[13px] font-medium">
                  {ABWESENHEIT_LABEL[a.kind] ?? a.kind}
                </span>
                <span className="num flex-1 text-[12px] text-muted">
                  {dateShort(a.from_date)} – {dateShort(a.to_date)}
                  {a.half_day ? " · halber Tag" : ""}
                </span>
                <Pill tone={STATUS_TON[a.status] ?? "neutral"}>
                  {a.status === "requested"
                    ? "beantragt"
                    : a.status === "approved"
                      ? "genehmigt"
                      : "abgelehnt"}
                </Pill>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* --- Qualifikationen --- */}
      <section className="mb-6">
        <h2 className="mb-2 text-[15px] font-semibold">Meine Nachweise</h2>
        {(qualifikationen ?? []).length === 0 ? (
          <p className="rounded-[20px] bg-surface p-5 text-[13px] text-muted shadow-soft">
            Keine Qualifikation hinterlegt.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {(qualifikationen ?? []).map((q) => {
              const bis = q.valid_until as string | null;
              const stand = qualifikationsstand(bis, heute);
              const abgelaufen = stand === "abgelaufen";
              const laeuftAb = stand === "laeuft_ab";
              return (
                <li
                  key={q.id as string}
                  className="flex flex-wrap items-center gap-2 rounded-input bg-surface px-4 py-3 shadow-soft"
                >
                  <span className="flex-1 text-[13px] font-medium">
                    {q.name as string}
                  </span>
                  {bis ? (
                    <span className="num text-[12px] text-muted">
                      bis {dateShort(bis)}
                    </span>
                  ) : null}
                  {abgelaufen ? (
                    <Pill tone="crit">abgelaufen</Pill>
                  ) : laeuftAb ? (
                    <Pill tone="warn">läuft ab</Pill>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <Link
        href="/logout"
        className="flex min-h-[56px] items-center justify-center rounded-pill bg-surface text-[15px] font-medium text-muted shadow-soft"
      >
        Abmelden
      </Link>
    </>
  );
}

function Kachel({
  label,
  wert,
  einheit,
  ton,
}: {
  label: string;
  wert: string;
  einheit?: string;
  ton?: "done" | "crit";
}) {
  return (
    <div className="rounded-input bg-panel px-3 py-[10px] text-center">
      <div className="text-[11px] text-muted">{label}</div>
      <div
        className={[
          "num mt-[2px] text-[17px] font-semibold",
          ton === "crit" ? "text-s-crit" : ton === "done" ? "text-s-done" : "",
        ].join(" ")}
      >
        {wert}
      </div>
      {einheit ? (
        <div className="text-[10.5px] text-faint">{einheit}</div>
      ) : null}
    </div>
  );
}
