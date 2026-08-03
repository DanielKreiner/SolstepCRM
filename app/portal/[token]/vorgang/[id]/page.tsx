import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { date, dateTime, eur, num, time } from "@/lib/format";
import { resolvePortal } from "@/lib/portal/data";
import { portalVorgangDetail } from "@/lib/portal/vorgang";
import { PHASEN, phaseIndex, summen } from "@/lib/vorgang/modell";
import { AngebotAktionen, PositionListe } from "./VorgangClient";

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
}: {
  params: Promise<{ token: string; id: string }>;
}) {
  const { token, id } = await params;
  const session = await resolvePortal(token);
  if (!session) notFound();

  const daten = await portalVorgangDetail(session, id);
  if (!daten) notFound();

  const { vorgang: v, schritte, dokumente, positionen, termine, firma, angenommen } =
    daten;

  const s = summen(
    positionen.map((p) => ({
      menge: p.menge,
      epNetto: p.epNetto,
      ustSatz: p.ustSatz,
      kalkStunden: null,
      kalkEk: null,
      istMaterial: true,
    })),
  );

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

  return (
    <div className={kannAnnehmen ? "pb-[132px]" : ""}>
      <main className="mx-auto w-full max-w-[860px] px-4 py-8">
        {/* ------------------------------------------------------ KOPF */}
        <header className="mb-5">
          <Link
            href={`/portal/${token}`}
            className="text-[12.5px] text-muted hover:text-ink"
          >
            ‹ Übersicht
          </Link>
          <p className="mt-3 text-[13px] text-muted">{firma?.name}</p>
          <h1 className="text-[30px] leading-tight font-bold tracking-[-0.03em]">
            Ihre Photovoltaikanlage
          </h1>
          <p className="num mt-1 text-[13px] text-muted">
            {v.nummer}
            {[v.adresse, v.ort].filter(Boolean).length > 0
              ? ` · ${[v.adresse, v.ort].filter(Boolean).join(", ")}`
              : ""}
          </p>
        </header>

        {/* -------------------------------------------------- ANLAGE */}
        {v.kwp ? (
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

        {/* ---------------------------------------------------- TERMIN */}
        {naechster ? (
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
          </section>
        ) : null}

        {/* --------------------------------------------------- ANGEBOT */}
        {positionen.length > 0 ? (
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

            <PositionListe positionen={positionen} />

            <div className="mt-3 rounded-panel bg-surface p-6 shadow-soft sm:p-8">
              <p className="text-[11.5px] font-semibold tracking-[0.14em] text-accent-ink uppercase">
                {angenommen ? "Auftragssumme" : "Ihr Investment"}
              </p>
              <dl className="mt-4 flex flex-col gap-[10px]">
                <Zeile label="Netto" wert={eur(s.netto)} />
                <Zeile label="Umsatzsteuer" wert={eur(s.ust)} leise />
                <div className="mt-2 flex items-baseline justify-between border-t border-line pt-4">
                  <dt className="text-[16px] font-bold">Gesamt brutto</dt>
                  <dd className="num text-[26px] font-bold tracking-[-0.03em]">
                    {eur(s.brutto)}
                  </dd>
                </div>
              </dl>
            </div>
          </section>
        ) : null}

        {/* ------------------------------------------------ RECHNUNGEN */}
        {rechnungen.length > 0 ? (
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
        {belege.length > 0 ? (
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

        {/* ----------------------------------------------------- VERLAUF */}
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

        <p className="pb-6 text-center text-[11.5px] text-faint">
          Fragen? Melden Sie sich über{" "}
          <Link href={`/portal/${token}#anliegen`}>Anliegen im Portal</Link>.
        </p>
      </main>

      {kannAnnehmen ? (
        <AngebotAktionen
          token={token}
          vorgangId={v.id}
          gesamt={eur(s.brutto)}
        />
      ) : null}
    </div>
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

function Zeile({
  label,
  wert,
  leise = false,
}: {
  label: string;
  wert: string;
  leise?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className={leise ? "text-[13px] text-muted" : "text-[13.5px]"}>
        {label}
      </dt>
      <dd
        className={`num ${leise ? "text-[13px] text-muted" : "text-[14px] font-medium"}`}
      >
        {wert}
      </dd>
    </div>
  );
}
