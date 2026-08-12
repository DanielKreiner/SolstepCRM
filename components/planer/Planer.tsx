"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { type FotoQuelle, Leinwand, type Werkzeug } from "./Leinwand";
import { FlaechenPanel } from "./FlaechenPanel";
import {
  type GeraetModul,
  type GeraetSpeicher,
  type GeraetWr,
  TechnikPanel,
} from "./TechnikPanel";
import { FotoLeiste } from "./FotoLeiste";
import { Dreidee } from "./Dreidee";
import { Ergebnis } from "./Ergebnis";
import { type KundeKurz, Uebergabe } from "./Uebergabe";
import { planungAlsBild } from "./bild";
import { useErtrag } from "./useErtrag";
import {
  type FoerderRegion,
  gilt,
  preisVorschlag,
  WirtschaftPanel,
  type WirtschaftVorgabe,
} from "./WirtschaftPanel";
import {
  ansichtMerken,
  fotoKalibrieren,
  planSpeichern,
  vorschauSichern,
} from "@/app/(app)/planer/actions";
import {
  ANBIETER,
  type AnbieterId,
  type AnbieterStand,
  anbieter as anbieterZu,
} from "@/lib/planer/anbieter";
import { type Meter, ZOOM_GRENZEN } from "@/lib/planer/geo";
import { dachflaeche, FANG_STANDARD, type FangOptionen } from "@/lib/planer/flaeche";
import { anzahlModule, kwp } from "@/lib/planer/module";
import { num } from "@/lib/format";
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
  { nr: 1 as const, mark: "1", label: "Dach", fertig: true },
  { nr: 2 as const, mark: "2", label: "Belegung", fertig: true },
  { nr: 3 as const, mark: "3", label: "Technik", fertig: true },
  { nr: 4 as const, mark: "4", label: "Ertrag", fertig: true },
  { nr: 5 as const, mark: "5", label: "Übergabe", fertig: true },
];

const WERKZEUGE: Array<{ id: Werkzeug; glyph: string; label: string; titel: string }> = [
  { id: "auswahl", glyph: "↖", label: "Wählen", titel: "Auswählen und bearbeiten" },
  { id: "flaeche", glyph: "⬠", label: "Fläche", titel: "Dachfläche zeichnen" },
  { id: "hindernis", glyph: "▣", label: "Hindernis", titel: "Hindernis aufziehen (Kamin, Fenster)" },
  { id: "modul", glyph: "⬓", label: "Modul", titel: "Einzelnes Modul frei setzen oder zurückholen" },
  { id: "teilen", glyph: "⧉", label: "Teilen", titel: "Teil der Gruppe als eigene Gruppe abtrennen" },
  { id: "string", glyph: "⚡", label: "String", titel: "Module dem gewählten String zuordnen" },
  { id: "messen", glyph: "↔", label: "Messen", titel: "Strecke messen" },
];

/*
 * Welcher Schritt womit arbeitet.
 *
 * Ein späterer Schritt fasst nicht mehr an, was ein früherer festgelegt
 * hat: Wer in der Belegung steht, verschiebt keine Dachkante mehr, und
 * wer Strings malt, verschiebt keine Module. Das ist keine
 * Bevormundung, sondern verhindert den teuersten Fehler in diesem
 * Ablauf — eine verrutschte Dachkante, nachdem die Belegung steht, und
 * niemand merkt es, weil die Module ja noch daliegen.
 *
 * Wer doch etwas ändern will, geht einen Schritt zurück. Der Weg
 * dorthin steht als Satz auf der Zeichenfläche.
 */
const WERKZEUGE_JE_PHASE: Record<1 | 2 | 3 | 4 | 5, Werkzeug[]> = {
  1: ["auswahl", "flaeche", "hindernis", "modul", "teilen", "messen"],
  2: ["auswahl", "modul", "teilen", "messen"],
  3: ["auswahl", "string", "messen"],
  4: ["auswahl"],
  5: ["auswahl"],
};

/**
 * Was in diesem Schritt bearbeitet werden darf.
 *
 * Dach und Belegung teilen sich das Panel — beides entsteht im ersten
 * Durchgang, und eine harte Trennung zwischen Schritt 1 und 2 wäre
 * künstlich. Gesperrt wird deshalb nach vorn: Ab der Belegung bleibt
 * das Dach, wie es ist; ab der Technik bleibt die Belegung.
 */
