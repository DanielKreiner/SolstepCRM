"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { LEER, Meldung, type AktionsStatus } from "@/components/ui/Formular";
import { Suchauswahl, type Option } from "@/components/ui/Suchauswahl";
import { eur, num } from "@/lib/format";
import { summen } from "@/lib/vorgang/modell";
import {
  positionAendern,
  positionAusArtikel,
  positionFrei,
  positionLoeschen,
} from "@/app/(app)/vorgaenge/positionen-actions";

export type PositionAnzeige = {
  id: string;
  sort: number;
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
  artikel,
  gesperrt,
  gesperrtGrund,
}: {
  vorgangId: string;
  positionen: PositionAnzeige[];
  artikel: Option[];
  gesperrt: boolean;
  gesperrtGrund: string | null;
}) {
  const s = summen(
    positionen.map((p) => ({
      menge: p.menge,
      epNetto: p.epNetto,
      ustSatz: p.ustSatz,
      kalkStunden: p.kalkStunden,
      kalkEk: p.kalkEk,
      istMaterial: p.istMaterial,
    })),
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

      {positionen.length === 0 ? (
        <p className="rounded-input bg-panel px-4 py-6 text-center text-[13px] text-muted">
          Noch nichts drin. Artikel suchen oder eine freie Position anlegen —
          für Montage, Anfahrt, Gerüst.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {positionen.map((p, i) => (
            <Zeile
              key={p.id}
              vorgangId={vorgangId}
              position={p}
              nummer={(i + 1) * 10}
              gesperrt={gesperrt}
            />
          ))}
        </ul>
      )}

      {/* ------------------------------------------------------ SUMMEN */}
      <dl className="mt-4 flex flex-col gap-[7px] border-t border-line pt-4 text-[13px]">
        <Summe label="Netto" wert={eur(s.netto)} />
        <Summe label="Umsatzsteuer" wert={eur(s.ust)} leise />
        <Summe label="Brutto" wert={eur(s.brutto)} stark />
        <div className="mt-1 flex flex-wrap gap-x-6 gap-y-1 border-t border-line pt-3 text-[11.5px] text-faint">
          <span className="num">Einkauf {eur(s.ek)}</span>
          <span className="num">Material {eur(s.materialEk)}</span>
          <span className="num">Kalkuliert {num(s.stunden)} h</span>
          <span
            className={`num ${s.marge < 10 ? "font-semibold text-s-crit" : ""}`}
            title="Deckungsbeitrag auf den Nettoumsatz"
          >
            DB {num(s.marge)} %
          </span>
        </div>
      </dl>

      {!gesperrt ? (
        <div className="mt-4 grid gap-3 border-t border-line pt-4 md:grid-cols-2">
          <ArtikelForm vorgangId={vorgangId} artikel={artikel} />
          <FreieForm vorgangId={vorgangId} />
        </div>
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
  gesperrt,
}: {
  vorgangId: string;
  position: PositionAnzeige;
  nummer: number;
  gesperrt: boolean;
}) {
  const [offen, setOffen] = useState(false);
  const zeile = position.menge * position.epNetto;
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
            {marge !== null ? ` · DB ${Math.round(marge)} %` : ""}
            {position.istMaterial ? " · Material" : " · Leistung"}
          </span>
        </span>

        <span className="num shrink-0 text-[13.5px] font-semibold">{eur(zeile)}</span>
      </button>

      {offen && !gesperrt ? (
        <ZeileBearbeiten
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
  schliessen,
}: {
  vorgangId: string;
  position: PositionAnzeige;
  schliessen: () => void;
}) {
  const [status, formAction] = useActionState<AktionsStatus, FormData>(
    positionAendern,
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

        <label className="flex items-center gap-2 text-[12px] sm:col-span-6">
          <input
            type="checkbox"
            name="istMaterial"
            value="ja"
            defaultChecked={position.istMaterial}
            className="h-4 w-4 accent-[var(--accent)]"
          />
          Material — zählt in die Bedarfsliste. Leistung wird nicht bestellt.
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
