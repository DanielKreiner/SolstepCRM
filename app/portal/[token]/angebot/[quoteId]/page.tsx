import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { eur, num } from "@/lib/format";
import { portalQuote, resolvePortal } from "@/lib/portal/data";
import { AngebotAktionen, OptionHaken } from "./AngebotClient";

export const metadata: Metadata = { title: "Ihr Angebot" };

/*
 * Die Angebotsseite für den Kunden.
 *
 * Aufbau nach der Vorlage des Solstep-Planers: Kopfzeile mit Nummer und
 * Gültigkeit, persönliche Anrede, die Anlage in Zahlen, dann was drin ist
 * — als einzelne Produkte, als Komplettpakete mit Inhalt, als kostenlose
 * Leistungen und als optionale Erweiterungen zum Ankreuzen. Unten die
 * Investmentrechnung, die nächsten Schritte und eine feste Aktionsleiste.
 *
 * Der Betrieb entscheidet je Angebot, ob der Kunde Einzelpreise sieht oder
 * nur die Gesamtsumme (quote.price_display). Beides ist verbreitet, und
 * beides ist eine Entscheidung des Betriebs, nicht des Systems.
 */

type Position = {
  id: string;
  pos: number;
  kind: string;
  group_key: string | null;
  category: string | null;
  manufacturer: string | null;
  text: string;
  description: string | null;
  tech_specs: Record<string, unknown> | null;
  datasheet_url: string | null;
  image_url: string | null;
  qty: string;
  unit: string;
  sale_price: string;
  vat_rate: string;
  optional_selected: boolean;
};

