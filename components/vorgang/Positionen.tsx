"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { LEER, Meldung, type AktionsStatus } from "@/components/ui/Formular";
import { Suchauswahl, type Option } from "@/components/ui/Suchauswahl";
import { eur, num } from "@/lib/format";
import { berechne, type PreisGruppe, type PreisPosition } from "@/lib/vorgang/preis";
import {
  angebotskopfSpeichern,
  gruppeAendern,
  gruppeAnlegen,
  gruppeAufloesen,
  positionAendern,
  positionAusArtikel,
  positionFrei,
  positionLoeschen,
  positionZuordnen,
} from "@/app/(app)/vorgaenge/positionen-actions";

export type GruppeAnzeige = {
  id: string;
  name: string;
  beschreibung: string | null;
  sort: number;
  paketPreis: number | null;
  einzelpreiseVerstecken: boolean;
};

export type PositionAnzeige = {
  id: string;
  sort: number;
  gruppeId: string | null;
  optional: boolean;
  rabattProzent: number;
  bezeichnung: string;
  menge: number;
  einheit: string;
  epNetto: number;
  ustSatz: number;
  kalkStunden: number | null;
  kalkEk: number | null;
  istMaterial: boolean;
  bildUrl: string | null;
};

/**
 * Der Angebotseditor — im Vorgang, nicht daneben.
 *
 * Positionen zusammenstellen, Summen live, Kalkulation sichtbar. Wer ein
 * Angebot baut, wechselt dabei nicht die Seite: der Kunde ist am Telefon
 * und fragt, was die Wallbox extra kostet.
 */