function bearbeitbarIn(phase: 1 | 2 | 3 | 4 | 5) {
  return {
    flaechen: phase === 1,
    module: phase <= 2,
    strings: phase === 3,
  };
}

export function Planer({
  projekt,
  staende,
  schreibrecht,
  geraete,
  vorgabe,
  regionen,
  kunden,
}: {
  projekt: PlanerProjekt;
  staende: AnbieterStand[];
  schreibrecht: boolean;
  geraete: { module: GeraetModul[]; wechselrichter: GeraetWr[]; speicher: GeraetSpeicher[] };
  vorgabe: WirtschaftVorgabe;
  regionen: FoerderRegion[];
  kunden: KundeKurz[];
}) {
  const [anbieter, setAnbieter] = useState<AnbieterId>(projekt.anbieter);
  const [zoom, setZoom] = useState(projekt.zoom);
  const [werkzeug, setWerkzeug] = useState<Werkzeug>("auswahl");
  const [aktiv, setAktiv] = useState<string | null>(null);
  const [aktiveGruppe, setAktiveGruppe] = useState<string | null>(null);
  const [aktiverStrang, setAktiverStrang] = useState<string | null>(null);
  /*
   * Phase 1 zeichnet und belegt, Phase 3 legt die Technik fest, Phase 4
   * rechnet. In Phase 4 tritt die Karte ganz zurück — dort wird nicht
   * mehr geplant, sondern gezeigt, und der Kunde schaut mit.
   */
  const [phase, setPhase] = useState<1 | 2 | 3 | 4 | 5>(1);
  const [fang, setFang] = useState<FangOptionen>(FANG_STANDARD);
  const [gemerkt, setGemerkt] = useState<"ruhe" | "speichert" | "fehler">("ruhe");
  const [mitte, setMitte] = useState<Meter>({ x: 0, y: 0 });
  const [panelOffen, setPanelOffen] = useState(true);
  /*
   * Räumliche Ansicht. Gezeichnet wird weiter in der Draufsicht — hier
   * wird geschaut. Beim Kunden am Tisch ist das der Moment, in dem aus
   * einem Grundriss ein Haus wird.
   */
  const [raeumlich, setRaeumlich] = useState(false);
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

  /**
   * Sofort sichern und warten, bis es durch ist.
   *
   * Der Autosave läuft gedrosselt — beim Planen genau richtig, bei der
   * Übergabe fatal: Der Dialog liest den Plan aus der Datenbank, und
   * wer eben noch das Modul gewählt hat, bekäme sonst eine
   * Bedarfsliste aus dem Stand von vor anderthalb Sekunden. Genau das
   * ist im Test passiert.
   */
  const jetztSichern = useCallback(async () => {
    if (planUhr.current) {
      clearTimeout(planUhr.current);
      planUhr.current = null;
    }
    const roh = JSON.stringify(plan);
    if (roh === letzterPlan.current) return;
    setGemerkt("speichert");
    const { ok } = await planSpeichern({ id: projekt.id, plan });
    letzterPlan.current = roh;
    setGemerkt(ok ? "ruhe" : "fehler");
  }, [plan, projekt.id]);

  /*
   * Beim Wechsel in die Übergabe ein Bild der Planung ablegen.
   *
   * Genau dieser Moment, und nicht bei jedem Speichern: Ein Bild zu
   * erzeugen kostet einen Canvas-Durchlauf über alle Kacheln, und
   * während des Zeichnens ändert sich ohnehin jede Sekunde etwas. Wer
   * zur Übergabe geht, hat eine Planung, die sich zeigen lässt.
   *
   * Die Karte muss dafür im DOM stehen — deshalb wird das Bild
   * unmittelbar VOR dem Umschalten gemacht, nicht danach.
   */
  const zeichenflaeche = useRef<HTMLDivElement>(null);

  const vorschauMachen = useCallback(async () => {
    /*
     * Zuerst das Bild, DANN das Speichern — in dieser Reihenfolge.
     *
     * Der Aufruf kommt aus dem Klick auf „Übergabe", und React
     * schaltet unmittelbar danach die Ansicht um: die Zeichenfläche ist
     * dann aus dem DOM. `planungAlsBild` liest deshalb synchron, bevor
     * irgendein `await` die Kontrolle abgibt. Umgekehrt entstand gar
     * kein Bild mehr, sobald das Speichern davor lag.
     */
    const wurzel = zeichenflaeche.current;
    const bild = wurzel
      ? await planungAlsBild({
          kacheln: wurzel.querySelector<HTMLElement>("[data-planer-kacheln]"),
          canvas: wurzel.querySelector<HTMLCanvasElement>("[data-planer-canvas]"),
        })
      : null;

    /*
     * In der Übergabe wird aus dem GESPEICHERTEN Plan gerechnet —
     * Bedarfsliste wie PDF. Ohne das trüge ein PDF, das unmittelbar
     * nach dem Belegen erzeugt wird, eine Anlage mit 0 kWp.
     */
    await jetztSichern();
    if (bild) await vorschauSichern({ id: projekt.id, bild });
  }, [projekt.id, jetztSichern]);

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
  /*
   * Ertrag der Anlage, laufend nachgeführt. Der Hook fragt je Fläche
   * und erst 800 ms nach der letzten Änderung — beim Ziehen am
   * Neigungsregler rechnet er solange aus dem letzten Wert hoch und
   * markiert das mit einer Tilde.
   */
  const ertrag = useErtrag(plan, projekt.ursprung, vorgabe.verlustProzent);

  const gewaehlterSpeicher = geraete.speicher.find((sp) => sp.id === plan.technik.speicher);
  const speicherKwh = gewaehlterSpeicher ? Number(gewaehlterSpeicher.nutzbar_kwh) : 0;

  const w = plan.wirtschaft;
  const wirtschaftWerte = {
    verbrauchKwh: gilt(w.verbrauchKwh, 4500),
    strompreis: gilt(w.strompreis, vorgabe.strompreis),
    verguetung: gilt(w.verguetung, vorgabe.verguetung),
    anlagenpreis: gilt(
      w.anlagenpreis,
      preisVorschlag(vorgabe, leistung, speicherKwh, w.mitSpeicher),
    ),
    foerderung: gilt(w.foerderung, regionen.find((r) => r.region === w.region)?.betrag ?? 0),
  };

  const tilde = ertrag.vorlaeufig ? "~" : "";
  const kennzahlen = [
    { wert: `${dach.toFixed(0)} m²`, label: "DACHFLÄCHE" },
    { wert: String(modulzahl), label: "MODULE" },
    { wert: `${leistung.toFixed(2).replace(".", ",")}`, label: "KWP" },
    /*
     * Der Ertrag steht in derselben Leiste wie die Module: er ist die
     * Zahl, nach der als Erstes gefragt wird. Die Tilde davor heisst,
     * dass gerade noch gerechnet wird — sie ist wichtiger als sie
     * aussieht, denn ohne sie hielte man einen Zwischenwert für den
     * endgültigen.
     */
    {
      wert:
        ertrag.anlage.jahresertragKwh > 0
          ? `${tilde}${num(Math.round(ertrag.anlage.jahresertragKwh))}`
          : "—",
      label: ertrag.quelle === "geschaetzt" ? "KWH/JAHR ~" : "KWH/JAHR",
    },
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

          <button
            type="button"
            onClick={() => setRaeumlich((v) => !v)}
            aria-pressed={raeumlich}
            className={[
              "num ml-2 flex h-8 shrink-0 items-center rounded-[9px] px-2.5 text-[12px] font-bold transition-colors",
              raeumlich ? "bg-accent text-white" : "bg-sunk text-muted hover:text-ink",
            ].join(" ")}
          >
            {raeumlich ? "3D" : "2D"}
          </button>
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1">
        {/*
          * ── Schritte, schwebend oben mittig ────────────────────────
          *
          * Vorher eine 76 px breite Spalte links. Die Zeichenfläche ist
          * der Arbeitsgegenstand; alles, was sie einrahmt, nimmt ihr
          * Platz. Schwebend über der Karte bleibt sie so gross wie
          * möglich — und der Blick springt nicht zwischen Rand und
          * Mitte.
          */}
        <nav
          className="pointer-events-none absolute left-1/2 top-3 z-20 hidden -translate-x-1/2 items-stretch gap-0.5 rounded-[14px] border border-pl-chrome-linie bg-pl-chrome px-1.5 py-1.5 shadow-[0_8px_30px_rgba(0,0,0,.4)] backdrop-blur-md sm:flex"
          aria-label="Planungsphasen"
        >
          {PHASEN.map((ph) => {
            const anklickbar = ph.fertig;
            const aktivePhase = phase === ph.nr;
            return (
              <button
                key={ph.nr}
                type="button"
                disabled={!anklickbar}
                aria-pressed={aktivePhase}
                onClick={() => {
                  /*
                   * Das Bild entsteht beim VERLASSEN einer Zeichenphase.
                   * In Phase 4 und 5 ist die Leinwand nicht im DOM — wer
                   * erst dort auslöst, bekommt kein Bild, und das
                   * Kunden-PDF trüge ein leeres Deckblatt.
                   */
                  const zeichnet = phase <= 3;
                  if (zeichnet && ph.nr >= 4 && schreibrecht) void vorschauMachen();
                  setPhase(ph.nr);
                  /*
                   * Beim Wechsel auf ein erlaubtes Werkzeug zurückfallen.
                   * Sonst bliebe „Fläche" aktiv, während die Leiste es
                   * gar nicht mehr anbietet — der nächste Klick auf die
                   * Karte legte dann eine Ecke an, die niemand wollte.
                   */
                  if (!WERKZEUGE_JE_PHASE[ph.nr].includes(werkzeug)) setWerkzeug("auswahl");
                }}
                className={[
                  "pointer-events-auto flex items-center gap-1.5 rounded-[10px] px-3 py-1.5 transition-colors",
                  aktivePhase
                    ? "bg-accent text-white"
                    : anklickbar
                      ? "text-pl-auf-dunkel-2 hover:bg-white/10"
                      : "cursor-default text-pl-auf-dunkel-4",
                ].join(" ")}
              >
                <span
                  className={[
                    "num flex h-[20px] w-[20px] items-center justify-center rounded-pill text-[11px] font-bold",
                    aktivePhase
                      ? "bg-white/25 text-white"
                      : anklickbar
                        ? "bg-white/10"
                        : "bg-white/5",
                  ].join(" ")}
                >
                  {ph.mark}
                </span>
                {/*
                  * Die Beschriftung erst ab genügend Breite. Sonst
                  * läuft die Leiste unter das Panel, und der letzte
                  * Schritt ist nicht mehr zu treffen — die Nummer
                  * allein genügt dort, die Reihenfolge kennt man nach
                  * dem zweiten Projekt.
                  */}
                <span className="hidden text-[12px] font-semibold xl:inline">{ph.label}</span>
              </button>
            );
          })}
        </nav>

        {/* ── Räumliche Ansicht ────────────────────────────────────── */}
        {raeumlich && phase !== 4 && phase !== 5 ? (
          <div className="relative min-w-0 flex-1 bg-pl-flaeche">
            <Dreidee
              plan={plan}
              ursprung={projekt.ursprung}
              anbieter={anbieter}
              /*
                * Nur für die Kachelauswahl: Breite und Höhe geben den
                * Ausschnitt vor, aus dem die Bodentextur entsteht. Ein
                * fester Wert reicht — die räumliche Ansicht hat ihre
                * eigene Kamera.
                */
              kamera={{ ursprung: projekt.ursprung, zoom, mitte, breite: 1024, hoehe: 1024 }}
              wandhoehe={plan.gebaeude.wandhoehe}
              ueberstand={plan.gebaeude.ueberstand}
            />
            <p className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-pill border border-pl-chrome-linie bg-pl-chrome px-3 py-1.5 text-[11.5px] text-pl-auf-dunkel-2 backdrop-blur-md">
              Ziehen dreht · Umschalt oder rechte Taste schwenkt · Rad zoomt
            </p>
          </div>
        ) : phase === 5 ? (
          <div className="min-w-0 flex-1 overflow-auto bg-app px-5 py-5">
            <h2 className="text-[18px] font-extrabold tracking-[-0.01em]">Übergabe</h2>
            <p className="mt-1 max-w-xl text-[13px] leading-[1.55] text-muted">
              Aus der Planung wird ein Vorgang: mit Kunde, Adresse, Anlagengrösse und einer
              Bedarfsliste, die schon steht. Was der Planer nicht sicher zuordnen kann, wird als
              Freitext übergeben und im Material ergänzt — geraten wird nichts.
            </p>

            <dl className="mt-4 grid max-w-xl gap-2.5 sm:grid-cols-2">
              {[
                ["Anlage", `${leistung.toFixed(2).replace(".", ",")} kWp`],
                ["Module", String(modulzahl)],
                [
                  "Speicher",
                  speicherKwh > 0 && plan.wirtschaft.mitSpeicher
                    ? `${num(speicherKwh)} kWh`
                    : "keiner",
                ],
                [
                  "Ertrag",
                  ertrag.anlage.jahresertragKwh > 0
                    ? `${num(Math.round(ertrag.anlage.jahresertragKwh))} kWh/Jahr`
                    : "—",
                ],
              ].map(([k, v]) => (
                <div key={k} className="rounded-card border border-line bg-surface px-4 py-3">
                  <dt className="text-[12px] text-muted">{k}</dt>
                  <dd className="num mt-0.5 text-[15px] font-bold">{v}</dd>
                </div>
              ))}
            </dl>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Uebergabe
                projektId={projekt.id}
                kunden={kunden}
                schreibrecht={schreibrecht}
                onVorOeffnen={jetztSichern}
              />
              {/*
                * Das PDF entsteht serverseitig aus dem gespeicherten
                * Plan. Deshalb vorher sichern — sonst trägt das Blatt
                * beim Kunden andere Zahlen als der Bildschirm.
                */}
              <a
                href={`/api/planer/pdf/${projekt.id}`}
                target="_blank"
                rel="noreferrer"
                onClick={() => void jetztSichern()}
                className="flex h-9 items-center rounded-[10px] border border-line bg-surface px-3.5 text-[13px] font-semibold text-ink transition-colors hover:bg-sunk"
              >
                Kunden-PDF öffnen
              </a>
            </div>
          </div>
        ) : phase === 4 ? (
          /*
           * In Phase 4 tritt die Karte ganz zurück. Hier wird nicht mehr
           * geplant, sondern gezeigt — und zwar hell, weil der Kunde
           * mitschaut und die dunkle Zeichenfläche in einem Wohnzimmer
           * am Tablet unangenehm blendet.
           */
          <div className="min-w-0 flex-1 bg-app">
            <Ergebnis
              ertragKwh={ertrag.anlage.jahresertragKwh}
              verbrauchKwh={wirtschaftWerte.verbrauchKwh}
              speicherKwh={speicherKwh}
              strompreis={wirtschaftWerte.strompreis}
              verguetung={wirtschaftWerte.verguetung}
              anlagenpreis={wirtschaftWerte.anlagenpreis}
              foerderung={wirtschaftWerte.foerderung}
              steigerung={vorgabe.steigerung}
              mitSpeicher={plan.wirtschaft.mitSpeicher}
              onMitSpeicher={(an) =>
                onPlan({ ...plan, wirtschaft: { ...plan.wirtschaft, mitSpeicher: an } }, true)
              }
              geschaetzt={ertrag.quelle === "geschaetzt"}
              vorlaeufig={ertrag.vorlaeufig}
              speicherVerfuegbar={speicherKwh > 0}
            />
          </div>
        ) : (
        /* ── Zeichenfläche, dunkel ────────────────────────────────── */
        <div ref={zeichenflaeche} className="relative min-w-0 flex-1 bg-pl-flaeche">
          {foto || verfuegbar(anbieter) ? (
            <Leinwand
              ursprung={projekt.ursprung}
              anbieter={anbieter}
              zoom={zoom}
              plan={plan}
              werkzeug={schreibrecht ? werkzeug : "auswahl"}
              schreibrecht={schreibrecht}
              bearbeitbar={bearbeitbarIn(phase)}
              fang={fang}
              foto={foto}
              onKalibriert={onKalibriert}
              aktiv={aktiv}
              onAktiv={setAktiv}
              aktiveGruppe={aktiveGruppe}
              onAktiveGruppe={setAktiveGruppe}
              aktiverStrang={aktiverStrang}
              onPlan={onPlan}
              onWerkzeug={setWerkzeug}
              onKamera={onKamera}
            />
          ) : (
            <NichtEingerichtet stand={staende.find((s) => s.id === anbieter)} />
          )}

          {/*
            * Werkzeuge, schwebend unten mittig.
            *
            * Vorher senkrecht am linken Rand. Unten in der Mitte liegen
            * sie dort, wo die Hand beim Zeichnen ohnehin ist — am iPad
            * verdeckt eine linke Spalte genau den Daumenbereich, mit dem
            * man die Karte hält.
            */}
          {schreibrecht ? (
            <div
              className="absolute bottom-3.5 left-1/2 z-10 flex -translate-x-1/2 items-stretch gap-1 rounded-[14px] border border-pl-chrome-linie bg-pl-chrome p-1.5 shadow-[0_8px_30px_rgba(0,0,0,.4)] backdrop-blur-md"
              role="group"
              aria-label="Werkzeug"
            >
              {WERKZEUGE.filter((w) => WERKZEUGE_JE_PHASE[phase].includes(w.id)).map((w) => {
                /*
                 * Modul und Teilen setzen eine gewählte Gruppe voraus —
                 * ohne sie wüsste das Werkzeug nicht, woran es arbeitet.
                 */
                const gesperrt =
                  (w.id === "hindernis" && (plan.flaechen.length === 0 || !aktiv)) ||
                  ((w.id === "modul" || w.id === "teilen") && !aktiveGruppe) ||
                  (w.id === "string" && !aktiverStrang);
                const an = werkzeug === w.id;
                return (
                  <button
                    key={w.id}
                    type="button"
                    disabled={gesperrt}
                    title={
                      gesperrt
                        ? w.id === "hindernis"
                          ? "Zuerst eine Dachfläche auswählen."
                          : w.id === "string"
                            ? "Zuerst einen String anlegen oder auswählen."
                            : "Zuerst eine Modulgruppe auswählen."
                        : w.titel
                    }
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

              <span className="my-1 w-px bg-pl-chrome-linie" />

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

          {/*
            * Was der Schritt sperrt, muss dastehen — sonst hält man
            * eine bewusste Sperre für einen Fehler und klickt dreimal
            * auf dieselbe Kante.
            */}
          {schreibrecht && (phase === 2 || phase === 3) ? (
            <div className="pointer-events-none absolute left-1/2 top-[58px] z-10 -translate-x-1/2 rounded-pill border border-pl-chrome-linie bg-pl-chrome px-3 py-1.5 text-[11.5px] text-pl-auf-dunkel-2 backdrop-blur-md">
              {phase === 2
                ? "Das Dach steht — zum Ändern zurück zu Schritt 1"
                : "Belegung steht — zum Ändern zurück zu Schritt 2"}
            </div>
          ) : null}

          {/* Kennzahlen, schwebend unten mittig */}
          <div className="pointer-events-none absolute bottom-[74px] left-1/2 z-10 flex -translate-x-1/2 items-stretch rounded-[14px] border border-pl-chrome-linie bg-pl-chrome px-1.5 py-2 shadow-[0_8px_30px_rgba(0,0,0,.4)] backdrop-blur-md">
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
        )}

        {/* ── Panel, 344 px ───────────────────────────────────────── */}
        {panelOffen && phase !== 5 ? (
          <div className="absolute inset-y-0 right-0 z-30 flex w-[var(--pl-panel-breite)] max-w-[86%] shadow-soft lg:static lg:z-auto lg:shadow-none">
            {phase === 4 ? (
              <aside className="flex w-full flex-col border-l border-line bg-panel">
                <div className="flex items-center px-4 pb-2.5 pt-3.5">
                  <h2 className="text-[15px] font-extrabold">Deine Angaben</h2>
                  <button
                    type="button"
                    onClick={() => setPanelOffen(false)}
                    aria-label="Seitenleiste schliessen"
                    className="ml-auto flex h-[30px] w-[30px] items-center justify-center rounded-[8px] text-[15px] text-muted hover:bg-sunk lg:hidden"
                  >
                    ›
                  </button>
                </div>
                <div className="flex-1 overflow-auto px-4 pb-4">
                  <WirtschaftPanel
                    plan={plan}
                    onPlan={(naechster) => onPlan(naechster, true)}
                    vorgabe={vorgabe}
                    regionen={regionen}
                    anlageKwp={leistung}
                    speicherKwh={speicherKwh}
                    schreibrecht={schreibrecht}
                  />
                </div>
              </aside>
            ) : phase === 3 ? (
              <aside className="flex w-full flex-col border-l border-line bg-panel">
                <div className="flex items-center px-4 pb-2.5 pt-3.5">
                  <h2 className="text-[15px] font-extrabold">Technik</h2>
                  <button
                    type="button"
                    onClick={() => setPanelOffen(false)}
                    aria-label="Seitenleiste schliessen"
                    className="ml-auto flex h-[30px] w-[30px] items-center justify-center rounded-[8px] text-[15px] text-muted hover:bg-sunk lg:hidden"
                  >
                    ›
                  </button>
                </div>
                <div className="flex-1 overflow-auto px-4 pb-4">
                  <TechnikPanel
                    plan={plan}
                    onPlan={onPlan}
                    module={geraete.module}
                    wechselrichter={geraete.wechselrichter}
                    speicher={geraete.speicher}
                    aktiverStrang={aktiverStrang}
                    onAktiverStrang={setAktiverStrang}
                    schreibrecht={schreibrecht}
                  />
                </div>
              </aside>
            ) : (
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
                dachAenderbar={phase === 1}
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
            )}
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
