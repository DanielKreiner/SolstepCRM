"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { type FotoQuelle, Leinwand, type Werkzeug } from "./Leinwand";
import { FlaechenPanel } from "./FlaechenPanel";
import { FotoLeiste } from "./FotoLeiste";
import { ansichtMerken, fotoKalibrieren, planSpeichern } from "@/app/(app)/planer/actions";
import {
  ANBIETER,
  type AnbieterId,
  type AnbieterStand,
  anbieter as anbieterZu,
} from "@/lib/planer/anbieter";
import { type Meter, ZOOM_GRENZEN } from "@/lib/planer/geo";
import { dachflaeche, FANG_STANDARD, type FangOptionen } from "@/lib/planer/flaeche";
import { anzahlModule, kwp } from "@/lib/planer/module";
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
 * Rahmen um die Zeichenfläche. Aufbau, Masse und Farben stammen aus
 * Planer-HTML.html — dem verbindlichen Entwurf:
 *
 *   Kopf 56 px hell · Stepper 76 px hell · Zeichenfläche DUNKEL
 *   (#17150F) · Panel 344 px hell
 *
 * Die Bedienung auf der Zeichenfläche SCHWEBT darüber, statt sie zu
 * umrahmen: Werkzeuge links, Kennzahlen unten mittig, beides in
 * halbdurchsichtigem Dunkel mit Weichzeichner. Das hält die Karte gross
 * — sie ist der Arbeitsgegenstand, nicht die Umrandung.
 */

export interface PlanerProjekt {
  id: string;
  name: string;
  adresse: string | null;
  ursprung: { lat: number; lon: number };
  anbieter: AnbieterId;
  zoom: number;
  plan: Plan;
  foto: FotoQuelle | null;
}

const PHASEN = [
  { nr: 1, mark: "1", label: "Dach", fertig: true },
  { nr: 2, mark: "2", label: "Belegung", fertig: false },
  { nr: 3, mark: "3", label: "Technik", fertig: false },
  { nr: 4, mark: "4", label: "Ertrag", fertig: false },
  { nr: 5, mark: "5", label: "Übergabe", fertig: false },
];

const WERKZEUGE: Array<{ id: Werkzeug; glyph: string; label: string; titel: string }> = [
  { id: "auswahl", glyph: "↖", label: "Wählen", titel: "Auswählen und bearbeiten" },
  { id: "flaeche", glyph: "⬠", label: "Fläche", titel: "Dachfläche zeichnen" },
  { id: "hindernis", glyph: "▣", label: "Hindernis", titel: "Hindernis aufziehen (Kamin, Fenster)" },
  { id: "messen", glyph: "↔", label: "Messen", titel: "Strecke messen" },
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
  const [aktiveGruppe, setAktiveGruppe] = useState<string | null>(null);
  const [fang, setFang] = useState<FangOptionen>(FANG_STANDARD);
  const [gemerkt, setGemerkt] = useState<"ruhe" | "speichert" | "fehler">("ruhe");
  const [mitte, setMitte] = useState<Meter>({ x: 0, y: 0 });
  const [panelOffen, setPanelOffen] = useState(true);
  const [foto, setFoto] = useState<FotoQuelle | null>(projekt.foto);

  /*
   * Hochladen und Entfernen laufen über Serveraktionen mit
   * revalidatePath; der neue Stand kommt als Eigenschaft herein.
   * Abhängig NUR von Adresse und Bildmassen, nicht vom Massstab: eine
   * gerade vorgenommene Kalibrierung darf ein nachlaufender
   * Serverdurchlauf nicht überschreiben.
   */
  useEffect(() => {
    setFoto(projekt.foto);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projekt.foto?.url, projekt.foto?.breite, projekt.foto?.hoehe]);

  const [verlauf, setVerlauf] = useState<Verlauf<Plan>>(() => verlaufStart(projekt.plan));
  const plan = verlauf.gegenwart;

  /*
   * Autosave, gedrosselt und ohne Speichern-Knopf (Briefing 1.4).
   * Ansicht und Plan laufen getrennt: die Ansicht ändert sich bei jedem
   * Schwenk, der Plan nur beim Bearbeiten.
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

  const onKalibriert = useCallback(
    async (meterProPixel: number, faktor: number) => {
      const schonGezeichnet = plan.flaechen.length > 0;
      const warKalibriert = foto?.meterProPixel != null;
      let skalieren = false;
      if (schonGezeichnet && warKalibriert && Math.abs(faktor - 1) > 0.001) {
        skalieren = window.confirm(
          `Der Massstab ändert sich um den Faktor ${faktor.toFixed(3).replace(".", ",")}. ` +
            "Sollen die bereits gezeichneten Flächen mitskaliert werden?",
        );
      }

      setFoto((f) => (f ? { ...f, meterProPixel } : f));

      /*
       * Zoom gegenläufig nachführen. Mit dem Massstab ändert sich, wie
       * viele Meter das Foto abdeckt — ohne Ausgleich springt es beim
       * Kalibrieren in der Grösse. Und nur so misst die Gegenprobe das
       * Foto und nicht die Kamera.
       */
      setZoom((z) =>
        Math.max(ZOOM_GRENZEN.min, Math.min(ZOOM_GRENZEN.max, z - Math.log2(faktor))),
      );

      setGemerkt("speichert");
      const { ok } = await fotoKalibrieren({
        id: projekt.id,
        meterProPixel,
        geometrieSkalieren: skalieren,
        faktor,
      });
      setGemerkt(ok ? "ruhe" : "fehler");
      if (ok && skalieren) {
        const skaliert: Plan = {
          ...plan,
          flaechen: plan.flaechen.map((fl) => ({
            ...fl,
            punkte: fl.punkte.map((q) => ({ x: q.x * faktor, y: q.y * faktor })),
            hindernisse: fl.hindernisse.map((h) => ({
              ...h,
              punkte: h.punkte.map((q) => ({ x: q.x * faktor, y: q.y * faktor })),
            })),
          })),
        };
        setVerlauf((v) => verlaufSetzen(v, skaliert));
        letzterPlan.current = JSON.stringify(skaliert);
      }
    },
    [foto, plan, projekt.id],
  );

  const onKamera = useCallback(
    (k: { zoom: number; mitte: Meter }) => {
      setZoom(k.zoom);
      setMitte(k.mitte);
      ansichtSichern({ anbieter, zoom: k.zoom });
    },
    [anbieter, ansichtSichern],
  );

  const verfuegbar = (id: AnbieterId) => staende.find((s) => s.id === id)?.verfuegbar ?? false;
  const fangAn = fang.rechterWinkel || fang.parallel || fang.raster;

  /* Kennzahlenleiste. Ab Stufe 3 kommen Module, kWp und Ertrag dazu. */
  const dach = plan.flaechen.reduce((s, f) => s + dachflaeche(f.punkte, f.neigung), 0);
  const modulzahl = plan.gruppen.reduce((s, g) => s + anzahlModule(g), 0);
  const leistung = plan.gruppen.reduce((s, g) => s + kwp(g), 0);
  const kennzahlen = [
    { wert: `${dach.toFixed(0)} m²`, label: "DACHFLÄCHE" },
    { wert: String(modulzahl), label: "MODULE" },
    { wert: `${leistung.toFixed(2).replace(".", ",")}`, label: "KWP" },
  ];

  return (
    <div className="flex h-full min-h-[520px] flex-col overflow-hidden rounded-card border border-line">
      {/* ── Kopf, 56 px ────────────────────────────────────────────── */}
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-panel px-4">
        <Link
          href="/planer"
          className="shrink-0 text-[17px] leading-none text-muted hover:text-ink"
          aria-label="Zurück zur Projektliste"
        >
          ←
        </Link>
        <div className="min-w-[72px] flex-1">
          <p className="truncate text-[15px] font-bold leading-tight">{projekt.name}</p>
          {projekt.adresse ? (
            <p className="hidden truncate text-[12px] leading-tight text-muted md:block">
              {projekt.adresse}
            </p>
          ) : null}
        </div>

        {schreibrecht ? (
          <div className="hidden shrink-0 items-center gap-1.5 md:flex">
            <RundKnopf zeichen="↺" beschriftung="Rückgängig" aus={!kannZurueck(verlauf)} onClick={schrittZurueck} />
            <RundKnopf zeichen="↻" beschriftung="Wiederholen" aus={!kannVor(verlauf)} onClick={schrittVor} />
          </div>
        ) : null}

        {foto ? (
          <FotoBadge foto={foto} />
        ) : (
          <AnbieterLeiste
            aktiv={anbieter}
            staende={staende}
            onWahl={(id) => {
              setAnbieter(id);
              ansichtSichern({ anbieter: id, zoom });
            }}
          />
        )}

        <div className="hidden shrink-0 items-center gap-1.5 sm:flex">
          <RundKnopf
            zeichen="−"
            beschriftung="Weiter weg"
            onClick={() => setZoom((z) => Math.max(ZOOM_GRENZEN.min, z - 1))}
          />
          <span className="num w-12 text-center text-[11px] tabular-nums text-muted">
            {zoom.toFixed(1)}
          </span>
          <RundKnopf
            zeichen="+"
            beschriftung="Näher heran"
            onClick={() => setZoom((z) => Math.min(ZOOM_GRENZEN.max, z + 1))}
          />
        </div>

        {/* Sicherungsanzeige wie im Entwurf: Punkt plus Wort. */}
        <div className="flex shrink-0 items-center gap-1.5 px-1" aria-live="polite">
          <span
            className="h-[7px] w-[7px] rounded-pill"
            style={{
              background:
                gemerkt === "fehler"
                  ? "var(--s-crit)"
                  : gemerkt === "speichert"
                    ? "var(--s-warn)"
                    : "var(--s-done)",
            }}
          />
          <span className="hidden text-[12px] text-muted lg:inline">
            {gemerkt === "speichert" ? "sichert" : gemerkt === "fehler" ? "nicht gesichert" : "gesichert"}
          </span>
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1">
        {/* ── Stepper, 76 px ───────────────────────────────────────── */}
        <nav
          className="z-20 hidden w-[var(--pl-stepper-breite)] shrink-0 flex-col items-center gap-1 border-r border-line bg-panel pt-3.5 sm:flex"
          aria-label="Planungsphasen"
        >
          {PHASEN.map((ph) => (
            <div
              key={ph.nr}
              className={[
                "flex w-16 flex-col items-center gap-1 rounded-[11px] pb-[7px] pt-[9px]",
                ph.fertig ? "bg-accent-sunk" : "",
              ].join(" ")}
            >
              <span
                className={[
                  "num flex h-[26px] w-[26px] items-center justify-center rounded-pill border-[1.5px] text-[12px] font-bold",
                  ph.fertig
                    ? "border-accent bg-accent text-white"
                    : "border-line-strong/40 bg-surface text-muted",
                ].join(" ")}
              >
                {ph.mark}
              </span>
              <span className={`text-[10px] font-semibold ${ph.fertig ? "text-ink" : "text-muted/70"}`}>
                {ph.label}
              </span>
              {!ph.fertig ? <span className="text-[9px] text-muted/50">folgt</span> : null}
            </div>
          ))}
        </nav>

        {/* ── Zeichenfläche, dunkel ────────────────────────────────── */}
        <div className="relative min-w-0 flex-1 bg-pl-flaeche">
          {foto || verfuegbar(anbieter) ? (
            <Leinwand
              ursprung={projekt.ursprung}
              anbieter={anbieter}
              zoom={zoom}
              plan={plan}
              werkzeug={schreibrecht ? werkzeug : "auswahl"}
              fang={fang}
              foto={foto}
              onKalibriert={onKalibriert}
              aktiv={aktiv}
              onAktiv={setAktiv}
              aktiveGruppe={aktiveGruppe}
              onAktiveGruppe={setAktiveGruppe}
              onPlan={onPlan}
              onWerkzeug={setWerkzeug}
              onKamera={onKamera}
            />
          ) : (
            <NichtEingerichtet stand={staende.find((s) => s.id === anbieter)} />
          )}

          {/* Werkzeugpalette, schwebend links */}
          {schreibrecht ? (
            <div
              className="absolute left-3 top-3.5 z-10 flex flex-col gap-1.5 rounded-[14px] border border-pl-chrome-linie bg-pl-chrome p-2 backdrop-blur-md"
              role="group"
              aria-label="Werkzeug"
            >
              {WERKZEUGE.map((w) => {
                const gesperrt = w.id === "hindernis" && (plan.flaechen.length === 0 || !aktiv);
                const an = werkzeug === w.id;
                return (
                  <button
                    key={w.id}
                    type="button"
                    disabled={gesperrt}
                    title={gesperrt ? "Zuerst eine Dachfläche auswählen." : w.titel}
                    aria-label={w.titel}
                    aria-pressed={an}
                    onClick={() => setWerkzeug(w.id)}
                    className={[
                      "flex h-12 w-12 flex-col items-center justify-center gap-0.5 rounded-[10px] transition-colors",
                      an
                        ? "bg-accent text-white"
                        : gesperrt
                          ? "cursor-not-allowed text-pl-auf-dunkel-4"
                          : "text-pl-auf-dunkel-2 hover:bg-white/10",
                    ].join(" ")}
                  >
                    <span className="text-[16px] leading-none">{w.glyph}</span>
                    <span className="text-[8px] font-semibold tracking-[0.02em]">{w.label}</span>
                  </button>
                );
              })}

              <span className="mx-1 my-0.5 h-px bg-pl-chrome-linie" />

              <button
                type="button"
                aria-pressed={fangAn}
                title="Rechte Winkel, Parallelität und 5-cm-Raster"
                aria-label="Fanghilfen"
                onClick={() =>
                  setFang((f) =>
                    fangAn ? { ...f, rechterWinkel: false, parallel: false, raster: false } : FANG_STANDARD,
                  )
                }
                className={[
                  "flex h-12 w-12 flex-col items-center justify-center gap-0.5 rounded-[10px] transition-colors",
                  fangAn
                    ? "bg-pl-mess-flaeche text-pl-mess"
                    : "text-pl-auf-dunkel-4 hover:bg-white/10",
                ].join(" ")}
              >
                <span className="text-[16px] leading-none">⊹</span>
                <span className="text-[8px] font-semibold tracking-[0.02em]">Fang</span>
              </button>
            </div>
          ) : null}

          {/* Kennzahlen, schwebend unten mittig */}
          <div className="pointer-events-none absolute bottom-3.5 left-1/2 z-10 flex -translate-x-1/2 items-stretch rounded-[14px] border border-pl-chrome-linie bg-pl-chrome px-1.5 py-2.5 shadow-[0_8px_30px_rgba(0,0,0,.4)] backdrop-blur-md">
            {kennzahlen.map((k) => (
              <div
                key={k.label}
                className="min-w-[92px] whitespace-nowrap border-r border-pl-chrome-linie px-[17px] text-center last:border-r-0"
              >
                <div className="num text-[19px] font-bold leading-none text-pl-auf-dunkel">{k.wert}</div>
                <div className="mt-1 text-[10px] font-semibold tracking-[0.04em] text-pl-auf-dunkel-3">
                  {k.label}
                </div>
              </div>
            ))}
            <div className="flex items-center pl-3 pr-1">
              <span className="w-[62px] text-[10px] leading-[1.25] text-pl-auf-dunkel-4">
                Richtwerte, unverbindlich
              </span>
            </div>
          </div>

          {/* Griff zum Ausklappen, wenn das Panel zu ist */}
          {!panelOffen ? (
            <button
              type="button"
              onClick={() => setPanelOffen(true)}
              aria-label="Seitenleiste öffnen"
              className="absolute right-0 top-1/2 z-10 flex h-[88px] w-[30px] -translate-y-1/2 items-center justify-center rounded-l-[12px] bg-panel text-[15px] font-bold text-muted shadow-[-4px_0_14px_rgba(0,0,0,.3)]"
            >
              ‹
            </button>
          ) : null}
        </div>

        {/* ── Panel, 344 px ───────────────────────────────────────── */}
        {panelOffen ? (
          <div className="absolute inset-y-0 right-0 z-30 flex w-[var(--pl-panel-breite)] max-w-[86%] shadow-soft lg:static lg:z-auto lg:shadow-none">
            <FlaechenPanel
              plan={plan}
              aktiv={aktiv}
              onAktiv={setAktiv}
              onPlan={onPlan}
              mitte={mitte}
              schreibrecht={schreibrecht}
              aktiveGruppe={aktiveGruppe}
              onAktiveGruppe={setAktiveGruppe}
              breitengrad={projekt.ursprung.lat}
              onSchliessen={() => setPanelOffen(false)}
              foto={
                schreibrecht ? (
                  <FotoLeiste
                    projektId={projekt.id}
                    foto={foto}
                    werkzeug={werkzeug}
                    onWerkzeug={setWerkzeug}
                  />
                ) : null
              }
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Knopf im Kopf — 36 px, Radius 9, wie im Entwurf. */
function RundKnopf({
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
      className="flex h-9 w-9 items-center justify-center rounded-[9px] border border-line bg-surface text-[15px] leading-none hover:border-accent disabled:opacity-35 disabled:hover:border-line"
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
        Projektnamen — der wurde dabei auf null gequetscht.
      */}
      <select
        className="h-9 shrink-0 rounded-[9px] border border-line bg-surface px-2 text-[12.5px] sm:hidden"
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
        className="hidden shrink-0 gap-0.5 rounded-[10px] bg-sunk p-1 sm:flex"
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
                "rounded-[7px] px-3 py-1 text-[12.5px] transition-colors",
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

/** Im Fotobetrieb steht im Kopf die Quelle statt der Anbieterleiste. */
function FotoBadge({ foto }: { foto: FotoQuelle }) {
  const kalibriert = foto.meterProPixel != null;
  return (
    <span
      className={[
        "num shrink-0 rounded-pill border px-3 py-1 text-[11px]",
        kalibriert
          ? "border-pl-mess bg-pl-mess-flaeche text-pl-hinweis-text"
          : "border-s-crit bg-s-crit/10 font-semibold text-s-crit",
      ].join(" ")}
      title={
        kalibriert
          ? "Drohnenfoto mit bekanntem Massstab"
          : "Drohnenfoto ohne Massstab — Längen sind geschätzt"
      }
    >
      Drohnenfoto{kalibriert ? "" : " · ungenau"}
    </span>
  );
}

/** Kein leerer Canvas, wenn ein Anbieter fehlt (Briefing 2.1). */
function NichtEingerichtet({ stand }: { stand: AnbieterStand | undefined }) {
  return (
    <div className="flex h-full items-center justify-center bg-pl-flaeche p-6">
      <div className="max-w-sm text-center">
        <p className="text-[15px] font-bold text-pl-auf-dunkel">
          {stand ? anbieterZu(stand.id).label : "Dieser Anbieter"} steht nicht zur Verfügung
        </p>
        <p className="mt-1.5 text-[13px] text-pl-auf-dunkel-2">{stand?.grund}</p>
        <p className="mt-3 text-[13px] text-pl-auf-dunkel-3">
          Basemap läuft ohne Schlüssel und hat in Österreich die schärfsten Bilder.
        </p>
      </div>
    </div>
  );
}