export function Positionen({
  vorgangId,
  positionen,
  gruppen,
  rahmen,
  artikel,
  gesperrt,
  gesperrtGrund,
}: {
  vorgangId: string;
  positionen: PositionAnzeige[];
  gruppen: GruppeAnzeige[];
  rahmen: { ustSatz: number; rabattProzent: number; lieferungNetto: number };
  artikel: Option[];
  gesperrt: boolean;
  gesperrtGrund: string | null;
}) {
  const preisPositionen: PreisPosition[] = positionen.map((p) => ({
    id: p.id,
    gruppeId: p.gruppeId,
    menge: p.menge,
    epNetto: p.epNetto,
    rabattProzent: p.rabattProzent,
    optional: p.optional,
    kalkEk: p.kalkEk,
  }));
  const preisGruppen: PreisGruppe[] = gruppen.map((g) => ({
    id: g.id,
    paketPreis: g.paketPreis,
  }));
  const preis = berechne(preisPositionen, preisGruppen, rahmen);

  const gruppenWahl = [
    { wert: "", text: "— ohne Gruppe —" },
    ...gruppen.map((g) => ({ wert: g.id, text: g.name })),
  ];
  const frei = positionen.filter(
    (p) => !p.gruppeId || !gruppen.some((g) => g.id === p.gruppeId),
  );

  return (
    <section className="rounded-[20px] bg-surface p-5 shadow-soft">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[15px] font-semibold">Angebotspositionen</h2>
        <span className="num text-[11.5px] text-faint">
          {positionen.length} {positionen.length === 1 ? "Position" : "Positionen"}
        </span>
      </div>

      {gesperrt ? (
        <p className="mb-4 rounded-input bg-panel px-4 py-3 text-[12.5px] text-muted">
          {gesperrtGrund}
        </p>
      ) : null}

      {positionen.length === 0 && gruppen.length === 0 ? (
        <p className="rounded-input bg-panel px-4 py-6 text-center text-[13px] text-muted">
          Noch nichts drin. Artikel suchen oder eine freie Position anlegen —
          für Montage, Anfahrt, Gerüst.
        </p>
      ) : null}

      {/* --------------------------------------------------- GRUPPEN */}
      {gruppen.map((g) => {
        const drin = positionen.filter((p) => p.gruppeId === g.id);
        const summe = preis.positionenNetto;
        void summe;
        return (
          <GruppenBlock
            key={g.id}
            vorgangId={vorgangId}
            gruppe={g}
            positionen={drin}
            gruppenWahl={gruppenWahl}
            gesperrt={gesperrt}
            netto={berechne(
              preisPositionen,
              [{ id: g.id, paketPreis: g.paketPreis }],
              { ...rahmen, rabattProzent: 0, lieferungNetto: 0 },
            ).positionenNetto}
          />
        );
      })}

      {/* --------------------------------------- FREIE EINZELPOSITIONEN */}
      {frei.length > 0 ? (
        <div className="mt-3">
          {gruppen.length > 0 ? (
            <p className="mb-2 text-[11px] font-semibold tracking-[0.1em] text-faint uppercase">
              Einzelpositionen
            </p>
          ) : null}
          <ul className="flex flex-col gap-2">
            {frei.map((p, i) => (
              <Zeile
                key={p.id}
                vorgangId={vorgangId}
                position={p}
                nummer={(i + 1) * 10}
                gruppenWahl={gruppenWahl}
                gesperrt={gesperrt}
              />
            ))}
          </ul>
        </div>
      ) : null}

      {/* ------------------------------------------------------ SUMMEN */}
      <dl className="mt-4 flex flex-col gap-[7px] border-t border-line pt-4 text-[13px]">
        <Summe label="Positionen netto" wert={eur(preis.positionenNetto)} leise />
        {preis.gesamtRabatt > 0 ? (
          <Summe
            label={`Rabatt ${num(rahmen.rabattProzent)} %`}
            wert={`− ${eur(preis.gesamtRabatt)}`}
            leise
          />
        ) : null}
        <Summe label="Netto" wert={eur(preis.netto)} />
        <Summe
          label={`Umsatzsteuer ${num(rahmen.ustSatz)} %`}
          wert={eur(preis.ust)}
          leise
        />
        {preis.lieferungNetto > 0 ? (
          <Summe
            label="Lieferung (inkl. USt.)"
            wert={eur(preis.lieferungBrutto)}
            leise
          />
        ) : null}
        <Summe label="Gesamt brutto" wert={eur(preis.gesamt)} stark />
        {preis.optionalNetto > 0 ? (
          <Summe
            label="Optionen, falls gewählt"
            wert={`+ ${eur(preis.optionalNetto)}`}
            leise
          />
        ) : null}
        <div className="mt-1 flex flex-wrap gap-x-6 gap-y-1 border-t border-line pt-3 text-[11.5px] text-faint">
          <span className="num">Einkauf {eur(preis.ek)}</span>
          <span
            className={`num ${preis.margeProzent < 10 ? "font-semibold text-s-crit" : ""}`}
            title="Deckungsbeitrag auf den Nettoumsatz"
          >
            Marge {eur(preis.marge)} ({num(preis.margeProzent)} %)
          </span>
        </div>
      </dl>

      {!gesperrt ? (
        <>
          <div className="mt-4 grid gap-3 border-t border-line pt-4 md:grid-cols-2">
            <ArtikelForm vorgangId={vorgangId} artikel={artikel} />
            <FreieForm vorgangId={vorgangId} />
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <GruppeForm vorgangId={vorgangId} />
            <RahmenForm vorgangId={vorgangId} rahmen={rahmen} />
          </div>
        </>
      ) : null}
    </section>
  );
}

function Summe({
  label,
  wert,
  leise = false,
  stark = false,
}: {
  label: string;
  wert: string;
  leise?: boolean;
  stark?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className={leise ? "text-muted" : ""}>{label}</dt>
      <dd
        className={`num ${stark ? "text-[15px] font-bold" : leise ? "text-muted" : "font-medium"}`}
      >
        {wert}
      </dd>
    </div>
  );
}

/* ------------------------------------------------------------- ZEILE */

