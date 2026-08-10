"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Leinwand, type Werkzeug } from "./Leinwand";
import { FlaechenPanel } from "./FlaechenPanel";
import { ansichtMerken, planSpeichern } from "@/app/(app)/planer/actions";
import {
  ANBIETER,
  type AnbieterId,
  type AnbieterStand,
  anbieter as anbieterZu,
} from "@/lib/planer/anbieter";
import { type Meter, ZOOM_GRENZEN } from "@/lib/planer/geo";
import { FANG_STANDARD, type FangOptionen } from "@/lib/planer/flaeche";
import type { Plan } from "@/lib/planer/plan";
import {
  kannVor,
  kannZurueck,
  type Verlauf,
  verlaufErsetzen,
  verlaufSetzen,
  verlaufStart,
  vor,
  zurueck,
} from "@/lib/planer/verlauf";

/*
 * Rahmen um die Zeichenfläche: Kopfleiste, Phasenleiste, Werkzeuge,
 * Leinwand, Panel. Aufbau nach Planer-HTML.html.
 *
 * Die Phasen stehen vollständig da, obwohl erst zwei davon greifen. Das
 * ist Absicht: der Nutzer soll sehen, wie weit der Weg ist. Was noch
 * nicht geht, ist als „folgt" markiert und nicht anklickbar — kein
 * Knopf, der ins Leere führt.
 */

export interface PlanerProjekt {
  id: string;
  name: string;
  adresse: string | null;
  ursprung: { lat: number; lon: number };
  anbieter: AnbieterId;
  zoom: number;
  plan: Plan;
}

const PHASEN = [
  { nr: 1, kurz: "01", label: "Dach", fertig: true },
  { nr: 2, kurz: "02", label: "Belegung", fertig: false },
  { nr: 3, kurz: "03", label: "Technik", fertig: false },
  { nr: 4, kurz: "04", label: "Ertrag", fertig: false },
  { nr: 5, kurz: "05", label: "Übergabe", fertig: false },
];

const WERKZEUGE: Array<{ id: Werkzeug; label: string; kurz: string }> = [
  { id: "auswahl", label: "Auswählen und bearbeiten", kurz: "Auswahl" },
  { id: "flaeche", label: "Dachfläche zeichnen", kurz: "Fläche" },
  { id: "hindernis", label: "Hindernis aufziehen (Kamin, Fenster)", kurz: "Hindernis" },
  { id: "messen", label: "Strecke messen", kurz: "Messen" },
];

