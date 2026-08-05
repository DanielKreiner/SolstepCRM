import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { date, dateTime, eur, num, time } from "@/lib/format";
import { resolvePortal } from "@/lib/portal/data";
import { portalVorgangDetail } from "@/lib/portal/vorgang";
import { PHASEN, phaseIndex } from "@/lib/vorgang/modell";
import {
  PortalShell,
  type PortalBereich,
} from "@/components/portal/PortalShell";
import { AngebotAnsicht } from "./AngebotAnsicht";
import { OffeneAnfragen, PortalChat } from "./PortalChat";
import { ConfirmAppointmentForm } from "../../PortalForms";
import { chatLesen } from "@/lib/vorgang/chat";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = { title: "Ihr Projekt" };

/**
 * Der Vorgang aus Sicht des Kunden.
 *
 * Ein Bildschirm für alles, was ihn angeht: wo das Projekt steht, wann
 * jemand kommt, was angeboten wurde, was er unterschreibt, was er zahlt.
 * Kein Login, kein Konto — nur der Link.
 *
 * Was hier steht, entscheidet kunde_sichtbar an Ereignis und Dokument.
 * Interne Notizen, Gate-Wechsel und die Materialbedarfsliste bleiben im
 * Betrieb; letztere trägt Einkaufspreise.
 */
