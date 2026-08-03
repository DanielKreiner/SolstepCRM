import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pill } from "@/components/ui/Pill";
import { Stat } from "@/components/ui/Stat";
import { date, dateTime, hhmm, initials } from "@/lib/format";
import { ROLE_LABEL } from "@/lib/nav";
import { requireMe } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import {
  DocumentForm,
  QualificationForm,
  SignForm,
  AustrittKnopf,
  MitarbeiterBearbeiten,
} from "../PersonalForms";

export const metadata: Metadata = { title: "Mitarbeiter" };

const DOK_LABEL: Record<string, string> = {
  contract: "Vertrag",
  payslip: "Lohnzettel",
  certificate: "Zertifikat",
  other: "Sonstiges",
};

export default async function MitarbeiterDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const me = await requireMe();
  const { id } = await params;
  const supabase = await createClient();

  const { data: person } = await supabase
    .from("app_user")
    .select(
      /*
       * hourly_cost steht hier bewusst NICHT: die Spalte hat seit 0009
       * kein Leserecht für authenticated, und eine Abfrage, die sie
       * mitnimmt, schlägt komplett fehl — die Seite wäre für jede Rolle
       * eine 404. Der Kostensatz kommt weiter unten über
       * hourly_cost_of(), das can(mitarbeiter) prüft.
       */
      "id, name, email, phone, role, weekly_hours, employment_type, vacation_days_year, vacation_carry, active, created_at, location_id, location:location_id ( name )",
    )
    .eq("id", id)
    .maybeSingle();

  if (!person) notFound();

  const darfPflegen = me.perms.mitarbeiter === "write";
  const eigenesProfil = me.id === id;

  const [{ data: quali }, { data: dokumente }, { data: saldo }, { data: satz }] =
    await Promise.all([
      supabase
        .from("qualification")
        .select("id, name, issued_on, valid_until")
        .eq("user_id", id)
        .order("valid_until", { nullsFirst: false }),
      supabase
        .from("job_document")
        .select("id, kind, filename, size_bytes, signature_status, signed_at, created_at")
        .eq("user_id", id)
        .order("created_at", { ascending: false }),
      supabase
        .from("v_time_balance")
        .select("actual_min, adjust_min")
        .eq("user_id", id)
        .maybeSingle(),
      supabase.rpc("hourly_cost_of", { p_user: id }),
    ]);

  const { data: standorte } = await supabase
    .from("location")
    .select("id, name, city")
    .order("name");

  const heute = new Date().toISOString().slice(0, 10);
  const istStunden =
    Number(saldo?.actual_min ?? 0) + Number(saldo?.adjust_min ?? 0);
  const offeneUnterschriften = (dokumente ?? []).filter(
    (d) => d.signature_status === "pending",
  ).length;

  const location = person.location as unknown as { name: string } | null;

  return (
    <>
      <PageHeader
        title={person.name as string}
        subtitle={`${ROLE_LABEL[person.role as string] ?? (person.role as string)}${location ? ` · ${location.name}` : ""}${person.active ? "" : " · nicht aktiv"}`}
        actions={
          <Link
            href="/mitarbeiter"
            className="rounded-pill border border-line bg-surface px-5 py-[13px] text-sm font-medium text-ink transition-colors hover:bg-sunk"
          >
            Zur Liste
          </Link>
        }
      />

      <div className="mb-4 grid gap-[10px] sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Iststunden" value={hhmm(istStunden)} />
        <Stat label="Wochenstunden" value={`${person.weekly_hours as string} h`} />
        <Stat
          label="Urlaubsanspruch"
          value={`${person.vacation_days_year as string} + ${person.vacation_carry as string}`}
          hint="Jahr + Übertrag"
        />
        <Stat
          label="Offene Unterschriften"
          value={offeneUnterschriften}
          tone={offeneUnterschriften > 0 ? "warn" : "done"}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_1.5fr] xl:items-start">
        <section className="rounded-[20px] bg-surface p-5 shadow-soft">
          <div className="mb-3 flex items-center gap-3">
            <span
              aria-hidden
              className="flex h-11 w-11 items-center justify-center rounded-pill bg-s-doing text-[14px] font-semibold text-white"
            >
              {initials(person.name as string)}
            </span>
            <h2 className="text-[15px] font-semibold">Stammdaten</h2>
          </div>

          <dl className="flex flex-col gap-[9px] text-[13px]">
            <Row label="E-Mail">
              <span className="num break-all">{person.email as string}</span>
            </Row>
            <Row label="Telefon">
              <span className="num">{(person.phone as string) ?? "—"}</span>
            </Row>
            <Row label="Beschäftigung">
              {(person.employment_type as string) ?? "—"}
            </Row>
            <Row label="Im Betrieb seit">
              {date(person.created_at as string)}
            </Row>
            <Row label="Stundensatz">
              {satz === null || satz === undefined ? (
                <span className="text-faint">nicht sichtbar</span>
              ) : (
                <span className="num">{Number(satz).toFixed(2)} EUR</span>
              )}
            </Row>
          </dl>

          <p className="mt-3 border-t border-line pt-3 text-[11.5px] text-faint">
            Der Stundensatz ist keine Spalte, die jeder lesen kann — er kommt
            über eine geprüfte Funktion.
          </p>
        </section>

        <div className="flex flex-col gap-4">
          <section className="rounded-[20px] bg-surface p-5 shadow-soft">
            <h2 className="text-[15px] font-semibold">
              Nachweise{" "}
              <span className="num font-normal text-muted">
                ({(quali ?? []).length})
              </span>
            </h2>

            {(quali ?? []).length === 0 ? (
              <p className="mt-2 text-[13px] text-muted">
                Kein Nachweis hinterlegt.
              </p>
            ) : (
              <ul className="mt-3 flex flex-col gap-2">
                {(quali ?? []).map((q) => {
                  const bis = q.valid_until as string | null;
                  const abgelaufen = bis !== null && bis < heute;
                  const bald =
                    bis !== null &&
                    !abgelaufen &&
                    new Date(bis).getTime() - Date.now() < 60 * 86_400_000;

                  return (
                    <li
                      key={q.id as string}
                      className="flex flex-wrap items-center gap-3 rounded-input bg-panel px-4 py-3"
                    >
                      <span className="min-w-0 flex-1 text-[13px]">
                        {q.name as string}
                      </span>
                      <span className="num text-[12px] text-muted">
                        {q.issued_on ? date(q.issued_on as string) : "—"}
                      </span>
                      {bis ? (
                        <Pill tone={abgelaufen ? "crit" : bald ? "warn" : "done"}>
                          {abgelaufen ? "abgelaufen" : `bis ${date(bis)}`}
                        </Pill>
                      ) : (
                        <Pill tone="neutral">unbefristet</Pill>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}

            {darfPflegen ? <QualificationForm userId={id} /> : null}
          </section>

          <section className="rounded-[20px] bg-surface p-5 shadow-soft">
            <h2 className="text-[15px] font-semibold">
              Dokumente{" "}
              <span className="num font-normal text-muted">
                ({(dokumente ?? []).length})
              </span>
            </h2>
            <p className="mt-1 text-[12px] text-faint">
              Personalakte. Sichtbar für die betroffene Person und für Rollen
              mit Leserecht auf Mitarbeiter.
            </p>

            {(dokumente ?? []).length === 0 ? (
              <p className="mt-2 text-[13px] text-muted">Noch nichts abgelegt.</p>
            ) : (
              <ul className="mt-3 flex flex-col gap-2">
                {(dokumente ?? []).map((d) => (
                  <li
                    key={d.id as string}
                    className="flex flex-wrap items-center gap-3 rounded-input bg-panel px-4 py-3"
                  >
                    <Pill tone="neutral">
                      {DOK_LABEL[d.kind as string] ?? (d.kind as string)}
                    </Pill>
                    <span className="min-w-0 flex-1 truncate text-[13px]">
                      {d.filename as string}
                    </span>
                    <span className="num text-[11.5px] text-faint">
                      {dateTime(d.created_at as string)}
                    </span>

                    {d.signature_status === "signed" ? (
                      <Pill tone="done">
                        unterschrieben {date(d.signed_at as string)}
                      </Pill>
                    ) : d.signature_status === "pending" ? (
                      eigenesProfil || darfPflegen ? (
                        <SignForm
                          documentId={d.id as string}
                          filename={d.filename as string}
                        />
                      ) : (
                        <Pill tone="warn">Unterschrift steht aus</Pill>
                      )
                    ) : null}
                  </li>
                ))}
              </ul>
            )}

            {darfPflegen ? <DocumentForm userId={id} /> : null}
          </section>
        </div>
      </div>

      {darfPflegen ? (
        <div className="mt-4 grid gap-4 xl:grid-cols-[1.6fr_1fr] xl:items-start">
          <MitarbeiterBearbeiten
            darfRolle={me.role === "gf"}
            werte={{
              userId: id,
              name: person.name as string,
              role: person.role as string,
              locationId: (person.location_id as string | null) ?? "",
              phone: (person.phone as string | null) ?? "",
              weeklyHours: Number(person.weekly_hours),
              employmentType: (person.employment_type as string) ?? "vollzeit",
              hourlyCost: Number(satz ?? 0),
              vacationDaysYear: Number(person.vacation_days_year),
              vacationCarry: Number(person.vacation_carry),
            }}
            standorte={(standorte ?? []).map((l) => ({
              wert: l.id as string,
              text: l.name as string,
              ...(l.city ? { zusatz: l.city as string } : {}),
            }))}
          />

          {me.role === "gf" && !eigenesProfil ? (
            <section className="rounded-[20px] bg-surface p-5 shadow-soft">
              <h2 className="text-[15px] font-semibold">Beschäftigung</h2>
              <p className="mt-1 mb-4 text-[12.5px] text-muted">
                {person.active
                  ? "Beim Austritt bleiben Zeiten, Dokumente und Belege erhalten — der Mitarbeiter verschwindet nur aus Planung und Zuweisungen."
                  : "Als ausgetreten vermerkt. Alle Daten sind erhalten."}
              </p>
              <AustrittKnopf userId={id} aktiv={Boolean(person.active)} />
            </section>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className="min-w-0 text-right">{children}</dd>
    </div>
  );
}