export function Planer({
  projekt,
  staende,
  schreibrecht,
}: {
  projekt: PlanerProjekt;
  staende: AnbieterStand[];
  schreibrecht: boolean;
}) {
  const [anbieter, setAnbieter] = useState<AnbieterId>(projekt.anbieter);
  const [zoom, setZoom] = useState(projekt.zoom);
  const [werkzeug, setWerkzeug] = useState<Werkzeug>("auswahl");
  const [aktiv, setAktiv] = useState<string | null>(null);
  const [fang, setFang] = useState<FangOptionen>(FANG_STANDARD);
  const [gemerkt, setGemerkt] = useState<"ruhe" | "speichert" | "fehler">("ruhe");
  const [mitte, setMitte] = useState<Meter>({ x: 0, y: 0 });
  /* Unter lg liegt das Panel über der Karte statt daneben — bei 834 px
     blieben sonst von der Zeichenfläche keine 250 px übrig. */
  const [panelOffen, setPanelOffen] = useState(false);

  const [verlauf, setVerlauf] = useState<Verlauf<Plan>>(() => verlaufStart(projekt.plan));
  const plan = verlauf.gegenwart;

  /*
   * Autosave, gedrosselt und ohne Speichern-Knopf (Briefing 1.4).
   * Ansicht und Plan laufen getrennt: die Ansicht ändert sich bei jedem
   * Schwenk, der Plan nur beim Bearbeiten — beides in einen Schreibvorgang
   * zu werfen hiesse, bei jedem Zoomen das ganze Dokument zu senden.
   */
  const letzteAnsicht = useRef({ anbieter: projekt.anbieter, zoom: projekt.zoom });
  const ansichtUhr = useRef<ReturnType<typeof setTimeout> | null>(null);
  const planUhr = useRef<ReturnType<typeof setTimeout> | null>(null);
  const letzterPlan = useRef(JSON.stringify(projekt.plan));

  const ansichtSichern = useCallback(
    (naechste: { anbieter: AnbieterId; zoom: number }) => {
      if (
        naechste.anbieter === letzteAnsicht.current.anbieter &&
        Math.abs(naechste.zoom - letzteAnsicht.current.zoom) < 0.01
      ) {
        return;
      }
      if (ansichtUhr.current) clearTimeout(ansichtUhr.current);
      ansichtUhr.current = setTimeout(async () => {
        const { ok } = await ansichtMerken({ id: projekt.id, ...naechste });
        letzteAnsicht.current = naechste;
        if (!ok) setGemerkt("fehler");
      }, 2000);
    },
    [projekt.id],
  );

  const planSichern = useCallback(
    (naechster: Plan) => {
      const roh = JSON.stringify(naechster);
      if (roh === letzterPlan.current) return;
      if (planUhr.current) clearTimeout(planUhr.current);
      setGemerkt("speichert");
      planUhr.current = setTimeout(async () => {
        const { ok } = await planSpeichern({ id: projekt.id, plan: naechster });
        letzterPlan.current = roh;
        setGemerkt(ok ? "ruhe" : "fehler");
      }, 1200);
    },
    [projekt.id],
  );

  useEffect(
    () => () => {
      if (ansichtUhr.current) clearTimeout(ansichtUhr.current);
      if (planUhr.current) clearTimeout(planUhr.current);
    },
    [],
  );

  const onPlan = useCallback(
    (naechster: Plan, schritt: boolean) => {
      setVerlauf((v) => (schritt ? verlaufSetzen(v, naechster) : verlaufErsetzen(v, naechster)));
      // Gesichert wird nur, was auch ein Schritt ist — Zwischenstände
      // beim Ziehen sind kein Ergebnis.
      if (schritt) planSichern(naechster);
    },
    [planSichern],
  );

  const schrittZurueck = useCallback(() => {
    setVerlauf((v) => {
      const n = zurueck(v);
      planSichern(n.gegenwart);
      return n;
    });
  }, [planSichern]);

  const schrittVor = useCallback(() => {
    setVerlauf((v) => {
      const n = vor(v);
      planSichern(n.gegenwart);
      return n;
    });
  }, [planSichern]);

  /* Cmd/Strg+Z und Umschalt dazu — überall im Planer. */
  useEffect(() => {
    const taste = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      e.preventDefault();
      if (e.shiftKey) schrittVor();
      else schrittZurueck();
    };
    window.addEventListener("keydown", taste);
    return () => window.removeEventListener("keydown", taste);
  }, [schrittVor, schrittZurueck]);

  const onKamera = useCallback(
    (k: { zoom: number; mitte: Meter }) => {
      setZoom(k.zoom);
      setMitte(k.mitte);
      ansichtSichern({ anbieter, zoom: k.zoom });
    },
    [anbieter, ansichtSichern],
  );

  const verfuegbar = (id: AnbieterId) => staende.find((s) => s.id === id)?.verfuegbar ?? false;

  return (
    <div className="flex h-full min-h-[520px] flex-col">
      {/*
        Kopfleiste bricht nicht um: sie ist 56 px hoch, ein Umbruch schob
        Zoom und Sicherungsanzeige hinter die Karte. Auf schmalen Geräten
        fallen stattdessen die entbehrlichen Teile weg.
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

        {schreibrecht ? (
          <div className="hidden shrink-0 items-center gap-1 md:flex">
            <KopfKnopf
              zeichen="↺"
              beschriftung="Rückgängig"
              aus={!kannZurueck(verlauf)}
              onClick={schrittZurueck}
            />
            <KopfKnopf
              zeichen="↻"
              beschriftung="Wiederholen"
              aus={!kannVor(verlauf)}
              onClick={schrittVor}
            />
          </div>
        ) : null}

        <AnbieterLeiste
          aktiv={anbieter}
          staende={staende}
          onWahl={(id) => {
            setAnbieter(id);
            ansichtSichern({ anbieter: id, zoom });
          }}
        />

        <div className="hidden shrink-0 items-center gap-1 sm:flex">
          <KopfKnopf zeichen="−" beschriftung="Weiter weg"
            onClick={() => setZoom((z) => Math.max(ZOOM_GRENZEN.min, z - 1))} />
          <span className="num w-14 text-center text-[12px] tabular-nums text-muted">
            {zoom.toFixed(1)}
          </span>
          <KopfKnopf zeichen="+" beschriftung="Näher heran"
            onClick={() => setZoom((z) => Math.min(ZOOM_GRENZEN.max, z + 1))} />
        </div>

        <span className="hidden w-24 shrink-0 text-right text-[12px] text-muted lg:block" aria-live="polite">
          {gemerkt === "speichert" ? "sichert …" : gemerkt === "fehler" ? "nicht gesichert" : "gesichert"}
        </span>
      </header>

      <div className="relative flex min-h-0 flex-1">
        <nav
          className="hidden w-[76px] shrink-0 flex-col gap-4 border-r border-line bg-panel py-5 sm:flex"
          aria-label="Planungsphasen"
        >
          {PHASEN.map((ph) => (
            <div key={ph.nr} className="px-2 text-center">
              <p className={`num text-[13px] font-bold ${ph.fertig ? "text-accent-ink" : "text-muted/60"}`}>
                {ph.kurz}
              </p>
              <p className={`text-[11px] ${ph.fertig ? "text-ink" : "text-muted/60"}`}>{ph.label}</p>
              {!ph.fertig ? <p className="text-[9.5px] text-muted/50">folgt</p> : null}
            </div>
          ))}
        </nav>

        <div className="flex min-w-0 flex-1 flex-col">
          <Werkzeugleiste
            werkzeug={werkzeug}
            onWerkzeug={setWerkzeug}
            fang={fang}
            onFang={setFang}
            hatFlaeche={plan.flaechen.length > 0}
            hatAuswahl={aktiv !== null}
            schreibrecht={schreibrecht}
            anzahl={plan.flaechen.length}
            onPanel={() => setPanelOffen((o) => !o)}
          />

          <div className="relative min-h-0 flex-1">
            {verfuegbar(anbieter) ? (
              <Leinwand
                ursprung={projekt.ursprung}
                anbieter={anbieter}
                zoom={zoom}
                plan={plan}
                werkzeug={schreibrecht ? werkzeug : "auswahl"}
                fang={fang}
                aktiv={aktiv}
                onAktiv={setAktiv}
                onPlan={onPlan}
                onWerkzeug={setWerkzeug}
                onKamera={onKamera}
              />
            ) : (
              <NichtEingerichtet stand={staende.find((s) => s.id === anbieter)} />
            )}
          </div>

        </div>

        {/*
          EIN Panel, nicht zwei. Zwei Instanzen — eine angedockt, eine
          überlagert — standen beide im DOM: jedes Feld doppelt, jede
          Beschriftung mehrdeutig. Stattdessen wechselt derselbe Knoten
          per Klassen zwischen „daneben" und „darüber".
        */}
        <div
          className={[
            "shrink-0 lg:static lg:flex lg:shadow-none",
            panelOffen
              ? "absolute inset-y-0 right-0 z-30 flex w-[300px] max-w-[86%] shadow-soft"
              : "hidden",
          ].join(" ")}
        >
          <FlaechenPanel
            plan={plan}
            aktiv={aktiv}
            onAktiv={setAktiv}
            onPlan={onPlan}
            mitte={mitte}
            schreibrecht={schreibrecht}
            onSchliessen={() => setPanelOffen(false)}
          />
        </div>
      </div>
    </div>
  );
}