function Zeile({
  vorgangId,
  position,
  nummer,
  gruppenWahl,
  gesperrt,
}: {
  vorgangId: string;
  position: PositionAnzeige;
  nummer: number;
  gruppenWahl: { wert: string; text: string }[];
  gesperrt: boolean;
}) {
  const [offen, setOffen] = useState(false);
  const zeile =
    position.menge * position.epNetto * (1 - position.rabattProzent / 100);
  const marge =
    position.epNetto > 0 && position.kalkEk !== null
      ? ((position.epNetto - position.kalkEk) / position.epNetto) * 100
      : null;

  return (
    <li className="rounded-input bg-panel">
      <button
        type="button"
        disabled={gesperrt}
        onClick={() => setOffen((o) => !o)}
        aria-expanded={offen}
        className="flex w-full cursor-pointer items-center gap-3 border-0 bg-transparent px-3 py-[10px] text-left disabled:cursor-default"
      >
        <span className="num w-[26px] shrink-0 text-[11px] text-faint">{nummer}</span>

        {position.bildUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={position.bildUrl}
            alt=""
            loading="lazy"
            className="h-[32px] w-[32px] shrink-0 rounded-[8px] bg-surface object-contain"
          />
        ) : null}

        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px] font-medium">
            {position.bezeichnung}
          </span>
          <span className="num block text-[11px] text-faint">
            {num(position.menge)} {position.einheit} × {eur(position.epNetto)}
            {position.rabattProzent > 0
              ? ` · −${num(position.rabattProzent)} %`
              : ""}
            {marge !== null ? ` · DB ${Math.round(marge)} %` : ""}
            {position.istMaterial ? " · Material" : " · Leistung"}
          </span>
        </span>

        {position.optional ? (
          <span className="shrink-0 rounded-pill bg-s-doing/12 px-[8px] py-px text-[10px] font-semibold text-s-doing">
            optional
          </span>
        ) : null}

        <span className="num shrink-0 text-[13.5px] font-semibold">{eur(zeile)}</span>
      </button>

      {offen && !gesperrt ? (
        <ZeileBearbeiten
          gruppenWahl={gruppenWahl}
          vorgangId={vorgangId}
          position={position}
          schliessen={() => setOffen(false)}
        />
      ) : null}
    </li>
  );
}

