"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Leinwand } from "./Leinwand";
import { ansichtMerken } from "@/app/(app)/planer/actions";
import {
  ANBIETER,
  type AnbieterId,
  type AnbieterStand,
  anbieter as anbieterZu,
} from "@/lib/planer/anbieter";
import { ZOOM_GRENZEN } from "@/lib/planer/geo";

/*
 * Rahmen um die Zeichenfläche: Kopfleiste, Phasenleiste, Leinwand.
 * Aufbau nach Planer-HTML.html — Kopf 56 px, Phasen links, Karte füllt
 * den Rest.
 *
 * Die Phasen stehen schon vollständig da, obwohl erst die erste
 * funktioniert. Das ist Absicht: der Nutzer soll von Anfang an sehen,
 * wie weit der Weg ist. Was noch nicht geht, ist als „folgt" markiert
 * und nicht anklickbar — kein Knopf, der ins Leere führt.
 */

export interface PlanerProjekt {
  id: string;
  name: string;
  adresse: string | null;
  ursprung: { lat: number; lon: number };
  anbieter: AnbieterId;
  zoom: number;
}

const PHASEN = [
  { nr: 1, kurz: "01", label: "Dach", fertig: true },
  { nr: 2, kurz: "02", label: "Belegung", fertig: false },
  { nr: 3, kurz: "03", label: "Technik", fertig: false },
  { nr: 4, kurz: "04", label: "Ertrag", fertig: false },
  { nr: 5, kurz: "05", label: "Übergabe", fertig: false },
];

export function Planer({
  projekt,
  staende,
}: {
  projekt: PlanerProjekt;
  staende: AnbieterStand[];
}) {
  const [aktiv, setAktiv] = useState<AnbieterId>(projekt.anbieter);
  const [zoom, setZoom] = useState(projekt.zoom);
  const [gemerkt, setGemerkt] = useState<"ruhe" | "speichert" | "fehler">("ruhe");

  /*
   * Autosave: gedrosselt, ohne Speichern-Knopf (Briefing 1.4). Zwei
   * Sekunden Ruhe nach der letzten Bewegung — beim Schwenken sonst
   * sechzig Schreibvorgänge je Sekunde.
   */
  const letzte = useRef({ anbieter: projekt.anbieter, zoom: projekt.zoom });
  const uhr = useRef<ReturnType<typeof setTimeout> | null>(null);

  const merken = useCallback(
    (naechste: { anbieter: AnbieterId; zoom: number }) => {
      if (
        naechste.anbieter === letzte.current.anbieter &&
        Math.abs(naechste.zoom - letzte.current.zoom) < 0.01
      ) {
        return;
      }
      if (uhr.current) clearTimeout(uhr.current);
      uhr.current = setTimeout(async () => {
        setGemerkt("speichert");
        const { ok } = await ansichtMerken({ id: projekt.id, ...naechste });
        letzte.current = naechste;
        setGemerkt(ok ? "ruhe" : "fehler");
      }, 2000);
    },
    [projekt.id],
  );

  useEffect(() => () => void (uhr.current && clearTimeout(uhr.current)), []);

  const onKamera = useCallback(
    (k: { zoom: number }) => {
      setZoom(k.zoom);
      merken({ anbieter: aktiv, zoom: k.zoom });
    },
    [aktiv, merken],
  );

  const verfuegbar = (id: AnbieterId) => staende.find((s) => s.id === id)?.verfuegbar ?? false;

  return (
    /*
     * Volle Hoehe des Inhaltsbereichs statt des Fensters: der Planer sitzt
     * in einem gepolsterten Panel, und 100dvh haette die Karte unten
     * darueber hinausgeschoben — Massstabsleiste und Quellenangabe waren
     * abgeschnitten.
     */
    <div className="flex h-full min-h-[520px] flex-col">
      {/* ── Kopfleiste ───────────────────────────────────────────── */}
      {/*
        Nicht umbrechen: die Kopfleiste ist 56 px hoch, ein Umbruch schob
        Zoom und Sicherungsanzeige hinter die Karte. Statt zu wachsen und
        Kartenfläche zu fressen, fallen auf schmalen Geräten die
        entbehrlichen Teile weg — gezoomt wird dort ohnehin mit zwei Fingern.
      */}
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-panel px-4">
        <Link
          href="/planer"
          className="shrink-0 text-[18px] leading-none text-muted hover:text-ink"
          aria-label="Zurück zur Projektliste"
        >
          ←
        </Link>
        <div className="min-w-[72px] flex-1">
          <p className="truncate text-[14.5px] font-bold leading-tight">{projekt.name}</p>
          {projekt.adresse ? (
            <p className="hidden truncate text-[12px] leading-tight text-muted md:block">
              {projekt.adresse}
            </p>
          ) : null}
        </div>

        <AnbieterLeiste aktiv={aktiv} staende={staende} onWahl={(id) => {
          setAktiv(id);
          merken({ anbieter: id, zoom });
        }} />

        <div className="hidden shrink-0 items-center gap-1 sm:flex">
          <ZoomKnopf zeichen="−" onClick={() => setZoom((z) => Math.max(ZOOM_GRENZEN.min, z - 1))} />
          <span className="mono w-14 text-center text-[12px] tabular-nums text-muted">
            {zoom.toFixed(1)}
          </span>
          <ZoomKnopf zeichen="+" onClick={() => setZoom((z) => Math.min(ZOOM_GRENZEN.max, z + 1))} />
        </div>

        <span
          className="hidden w-24 shrink-0 text-right text-[12px] text-muted lg:block"
          aria-live="polite"
        >
          {gemerkt === "speichert" ? "sichert …" : gemerkt === "fehler" ? "nicht gesichert" : "gesichert"}
        </span>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* ── Phasen ─────────────────────────────────────────────── */}
        <nav
          className="hidden w-[76px] shrink-0 flex-col gap-4 border-r border-line bg-panel py-5 sm:flex"
          aria-label="Planungsphasen"
        >
          {PHASEN.map((p) => (
            <div key={p.nr} className="px-2 text-center">
              <p
                className={`mono text-[13px] font-bold ${p.fertig ? "text-accent-ink" : "text-muted/60"}`}
              >
                {p.kurz}
              </p>
              <p className={`text-[11px] ${p.fertig ? "text-ink" : "text-muted/60"}`}>{p.label}</p>
              {!p.fertig ? <p className="text-[9.5px] text-muted/50">folgt</p> : null}
            </div>
          ))}
        </nav>

        {/* ── Leinwand ───────────────────────────────────────────── */}
        <div className="relative min-w-0 flex-1">
          {verfuegbar(aktiv) ? (
            <Leinwand
              ursprung={projekt.ursprung}
              anbieter={aktiv}
              zoom={zoom}
              onKamera={onKamera}
            />
          ) : (
            <NichtEingerichtet stand={staende.find((s) => s.id === aktiv)} />
          )}
        </div>
      </div>
    </div>
  );
}

