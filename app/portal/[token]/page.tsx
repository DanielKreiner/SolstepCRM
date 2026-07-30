import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Pill } from "@/components/ui/Pill";
import { date, eur } from "@/lib/format";
import {
  portalJobs,
  portalQuotes,
  portalTickets,
  resolvePortal,
} from "@/lib/portal/data";
import { AcceptForm, TicketForm } from "./PortalForms";

export const metadata: Metadata = { title: "Kundenportal" };

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

  const [jobs, quotes, tickets] = await Promise.all([
    portalJobs(session),
    portalQuotes(session),
    portalTickets(session),
  ]);

  const offeneAngebote = quotes.filter(
    (q) => !q.accepted_at && q.status !== "lost" && q.status !== "expired",
  );

  return (
    <main className="mx-auto w-full max-w-[820px] px-4 py-8">
      <header className="mb-6">
        <p className="text-[13px] text-muted">{session.companyName}</p>
        <h1 className="text-[28px] font-bold tracking-[-0.025em]">
          {session.customerName}
        </h1>
      </header>

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
              const offen = offeneAngebote.some((o) => o.id === q.id);
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
                  ) : offen ? (
                    <AcceptForm
                      token={token}
                      quoteId={q.id as string}
                      quoteNumber={q.number as string}
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="mb-6 grid gap-4 md:grid-cols-2 md:items-start">
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
                  <p className="mt-2 text-[13px]">{t.body as string}</p>
                  {t.response ? (
                    <p className="mt-2 rounded-input bg-panel px-3 py-2 text-[13px]">
                      {t.response as string}
                    </p>
                  ) : null}
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