function ZeileBearbeiten({
  vorgangId,
  position,
  gruppenWahl,
  schliessen,
}: {
  vorgangId: string;
  position: PositionAnzeige;
  gruppenWahl: { wert: string; text: string }[];
  schliessen: () => void;
}) {
  const [status, formAction] = useActionState<AktionsStatus, FormData>(
    positionAendern,
    LEER,
  );
  const [zuordStatus, zuordAction] = useActionState<AktionsStatus, FormData>(
    positionZuordnen,
    LEER,
  );
  const [loeschStatus, loeschAction] = useActionState<AktionsStatus, FormData>(
    positionLoeschen,
    LEER,
  );
  const p = `pz-${position.id.slice(0, 8)}`;

  return (
    <div className="border-t border-line px-3 py-3">
      <form action={formAction} className="grid gap-2 sm:grid-cols-6">
        <input type="hidden" name="vorgangId" value={vorgangId} />
        <input type="hidden" name="positionId" value={position.id} />

        <Feld
          praefix={p}
          label="Bezeichnung"
          name="bezeichnung"
          wert={position.bezeichnung}
          spalten="sm:col-span-6"
        />
        <Feld praefix={p} label="Menge" name="menge" wert={position.menge} typ="number" schritt="0.001" />
        <Feld praefix={p} label="Einheit" name="einheit" wert={position.einheit} />
        <Feld
          praefix={p}
          label="Verkauf netto"
          name="epNetto"
          wert={position.epNetto}
          typ="number"
          schritt="0.01"
        />
        <Feld
          praefix={p}
          label="Einkauf"
          name="kalkEk"
          wert={position.kalkEk ?? ""}
          typ="number"
          schritt="0.01"
        />
        <Feld
          praefix={p}
          label="Stunden"
          name="kalkStunden"
          wert={position.kalkStunden ?? ""}
          typ="number"
          schritt="0.001"
        />
        <Feld praefix={p} label="USt %" name="ustSatz" wert={position.ustSatz} typ="number" schritt="1" />
        <Feld
          praefix={p}
          label="Rabatt %"
          name="rabattProzent"
          wert={position.rabattProzent}
          typ="number"
          schritt="0.5"
        />

        <label className="flex items-center gap-2 text-[12px] sm:col-span-3">
          <input
            type="checkbox"
            name="istMaterial"
            value="ja"
            defaultChecked={position.istMaterial}
            className="h-4 w-4 accent-[var(--accent)]"
          />
          Material — zählt in die Bedarfsliste
        </label>

        {/*
          Optional heisst: zählt erst, wenn der Kunde im Portal das
          Häkchen setzt. Vorher wäre der Preis höher, als das Angebot
          verspricht.
        */}
        <label className="flex items-center gap-2 text-[12px] sm:col-span-3">
          <input
            type="checkbox"
            name="optional"
            value="ja"
            defaultChecked={position.optional}
            className="h-4 w-4 accent-[var(--accent)]"
          />
          Optional — der Kunde wählt sie dazu
        </label>

        <div className="flex flex-wrap items-center gap-2 sm:col-span-6">
          <Klein label="Speichern" />
          <button
            type="button"
            onClick={schliessen}
            className="cursor-pointer border-0 bg-transparent text-[12px] text-muted underline"
          >
            Schliessen
          </button>
        </div>
      </form>

      {/*
        Eigenes Formular: verschachtelte wirft der Browser weg, und der
        innere Knopf löste dann den äusseren Vorgang aus.
      */}
      {gruppenWahl.length > 1 ? (
        <form action={zuordAction} className="mt-2 flex flex-wrap items-center gap-2">
          <input type="hidden" name="vorgangId" value={vorgangId} />
          <input type="hidden" name="positionId" value={position.id} />
          <label htmlFor={`${p}-gruppe`} className="text-[11.5px] text-muted">
            Gruppe
          </label>
          <select
            id={`${p}-gruppe`}
            name="gruppeId"
            defaultValue={position.gruppeId ?? ""}
            className="rounded-input border border-line bg-surface px-[10px] py-[6px] text-[12px]"
          >
            {gruppenWahl.map((g) => (
              <option key={g.wert} value={g.wert}>
                {g.text}
              </option>
            ))}
          </select>
          <Klein label="Verschieben" />
          <Meldung status={zuordStatus} />
        </form>
      ) : null}

      <form action={loeschAction} className="mt-2">
        <input type="hidden" name="vorgangId" value={vorgangId} />
        <input type="hidden" name="positionId" value={position.id} />
        <button
          type="submit"
          className="cursor-pointer border-0 bg-transparent text-[12px] font-medium text-s-crit underline"
        >
          Position entfernen
        </button>
      </form>

      <Meldung status={status} />
      <Meldung status={loeschStatus} />
    </div>
  );
}

function Feld({
  label,
  name,
  wert,
  typ = "text",
  schritt,
  spalten = "",
  praefix,
}: {
  label: string;
  name: string;
  wert: string | number;
  typ?: string;
  schritt?: string;
  spalten?: string;
  /*
   * Eindeutig je Formular. Auf der Seite stehen der Artikelübernahme-
   * Block, das Formular für freie Positionen und je Zeile ein
   * Bearbeitungsformular — alle mit einem Feld „Menge". Ohne Präfix
   * zeigen mehrere Labels auf dieselbe id, und dann trifft ein Klick
   * aufs Label das falsche Feld.
   */
  praefix: string;
}) {
  const id = `${praefix}-${name}`;
  return (
    <span className={`flex flex-col gap-[3px] ${spalten}`}>
      <label htmlFor={id} className="text-[10.5px] text-muted">
        {label}
      </label>
      <input
        id={id}
        name={name}
        type={typ}
        step={schritt}
        defaultValue={wert}
        className="w-full rounded-input border border-transparent bg-surface px-[10px] py-[7px] text-[12.5px] outline-0 focus:border-accent"
      />
    </span>
  );
}