function Werkzeugleiste({
  werkzeug,
  onWerkzeug,
  fang,
  onFang,
  hatFlaeche,
  hatAuswahl,
  schreibrecht,
  anzahl,
  onPanel,
}: {
  werkzeug: Werkzeug;
  onWerkzeug: (w: Werkzeug) => void;
  fang: FangOptionen;
  onFang: (f: FangOptionen) => void;
  hatFlaeche: boolean;
  hatAuswahl: boolean;
  schreibrecht: boolean;
  anzahl: number;
  onPanel: () => void;
}) {
  const alleAus = !fang.rechterWinkel && !fang.parallel && !fang.raster;

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line bg-panel px-3 py-2">
      {/* Ohne Schreibrecht bleibt die Werkzeugleiste leer bis auf den
          Panel-Schalter — ansehen darf man den Plan trotzdem. */}
      <div
        className={`gap-0.5 rounded-pill bg-sunk p-0.5 ${schreibrecht ? "flex" : "hidden"}`}
        role="group"
        aria-label="Werkzeug"
      >
        {WERKZEUGE.map((w) => {
          // Ein Hindernis braucht eine Fläche, auf der es liegen kann.
          const gesperrt = w.id === "hindernis" && (!hatFlaeche || !hatAuswahl);
          return (
            <button
              key={w.id}
              type="button"
              title={gesperrt ? "Zuerst eine Dachfläche auswählen." : w.label}
              aria-label={w.label}
              aria-pressed={werkzeug === w.id}
              disabled={gesperrt}
              onClick={() => onWerkzeug(w.id)}
              className={[
                "rounded-pill px-3 py-1 text-[12.5px] transition-colors",
                werkzeug === w.id ? "bg-surface font-semibold shadow-soft" : "",
                gesperrt ? "cursor-not-allowed text-muted/45" : "hover:bg-surface/70",
              ].join(" ")}
            >
              {w.kurz}
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={onPanel}
        className="rounded-pill border border-line px-3 py-1 text-[12.5px] lg:hidden"
      >
        Flächen ({anzahl})
      </button>

      <button
        type="button"
        aria-pressed={!alleAus}
        hidden={!schreibrecht}
        onClick={() =>
          onFang(
            alleAus
              ? FANG_STANDARD
              : { ...fang, rechterWinkel: false, parallel: false, raster: false },
          )
        }
        title="Rechte Winkel, Parallelität und 5-cm-Raster"
        className={[
          "rounded-pill border px-3 py-1 text-[12.5px] transition-colors",
          alleAus ? "border-line text-muted" : "border-accent bg-accent-sunk font-semibold",
        ].join(" ")}
      >
        Fang {alleAus ? "aus" : "an"}
      </button>

      <p className="hidden text-[11.5px] text-muted xl:block">
        Doppeltipp auf eine Kante setzt einen Punkt, auf einen Punkt entfernt ihn. Kantenmass
        antippen und Zahl eintippen.
      </p>
    </div>
  );
}

function KopfKnopf({
  zeichen,
  beschriftung,
  onClick,
  aus,
}: {
  zeichen: string;
  beschriftung: string;
  onClick: () => void;
  aus?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={aus}
      aria-label={beschriftung}
      title={beschriftung}
      className="h-8 w-8 rounded-icon border border-line bg-surface text-[15px] leading-none hover:border-accent disabled:opacity-35 disabled:hover:border-line"
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
                aktiv === a.id ? "bg-surface font-semibold shadow-soft" : "",
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

/** Kein leerer Canvas, wenn ein Anbieter fehlt (Briefing 2.1). */
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