function ZoomKnopf({ zeichen, onClick }: { zeichen: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={zeichen === "+" ? "Näher heran" : "Weiter weg"}
      className="h-8 w-8 rounded-icon border border-line bg-surface text-[15px] leading-none hover:border-accent"
    >
      {zeichen}
    </button>
  );
}

function AnbieterLeiste({
  aktiv,
  staende,
  onWahl,
}: {
  aktiv: AnbieterId;
  staende: AnbieterStand[];
  onWahl: (id: AnbieterId) => void;
}) {
  const gesperrt = (id: AnbieterId) => !(staende.find((s) => s.id === id)?.verfuegbar ?? false);

  return (
    <>
      {/*
        Am Telefon reicht die Breite nicht für vier Pillen UND den
        Projektnamen — der wurde dabei auf null gequetscht. Dort steht
        deshalb ein Auswahlfeld; ab sm die Leiste wie im Prototyp.
      */}
      <select
        className="h-8 shrink-0 rounded-pill border border-line bg-surface px-2 text-[12.5px] sm:hidden"
        aria-label="Bildquelle"
        value={aktiv}
        onChange={(e) => onWahl(e.target.value as AnbieterId)}
      >
        {ANBIETER.map((a) => (
          <option key={a.id} value={a.id} disabled={gesperrt(a.id)}>
            {a.label}
            {gesperrt(a.id) ? " — nicht eingerichtet" : ""}
          </option>
        ))}
      </select>

      <div
        className="hidden shrink-0 gap-0.5 rounded-pill bg-sunk p-0.5 sm:flex"
        role="group"
        aria-label="Bildquelle"
      >
      {ANBIETER.map((a) => {
        const stand = staende.find((s) => s.id === a.id);
        const frei = stand?.verfuegbar ?? false;
        return (
          <button
            key={a.id}
            type="button"
            disabled={!frei}
            title={stand?.grund}
            aria-pressed={aktiv === a.id}
            onClick={() => onWahl(a.id)}
            className={[
              "rounded-pill px-3 py-1 text-[12.5px] transition-colors",
              aktiv === a.id ? "bg-surface font-semibold shadow-card" : "",
              frei ? "hover:bg-surface/70" : "cursor-not-allowed text-muted/45",
            ].join(" ")}
          >
            {a.label}
          </button>
        );
      })}
      </div>
    </>
  );
}

/**
 * Kein leerer Canvas, wenn ein Anbieter fehlt (Briefing 2.1): der Grund
 * steht da, und die freie Quelle ist einen Klick entfernt.
 */
function NichtEingerichtet({ stand }: { stand: AnbieterStand | undefined }) {
  return (
    <div className="flex h-full items-center justify-center bg-sunk p-6">
      <div className="max-w-sm text-center">
        <p className="text-[14.5px] font-semibold">
          {stand ? anbieterZu(stand.id).label : "Dieser Anbieter"} steht nicht zur Verfügung
        </p>
        <p className="mt-1.5 text-[13px] text-muted">{stand?.grund}</p>
        <p className="mt-3 text-[13px] text-muted">
          Basemap läuft ohne Schlüssel und hat in Österreich die schärfsten Bilder.
        </p>
      </div>
    </div>
  );
}