function Klein({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="min-h-[34px] cursor-pointer rounded-pill border-0 bg-ink px-[16px] text-[12px] font-semibold text-app disabled:opacity-50"
    >
      {pending ? "…" : label}
    </button>
  );
}

/* ------------------------------------------------------------ ANLEGEN */

function ArtikelForm({
  vorgangId,
  artikel,
}: {
  vorgangId: string;
  artikel: Option[];
}) {
  const [status, formAction] = useActionState<AktionsStatus, FormData>(
    positionAusArtikel,
    LEER,
  );

  return (
    <form action={formAction} key={status.ok ?? "leer"} className="rounded-input bg-panel p-4">
      <h3 className="text-[13px] font-semibold">Artikel übernehmen</h3>
      <p className="mt-1 mb-3 text-[11.5px] text-muted">
        Preis, Kalkulation und Bild werden kopiert — ein späterer
        Artikelpreis ändert dieses Angebot nicht.
      </p>

      <input type="hidden" name="vorgangId" value={vorgangId} />

      <Suchauswahl
        name="articleId"
        label="Artikel"
        pflicht
        breit
        platzhalter="Artikel suchen — Bezeichnung oder Nummer"
        optionen={artikel}
      />

      <div className="mt-2">
        <Feld praefix="pa" label="Menge" name="menge" wert={1} typ="number" schritt="0.001" />
      </div>

      <div className="mt-3">
        <Klein label="Übernehmen" />
      </div>
      <Meldung status={status} />
    </form>
  );
}

function FreieForm({ vorgangId }: { vorgangId: string }) {
  const [status, formAction] = useActionState<AktionsStatus, FormData>(
    positionFrei,
    LEER,
  );

  return (
    <form action={formAction} key={status.ok ?? "leer"} className="rounded-input bg-panel p-4">
      <h3 className="text-[13px] font-semibold">Freie Position</h3>
      <p className="mt-1 mb-3 text-[11.5px] text-muted">
        Für Leistungen ohne Artikel — Montage, Anfahrt, Gerüst.
      </p>

      <input type="hidden" name="vorgangId" value={vorgangId} />

      <div className="grid gap-2 sm:grid-cols-2">
        <Feld praefix="pf" label="Bezeichnung" name="bezeichnung" wert="" spalten="sm:col-span-2" />
        <Feld praefix="pf" label="Menge" name="menge" wert={1} typ="number" schritt="0.001" />
        <Feld praefix="pf" label="Einheit" name="einheit" wert="Stk" />
        <Feld praefix="pf" label="Verkauf netto" name="epNetto" wert="" typ="number" schritt="0.01" />
        <Feld praefix="pf" label="Einkauf" name="kalkEk" wert="" typ="number" schritt="0.01" />
        <Feld praefix="pf" label="Stunden" name="kalkStunden" wert="" typ="number" schritt="0.001" />
        <Feld praefix="pf" label="USt %" name="ustSatz" wert={20} typ="number" schritt="1" />
      </div>

      <label className="mt-2 flex items-center gap-2 text-[11.5px]">
        <input
          type="checkbox"
          name="istMaterial"
          value="ja"
          className="h-4 w-4 accent-[var(--accent)]"
        />
        Material
      </label>

      <div className="mt-3">
        <Klein label="Position anlegen" />
      </div>
      <Meldung status={status} />
    </form>
  );
}

/* ------------------------------------------------------------ GRUPPE */

/**
 * Eine Gruppe im Editor.
 *
 * Zeigt oben, was der Kunde sehen wird — Paketpreis oder Summe — und
 * darunter die Positionen, die darin stecken. Die Einstellungen klappen
 * auf: sie werden einmal gesetzt und danach selten angefasst.
 */
