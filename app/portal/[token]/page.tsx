import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  Fortschrittsleiste,
  type Schritt,
} from "@/components/ui/Fortschrittsleiste";
import { Pill } from "@/components/ui/Pill";
import { date, dateShort, dateTime, eur, num, time } from "@/lib/format";
import {
  portalAppointments,
  portalJobs,
  portalPhases,
  portalPlant,
  portalQuotes,
  portalTickets,
  resolvePortal,
} from "@/lib/portal/data";
import Link from "next/link";
import { ConfirmAppointmentForm, NachfrageForm, TicketForm } from "./PortalForms";

export const metadata: Metadata = { title: "Kundenportal" };

type Nachricht = {
  id: string;
  author: string;
  author_name: string | null;
  body: string;
  created_at: string;
};

const KATEGORIE: Record<string, string> = {
  stoerung: "Störung",
  frage: "Frage",
  beschwerde: "Beschwerde",
  rechnung: "Rechnung",
};

const TICKET_STATUS: Record<string, string> = {
  offen: "offen",
  diagnose: "in Prüfung",
  termin_geplant: "Termin geplant",
  behoben: "erledigt",
};

export default async function PortalPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const session = await resolvePortal(token);

  // Ungültig, abgelaufen oder widerrufen — bewusst dieselbe Antwort, damit
  // sich aus der Fehlermeldung nichts ableiten lässt.
  if (!session) notFound();

  const [jobs, quotes, tickets, phasen, anlage, termine] = await Promise.all([
    portalJobs(session),
    portalQuotes(session),
    portalTickets(session),
    portalPhases(session),
    portalPlant(session),
    portalAppointments(session),
  ]);

  /*
   * Das laufende Projekt: der jüngste Auftrag, der noch nicht abgeschlossen
   * ist. Hat der Kunde mehrere, trägt die Leiste den aktuellen — die
   * übrigen stehen weiter unten in der Liste.
   */
  const laufendes = jobs.find(
    (j) =>
      (j.phase as unknown as { system_key: string | null } | null)
        ?.system_key !== "closed",
  );

  const aktuellerSort = laufendes
    ? ((laufendes.phase as unknown as { sort: number } | null)?.sort ?? null)
    : null;

  const schritte: Schritt[] =
    aktuellerSort === null
      ? []
      : phasen.map((p) => ({
          label: p.label,
          zustand:
            p.sort < aktuellerSort
              ? "erledigt"
              : p.sort === aktuellerSort
                ? "aktuell"
                : "offen",
        }));

  const naechsterTermin = termine[0] ?? null;

  return (
    <main className="mx-auto w-full max-w-[820px] px-4 py-8">
      <header className="mb-6">
        <p className="text-[13px] text-muted">{session.companyName}</p>
        <h1 className="text-[28px] font-bold tracking-[-0.025em]">
          {session.customerName}
        </h1>
      </header>

      {schritte.length > 0 && laufendes ? (
        <section className="mb-4 rounded-[20px] bg-surface p-5 shadow-soft">
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-[15px] font-semibold">Ihr Projekt im Verlauf</h2>
            <span className="num text-[12px] text-muted">
              {laufendes.number as string}
            </span>
          </div>
          <Fortschrittsleiste schritte={schritte} />
        </section>
      ) : null}

      {naechsterTermin ? (
        <section className="mb-4 rounded-[20px] bg-surface p-5 shadow-soft">
          <h2 className="text-[15px] font-semibold">Nächster Termin</h2>
          <p className="mt-2 text-[19px] leading-snug font-semibold tracking-[-0.02em]">
            {(naechsterTermin.title as string | null) ?? "Termin vor Ort"}
          </p>
          <p className="num mt-1 text-[13px] text-muted">
            {date(naechsterTermin.starts_at as string)} ·{" "}
            {time(naechsterTermin.starts_at as string)}–
            {time(naechsterTermin.ends_at as string)}
          </p>

          {naechsterTermin.customer_confirmed ? (
            <p className="mt-3 text-[13px] text-s-done">
              Von Ihnen bestätigt. Danke.
            </p>
          ) : (
            <div className="mt-4">
              <ConfirmAppointmentForm
                token={token}
                appointmentId={naechsterTermin.id as string}
              />
              <p className="mt-2 text-[11.5px] text-faint">
                Passt der Termin nicht? Schreiben Sie uns unten über
                {" „Anliegen“"} — wir melden uns.
              </p>
            </div>
          )}
        </section>
      ) : null}

      {anlage ? (
        <section className="mb-6 rounded-[20px] bg-surface p-5 shadow-soft">
          <h2 className="mb-3 text-[15px] font-semibold">Ihre Anlage</h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Anlagenwert
              label="Leistung"
              wert={anlage.kwp ? `${num(anlage.kwp as string)} kWp` : "—"}
            />
            <Anlagenwert
              label="Speicher"
              wert={
                anlage.storage_kwh
                  ? `${num(anlage.storage_kwh as string)} kWh`
                  : "kein Speicher"
              }
            />
            <Anlagenwert
              label="Module"
              wert={(anlage.modules as string | null) ?? "—"}
            />
            <Anlagenwert
              label="In Betrieb seit"
              wert={
                anlage.commissioned_on
                  ? dateShort(anlage.commissioned_on as string)
                  : "in Umsetzung"
              }
            />
          </div>
        </section>
      ) : null}

      <section className="mb-6">
        <h2 className="mb-2 text-[15px] font-semibold">Ihre Projekte</h2>
        {jobs.length === 0 ? (
          <p className="rounded-[20px] bg-surface p-5 text-[13px] text-muted shadow-soft">
            Aktuell ist kein Projekt hinterlegt.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {jobs.map((j) => (
              <li
                key={j.id as string}
                className="rounded-[20px] bg-surface p-5 shadow-soft"
              >
                <div className="flex flex-wrap items-center gap-3">
                  <span className="num text-[13px] font-semibold">
                    {j.number as string}
                  </span>
                  {j.phase ? (
                    <Pill tone="doing">
                      {(j.phase as unknown as { label: string }).label}
                    </Pill>
                  ) : null}
                  <span className="num flex-1 text-[12.5px] text-muted">
                    {[j.zip, j.city].filter(Boolean).join(" ")}
                  </span>
                </div>
                {j.scheduled_from ? (
                  <p className="num mt-2 text-[13px]">
                    Termin {date(j.scheduled_from as string)}
                    {j.scheduled_to
                      ? ` – ${date(j.scheduled_to as string)}`
                      : ""}
                  </p>
                ) : null}
                {j.next_step ? (
                  <p className="mt-1 text-[13px] text-muted">
                    Nächster Schritt: {j.next_step as string}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mb-6">
        <h2 className="mb-2 text-[15px] font-semibold">Ihre Angebote</h2>
        {quotes.length === 0 ? (
          <p className="rounded-[20px] bg-surface p-5 text-[13px] text-muted shadow-soft">
            Kein Angebot vorhanden.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {quotes.map((q) => {
              return (
                <li
                  key={q.id as string}
                  className="rounded-[20px] bg-surface p-5 shadow-soft"
                >
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="num text-[13px] font-semibold">
                      {q.number as string}
                    </span>
                    {q.accepted_at ? (
                      <Pill tone="done">angenommen</Pill>
                    ) : q.status === "lost" || q.status === "expired" ? (
                      <Pill tone="neutral">nicht mehr aktuell</Pill>
                    ) : (
                      <Pill tone="warn">offen</Pill>
                    )}
                    <span className="num flex-1 text-right text-[15px] font-semibold">
                      {eur(q.net_total as string)}
                    </span>
                  </div>
                  <p className="mt-1 text-[12px] text-muted">
                    Beträge exkl. USt.
                    {q.valid_until
                      ? ` · gültig bis ${date(q.valid_until as string)}`
                      : ""}
                  </p>

                  {q.accepted_at ? (
                    <p className="num mt-2 text-[12.5px] text-s-done">
                      Angenommen am {date(q.accepted_at as string)}
                      {q.accepted_name ? ` durch ${q.accepted_name as string}` : ""}
                    </p>
                  ) : null}

                  {/*
                    Das Angebot hat eine eigene Seite — mit Anlagendaten,
                    Produktbeschreibungen und den optionalen Erweiterungen.
                    Die Annahme passiert dort, nicht in dieser Kurzliste.
                  */}
                  <Link
                    href={`/portal/${token}/angebot/${q.id as string}`}
                    className="mt-3 inline-flex items-center justify-center rounded-pill bg-[linear-gradient(150deg,var(--accent-from),var(--accent-to))] px-5 py-[11px] text-[13px] font-semibold text-white hover:text-white"
                  >
                    {q.accepted_at ? "Angebot ansehen" : "Angebot ansehen und annehmen"}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section id="anliegen" className="mb-6 grid gap-4 md:grid-cols-2 md:items-start">
        <TicketForm token={token} />

        <div>
          <h2 className="mb-2 text-[15px] font-semibold">Ihre Anliegen</h2>
          {tickets.length === 0 ? (
            <p className="rounded-[20px] bg-surface p-5 text-[13px] text-muted shadow-soft">
              Noch keine Meldung.
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {tickets.map((t) => (
                <li
                  key={t.id as string}
                  className="rounded-[20px] bg-surface p-5 shadow-soft"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="num text-[12.5px] font-semibold">
                      {t.number as string}
                    </span>
                    <Pill tone={t.status === "behoben" ? "done" : "doing"}>
                      {TICKET_STATUS[t.status as string] ?? (t.status as string)}
                    </Pill>
                    <span className="text-[12px] text-muted">
                      {KATEGORIE[t.category as string] ?? (t.category as string)}
                    </span>
                  </div>
                  {/*
                    Der Verlauf statt einer einzelnen Antwort: der Kunde
                    sieht, was er geschrieben hat und was zurückkam, und
                    kann nachfragen. Interne Notizen des Betriebs sind
                    schon beim Laden aussortiert.
                  */}
                  {(t.verlauf as unknown as Nachricht[]).length === 0 ? (
                    <p className="mt-2 text-[13px] leading-[1.5]">
                      {t.body as string}
                    </p>
                  ) : null}

                  <ul className="mt-3 flex flex-col gap-2">
                    {(t.verlauf as unknown as Nachricht[]).map((m) => (
                      <li
                        key={m.id}
                        className={[
                          "rounded-input px-3 py-2",
                          m.author === "kunde"
                            ? "bg-panel"
                            : "bg-s-done/10",
                        ].join(" ")}
                      >
                        <div className="mb-[2px] flex items-baseline gap-2">
                          <span className="text-[11.5px] font-semibold">
                            {m.author === "kunde"
                              ? "Sie"
                              : (m.author_name ?? session.companyName)}
                          </span>
                          <span className="num ml-auto text-[10.5px] text-faint">
                            {dateTime(m.created_at)}
                          </span>
                        </div>
                        <p className="text-[13px] leading-[1.5] whitespace-pre-line">
                          {m.body}
                        </p>
                      </li>
                    ))}
                  </ul>

                  {t.status === "behoben" ? null : (
                    <NachfrageForm
                      token={token}
                      ticketId={t.id as string}
                      nummer={t.number as string}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <footer className="border-t border-line pt-4 text-[11.5px] text-faint">
        Dieser Zugang ist persönlich. Bitte den Link nicht weitergeben.
      </footer>
    </main>
  );
}

function Anlagenwert({ label, wert }: { label: string; wert: string }) {
  return (
    <div className="rounded-input bg-panel px-4 py-3">
      <div className="text-[11.5px] text-muted">{label}</div>
      <div className="num mt-[2px] text-[15px] font-semibold">{wert}</div>
    </div>
  );
}
