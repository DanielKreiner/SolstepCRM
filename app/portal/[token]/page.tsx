import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Pill } from "@/components/ui/Pill";
import { dateShort, dateTime, eur, num } from "@/lib/format";
import {
  portalPlant,
  portalTickets,
  resolvePortal,
} from "@/lib/portal/data";
import Link from "next/link";
import { NachfrageForm, TicketForm } from "./PortalForms";
import { portalVorgaenge } from "@/lib/portal/vorgang";
import { PHASEN, phaseIndex, type Phase } from "@/lib/vorgang/modell";

/* Phasennamen in Kundensprache — „Beauftragt" sagt einem Kunden nichts. */
const KUNDENPHASE: Record<Phase, string> = {
  anfrage: "Anfrage",
  aufnahme: "Aufnahme",
  angebot: "Angebot liegt vor",
  beauftragt: "in Vorbereitung",
  montage: "Montage",
  abschluss: "Abschluss",
  verloren: "ruht",
};

const KUNDENSATZ: Record<Phase, string> = {
  anfrage: "Wir melden uns bei Ihnen.",
  aufnahme: "Wir sehen uns Dach und Zähler an.",
  angebot: "Ihr Angebot wartet auf Ihre Rückmeldung.",
  beauftragt: "Material, Netzanmeldung und Förderung laufen.",
  montage: "Wir bauen Ihre Anlage.",
  abschluss: "Inbetriebnahme und Abrechnung.",
  verloren: "Dieses Projekt ruht.",
};

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

  const [vorgaenge, tickets, anlage] = await Promise.all([
    portalVorgaenge(session),
    portalTickets(session),
    portalPlant(session),
  ]);

  return (
    <main className="mx-auto w-full max-w-[820px] px-4 py-8">
      <header className="mb-6">
        <p className="text-[13px] text-muted">{session.companyName}</p>
        <h1 className="text-[28px] font-bold tracking-[-0.025em]">
          {session.customerName}
        </h1>
      </header>

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

      {/*
        Ein Vorgang trägt den ganzen Weg — Anfrage, Angebot, Auftrag,
        Rechnung. Der Kunde sieht eine Karte je Projekt und darin alles,
        statt getrennter Listen für Aufträge und Angebote.
      */}
      <section className="mb-6">
        <h2 className="mb-2 text-[15px] font-semibold">Ihre Projekte</h2>
        {vorgaenge.length === 0 ? (
          <p className="rounded-[20px] bg-surface p-5 text-[13px] text-muted shadow-soft">
            Aktuell ist kein Projekt hinterlegt.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {vorgaenge.map((v) => {
              const idx = phaseIndex(v.phase);
              const wert = v.auftragswertNetto ?? v.angebotswertNetto;
              return (
                <li key={v.id}>
                  <Link
                    href={`/portal/${token}/vorgang/${v.id}`}
                    className="block rounded-[20px] bg-surface p-5 text-ink shadow-soft transition-colors hover:bg-panel hover:text-ink"
                  >
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="num text-[13px] font-semibold">
                        {v.nummer}
                      </span>
                      {v.phase === "verloren" ? (
                        <Pill tone="neutral">ruht</Pill>
                      ) : (
                        <Pill tone={idx >= 4 ? "done" : "doing"}>
                          {KUNDENPHASE[v.phase] ?? v.phase}
                        </Pill>
                      )}
                      <span className="num flex-1 text-right text-[13px] text-muted">
                        {v.kwp ? `${num(v.kwp)} kWp` : ""}
                      </span>
                    </div>

                    {v.phase !== "verloren" && idx >= 0 ? (
                      <div className="mt-3 flex gap-1" aria-hidden>
                        {PHASEN.map((p, i) => (
                          <span
                            key={p.key}
                            className={[
                              "h-[5px] flex-1 rounded-pill",
                              i < idx
                                ? "bg-s-done"
                                : i === idx
                                  ? "bg-accent"
                                  : "bg-line",
                            ].join(" ")}
                          />
                        ))}
                      </div>
                    ) : null}

                    <p className="mt-2 text-[12.5px] text-muted">
                      {KUNDENSATZ[v.phase] ?? ""}
                      {wert ? ` · ${eur(wert)} netto` : ""}
                    </p>
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