function GruppenBlock({
  vorgangId,
  gruppe,
  positionen,
  gruppenWahl,
  netto,
  gesperrt,
}: {
  vorgangId: string;
  gruppe: GruppeAnzeige;
  positionen: PositionAnzeige[];
  gruppenWahl: { wert: string; text: string }[];
  netto: number;
  gesperrt: boolean;
}) {
  const [offen, setOffen] = useState(false);
  const [status, formAction] = useActionState<AktionsStatus, FormData>(
    gruppeAendern,
    LEER,
  );
  const [aufloesStatus, aufloesAction] = useActionState<AktionsStatus, FormData>(
    gruppeAufloesen,
    LEER,
  );
  const p = `gr-${gruppe.id.slice(0, 8)}`;

  return (
    <section className="mt-3 rounded-input border border-line bg-panel">
      <div className="flex flex-wrap items-center gap-2 px-3 py-[10px]">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px] font-semibold">
            {gruppe.name}
          </span>
          <span className="num block text-[11px] text-faint">
            {positionen.length}{" "}
            {positionen.length === 1 ? "Position" : "Positionen"}
            {gruppe.einzelpreiseVerstecken
              ? " · Kunde sieht nur den Paketpreis"
              : ""}
          </span>
        </span>

        <span className="shrink-0 text-right">
          <span className="block text-[10px] tracking-[0.08em] text-faint uppercase">
            {gruppe.paketPreis !== null ? "Paketpreis" : "Summe"}
          </span>
          <span className="num block text-[13.5px] font-semibold">
            {eur(netto)}
          </span>
        </span>

        {!gesperrt ? (
          <button
            type="button"
            onClick={() => setOffen((o) => !o)}
            aria-expanded={offen}
            className="shrink-0 cursor-pointer rounded-pill border border-line bg-surface px-[11px] py-[5px] text-[11.5px] font-medium"
          >
            {offen ? "Fertig" : "Ändern"}
          </button>
        ) : null}
      </div>

      {offen && !gesperrt ? (
        <div className="border-t border-line px-3 py-3">
          <form action={formAction} className="grid gap-2 sm:grid-cols-4">
            <input type="hidden" name="vorgangId" value={vorgangId} />
            <input type="hidden" name="gruppeId" value={gruppe.id} />

            <Feld
              praefix={p}
              label="Name"
              name="name"
              wert={gruppe.name}
              spalten="sm:col-span-2"
            />
            <Feld
              praefix={p}
              label="Paketpreis netto"
              name="paketPreis"
              wert={gruppe.paketPreis ?? ""}
              typ="number"
              schritt="0.01"
            />
            <Feld
              praefix={p}
              label="Beschreibung"
              name="beschreibung"
              wert={gruppe.beschreibung ?? ""}
              spalten="sm:col-span-4"
            />

            <label className="flex items-center gap-2 text-[12px] sm:col-span-4">
              <input
                type="checkbox"
                name="einzelpreiseVerstecken"
                value="ja"
                defaultChecked={gruppe.einzelpreiseVerstecken}
                className="h-4 w-4 accent-[var(--accent)]"
              />
              Einzelpreise verstecken — der Kunde sieht nur den Paketpreis
            </label>

            <p className="text-[11px] text-faint sm:col-span-4">
              Leerer Paketpreis heisst: die Positionen zählen sich selbst
              zusammen.
            </p>

            <div className="sm:col-span-4">
              <Klein label="Speichern" />
              <Meldung status={status} />
            </div>
          </form>

          <form action={aufloesAction} className="mt-2">
            <input type="hidden" name="vorgangId" value={vorgangId} />
            <input type="hidden" name="gruppeId" value={gruppe.id} />
            <button
              type="submit"
              className="cursor-pointer border-0 bg-transparent text-[11.5px] text-s-crit underline"
            >
              Gruppe auflösen — die Positionen bleiben
            </button>
            <Meldung status={aufloesStatus} />
          </form>
        </div>
      ) : null}

      {positionen.length > 0 ? (
        <ul className="flex flex-col gap-2 px-3 pb-3">
          {positionen.map((pos, i) => (
            <Zeile
              key={pos.id}
              vorgangId={vorgangId}
              position={pos}
              nummer={(i + 1) * 10}
              gruppenWahl={gruppenWahl}
              gesperrt={gesperrt}
            />
          ))}
        </ul>
      ) : (
        <p className="px-3 pb-3 text-[11.5px] text-faint">
          Noch nichts in dieser Gruppe. Positionen unten anlegen und dann
          hierher verschieben.
        </p>
      )}
    </section>
  );
}