export default async function PortalAngebotPage({
  params,
}: {
  params: Promise<{ token: string; quoteId: string }>;
}) {
  const { token, quoteId } = await params;
  const session = await resolvePortal(token);
  if (!session) notFound();

  const daten = await portalQuote(session, quoteId);
  if (!daten) notFound();

  const q = daten.quote;
  const positionen = daten.positionen as unknown as Position[];
  const kunde = q.customer as unknown as {
    name: string;
    contact_person: string | null;
    address: string | null;
    zip: string | null;
    city: string | null;
  } | null;

  const einzeln = q.price_display === "positionen";
  const angenommen = Boolean(q.accepted_at);

  const produkte = positionen.filter((p) => p.kind === "position");
  const pakete = positionen.filter((p) => p.kind === "paket");
  const inhalte = positionen.filter((p) => p.kind === "paket_inhalt");
  const optionen = positionen.filter((p) => p.kind === "option");
  const leistungen = positionen.filter((p) => p.kind === "leistung");

  /*
   * Die Summe rechnet der Server, nicht der Browser. Ein Kunde, der ein
   * Häkchen setzt, lädt die Seite neu — das ist langsamer als eine
   * Rechnung im Browser, aber es gibt nur eine Wahrheit über den Preis.
   */
  const zeilenNetto = (p: Position) => Number(p.qty) * Number(p.sale_price);

  const grundNetto = [...produkte, ...pakete].reduce(
    (s, p) => s + zeilenNetto(p),
    0,
  );
  const optionenNetto = optionen
    .filter((p) => p.optional_selected)
    .reduce((s, p) => s + zeilenNetto(p), 0);

  const netto = grundNetto + optionenNetto;
  const lieferung = Number(q.delivery_net ?? 0);

  const ust = [...produkte, ...pakete, ...optionen.filter((p) => p.optional_selected)]
    .reduce((s, p) => s + (zeilenNetto(p) * Number(p.vat_rate)) / 100, 0);

  const brutto = netto + lieferung + ust;

  const gueltigAbgelaufen =
    q.valid_until !== null &&
    (q.valid_until as string) < new Date().toISOString().slice(0, 10);

  return (
    <div className="pb-[92px]">
      {/* ---------- Kopfzeile ---------- */}
      <header className="sticky top-0 z-20 border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-[980px] flex-wrap items-center gap-3 px-4 py-3">
          <span className="flex items-center gap-[10px]">
            <span
              aria-hidden
              className="grid h-7 w-7 place-items-center rounded-[9px] bg-[linear-gradient(150deg,var(--accent-from),var(--accent-to))] text-[13px] font-bold text-white"
            >
              {daten.firma?.name?.slice(0, 1) ?? "B"}
            </span>
            <span className="text-[15px] font-bold tracking-[-0.02em]">
              {daten.firma?.name ?? ""}
            </span>
          </span>

          <span className="ml-auto flex flex-wrap items-center gap-4">
            <a
              href={`/api/pdf/quote/${q.id as string}`}
              className="rounded-pill border border-line px-[15px] py-[8px] text-[12.5px] font-medium text-ink hover:bg-sunk hover:text-ink"
            >
              PDF
            </a>
            <span className="text-right">
              <span className="num block text-[12.5px] font-semibold">
                Angebot {q.number as string}
              </span>
              <span
                className={`num block text-[11px] ${gueltigAbgelaufen ? "text-s-crit" : "text-faint"}`}
              >
                {q.valid_until
                  ? `Gültig bis ${new Date(q.valid_until as string).toLocaleDateString("de-AT")}`
                  : "ohne Frist"}
              </span>
            </span>
          </span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[980px] px-4">
        {/* ---------- Anrede ---------- */}
        <section className="py-10">
          <p className="text-[11.5px] font-semibold tracking-[0.14em] text-accent-ink uppercase">
            Angebot für {kunde?.contact_person ?? kunde?.name ?? ""}
          </p>
          <h1 className="mt-2 text-[36px] leading-[1.08] font-bold tracking-[-0.035em] sm:text-[44px]">
            Ihr persönliches Angebot
          </h1>
          <p className="mt-4 max-w-[640px] text-[14.5px] leading-relaxed text-muted">
            {(q.intro_text as string | null) ??
              "Danke für Ihr Interesse. Auf dieser Seite finden Sie Ihr individuelles Angebot — mit allem, was dazugehört."}
          </p>
        </section>

        {/* ---------- Anlage ---------- */}
        {daten.anlage ? (
          <section className="mb-6 rounded-panel bg-surface p-6 shadow-soft sm:p-8">
            <div className="flex flex-wrap items-start justify-between gap-6">
              <div>
                <h2 className="text-[21px] font-bold tracking-[-0.02em]">
                  Ihre Anlage im Detail
                </h2>
                <p className="mt-1 text-[13px] text-muted">
                  Das haben wir für Sie geplant
                </p>
              </div>
              {daten.anlage.kwp ? (
                <div className="text-right">
                  <div className="num text-[34px] leading-none font-bold tracking-[-0.03em] text-accent-ink">
                    {num(daten.anlage.kwp)} kWp
                  </div>
                  {daten.anlage.modules ? (
                    <div className="num mt-1 text-[12px] text-faint">
                      {daten.anlage.modules as string}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>

            <dl className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Kennwert
                label="Leistung"
                wert={daten.anlage.kwp ? num(daten.anlage.kwp, "kWp") : "—"}
              />
              <Kennwert
                label="Speicher"
                wert={
                  daten.anlage.storage_kwh
                    ? num(daten.anlage.storage_kwh, "kWh")
                    : "kein Speicher"
                }
              />
              <Kennwert
                label="Wechselrichter"
                wert={(daten.anlage.inverter as string | null) ?? "—"}
              />
              <Kennwert
                label="Adresse"
                wert={
                  [kunde?.address, [kunde?.zip, kunde?.city].filter(Boolean).join(" ")]
                    .filter(Boolean)
                    .join(", ") || "—"
                }
              />
            </dl>
          </section>
        ) : null}

        {/* ---------- Was Sie bekommen ---------- */}
        {produkte.length + pakete.length > 0 ? (
          <section className="mb-6">
            <h2 className="mb-1 text-[21px] font-bold tracking-[-0.02em]">
              Was Sie bekommen
            </h2>
            <p className="mb-4 text-[13px] text-muted">
              {einzeln
                ? "Alle Positionen mit Einzelpreisen."
                : "Alle Positionen. Der Preis gilt für das Gesamtpaket."}
            </p>

            <div className="flex flex-col gap-3">
              {produkte.map((p) => (
                <Produktkarte key={p.id} position={p} preisZeigen={einzeln} />
              ))}

              {pakete.map((paket) => (
                <Paketkarte
                  key={paket.id}
                  paket={paket}
                  inhalt={inhalte.filter(
                    (i) => i.group_key !== null && i.group_key === paket.group_key,
                  )}
                  preisZeigen={einzeln}
                />
              ))}
            </div>
          </section>
        ) : null}

        {/* ---------- Inklusive ---------- */}
        {leistungen.length > 0 ? (
          <section className="mb-6 rounded-panel bg-surface p-6 shadow-soft sm:p-8">
            <h2 className="text-[21px] font-bold tracking-[-0.02em]">
              Bei uns inklusive
            </h2>
            <p className="mt-1 mb-5 text-[13px] text-muted">
              Diese Leistungen sind im Angebot enthalten — ohne Aufpreis.
            </p>

            <div className="grid gap-3 sm:grid-cols-2">
              {leistungen.map((l) => (
                <div key={l.id} className="rounded-card bg-panel p-4">
                  <div className="mb-1 flex items-start justify-between gap-3">
                    <span className="text-[14px] font-semibold">{l.text}</span>
                    <span className="shrink-0 rounded-pill bg-s-done/12 px-[9px] py-[3px] text-[10px] font-semibold tracking-[0.08em] text-s-done uppercase">
                      inklusive
                    </span>
                  </div>
                  {l.description ? (
                    <p className="text-[12.5px] leading-relaxed text-muted">
                      {l.description}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {/* ---------- Optionale Erweiterungen ---------- */}
        {optionen.length > 0 ? (
          <section className="mb-6 rounded-panel bg-surface p-6 shadow-soft sm:p-8">
            <h2 className="text-[21px] font-bold tracking-[-0.02em]">
              Optionale Erweiterungen
            </h2>
            <p className="mt-1 mb-5 text-[13px] text-muted">
              {angenommen
                ? "Das Angebot ist angenommen — die Auswahl steht fest."
                : "Häkchen setzen, wenn Sie es dazubuchen wollen. Der Gesamtpreis aktualisiert sich."}
            </p>

            <ul className="flex flex-col gap-3">
              {optionen.map((o) => (
                <li key={o.id}>
                  <OptionHaken
                    token={token}
                    itemId={o.id}
                    gewaehlt={o.optional_selected}
                    gesperrt={angenommen}
                    titel={o.text}
                    hersteller={o.manufacturer}
                    beschreibung={o.description}
                    preis={eur(zeilenNetto(o))}
                    menge={num(o.qty, o.unit)}
                  />
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {/* ---------- Investment ---------- */}
        <section className="mb-6 rounded-panel bg-surface p-6 shadow-soft sm:p-8">
          <p className="text-[11.5px] font-semibold tracking-[0.14em] text-accent-ink uppercase">
            Ihr Investment
          </p>

          <dl className="mt-4 flex flex-col gap-[10px]">
            {einzeln ? (
              <Summenzeile label="Positionen netto" wert={eur(grundNetto)} />
            ) : (
              <Summenzeile label="Leistungsumfang netto" wert={eur(grundNetto)} />
            )}

            {optionenNetto > 0 ? (
              <Summenzeile
                label="Gewählte Erweiterungen"
                wert={eur(optionenNetto)}
              />
            ) : null}

            {lieferung > 0 ? (
              <Summenzeile label="Lieferung" wert={eur(lieferung)} />
            ) : null}

            <Summenzeile label="Netto" wert={eur(netto + lieferung)} />
            <Summenzeile label="Umsatzsteuer" wert={eur(ust)} leise />

            <div className="mt-2 flex items-baseline justify-between border-t border-line pt-4">
              <dt className="text-[16px] font-bold">Gesamt brutto</dt>
              <dd className="num text-[26px] font-bold tracking-[-0.03em]">
                {eur(brutto)}
              </dd>
            </div>
          </dl>
        </section>

        {/* ---------- Nächste Schritte ---------- */}
        <section className="mb-6">
          <h2 className="mb-4 text-[21px] font-bold tracking-[-0.02em]">
            Nächste Schritte
          </h2>
          <ol className="grid gap-3 sm:grid-cols-3">
            {[
              ["Annehmen", "Sie bestätigen mit Ihrem Namen — rechtsverbindlich."],
              ["Wir planen", "Wir fixieren den Termin und bestellen das Material."],
              ["Wir bauen", "Montage, Anschluss, Netzanmeldung und Inbetriebnahme."],
            ].map(([titel, text], i) => (
              <li key={titel} className="rounded-card bg-surface p-5 shadow-soft">
                <span className="num grid h-7 w-7 place-items-center rounded-pill bg-accent text-[12px] font-bold text-white">
                  {i + 1}
                </span>
                <h3 className="mt-3 text-[14.5px] font-semibold">{titel}</h3>
                <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
                  {text}
                </p>
              </li>
            ))}
          </ol>
        </section>

        <p className="pb-6 text-center text-[11.5px] text-faint">
          Fragen? Melden Sie sich bei uns — über{" "}
          <Link href={`/portal/${token}`}>Anliegen im Portal</Link> oder direkt.
        </p>
      </main>

      {/* ---------- Feste Aktionsleiste ---------- */}
      <AngebotAktionen
        token={token}
        quoteId={q.id as string}
        gesamt={eur(brutto)}
        angenommen={angenommen}
        angenommenVon={(q.accepted_name as string | null) ?? null}
        abgelaufen={gueltigAbgelaufen}
      />
    </div>
  );
}

function Kennwert({ label, wert }: { label: string; wert: string }) {
  return (
    <div className="rounded-card bg-panel px-4 py-3">
      <dt className="text-[11.5px] text-muted">{label}</dt>
      <dd className="num mt-[2px] text-[14px] font-semibold">{wert}</dd>
    </div>
  );
}

function Summenzeile({
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

/** Einzelnes Produkt mit Kategorie, Hersteller, Beschreibung und Technik. */
function Produktkarte({
  position,
  preisZeigen,
}: {
  position: Position;
  preisZeigen: boolean;
}) {
  return (
    <article className="rounded-panel bg-surface p-6 shadow-soft">
      <div className="flex flex-wrap items-start gap-4">
        {position.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={position.image_url}
            alt=""
            className="h-[68px] w-[68px] shrink-0 rounded-card bg-panel object-contain"
          />
        ) : null}

        <div className="min-w-0 flex-1">
          {position.category ? (
            <span className="text-[10px] font-semibold tracking-[0.1em] text-accent-ink uppercase">
              {position.category}
            </span>
          ) : null}
          <h3 className="mt-[3px] text-[17px] leading-snug font-semibold tracking-[-0.015em]">
            {position.text}
          </h3>
          {position.manufacturer ? (
            <p className="text-[12.5px] text-muted">{position.manufacturer}</p>
          ) : null}
        </div>

        <div className="text-right">
          <div className="num text-[12px] text-muted">
            {num(position.qty, position.unit)}
            {preisZeigen ? ` × ${eur(position.sale_price)}` : ""}
          </div>
          {preisZeigen ? (
            <div className="num mt-[2px] text-[17px] font-semibold">
              {eur(Number(position.qty) * Number(position.sale_price))}
            </div>
          ) : null}
        </div>
      </div>

      {position.description ? (
        <p className="mt-4 text-[13px] leading-relaxed text-muted">
          {position.description}
        </p>
      ) : null}

      <Technikdaten
        specs={position.tech_specs}
        datenblatt={position.datasheet_url}
      />
    </article>
  );
}

/** Komplettpaket: ein Preis, darunter was drin ist. */
function Paketkarte({
  paket,
  inhalt,
  preisZeigen,
}: {
  paket: Position;
  inhalt: Position[];
  preisZeigen: boolean;
}) {
  return (
    <article className="rounded-panel bg-surface p-6 shadow-soft">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <span className="text-[10px] font-semibold tracking-[0.1em] text-accent-ink uppercase">
            Komplettpaket
          </span>
          <h3 className="mt-[3px] text-[19px] leading-snug font-bold tracking-[-0.02em]">
            {paket.text}
          </h3>
          {paket.description ? (
            <p className="mt-2 max-w-[560px] text-[13px] leading-relaxed text-muted">
              {paket.description}
            </p>
          ) : null}
        </div>

        {preisZeigen ? (
          <div className="text-right">
            <div className="text-[10px] font-semibold tracking-[0.1em] text-faint uppercase">
              Paketpreis
            </div>
            <div className="num text-[21px] font-bold tracking-[-0.02em]">
              {eur(Number(paket.qty) * Number(paket.sale_price))}
            </div>
            <div className="text-[11px] text-faint">netto</div>
          </div>
        ) : null}
      </div>

      {inhalt.length > 0 ? (
        <>
          <p className="mt-6 mb-3 text-[10px] font-semibold tracking-[0.1em] text-faint uppercase">
            Enthalten im Paket
          </p>
          <ul className="flex flex-col gap-2">
            {inhalt.map((i) => (
              <li
                key={i.id}
                className="flex flex-wrap items-center gap-3 rounded-card bg-panel px-4 py-3"
              >
                <span className="min-w-0 flex-1">
                  {i.category ? (
                    <span className="block text-[9.5px] font-semibold tracking-[0.1em] text-faint uppercase">
                      {i.category}
                    </span>
                  ) : null}
                  <span className="block truncate text-[13.5px] font-medium">
                    {i.text}
                  </span>
                  {i.manufacturer ? (
                    <span className="block text-[11.5px] text-faint">
                      {i.manufacturer}
                    </span>
                  ) : null}
                </span>
                <span className="num text-[12px] text-muted">
                  {num(i.qty, i.unit)}
                </span>
                <span className="rounded-pill bg-sunk px-[9px] py-[3px] text-[10.5px] text-muted">
                  im Paket
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </article>
  );
}

/**
 * Technische Daten als Aufklapper.
 *
 * <details> statt eines Client-Umschalters: das Aufklappen braucht kein
 * Javascript, funktioniert im Ausdruck und ist von Haus aus zugänglich.
 */
function Technikdaten({
  specs,
  datenblatt,
}: {
  specs: Record<string, unknown> | null;
  datenblatt: string | null;
}) {
  const eintraege = specs
    ? Object.entries(specs).filter(([, v]) => v !== null && v !== "")
    : [];

  if (eintraege.length === 0 && !datenblatt) return null;

  return (
    <details className="group mt-4 border-t border-line pt-3">
      <summary className="cursor-pointer list-none text-[12.5px] font-medium text-accent-ink">
        Technische Daten
        {datenblatt ? " und Datenblatt" : ""} anzeigen
      </summary>

      {eintraege.length > 0 ? (
        <dl className="mt-3 grid gap-x-6 gap-y-[6px] sm:grid-cols-2">
          {eintraege.slice(0, 24).map(([k, v]) => (
            <div
              key={k}
              className="flex justify-between gap-3 border-b border-line py-[5px] text-[12.5px]"
            >
              <dt className="text-muted">{k}</dt>
              <dd className="num text-right">{String(v)}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {datenblatt ? (
        <a
          href={datenblatt}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-block text-[12.5px] font-medium"
        >
          Datenblatt öffnen
        </a>
      ) : null}
    </details>
  );
}