export default async function PortalVorgangPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string; id: string }>;
  searchParams: Promise<{ bereich?: string }>;
}) {
  const { token, id } = await params;
  const session = await resolvePortal(token);
  if (!session) notFound();

  const { bereich: roh } = await searchParams;
  const bereich: PortalBereich = (
    ["fortschritt", "angebot", "dokumente", "anliegen"] as const
  ).includes(roh as PortalBereich)
    ? (roh as PortalBereich)
    : "fortschritt";

  const daten = await portalVorgangDetail(session, id);
  if (!daten) notFound();

  const {
    vorgang: v,
    schritte,
    dokumente,
    positionen,
    gruppen,
    rahmen,
    texte,
    termine,
    firma,
    ansprechpartner,
    angenommen,
    angebotVersendet,
    fassung,
  } = daten;


  /*
   * Gespräch und Rückfragen, nur die Kundensicht — interne Notizen
   * bleiben im Betrieb. Gefiltert wird in der Abfrage, nicht in der
   * Anzeige: was nicht geladen wird, kann auch nicht durchrutschen.
   */
  const chat = await chatLesen(createAdminClient(), id, { nurKundensicht: true });

  const jetzt = new Date();
  const naechster = termine.find((t) => new Date(t.bis) >= jetzt);
  const aktuell = phaseIndex(v.phase);
  const verloren = v.phase === "verloren";

  /* Angenommen wird, solange der Vorgang im Angebot steht. */
  const kannAnnehmen = v.phase === "angebot" && positionen.length > 0;

  const rechnungen = dokumente.filter(
    (d) => d.typ === "anzahlungsrechnung" || d.typ === "schlussrechnung",
  );
  const belege = dokumente.filter(
    (d) => d.typ !== "anzahlungsrechnung" && d.typ !== "schlussrechnung",
  );

  const TITEL: Record<PortalBereich, { titel: string; unter: string }> = {
    fortschritt: {
      titel: "Fortschritt",
      unter: `${v.nummer}${termine.length ? ` · seit ${date(termine[0]!.von)} in Umsetzung` : ""}`,
    },
    angebot: {
      titel: texte.titel ?? (angenommen ? "Ihr Auftrag" : "Ihr Angebot"),
      unter: [
        texte.gueltigBis ? `Gültig bis ${date(texte.gueltigBis)}` : null,
        /* Ab Fassung 2 wissenswert: es gab davor eine andere. */
        fassung && fassung > 1 ? `Fassung ${fassung}` : null,
      ]
        .filter(Boolean)
        .join(" · ") || "Ihre Anlage im Detail",
    },
    dokumente: { titel: "Dokumente", unter: "Alles zum Nachlesen und Herunterladen" },
    anliegen: { titel: "Anliegen", unter: "Schreiben Sie uns — wir antworten hier" },
  };

  return (
    <PortalShell
      token={token}
      vorgangId={v.id}
      bereich={bereich}
      firma={session.companyName}
      logoUrl={session.logoUrl}
      kundeName={session.customerName}
      nummer={v.nummer}
      adresse={[v.adresse, v.ort].filter(Boolean).join(", ") || null}
      phase={v.phase}
      ansprechpartner={ansprechpartner}
      titel={TITEL[bereich].titel}
      unter={TITEL[bereich].unter}
      nav={[
        { bereich: "fortschritt", label: "Fortschritt", icon: "berichte" },
        {
          bereich: "angebot",
          label: angenommen ? "Ihr Auftrag" : "Ihr Angebot",
          icon: "angebote",
          ...(positionen.length ? { anzahl: 1 } : {}),
        },
        {
          bereich: "dokumente",
          label: "Dokumente",
          icon: "dokumente",
          anzahl: dokumente.length,
        },
        {
          bereich: "anliegen",
          label: "Anliegen",
          icon: "chat",
          anzahl: chat.nachrichten.length + chat.anfragen.length,
        },
      ]}
    >
      <div className={kannAnnehmen && bereich === "angebot" ? "pb-[132px]" : ""}>
        <OffeneAnfragen
          token={token}
          vorgangId={v.id}
          anfragen={chat.anfragen}
        />

        {/* -------------------------------------------------- ANLAGE */}
        {bereich === "fortschritt" && v.kwp ? (
          <section className="mb-4 rounded-panel bg-surface p-6 shadow-soft sm:p-8">
            <p className="text-[11.5px] font-semibold tracking-[0.14em] text-accent-ink uppercase">
              Ihre Anlage
            </p>
            <div className="mt-3 flex flex-wrap items-end gap-x-10 gap-y-4">
              <div>
                <div className="num text-[34px] leading-none font-bold tracking-[-0.03em] text-accent-ink">
                  {num(v.kwp)} kWp
                </div>
                <div className="mt-1 text-[12px] text-muted">Leistung</div>
              </div>
              {v.speicherKwh ? (
                <div>
                  <div className="num text-[22px] leading-none font-bold tracking-[-0.02em]">
                    {num(v.speicherKwh)} kWh
                  </div>
                  <div className="mt-1 text-[12px] text-muted">Speicher</div>
                </div>
              ) : null}
            </div>
          </section>
        ) : null}

        {/* ------------------------------------------------ FORTSCHRITT */}
        {bereich === "fortschritt" ? (
        <section className="mb-4 rounded-panel bg-surface p-6 shadow-soft sm:p-8">
          <h2 className="mb-4 text-[17px] font-bold tracking-[-0.02em]">
            Wo Ihr Projekt steht
          </h2>

          {verloren ? (
            <p className="rounded-card bg-panel px-4 py-3 text-[13.5px] text-muted">
              Dieses Projekt ruht derzeit. Melden Sie sich, wenn Sie es
              wieder aufnehmen möchten.
            </p>
          ) : (
            <ol className="flex flex-col gap-2">
              {PHASEN.map((p, i) => {
                const fertig = i < aktuell;
                const ist = i === aktuell;
                return (
                  <li
                    key={p.key}
                    aria-current={ist ? "step" : undefined}
                    className={[
                      "flex items-center gap-3 rounded-card px-4 py-3",
                      ist
                        ? "bg-accent-sunk"
                        : fertig
                          ? "bg-panel"
                          : "bg-panel opacity-60",
                    ].join(" ")}
                  >
                    <span
                      aria-hidden
                      className={[
                        "num grid h-[26px] w-[26px] shrink-0 place-items-center rounded-pill text-[12px] font-bold",
                        ist
                          ? "bg-accent text-white"
                          : fertig
                            ? "bg-s-done text-white"
                            : "bg-line text-faint",
                      ].join(" ")}
                    >
                      {fertig ? "✓" : i + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span
                        className={`block text-[14px] ${ist ? "font-semibold" : "font-medium"}`}
                      >
                        {KUNDENTEXT[p.key]?.titel ?? p.label}
                      </span>
                      <span className="block text-[12px] text-muted">
                        {fertig
                          ? "erledigt"
                          : (KUNDENTEXT[p.key]?.meta ?? p.meta)}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        ) : null}

        {/* ---------------------------------------------------- TERMIN */}
        {bereich === "fortschritt" && naechster ? (
          <section className="mb-4 rounded-panel bg-surface p-6 shadow-soft sm:p-8">
            <p className="text-[11.5px] font-semibold tracking-[0.14em] text-accent-ink uppercase">
              {naechster.art === "montage" ? "Montage" : "Termin vor Ort"}
            </p>
            <p className="num mt-2 text-[21px] leading-snug font-bold tracking-[-0.02em]">
              {date(naechster.von)}
              {naechster.von.slice(0, 10) !== naechster.bis.slice(0, 10)
                ? ` – ${date(naechster.bis)}`
                : ""}
            </p>
            <p className="num mt-1 text-[13px] text-muted">
              ab {time(naechster.von)} Uhr
              {naechster.personen.length > 0
                ? ` · ${naechster.personen.join(", ")} ${
                    naechster.personen.length === 1 ? "kommt" : "kommen"
                  }`
                : ""}
            </p>
            {naechster.notiz ? (
              <p className="mt-3 rounded-card bg-panel px-4 py-3 text-[13px]">
                {naechster.notiz}
              </p>
            ) : null}

            {/*
              Die Bestätigung ist der einzige Rückkanal vor dem
              Montagetag. Verschieben geht hier bewusst nicht: das
              kollidiert mit der Einsatzplanung und der Ruhezeitprüfung.
            */}
            {naechster.bestaetigtAm ? (
              <p className="mt-4 text-[13px] font-medium text-s-done">
                Von Ihnen bestätigt am {date(naechster.bestaetigtAm)}. Danke.
              </p>
            ) : (
              <div className="mt-4">
                <ConfirmAppointmentForm
                  token={token}
                  appointmentId={naechster.id}
                />
                <p className="mt-2 text-[11.5px] text-faint">
                  Passt der Termin nicht? Schreiben Sie uns unten — wir
                  melden uns.
                </p>
              </div>
            )}
          </section>
        ) : null}

        {/* --------------------------------------------------- ANGEBOT */}
        {/*
          Kein Angebot da? Dann steht ein Satz und keine leere Fläche. Der
          Kunde soll wissen, dass nichts kaputt ist — es ist einfach noch
          nicht fertig.
        */}
        {bereich === "angebot" && positionen.length === 0 ? (
          <section className="rounded-panel bg-surface p-6 shadow-soft sm:p-8">
            <h2 className="text-[17px] font-bold tracking-[-0.02em]">
              {angebotVersendet
                ? "Hier ist noch nichts hinterlegt"
                : "Ihr Angebot wird gerade erstellt"}
            </h2>
            <p className="mt-2 text-[13.5px] text-muted">
              {angebotVersendet
                ? "Melden Sie sich gern bei uns, wenn Sie etwas vermissen."
                : "Sobald es fertig ist, bekommen Sie eine Mail und finden es hier."}
            </p>
          </section>
        ) : null}

        {bereich === "angebot" && positionen.length > 0 ? (
          <section className="mb-4">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-[21px] font-bold tracking-[-0.02em]">
                {angenommen ? "Ihr Auftrag" : "Ihr Angebot"}
              </h2>
              <a
                href={`/api/portal/${token}/pdf/${v.id}?art=${angenommen ? "ab" : "angebot"}`}
                target="_blank"
                rel="noreferrer"
                className="text-[12.5px] font-medium text-accent-ink underline"
              >
                Als PDF
              </a>
            </div>

            <AngebotAnsicht
              positionen={positionen}
              gruppen={gruppen}
              rahmen={rahmen}
              formularId="annahme-formular"
              aktionen={{ token, vorgangId: v.id, zeigen: kannAnnehmen }}
            />
          </section>
        ) : null}

        {/* ------------------------------------------------ RECHNUNGEN */}
        {bereich === "dokumente" && rechnungen.length > 0 ? (
          <section className="mb-4 rounded-panel bg-surface p-6 shadow-soft sm:p-8">
            <h2 className="mb-3 text-[17px] font-bold tracking-[-0.02em]">
              Ihre Rechnungen
            </h2>
            <ul className="flex flex-col gap-2">
              {rechnungen.map((r) => (
                <li
                  key={r.id}
                  className="flex flex-wrap items-baseline gap-2 rounded-card bg-panel px-4 py-3"
                >
                  <a
                    href={`/api/portal/${token}/pdf/${v.id}?art=${r.typ}`}
                    target="_blank"
                    rel="noreferrer"
                    className="num text-[13px] font-semibold text-accent-ink underline"
                  >
                    {r.nummer ?? r.dateiname}
                  </a>
                  <span className="text-[12px] text-muted">
                    {r.typ === "anzahlungsrechnung" ? "Anzahlung" : "Schlussrechnung"}
                  </span>
                  <span
                    className={[
                      "rounded-pill px-[9px] py-[2px] text-[11px] font-semibold",
                      r.bezahltAm
                        ? "bg-s-done/14 text-s-done"
                        : "bg-s-warn/14 text-accent-ink",
                    ].join(" ")}
                  >
                    {r.bezahltAm
                      ? `bezahlt ${date(r.bezahltAm)}`
                      : r.faelligAm
                        ? `fällig ${date(r.faelligAm)}`
                        : "offen"}
                  </span>
                  <span className="num ml-auto text-[14px] font-semibold">
                    {r.betragBrutto !== null ? eur(r.betragBrutto) : "—"}
                  </span>
                </li>
              ))}
            </ul>
            {firma?.iban ? (
              <p className="num mt-3 text-[11.5px] text-faint">
                Zahlung auf IBAN {firma.iban}, bitte die Rechnungsnummer als
                Verwendungszweck angeben.
              </p>
            ) : null}
          </section>
        ) : null}

        {/* -------------------------------------------------- DOKUMENTE */}
        {bereich === "dokumente" && belege.length > 0 ? (
          <section className="mb-4 rounded-panel bg-surface p-6 shadow-soft sm:p-8">
            <h2 className="mb-3 text-[17px] font-bold tracking-[-0.02em]">
              Unterlagen
            </h2>
            <ul className="flex flex-col gap-2">
              {belege.map((d) => (
                <li key={d.id} className="rounded-card bg-panel px-4 py-3">
                  <a
                    href={`/api/portal/${token}/pdf/${v.id}?art=${d.typ}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[13px] font-medium text-accent-ink underline"
                  >
                    {d.dateiname}
                  </a>
                  <span className="num ml-2 text-[11.5px] text-faint">
                    {date(d.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {bereich === "anliegen" ? (
          <PortalChat
            token={token}
            vorgangId={v.id}
            firmaName={firma?.name ?? "Ihr Betrieb"}
            nachrichten={chat.nachrichten}
          />
        ) : null}

        {/*
          Der Bereich "Ertrag" ist entfallen.

          Er zeigte eine Faustformel — kWp mal 1000 — als eigenen
          Menüpunkt neben Angebot und Dokumenten. Damit stand eine
          Schätzung gleichrangig neben Dingen, die verbindlich sind, und
          ein Kunde, der im ersten Winter nachrechnet, hält sie für eine
          Zusage. Kommt sie als gemessener Wert aus der Anlage zurück,
          gehört sie wieder her — vorher nicht.
        */}

        {/* ----------------------------------------------------- VERLAUF */}
        {bereich === "fortschritt" ? (
        <section className="mb-4 rounded-panel bg-surface p-6 shadow-soft sm:p-8">
          <h2 className="mb-3 text-[17px] font-bold tracking-[-0.02em]">
            Was bisher passiert ist
          </h2>
          {schritte.length === 0 ? (
            <p className="text-[13px] text-muted">
              Sobald sich etwas tut, steht es hier.
            </p>
          ) : (
            <ol className="flex flex-col gap-3">
              {schritte.map((e) => (
                <li key={e.id} className="border-l-2 border-line pl-4">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="text-[13.5px] font-semibold">{e.titel}</span>
                    <span className="num ml-auto text-[11px] text-faint">
                      {dateTime(e.createdAt)}
                    </span>
                  </div>
                  {e.body ? (
                    <p className="mt-1 text-[13px] leading-[1.55] text-muted">
                      {e.body}
                    </p>
                  ) : null}
                </li>
              ))}
            </ol>
          )}
        </section>

        ) : null}

        {bereich === "angebot" && texte.abschluss ? (
          <section className="mb-4 rounded-panel bg-surface p-6 shadow-soft sm:p-8">
            <p className="max-w-[62ch] text-[14px] leading-relaxed whitespace-pre-line">
              {texte.abschluss}
            </p>
          </section>
        ) : null}

      </div>
    </PortalShell>
  );
}

/**
 * Phasennamen in Kundensprache.
 *
 * „Beauftragt — Gates laufen" sagt einem Betrieb alles und einem Kunden
 * nichts. Er will wissen, was gerade für ihn getan wird.
 */
const KUNDENTEXT: Record<string, { titel: string; meta: string }> = {
  anfrage: { titel: "Anfrage eingegangen", meta: "Wir melden uns bei Ihnen." },
  aufnahme: {
    titel: "Aufnahme vor Ort",
    meta: "Wir sehen uns Dach, Zähler und Wege an.",
  },
  angebot: {
    titel: "Angebot",
    meta: "Ihr Angebot liegt vor und wartet auf Ihre Rückmeldung.",
  },
  beauftragt: {
    titel: "Vorbereitung",
    meta: "Material, Netzanmeldung und Förderung laufen.",
  },
  montage: { titel: "Montage", meta: "Wir bauen Ihre Anlage." },
  abschluss: {
    titel: "Abnahme und Abrechnung",
    meta: "Inbetriebnahme, Protokoll und Schlussrechnung.",
  },
};