function GruppeForm({ vorgangId }: { vorgangId: string }) {
  const [status, formAction] = useActionState<AktionsStatus, FormData>(
    gruppeAnlegen,
    LEER,
  );

  return (
    <form
      action={formAction}
      key={status.ok ?? "leer"}
      className="rounded-input bg-panel p-4"
    >
      <h3 className="text-[13px] font-semibold">Gruppe anlegen</h3>
      <p className="mt-1 mb-3 text-[11.5px] text-muted">
        Für Pakete wie „PV-Anlage 9,3 kWp“. Der Kunde entscheidet über das
        Paket, nicht über zwanzig Modulklemmen.
      </p>

      <input type="hidden" name="vorgangId" value={vorgangId} />

      <div className="grid gap-2">
        <Feld praefix="gn" label="Name" name="name" wert="" />
        <Feld praefix="gn" label="Beschreibung" name="beschreibung" wert="" />
      </div>

      <div className="mt-3">
        <Klein label="Anlegen" />
      </div>
      <Meldung status={status} />
    </form>
  );
}

/**
 * Steuersatz, Rabatt und Lieferung.
 *
 * Der Steuersatz gilt für das ganze Angebot: eine PV-Anlage nach
 * Deutschland ist vollständig steuerfrei, eine nach Österreich
 * vollständig mit 20 %. Gemischte Sätze gibt es in diesem Geschäft nicht.
 */
function RahmenForm({
  vorgangId,
  rahmen,
}: {
  vorgangId: string;
  rahmen: { ustSatz: number; rabattProzent: number; lieferungNetto: number };
}) {
  const [status, formAction] = useActionState<AktionsStatus, FormData>(
    angebotskopfSpeichern,
    LEER,
  );

  return (
    <form action={formAction} className="rounded-input bg-panel p-4">
      <h3 className="text-[13px] font-semibold">Steuer, Rabatt, Lieferung</h3>
      <p className="mt-1 mb-3 text-[11.5px] text-muted">
        Gilt für das ganze Angebot.
      </p>

      <input type="hidden" name="vorgangId" value={vorgangId} />

      <div className="grid gap-2 sm:grid-cols-3">
        <div>
          <label
            htmlFor="rf-ust"
            className="mb-[5px] block text-[11.5px] font-medium text-muted"
          >
            USt-Satz
          </label>
          <select
            id="rf-ust"
            name="ustSatz"
            defaultValue={String(rahmen.ustSatz)}
            className="w-full rounded-input border border-transparent bg-sunk px-[11px] py-[9px] text-[13px] outline-0 focus:border-accent"
          >
            <option value="0">0 % — Deutschland</option>
            <option value="19">19 %</option>
            <option value="20">20 % — Österreich</option>
          </select>
        </div>
        <Feld
          praefix="rf"
          label="Rabatt %"
          name="rabattProzent"
          wert={rahmen.rabattProzent}
          typ="number"
          schritt="0.5"
        />
        <Feld
          praefix="rf"
          label="Lieferung netto"
          name="lieferungNetto"
          wert={rahmen.lieferungNetto}
          typ="number"
          schritt="0.01"
        />
      </div>

      <div className="mt-3">
        <Klein label="Speichern" />
      </div>
      <Meldung status={status} />
    </form>
  );
}
