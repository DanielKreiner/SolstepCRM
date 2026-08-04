"use client";

import { useMemo, useState } from "react";
import { eur, num } from "@/lib/format";
import { berechne, type PreisGruppe, type PreisPosition } from "@/lib/vorgang/preis";
import type { PortalGruppe, PortalPosition } from "@/lib/portal/vorgang";
import { AngebotAktionen } from "./VorgangClient";

/**
 * Das Angebot, wie der Kunde es sieht.
 *
 * Nicht als Tabelle mit zwanzig Zeilen, sondern als das, worüber er
 * entscheidet: ein Paket mit einem Preis, darin die Teile mit Bild und
 * Beschreibung. Bei zwanzig Modulklemmen zu 3,10 € diskutiert man sonst
 * über Kleinteile statt über die Anlage.
 *
 * Optionale Erweiterungen kreuzt er an, und die Summe rechnet sofort
 * mit — nicht erst nach dem Absenden. Wer erst beim Bestätigen erfährt,
 * was es kostet, klickt nicht auf Bestätigen.
 *
 * Die Auswahl steht als verstecktes Feld im Annahmeformular: die Seite
 * rechnet nur vor, entschieden wird serverseitig noch einmal.
 */
export function AngebotAnsicht({
  positionen,
  gruppen,
  rahmen,
  formularId,
  aktionen,
}: {
  positionen: PortalPosition[];
  gruppen: PortalGruppe[];
  rahmen: { ustSatz: number; rabattProzent: number; lieferungNetto: number };
  /* In dieses Formular werden die Häkchen gespiegelt. */
  formularId: string;
  /*
   * Die Zusageleiste gehört hierher und nicht daneben: sie zeigt den
   * Gesamtpreis, und der ändert sich mit jedem Häkchen. Zwei Stellen mit
   * zwei Rechnungen hiessen zwei verschiedene Zahlen auf einer Seite —
   * und der Kunde glaubt der grösseren.
   */
  aktionen: { token: string; vorgangId: string; zeigen: boolean } | null;
}) {
  const [gewaehlt, setGewaehlt] = useState<Record<string, boolean>>({});
  const [upgrades, setUpgrades] = useState<Record<string, boolean>>({});
  const [offen, setOffen] = useState<string | null>(null);

  const preis = useMemo(() => {
    const p: PreisPosition[] = positionen.map((x) => ({
      id: x.id,
      gruppeId: x.gruppeId,
      menge: x.menge,
      epNetto: x.epNetto,
      rabattProzent: x.rabattProzent,
      optional: x.optional,
      gewaehlt: gewaehlt[x.id] === true,
    }));
    const g: PreisGruppe[] = gruppen.map((x) => ({
      id: x.id,
      paketPreis: x.paketPreis,
    }));
    return berechne(p, g, rahmen);
  }, [positionen, gruppen, rahmen, gewaehlt]);

  /*
   * Upgrades kommen brutto oben drauf. Sie ändern die Position nicht —
   * das passiert erst serverseitig bei der Annahme, damit die Zahl im
   * Angebot und die im Auftrag dieselbe Herkunft haben.
   */
  const upgradeAufpreis = positionen
    .filter((p) => upgrades[p.id] && p.upgradeAufpreis !== null)
    .reduce((s, p) => s + (p.upgradeAufpreis ?? 0), 0);

  const gesamt = Math.round((preis.gesamt + upgradeAufpreis) * 100) / 100;

  const optionale = positionen.filter((p) => p.optional);
  const freie = positionen.filter(
    (p) => !p.optional && (!p.gruppeId || !gruppen.some((g) => g.id === p.gruppeId)),
  );

  return (
    <>
      {/* Die Auswahl reist als verstecktes Feld mit dem Annahmeformular. */}
      <input
        type="hidden"
        form={formularId}
        name="gewaehlteOptionen"
        value={Object.entries(gewaehlt)
          .filter(([, an]) => an)
          .map(([id]) => id)
          .join(",")}
      />
      <input
        type="hidden"
        form={formularId}
        name="gewaehlteUpgrades"
        value={Object.entries(upgrades)
          .filter(([, an]) => an)
          .map(([id]) => id)
          .join(",")}
      />

      <section className="mb-4 rounded-panel bg-surface p-6 shadow-soft sm:p-8">
        <h2 className="text-[19px] font-bold tracking-[-0.02em]">
          Was du bekommst
        </h2>
        <p className="mt-1 mb-5 text-[13px] text-muted">
          Klick auf ein Produkt für Details.
        </p>

        {gruppen.map((g) => {
          const drin = positionen.filter(
            (p) => p.gruppeId === g.id && !p.optional,
          );
          const optionenDrin = positionen.filter(
            (p) => p.gruppeId === g.id && p.optional,
          );
          const summe =
            g.paketPreis !== null
              ? g.paketPreis
              : drin.reduce(
                  (s, p) =>
                    s + p.menge * p.epNetto * (1 - p.rabattProzent / 100),
                  0,
                );

          return (
            <div key={g.id} className="mb-5 rounded-card border border-line">
              <div className="flex flex-wrap items-start gap-3 border-b border-line p-5">
                <div className="min-w-0 flex-1">
                  <p className="text-[10.5px] font-semibold tracking-[0.12em] text-accent-ink uppercase">
                    Komplettpaket
                  </p>
                  <h3 className="mt-1 text-[19px] leading-snug font-bold tracking-[-0.02em]">
                    {g.name}
                  </h3>
                  {g.beschreibung ? (
                    <p className="mt-2 text-[13px] leading-relaxed text-muted">
                      {g.beschreibung}
                    </p>
                  ) : null}
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-[10.5px] font-semibold tracking-[0.1em] text-faint uppercase">
                    Paketpreis
                  </p>
                  <p className="num text-[21px] font-bold tracking-[-0.02em]">
                    {eur(summe)}
                  </p>
                  <p className="text-[11px] text-faint">netto</p>
                </div>
              </div>

              <p className="px-5 pt-4 text-[10.5px] font-semibold tracking-[0.1em] text-faint uppercase">
                Enthalten im Paket
              </p>
              <ul className="flex flex-col gap-1 p-3">
                {drin.map((p) => (
                  <Produkt
                    key={p.id}
                    position={p}
                    preisZeigen={!g.einzelpreiseVerstecken}
                    offen={offen === p.id}
                    umschalten={() => setOffen(offen === p.id ? null : p.id)}
                    upgradeAn={upgrades[p.id] === true}
                    upgradeUmschalten={() =>
                      setUpgrades((u) => ({ ...u, [p.id]: !u[p.id] }))
                    }
                  />
                ))}
              </ul>

              {optionenDrin.length > 0 ? (
                <div className="border-t border-line px-3 pt-3 pb-4">
                  <p className="px-2 text-[10.5px] font-semibold tracking-[0.1em] text-accent-ink uppercase">
                    Optionale Erweiterungen für dieses Paket
                  </p>
                  <p className="px-2 pt-1 pb-2 text-[12px] text-muted">
                    Häkchen setzen, wenn du es dazubuchen willst — dein
                    Gesamtpreis aktualisiert sich sofort.
                  </p>
                  <ul className="flex flex-col gap-1">
                    {optionenDrin.map((p) => (
                      <Option
                        key={p.id}
                        position={p}
                        an={gewaehlt[p.id] === true}
                        umschalten={() =>
                          setGewaehlt((g2) => ({ ...g2, [p.id]: !g2[p.id] }))
                        }
                        ustSatz={rahmen.ustSatz}
                      />
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          );
        })}

        {freie.length > 0 ? (
          <ul className="flex flex-col gap-1">
            {freie.map((p) => (
              <Produkt
                key={p.id}
                position={p}
                preisZeigen
                offen={offen === p.id}
                umschalten={() => setOffen(offen === p.id ? null : p.id)}
                upgradeAn={upgrades[p.id] === true}
                upgradeUmschalten={() =>
                  setUpgrades((u) => ({ ...u, [p.id]: !u[p.id] }))
                }
              />
            ))}
          </ul>
        ) : null}
      </section>

      {/* --------------------------------------- OPTIONEN OHNE GRUPPE */}
      {optionale.filter((p) => !p.gruppeId).length > 0 ? (
        <section className="mb-4 rounded-panel bg-surface p-6 shadow-soft sm:p-8">
          <h2 className="text-[17px] font-bold tracking-[-0.02em]">
            Optionale Erweiterungen
          </h2>
          <p className="mt-1 mb-4 text-[13px] text-muted">
            Häkchen setzen, wenn du es dazubuchen willst — dein Gesamtpreis
            aktualisiert sich sofort.
          </p>
          <ul className="flex flex-col gap-2">
            {optionale
              .filter((p) => !p.gruppeId)
              .map((p) => (
                <Option
                  key={p.id}
                  position={p}
                  an={gewaehlt[p.id] === true}
                  umschalten={() =>
                    setGewaehlt((g2) => ({ ...g2, [p.id]: !g2[p.id] }))
                  }
                  ustSatz={rahmen.ustSatz}
                />
              ))}
          </ul>
        </section>
      ) : null}

      {/* ------------------------------------------------- INVESTMENT */}
      <section className="mb-4 rounded-panel bg-surface p-6 shadow-soft sm:p-8">
        <p className="mb-4 text-[10.5px] font-semibold tracking-[0.12em] text-accent-ink uppercase">
          Dein Investment
        </p>
        <dl className="flex flex-col gap-[9px] text-[13.5px]">
          <Zeile label="Positionen netto" wert={eur(preis.positionenNetto)} />
          {preis.gesamtRabatt > 0 ? (
            <Zeile
              label={`Rabatt ${num(rahmen.rabattProzent)} %`}
              wert={`− ${eur(preis.gesamtRabatt)}`}
            />
          ) : null}
          <Zeile label="Netto" wert={eur(preis.netto)} />
          <Zeile
            label={`+ MwSt ${num(rahmen.ustSatz)} %`}
            wert={eur(preis.ust)}
          />
          {preis.lieferungNetto > 0 ? (
            <Zeile
              label="Lieferung (inkl. MwSt)"
              wert={eur(preis.lieferungBrutto)}
            />
          ) : null}
          {upgradeAufpreis > 0 ? (
            <Zeile label="Gewählte Upgrades" wert={`+ ${eur(upgradeAufpreis)}`} />
          ) : null}

          <div className="mt-2 flex flex-wrap items-baseline justify-between gap-3 border-t border-line pt-4">
            <dt className="text-[17px] font-bold tracking-[-0.02em]">
              Gesamt (brutto)
            </dt>
            <dd className="num text-[23px] font-bold tracking-[-0.02em] text-accent-ink">
              {eur(gesamt)}
            </dd>
          </div>
        </dl>
      </section>

      {aktionen?.zeigen ? (
        <AngebotAktionen
          token={aktionen.token}
          vorgangId={aktionen.vorgangId}
          gesamt={eur(gesamt)}
        />
      ) : null}
    </>
  );
}

/* ---------------------------------------------------------- PRODUKT */

function Produkt({
  position,
  preisZeigen,
  offen,
  umschalten,
  upgradeAn,
  upgradeUmschalten,
}: {
  position: PortalPosition;
  preisZeigen: boolean;
  offen: boolean;
  umschalten: () => void;
  upgradeAn: boolean;
  upgradeUmschalten: () => void;
}) {
  const p = position;
  const hatDetails = Boolean(p.beschreibung || p.techSpecs?.length || p.datenblattUrl);

  return (
    <li className="rounded-card">
      <button
        type="button"
        onClick={hatDetails ? umschalten : undefined}
        aria-expanded={hatDetails ? offen : undefined}
        className={[
          "flex w-full items-center gap-3 border-0 bg-transparent p-2 text-left",
          hatDetails ? "cursor-pointer hover:bg-panel" : "cursor-default",
          "rounded-card",
        ].join(" ")}
      >
        {p.bildUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={p.bildUrl}
            alt=""
            loading="lazy"
            className="h-[46px] w-[46px] shrink-0 rounded-[10px] bg-panel object-contain"
          />
        ) : (
          <span className="h-[46px] w-[46px] shrink-0 rounded-[10px] bg-panel" />
        )}

        <span className="min-w-0 flex-1">
          {p.kategorie ? (
            <span className="block text-[10px] font-semibold tracking-[0.1em] text-faint uppercase">
              {p.kategorie}
            </span>
          ) : null}
          <span className="block text-[14px] leading-snug font-semibold">
            {p.bezeichnung}
          </span>
          <span className="block text-[12px] text-muted">
            {p.hersteller ? `${p.hersteller} · ` : ""}
            <span className="num">
              {num(p.menge)} {p.einheit}
            </span>
          </span>
        </span>

        <span className="num shrink-0 text-right text-[12.5px] text-muted">
          {preisZeigen
            ? eur(p.menge * p.epNetto * (1 - p.rabattProzent / 100))
            : "inkl. im Paket"}
        </span>
      </button>

      {offen && hatDetails ? (
        <div className="px-3 pb-3">
          {p.beschreibung ? (
            <p className="text-[12.5px] leading-relaxed text-muted">
              {p.beschreibung}
            </p>
          ) : null}

          {p.techSpecs?.length ? (
            <dl className="mt-3 grid gap-x-6 gap-y-1 sm:grid-cols-2">
              {p.techSpecs.slice(0, 12).map((t, i) => (
                <div key={i} className="flex justify-between gap-3 text-[12px]">
                  <dt className="text-faint">{t.key}</dt>
                  <dd className="num text-right">
                    {t.value}
                    {t.unit ? ` ${t.unit}` : ""}
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}

          {p.datenblattUrl ? (
            <a
              href={p.datenblattUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-block text-[12px] font-medium text-accent-ink underline"
            >
              Datenblatt öffnen
            </a>
          ) : null}
        </div>
      ) : null}

      {/*
        Das Upgrade steht direkt an der Position, die es ersetzt — nicht
        am Ende der Seite. Wer über die Batterie liest, entscheidet dort,
        ob es die grössere sein soll.
      */}
      {p.upgradeAufpreis !== null ? (
        <label
          className={[
            "mx-2 mb-2 flex cursor-pointer flex-wrap items-center gap-2 rounded-card px-3 py-2 text-[12.5px]",
            upgradeAn ? "bg-accent-sunk" : "bg-panel",
          ].join(" ")}
        >
          <input
            type="checkbox"
            checked={upgradeAn}
            onChange={upgradeUmschalten}
            className="h-4 w-4 accent-[var(--accent)]"
          />
          <span className="min-w-0 flex-1">
            {p.upgradeText ??
              (p.upgradeName ? `Upgrade auf ${p.upgradeName}` : "Upgrade")}
          </span>
          <span className="num font-semibold text-accent-ink">
            + {eur(p.upgradeAufpreis)}
          </span>
        </label>
      ) : null}
    </li>
  );
}

/* ----------------------------------------------------------- OPTION */

function Option({
  position,
  an,
  umschalten,
  ustSatz,
}: {
  position: PortalPosition;
  an: boolean;
  umschalten: () => void;
  ustSatz: number;
}) {
  const p = position;
  const netto = p.menge * p.epNetto * (1 - p.rabattProzent / 100);
  const brutto = netto * (1 + ustSatz / 100);

  return (
    <li>
      <label
        className={[
          "flex cursor-pointer flex-wrap items-start gap-3 rounded-card border p-3 transition-colors",
          an ? "border-accent bg-accent-sunk" : "border-line bg-surface",
        ].join(" ")}
      >
        <input
          type="checkbox"
          checked={an}
          onChange={umschalten}
          className="mt-1 h-[18px] w-[18px] shrink-0 accent-[var(--accent)]"
        />

        {p.bildUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={p.bildUrl}
            alt=""
            loading="lazy"
            className="h-[46px] w-[46px] shrink-0 rounded-[10px] bg-panel object-contain"
          />
        ) : null}

        <span className="min-w-0 flex-1">
          <span className="block text-[14px] leading-snug font-semibold">
            {p.bezeichnung}
          </span>
          {p.hersteller ? (
            <span className="block text-[11.5px] text-faint">{p.hersteller}</span>
          ) : null}
          {p.beschreibung ? (
            <span className="mt-1 block text-[12.5px] leading-relaxed text-muted">
              {p.beschreibung}
            </span>
          ) : null}
          <span className="num mt-1 block text-[11.5px] text-faint">
            {num(p.menge)} {p.einheit}
          </span>
        </span>

        <span className="shrink-0 text-right">
          <span className="block text-[10px] font-semibold tracking-[0.08em] text-faint uppercase">
            + falls gewählt
          </span>
          <span className="num block text-[15px] font-bold">{eur(brutto)}</span>
          <span className="block text-[10.5px] text-faint">brutto</span>
        </span>
      </label>
    </li>
  );
}

function Zeile({ label, wert }: { label: string; wert: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="num font-medium">{wert}</dd>
    </div>
  );
}
