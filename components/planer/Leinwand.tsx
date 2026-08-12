"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  bildZuMeter,
  kachelnFuer,
  type Kamera,
  massstab,
  type Meter,
  meterProPixel,
  meterZuBild,
  zoomeAn,
  ZOOM_GRENZEN,
} from "@/lib/planer/geo";
import {
  azimutAusTraufe,
  type Dachflaeche,
  type FangOptionen,
  fange,
  kanten,
  laenge,
  naechsterAufStrecke,
  punktEinfuegen,
  punktInPolygon,
  schneidetSichSelbst,
  falllinie,
  planlaengeFuerDach,
  setzeKantenlaenge,
} from "@/lib/planer/flaeche";
import {
  modulSchluessel,
  naechsteId,
  naechsterFlaechenName,
  type Plan,
  strangFarbe,
} from "@/lib/planer/plan";
import { anbieter as anbieterZu, type AnbieterId, kachelUrl } from "@/lib/planer/anbieter";
import {
  aktiveZellen,
  anbaustellen,
  modulAnbauen,
  erweitere,
  fangeAufRaster,
  insRasterZurueck,
  modulEcken,
  modulMitte,
  nachfuehren,
  planMasse,
  achsen as rasterAchsen,
  setzeFrei,
  teileGruppe,
  zelle as zellSchluessel,
} from "@/lib/planer/module";
import {
  kantenMitte,
  meterText,
  zeichneEntwurf,
  zeichneFlaeche,
  griffe,
  anbauMitte,
  gruppenRahmen,
  zeichneObjekte,
  zeichneAnbaustellen,
  zeichneAuswahl,
  zeichneGruppe,
  zeichneMessung,
  zeichneUrsprung,
} from "./zeichnen";

/*
 * Die Zeichenfläche.
 *
 * Zwei Schichten über einer Kamera: DOM-Bilder für die Kacheln (der
 * Browser dekodiert und cacht sie selbst), darüber ein Canvas für die
 * Geometrie. Ab Stufe 3 liegen dort zweihundert Module — als DOM-Knoten
 * wäre das am iPad zäh.
 *
 * Kamera und Plan liegen in Refs, nicht im State: beim Ziehen ändern sie
 * sich sechzig Mal je Sekunde, und jedes davon wäre sonst ein
 * React-Durchlauf mitten in der Bewegung.
 */

export type Werkzeug =
  | "auswahl"
  | "flaeche"
  | "hindernis"
  | "messen"
  /** Referenzstrecke ziehen und ihre wahre Länge eingeben. */
  | "kalibrieren"
  /** Zweite Strecke quer dazu — deckt ein verzerrtes Foto auf. */
  | "gegenprobe"
  /** Einzelne Module frei ziehen und zurücksetzen. */
  | "baum"
  | "modul"
  /** Auswahlrechteck ziehen und daraus eine eigene Gruppe machen. */
  | "teilen"
  /** Module dem gewählten String zuordnen — „malen" laut Briefing 5.2. */
  | "string";

export interface FotoQuelle {
  url: string;
  breite: number;
  hoehe: number;
  /** Meter je Bildpunkt. Null = hochgeladen, aber nicht kalibriert. */
  meterProPixel: number | null;
}

/**
 * Vorläufiger Massstab für ein unkalibriertes Foto: das Bild soll rund
 * 60 m überspannen. Nur damit überhaupt etwas zu sehen ist — jede Länge
 * daraus ist geraten, und die Oberfläche sagt das auch.
 */
export function vorlaeufigerMassstab(breite: number): number {
  return 60 / Math.max(1, breite);
}

export interface LeinwandProps {
  ursprung: { lat: number; lon: number };
  anbieter: AnbieterId;
  zoom: number;
  plan: Plan;
  werkzeug: Werkzeug;
  fang: FangOptionen;
  /** Gesetzt: das Foto ersetzt die Karte (Briefing 2.3). */
  foto: FotoQuelle | null;
  onKalibriert: (meterProPixel: number, faktor: number) => void;
  aktiv: string | null;
  onAktiv: (id: string | null) => void;
  aktiveGruppe: string | null;
  onAktiveGruppe: (id: string | null) => void;
  /** Welcher String gerade gemalt wird. */
  aktiverStrang: string | null;
  /** `schritt` legt einen Rückschritt an; false für Zwischenstände beim Ziehen. */
  onPlan: (plan: Plan, schritt: boolean) => void;
  onWerkzeug: (w: Werkzeug) => void;
  /** Ohne Schreibrecht keine Anbaustellen — sie liessen sich nicht nutzen. */
  schreibrecht: boolean;
  /**
   * Was in diesem Schritt angefasst werden darf.
   *
   * Die Werkzeugleiste zeigt schon nur die passenden Werkzeuge — das
   * allein genügt aber nicht: Ecken, Kanten und Gruppen lassen sich
   * auch mit dem Auswahlwerkzeug ziehen. Ohne diese Sperre verschöbe
   * man in der Belegung weiterhin Dachkanten, und die fertige Planung
   * verrutschte unbemerkt.
   */
  bearbeitbar: { flaechen: boolean; module: boolean; strings: boolean };
  /**
   * Verschattungsgrad je Modul aus der Ertragsrechnung. Wird nur
   * angezeigt, nicht hier berechnet — die Rechnung hängt am Ertrag.
   */
  schatten?: Map<string, { grad: number }>;
  onKamera?: (k: { zoom: number; mitte: Meter }) => void;
}

/** Trefferzone in Bildpunkten — grosszügig, weil am iPad ein Finger zielt. */
const GRIFF = 12;

/** Module der übrigen Gruppen derselben Fläche — die bleiben besetzt. */
function fremdeModule(plan: Plan, eigene: { id: string; flaeche: string }): Meter[][] {
  return plan.gruppen
    .filter((x) => x.id !== eigene.id && x.flaeche === eigene.flaeche)
    .flatMap((x) => {
      const f = plan.flaechen.find((y) => y.id === x.flaeche);
      return f ? aktiveZellen(x).map((z) => modulEcken(x, f, z.reihe, z.spalte)) : [];
    });
}

export function Leinwand(p: LeinwandProps) {
  const huelle = useRef<HTMLDivElement>(null);
  const kachelSchicht = useRef<HTMLDivElement>(null);
  const flaeche = useRef<HTMLCanvasElement>(null);

  const kamera = useRef<Kamera>({
    ursprung: p.ursprung,
    mitte: { x: 0, y: 0 },
    zoom: p.zoom,
    breite: 0,
    hoehe: 0,
  });

  /* Aktueller Stand für die Ereignisbehandler, die nur einmal gebunden werden. */
  const stand = useRef(p);
  stand.current = p;

  const [anzeige, setAnzeige] = useState({ zoom: p.zoom, leiste: { meter: 10, punkte: 0 } });
  const [zeigerMeter, setZeigerMeter] = useState<Meter | null>(null);
  /** Ein langer Druck hat ein Modul aus dem Raster gelöst. */
  const [langerDruck, setLangerDruck] = useState(false);
  const [kachelFehler, setKachelFehler] = useState(false);
  const [fangHinweis, setFangHinweis] = useState<string | null>(null);
  /*
   * Rahmen der gewählten Gruppe als Attribut am Wurzelknoten.
   *
   * Die Griffe liegen im Canvas und sind von aussen unsichtbar — ohne
   * diese Angabe liesse sich nicht prüfen, ob ein Zug am Griff wirklich
   * am Griff ankommt. Vier Zahlen, die ohnehin schon berechnet werden.
   */
  const [rahmenAttribut, setRahmenAttribut] = useState<string | undefined>(undefined);
  /** Kurze Rückmeldung, wenn eine Eingabe abgelehnt wurde. */
  const [meldung, setMeldung] = useState<string | null>(null);

  /** Umriss, der gerade entsteht. */
  const entwurf = useRef<Meter[]>([]);
  const [entwurfLaenge, setEntwurfLaenge] = useState(0);
  const messung = useRef<{ von: Meter; nach: Meter } | null>(null);
  const auswahl = useRef<{ von: Meter; nach: Meter } | null>(null);
  const zieht = useRef<
    | { art: "ecke"; flaeche: string; index: number }
    | { art: "kante"; flaeche: string; index: number; letzte: Meter }
    | { art: "hindernis"; flaeche: string; von: Meter }
    | { art: "gruppe"; gruppe: string; reihe: number; spalte: number; letzte: Meter }
    /*
     * Zug am Verschiebe-Symbol. Getrennt von "gruppe": Dort
     * entscheidet die Wegstrecke zwischen Tippen (Modul schalten) und
     * Ziehen. Am Symbol gibt es nichts zu schalten — ein kurzer Tipp
     * darf dort kein Modul abschalten, das gar nicht darunter liegt.
     */
    | { art: "schieben"; gruppe: string; letzte: Meter }
    | { art: "drehen"; gruppe: string }
    | { art: "erweitern"; gruppe: string; richtung: "oben" | "unten" | "links" | "rechts"; start: Meter; angewandt: number }
    | { art: "modul"; gruppe: string; reihe: number; spalte: number }
    | { art: "auswahl"; von: Meter }
    | { art: "malen" }
    | { art: "messen" }
    | { art: "schwenk" }
    | null
  >(null);

  /** Referenzstrecke gezogen — jetzt fehlt ihre wahre Länge. */
  const [kalibrierEingabe, setKalibrierEingabe] = useState<
    { art: "kalibrieren" | "gegenprobe"; gemessen: number; x: number; y: number; wert: string } | null
  >(null);

  const [maszEingabe, setMaszEingabe] = useState<
    { flaeche: string; kante: number; x: number; y: number; wert: string } | null
  >(null);

  const neuZeichnen = useRef(false);
  const bilder = useRef(new Map<string, HTMLImageElement>());
  const fotoBild = useRef<HTMLImageElement | null>(null);

  /* ── Kacheln ─────────────────────────────────────────────────── */

  /** Das Foto liegt an der Stelle der Kacheln, mittig um den Ursprung. */
  const legeFoto = useCallback(() => {
    const schicht = kachelSchicht.current;
    const f = stand.current.foto;
    if (!schicht || !f) return;

    // Alte Kacheln müssen weg, sonst scheinen sie unter dem Foto durch.
    for (const [, b] of bilder.current) b.remove();
    bilder.current.clear();

    let bild = fotoBild.current;
    if (!bild || bild.dataset.quelle !== f.url) {
      bild?.remove();
      bild = new Image();
      bild.dataset.quelle = f.url;
      bild.decoding = "async";
      bild.draggable = false;
      bild.style.position = "absolute";
      bild.style.left = "0";
      bild.style.top = "0";
      bild.style.transformOrigin = "0 0";
      bild.addEventListener("error", () => setMeldung("Das Foto konnte nicht geladen werden."));
      bild.src = f.url;
      schicht.appendChild(bild);
      fotoBild.current = bild;
    }

    const mpp = f.meterProPixel ?? vorlaeufigerMassstab(f.breite);
    const breiteM = f.breite * mpp;
    const hoeheM = f.hoehe * mpp;
    const k = kamera.current;
    // Linke obere Ecke im Metersystem — das Foto sitzt mittig um den Ursprung.
    const ecke = meterZuBild(k, { x: -breiteM / 2, y: hoeheM / 2 });
    const s = 1 / meterProPixel(k.ursprung.lat, k.zoom);
    bild.style.width = `${breiteM * s}px`;
    bild.style.height = `${hoeheM * s}px`;
    bild.style.transform = `translate3d(${ecke.x}px, ${ecke.y}px, 0)`;
  }, []);

  const legeKacheln = useCallback(() => {
    const schicht = kachelSchicht.current;
    if (!schicht) return;
    if (stand.current.foto) return legeFoto();
    // Zurück auf die Karte: ein liegengebliebenes Foto verdeckt sie sonst.
    if (fotoBild.current) {
      fotoBild.current.remove();
      fotoBild.current = null;
    }
    const k = kamera.current;
    const grenze = anbieterZu(stand.current.anbieter).maxStufe;
    const gebraucht = new Set<string>();

    for (const t of kachelnFuer(k, grenze)) {
      const schluessel = `${t.z}/${t.x}/${t.y}`;
      gebraucht.add(schluessel);
      let b = bilder.current.get(schluessel);
      if (!b) {
        b = new Image();
        /*
         * `anonymous` ist die Voraussetzung dafür, dass sich aus der
         * Karte später ein Bild machen lässt: ohne CORS-Zustimmung gilt
         * das Canvas als „getaintet" und `toDataURL` wirft. Basemap und
         * der eigene Kachel-Proxy erlauben es beide.
         */
        b.crossOrigin = "anonymous";
        b.decoding = "async";
        b.draggable = false;
        b.style.position = "absolute";
        b.style.left = "0";
        b.style.top = "0";
        b.style.transformOrigin = "0 0";
        b.style.opacity = "0";
        b.style.transition = "opacity 140ms linear";
        b.addEventListener("load", () => void (b!.style.opacity = "1"));
        b.addEventListener("error", () => setKachelFehler(true));
        b.src = kachelUrl(stand.current.anbieter, t.z, t.x, t.y);
        schicht.appendChild(b);
        bilder.current.set(schluessel, b);
      }
      // Eine Zehntel Überlappung gegen helle Fugen bei gebrochenem Zoom.
      b.style.width = `${t.groesse + 0.6}px`;
      b.style.height = `${t.groesse + 0.6}px`;
      b.style.transform = `translate3d(${t.links}px, ${t.oben}px, 0)`;
    }

    for (const [schluessel, b] of bilder.current) {
      if (gebraucht.has(schluessel)) continue;
      b.remove();
      bilder.current.delete(schluessel);
    }
  }, [legeFoto]);

  /* ── Geometrie ───────────────────────────────────────────────── */

  const zeichne = useCallback(() => {
    const c = flaeche.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const k = kamera.current;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (c.width !== Math.round(k.breite * dpr)) {
      c.width = Math.round(k.breite * dpr);
      c.height = Math.round(k.hoehe * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, k.breite, k.hoehe);

    zeichneUrsprung(ctx, k);
    const sicht = { kamera: k, aktiv: stand.current.aktiv, betont: null };
    for (const f of stand.current.plan.flaechen) zeichneFlaeche(ctx, sicht, f);

    // Module über die Flächen — sie liegen ja auch darauf.
    /*
     * Farbe je Modul aus seiner String-Zugehörigkeit. Ohne String bleibt
     * es neutral — so sieht man auf einen Blick, was noch offen ist.
     */
    const farben = new Map<string, string>();
    stand.current.plan.strings.forEach((st, i) => {
      for (const m of st.module) farben.set(m, strangFarbe(i));
    });

    for (const g of stand.current.plan.gruppen) {
      const f = stand.current.plan.flaechen.find((x) => x.id === g.flaeche);
      if (f) {
        zeichneGruppe(
          ctx,
          k,
          g,
          f,
          stand.current.aktiveGruppe === g.id,
          farben,
          stand.current.schatten,
        );
      }
    }

    // Bäume und Nachbargebäude über der Belegung: sie stehen davor.
    if (stand.current.plan.objekte.length > 0) {
      zeichneObjekte(ctx, k, stand.current.plan.objekte);
    }

    if (entwurf.current.length > 0) {
      const vorschau = zeigerRef.current;
      const kette = vorschau ? [...entwurf.current, vorschau] : entwurf.current;
      zeichneEntwurf(ctx, k, entwurf.current, vorschau, schneidetSichSelbst(kette));
    }
    if (messung.current) zeichneMessung(ctx, k, messung.current.von, messung.current.nach);
    if (auswahl.current) zeichneAuswahl(ctx, k, auswahl.current.von, auswahl.current.nach);

    const gewaehlt = stand.current.plan.gruppen.find((g) => g.id === stand.current.aktiveGruppe);
    const gf = gewaehlt
      ? stand.current.plan.flaechen.find((x) => x.id === gewaehlt.flaeche)
      : null;

    /*
     * Anbaustellen der gewählten Gruppe: dort, wo das nächste Modul
     * liegen würde. Sie werden bei jedem Zeichnen neu bestimmt — dann
     * stimmen sie auch, nachdem jemand ein Modul entfernt oder die
     * Gruppe verschoben hat, ohne dass es dafür einen Sonderfall
     * braucht.
     */
    if (
      gewaehlt &&
      gf &&
      stand.current.werkzeug === "auswahl" &&
      stand.current.schreibrecht &&
      stand.current.bearbeitbar.module
    ) {
      stellen.current = anbaustellen(gewaehlt, gf, fremdeModule(stand.current.plan, gewaehlt));
      zeichneAnbaustellen(ctx, k, gewaehlt, gf, stellen.current);
    } else {
      stellen.current = [];
    }

    const rahmen = gewaehlt && gf ? gruppenRahmen(k, gewaehlt, gf) : null;
    setRahmenAttribut(
      rahmen
        ? [rahmen.links, rahmen.oben, rahmen.rechts, rahmen.unten].map((v) => Math.round(v)).join(",")
        : undefined,
    );
  }, []);

  const zeigerRef = useRef<Meter | null>(null);
  /** Anbaustellen aus dem letzten Zeichnen — Grundlage für den Treffer. */
  const stellen = useRef<Array<{ reihe: number; spalte: number }>>([]);

  const anstossen = useCallback(() => {
    if (neuZeichnen.current) return;
    neuZeichnen.current = true;
    requestAnimationFrame(() => {
      neuZeichnen.current = false;
      legeKacheln();
      zeichne();
      const k = kamera.current;
      setAnzeige({ zoom: k.zoom, leiste: massstab(k) });
      stand.current.onKamera?.({ zoom: k.zoom, mitte: k.mitte });
    });
  }, [legeKacheln, zeichne]);

  /* Neuzeichnen, wenn sich Plan, Auswahl oder Werkzeug ändern. */
  useEffect(() => {
    anstossen();
  }, [p.plan, p.aktiv, p.aktiveGruppe, p.werkzeug, p.foto, p.schatten, anstossen]);

  /* ── Grösse, Anbieter, Ursprung ──────────────────────────────── */

  useEffect(() => {
    const el = huelle.current;
    if (!el) return;
    const beobachter = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      kamera.current.breite = r.width;
      kamera.current.hoehe = r.height;
      anstossen();
    });
    beobachter.observe(el);
    return () => beobachter.disconnect();
  }, [anstossen]);

  useEffect(() => {
    for (const [, b] of bilder.current) b.remove();
    bilder.current.clear();
    setKachelFehler(false);
    anstossen();
  }, [p.anbieter, anstossen]);

  useEffect(() => {
    kamera.current.ursprung = p.ursprung;
    anstossen();
  }, [p.ursprung, anstossen]);

  useEffect(() => {
    const k = kamera.current;
    if (Math.abs(k.zoom - p.zoom) < 0.001) return;
    Object.assign(k, zoomeAn(k, { x: k.breite / 2, y: k.hoehe / 2 }, p.zoom));
    anstossen();
  }, [p.zoom, anstossen]);

  /* ── Treffer ─────────────────────────────────────────────────── */

  const treffer = useCallback((bp: { x: number; y: number }) => {
    const k = kamera.current;
    const s = stand.current;
    const aktive = s.plan.flaechen.find((f) => f.id === s.aktiv);

    /*
     * Griffe der gewählten Gruppe zuerst: sie liegen über allem und sind
     * klein — wer sie trifft, meint sie.
     *
     * ABER nur im Auswahl-Werkzeug. Die Griffe gehören zur Auswahl; mit
     * einem anderen Werkzeug in der Hand fingen sie sonst Klicks ab, die
     * dem Modul darunter galten. Beim String-Werkzeug verschluckten sie
     * die Zuordnung, und ein Zug am Griff schrumpfte die Gruppe, statt
     * Module zu färben — die Module waren danach weg.
     */
    const gewaehlt =
      s.werkzeug === "auswahl" && s.bearbeitbar.module
        ? s.plan.gruppen.find((g) => g.id === s.aktiveGruppe)
        : undefined;
    if (gewaehlt) {
      const gf = s.plan.flaechen.find((x) => x.id === gewaehlt.flaeche);

      /*
       * Anbaustellen zuerst: Sie liegen ausserhalb der Gruppe und damit
       * genau dort, wo sonst „nichts" wäre — der Klick würde sonst als
       * Schwenk verpuffen. Sie stammen aus dem letzten Zeichnen, sind
       * also immer auf dem Stand des Bildes.
       */
      if (gf) {
        for (const stelle of stellen.current) {
          const m = anbauMitte(k, gewaehlt, gf, stelle);
          if (Math.hypot(m.x - bp.x, m.y - bp.y) <= GRIFF + 2) {
            return { art: "anbau" as const, gruppe: gewaehlt.id, ...stelle };
          }
        }
      }

      const rahmen = gf ? gruppenRahmen(k, gewaehlt, gf) : null;
      if (rahmen) {
        for (const griff of griffe(rahmen)) {
          if (Math.hypot(griff.x - bp.x, griff.y - bp.y) <= GRIFF) {
            return { art: "griff" as const, gruppe: gewaehlt.id, welcher: griff.art };
          }
        }
      }
    }

    /*
     * Module danach: sie liegen über den Flächen, und wer auf ein Modul
     * tippt, meint das Modul — nicht die Fläche darunter.
     */
    const zeigerM = bildZuMeter(k, bp);
    for (const g of s.plan.gruppen) {
      const f = s.plan.flaechen.find((x) => x.id === g.flaeche);
      if (!f) continue;
      for (let r = 0; r < g.reihen; r++) {
        for (let c = 0; c < g.spalten; c++) {
          if (punktInPolygon(zeigerM, modulEcken(g, f, r, c))) {
            return { art: "modul" as const, gruppe: g.id, reihe: r, spalte: c };
          }
        }
      }
    }

    /*
     * Ecken, Massangaben und Kanten nur im Dach-Schritt. Später sind
     * sie zwar noch zu sehen, aber nicht mehr zu greifen — sonst
     * verschöbe ein Fehlgriff beim Belegen die Dachkante, und die
     * fertige Planung wäre still verrutscht.
     */
    if (aktive && s.bearbeitbar.flaechen) {
      for (let i = 0; i < aktive.punkte.length; i++) {
        const b = meterZuBild(k, aktive.punkte[i]!);
        if (Math.hypot(b.x - bp.x, b.y - bp.y) <= GRIFF) {
          return { art: "ecke" as const, flaeche: aktive.id, index: i };
        }
      }
    }

    // Pillen zuerst: sie liegen auf der Kante und sollen sie überstimmen.
    if (s.bearbeitbar.flaechen)
    for (const f of s.plan.flaechen) {
      for (const kante of kanten(f.punkte)) {
        const m = kantenMitte(k, kante.a, kante.b);
        const p1 = meterZuBild(k, kante.a);
        const p2 = meterZuBild(k, kante.b);
        if (Math.hypot(p2.x - p1.x, p2.y - p1.y) < 46) continue;
        if (Math.abs(m.x - bp.x) <= 34 && Math.abs(m.y - bp.y) <= 11) {
          return { art: "masz" as const, flaeche: f.id, index: kante.i };
        }
      }
    }

    if (s.bearbeitbar.flaechen)
    for (const f of s.plan.flaechen) {
      for (const kante of kanten(f.punkte)) {
        const nah = meterZuBild(k, naechsterAufStrecke(bildZuMeter(k, bp), kante.a, kante.b));
        if (Math.hypot(nah.x - bp.x, nah.y - bp.y) <= GRIFF) {
          return { art: "kante" as const, flaeche: f.id, index: kante.i };
        }
      }
    }

    const m = bildZuMeter(k, bp);
    for (const f of s.plan.flaechen) {
      if (punktInPolygon(m, f.punkte)) return { art: "flaeche" as const, flaeche: f.id, index: -1 };
    }
    return null;
  }, []);

  /* ── Planänderungen ──────────────────────────────────────────── */

  const aendereFlaeche = useCallback(
    (id: string, wie: (f: Dachflaeche) => Dachflaeche, schritt: boolean) => {
      const s = stand.current;
      s.onPlan(
        { ...s.plan, flaechen: s.plan.flaechen.map((f) => (f.id === id ? wie(f) : f)) },
        schritt,
      );
    },
    [],
  );

  const entwurfAbschliessen = useCallback(() => {
    const s = stand.current;
    const punkte = entwurf.current;
    if (punkte.length < 3 || schneidetSichSelbst(punkte)) {
      entwurf.current = [];
      setEntwurfLaenge(0);
      anstossen();
      return;
    }

    if (s.werkzeug === "hindernis") {
      const ziel = s.plan.flaechen.find((f) => f.id === s.aktiv);
      /*
       * Ein Kamin neben dem Dach ist keine Angabe, sondern ein Versehen:
       * er sperrt nichts und taucht in keiner Rechnung auf. Statt ihn
       * still anzulegen, wird abgelehnt und gesagt, warum.
       */
      const mitte = {
        x: punkte.reduce((a, q) => a + q.x, 0) / punkte.length,
        y: punkte.reduce((a, q) => a + q.y, 0) / punkte.length,
      };
      if (ziel && !punktInPolygon(mitte, ziel.punkte)) {
        setMeldung("Das Hindernis muss auf der gewählten Dachfläche liegen.");
        entwurf.current = [];
        setEntwurfLaenge(0);
        anstossen();
        return;
      }
      if (ziel) {
        aendereFlaeche(
          ziel.id,
          (f) => ({
            ...f,
            hindernisse: [
              ...f.hindernisse,
              {
                id: naechsteId(f.hindernisse.map((h) => h.id), "h"),
                art: "polygon",
                name: `Hindernis ${f.hindernisse.length + 1}`,
                punkte,
                abstand: 0.3,
              },
            ],
          }),
          true,
        );
      }
    } else {
      const id = naechsteId(s.plan.flaechen.map((f) => f.id), "f");
      /*
       * Traufe auf die längste Kante vorbelegen. Bei einem Satteldach,
       * einem Pultdach und den allermeisten Grundrissen ist die Traufe
       * die lange Kante — und ohne Traufe gäbe es weder Falllinie noch
       * Azimut, also müsste der Nutzer erst im Panel etwas einstellen,
       * bevor die Fläche irgendetwas aussagt. Ändern kann er es dort
       * weiterhin.
       */
      const laengste = kanten(punkte).reduce(
        (best, k) => (laenge(k.a, k.b) > laenge(best.a, best.b) ? k : best),
        kanten(punkte)[0]!,
      );
      const neue: Dachflaeche = {
        id,
        name: naechsterFlaechenName(s.plan.flaechen),
        punkte,
        neigung: 30,
        azimut: 180,
        traufe: laengste.i,
        randabstand: 0.3,
        hindernisse: [],
      };
      neue.azimut = azimutAusTraufe(neue) ?? 180;
      s.onPlan({ ...s.plan, flaechen: [...s.plan.flaechen, neue] }, true);
      s.onAktiv(id);
    }

    entwurf.current = [];
    setEntwurfLaenge(0);
    s.onWerkzeug("auswahl");
    anstossen();
  }, [aendereFlaeche, anstossen]);

  /**
   * Ein Modul dem aktiven String zuschlagen — oder herausnehmen, wenn es
   * schon drin ist. Beim Ziehen wird jedes berührte Modul einmal
   * behandelt; ohne die Merkliste flackerte es zwischen drin und
   * draussen, solange der Finger daraufsteht.
   */
  const gemalt = useRef(new Set<string>());

  const malenAnStrang = useCallback((gruppe: string, reihe: number, spalte: number) => {
    const s = stand.current;
    if (!s.aktiverStrang) {
      setMeldung("Zuerst einen String anlegen oder auswählen.");
      return;
    }
    const schluessel = modulSchluessel(gruppe, reihe, spalte);
    if (gemalt.current.has(schluessel)) return;
    gemalt.current.add(schluessel);

    const strang = s.plan.strings.find((x) => x.id === s.aktiverStrang);
    if (!strang) return;
    const drin = strang.module.includes(schluessel);

    s.onPlan(
      {
        ...s.plan,
        strings: s.plan.strings.map((x) => {
          if (x.id === strang.id) {
            return {
              ...x,
              module: drin
                ? x.module.filter((m) => m !== schluessel)
                : [...x.module, schluessel],
            };
          }
          // Ein Modul gehört zu genau einem String — aus den anderen raus.
          return drin ? x : { ...x, module: x.module.filter((m) => m !== schluessel) };
        }),
      },
      false,
    );
  }, []);

  /* ── Eingabe ─────────────────────────────────────────────────── */

  useEffect(() => {
    const el = huelle.current;
    if (!el) return;

    const zeiger = new Map<number, { x: number; y: number }>();

    /*
     * Langer Druck auf ein Modul löst es aus dem Raster (Briefing 4.2,
     * Abnahmetest 9 und 23).
     *
     * Auf dem iPad ist das der einzige brauchbare Weg: Dort gibt es
     * keine rechte Maustaste und keinen Modifikator, und wer für jedes
     * einzelne Modul erst oben das Werkzeug wechseln muss, lässt es
     * beim Kunden bleiben. Am Schreibtisch bleibt das Modul-Werkzeug
     * der schnellere Weg — beides führt zum selben Zustand.
     */
    let druckUhr: ReturnType<typeof setTimeout> | null = null;
    const druckLoesen = () => {
      if (druckUhr) clearTimeout(druckUhr);
      druckUhr = null;
    };
    let letzterAbstand = 0;
    let letzteMitte = { x: 0, y: 0 };
    let bewegt = 0;

    const ortVon = (e: PointerEvent | WheelEvent) => {
      const r = el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    /** Zeigerposition in Metern, mit Fanghilfen. */
    const gefangen = (bp: { x: number; y: number }, bezug: Meter | null): Meter => {
      const s = stand.current;
      const roh = bildZuMeter(kamera.current, bp);
      const bestehende = s.plan.flaechen.flatMap((f) =>
        kanten(f.punkte).map((k) => ({ a: k.a, b: k.b })),
      );
      const { punkt, hinweis } = fange(roh, bezug, bestehende, s.fang);
      setFangHinweis(
        hinweis === "rechter-winkel" ? "rechter Winkel" : hinweis === "parallel" ? "parallel" : null,
      );
      return punkt;
    };

    const runter = (e: PointerEvent) => {
      el.setPointerCapture(e.pointerId);
      const bp = ortVon(e);
      zeiger.set(e.pointerId, bp);
      bewegt = 0;
      gemalt.current.clear();

      if (zeiger.size === 2) {
        const [a, b] = [...zeiger.values()];
        letzterAbstand = Math.hypot(b!.x - a!.x, b!.y - a!.y);
        letzteMitte = { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 };
        zieht.current = null;
        return;
      }

      const s = stand.current;
      if (s.werkzeug === "messen" || s.werkzeug === "kalibrieren" || s.werkzeug === "gegenprobe") {
        const m = bildZuMeter(kamera.current, bp);
        messung.current = { von: m, nach: m };
        zieht.current = { art: "messen" };
        return;
      }
      if (s.werkzeug === "baum") {
        /*
         * Ein Klick setzt einen Baum mit Standardmassen — Höhe und
         * Krone werden danach im Panel angepasst. Zwei Werte beim
         * Setzen abzufragen würde den Fluss brechen; am Küchentisch
         * zeigt der Kunde auf die Fichte, und sie soll dort erscheinen.
         */
        const m = bildZuMeter(kamera.current, bp);
        s.onPlan(
          {
            ...s.plan,
            objekte: [
              ...s.plan.objekte,
              {
                id: naechsteId(s.plan.objekte.map((o) => o.id), "o"),
                art: "baum" as const,
                name: `Baum ${s.plan.objekte.filter((o) => o.art === "baum").length + 1}`,
                hoehe: 10,
                mitte: m,
                radius: 3,
              },
            ],
          },
          true,
        );
        zieht.current = null;
        return;
      }
      if (s.werkzeug === "hindernis" && s.aktiv) {
        zieht.current = { art: "hindernis", flaeche: s.aktiv, von: gefangen(bp, null) };
        return;
      }
      if (s.werkzeug === "flaeche") {
        // Punkte entstehen beim Loslassen — sonst legt schon ein Schwenk
        // mit zwei Fingern Ecken an.
        zieht.current = null;
        return;
      }

      if (s.werkzeug === "teilen") {
        const m = bildZuMeter(kamera.current, bp);
        auswahl.current = { von: m, nach: m };
        zieht.current = { art: "auswahl", von: m };
        return;
      }

      const t = treffer(bp);
      if (s.werkzeug === "string") {
        /*
         * Immer malen, auch wenn der Strich neben der Belegung beginnt.
         * Sonst schwenkte ein Zug, der knapp neben dem ersten Modul
         * ansetzt, nur die Karte — und man wundert sich, warum nichts
         * eingefärbt wird.
         */
        if (t?.art === "modul") malenAnStrang(t.gruppe, t.reihe, t.spalte);
        zieht.current = { art: "malen" };
        return;
      }
      if (t?.art === "anbau") {
        /*
         * Ein Klick auf das Plus setzt genau ein Modul — kein Ziehen,
         * kein Zwischenzustand. Als eigener Schritt im Verlauf, damit
         * ein versehentliches Modul mit einem Rückschritt wieder
         * verschwindet.
         */
        const g = s.plan.gruppen.find((x) => x.id === t.gruppe);
        const gf = g ? s.plan.flaechen.find((x) => x.id === g.flaeche) : null;
        if (g && gf) {
          const erweitert = modulAnbauen(g, gf, { reihe: t.reihe, spalte: t.spalte });
          s.onPlan(
            { ...s.plan, gruppen: s.plan.gruppen.map((x) => (x.id === g.id ? erweitert : x)) },
            true,
          );
        }
        zieht.current = null;
        return;
      }
      if (t?.art === "griff") {
        zieht.current =
          t.welcher === "drehen"
            ? { art: "drehen", gruppe: t.gruppe }
            : t.welcher === "verschieben"
              ? { art: "schieben", gruppe: t.gruppe, letzte: bildZuMeter(kamera.current, bp) }
              : {
                  art: "erweitern",
                  gruppe: t.gruppe,
                  richtung: t.welcher,
                  start: bildZuMeter(kamera.current, bp),
                  angewandt: 0,
                };
      } else if (t?.art === "modul" && s.werkzeug === "modul") {
        zieht.current = { art: "modul", gruppe: t.gruppe, reihe: t.reihe, spalte: t.spalte };
      } else if (t?.art === "modul" && !s.bearbeitbar.module) {
        // In einem späteren Schritt ist das Modul nur noch anzusehen.
        zieht.current = { art: "schwenk" };
      } else if (t?.art === "modul") {
        // Tippen schaltet das Modul, Ziehen verschiebt die Gruppe —
        // entschieden wird erst beim Loslassen, an der Wegstrecke.
        zieht.current = {
          art: "gruppe",
          gruppe: t.gruppe,
          reihe: t.reihe,
          spalte: t.spalte,
          letzte: bildZuMeter(kamera.current, bp),
        };

        /*
         * Wer den Finger liegen lässt, will das einzelne Modul, nicht
         * die Gruppe. Nach 450 ms ohne nennenswerte Bewegung wird
         * umgeschaltet — die Schwelle unten in `bewegung` bricht ab,
         * sobald jemand doch schiebt.
         */
        const ziel = { gruppe: t.gruppe, reihe: t.reihe, spalte: t.spalte };
        druckUhr = setTimeout(() => {
          druckUhr = null;
          if (zieht.current?.art !== "gruppe") return;
          zieht.current = { art: "modul", ...ziel };
          setLangerDruck(true);
          // Kurz vibrieren, wo es geht: das Umschalten passiert unter
          // dem Finger und ist sonst nicht zu bemerken.
          navigator.vibrate?.(12);
        }, 450);
      } else if (t?.art === "ecke") {
        zieht.current = { art: "ecke", flaeche: t.flaeche, index: t.index };
      } else if (t?.art === "kante") {
        zieht.current = {
          art: "kante",
          flaeche: t.flaeche,
          index: t.index,
          letzte: bildZuMeter(kamera.current, bp),
        };
      } else {
        zieht.current = { art: "schwenk" };
      }
    };

    const bewegung = (e: PointerEvent) => {
      const jetzt = ortVon(e);
      const k = kamera.current;
      const s = stand.current;

      if (!zeiger.has(e.pointerId)) {
        const bezug = entwurf.current.length
          ? entwurf.current[entwurf.current.length - 1]!
          : null;
        const m = s.werkzeug === "flaeche" ? gefangen(jetzt, bezug) : bildZuMeter(k, jetzt);
        zeigerRef.current = s.werkzeug === "flaeche" ? m : null;
        setZeigerMeter(m);
        if (entwurf.current.length) anstossen();
        return;
      }

      const vorher = zeiger.get(e.pointerId)!;
      zeiger.set(e.pointerId, jetzt);
      bewegt += Math.hypot(jetzt.x - vorher.x, jetzt.y - vorher.y);
      // Mehr als ein Wackeln heisst: schieben, nicht halten.
      if (druckUhr && bewegt > 6) druckLoesen();
      const mpp = meterProPixel(k.ursprung.lat, k.zoom);

      if (zeiger.size === 2) {
        const [a, b] = [...zeiger.values()];
        const abstand = Math.hypot(b!.x - a!.x, b!.y - a!.y);
        const mitte = { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 };
        if (letzterAbstand > 0 && abstand > 0) {
          Object.assign(k, zoomeAn(k, mitte, k.zoom + Math.log2(abstand / letzterAbstand)));
        }
        const mppNeu = meterProPixel(k.ursprung.lat, k.zoom);
        k.mitte = {
          x: k.mitte.x - (mitte.x - letzteMitte.x) * mppNeu,
          y: k.mitte.y + (mitte.y - letzteMitte.y) * mppNeu,
        };
        letzterAbstand = abstand;
        letzteMitte = mitte;
        anstossen();
        return;
      }

      const z = zieht.current;
      if (!z || z.art === "schwenk") {
        k.mitte = {
          x: k.mitte.x - (jetzt.x - vorher.x) * mpp,
          y: k.mitte.y + (jetzt.y - vorher.y) * mpp,
        };
        anstossen();
        return;
      }

      if (z.art === "messen" && messung.current) {
        messung.current = { ...messung.current, nach: bildZuMeter(k, jetzt) };
        anstossen();
        return;
      }

      if (z.art === "hindernis") {
        const bis = gefangen(jetzt, null);
        entwurf.current = [
          z.von,
          { x: bis.x, y: z.von.y },
          bis,
          { x: z.von.x, y: bis.y },
        ];
        setEntwurfLaenge(4);
        anstossen();
        return;
      }

      if (z.art === "ecke") {
        const f = s.plan.flaechen.find((x) => x.id === z.flaeche);
        if (!f) return;
        const nachbarn = f.punkte.filter((_, i) => i !== z.index);
        const bezug = f.punkte[(z.index - 1 + f.punkte.length) % f.punkte.length]!;
        const ziel = gefangen(jetzt, nachbarn.length ? bezug : null);
        aendereFlaeche(
          z.flaeche,
          (alt) => ({ ...alt, punkte: alt.punkte.map((pp, i) => (i === z.index ? ziel : pp)) }),
          false,
        );
        return;
      }

      if (z.art === "malen") {
        const t = treffer(jetzt);
        if (t?.art === "modul") malenAnStrang(t.gruppe, t.reihe, t.spalte);
        return;
      }

      if (z.art === "auswahl" && auswahl.current) {
        auswahl.current = { ...auswahl.current, nach: bildZuMeter(k, jetzt) };
        anstossen();
        return;
      }

      if (z.art === "drehen") {
        const g = s.plan.gruppen.find((x) => x.id === z.gruppe);
        const f = g ? s.plan.flaechen.find((x) => x.id === g.flaeche) : null;
        if (!g || !f) return;
        const rahmen = gruppenRahmen(k, g, f);
        if (!rahmen) return;
        const mitteBild = { x: (rahmen.links + rahmen.rechts) / 2, y: (rahmen.oben + rahmen.unten) / 2 };
        // Winkel des Zeigers gegen „oben" — der Drehgriff sitzt dort.
        const roh = (Math.atan2(jetzt.x - mitteBild.x, mitteBild.y - jetzt.y) * 180) / Math.PI;
        // Traufparallel einrasten: der mit Abstand häufigste Fall.
        const winkel = Math.abs(roh) < 4 ? 0 : Math.round(roh * 2) / 2;
        s.onPlan(
          { ...s.plan, gruppen: s.plan.gruppen.map((x) => (x.id === g.id ? { ...x, winkel } : x)) },
          false,
        );
        return;
      }

      if (z.art === "erweitern") {
        const g = s.plan.gruppen.find((x) => x.id === z.gruppe);
        const f = g ? s.plan.flaechen.find((x) => x.id === g.flaeche) : null;
        if (!g || !f) return;
        const jetztM = bildZuMeter(k, jetzt);
        const a = rasterAchsen(g, f);
        const m = planMasse(g, f);
        const laengsRichtung = z.richtung === "oben" || z.richtung === "unten";
        const achse = laengsRichtung ? a.laengs : a.quer;
        const schritt = (laengsRichtung ? m.laengs + g.reihenabstand : m.quer + g.spaltenabstand);
        // Nach unten und links zeigt der Zuwachs entgegen der Achse.
        const vorzeichen = z.richtung === "oben" || z.richtung === "rechts" ? 1 : -1;
        const weg =
          ((jetztM.x - z.start.x) * achse.x + (jetztM.y - z.start.y) * achse.y) * vorzeichen;
        const gewollt = Math.round(weg / schritt);
        const schritte = gewollt - z.angewandt;
        if (schritte === 0) return;
        z.angewandt = gewollt;
        s.onPlan(
          {
            ...s.plan,
            gruppen: s.plan.gruppen.map((x) =>
              x.id === g.id ? erweitere(x, f, z.richtung, schritte) : x,
            ),
          },
          false,
        );
        return;
      }

      if (z.art === "modul") {
        const g = s.plan.gruppen.find((x) => x.id === z.gruppe);
        const f = g ? s.plan.flaechen.find((x) => x.id === g.flaeche) : null;
        if (!g || !f) return;
        // Fangen aufs eigene Raster — mit halber Modulbreite Toleranz.
        const roh = bildZuMeter(k, jetzt);
        const ziel = fangeAufRaster(g, f, roh, planMasse(g, f).quer / 2);
        s.onPlan(
          {
            ...s.plan,
            gruppen: s.plan.gruppen.map((x) =>
              x.id === g.id ? setzeFrei(x, z.reihe, z.spalte, ziel) : x,
            ),
          },
          false,
        );
        return;
      }

      if (z.art === "gruppe" || z.art === "schieben") {
        const jetztM = bildZuMeter(k, jetzt);
        const um = { x: jetztM.x - z.letzte.x, y: jetztM.y - z.letzte.y };
        z.letzte = jetztM;
        s.onPlan(
          {
            ...s.plan,
            gruppen: s.plan.gruppen.map((g) =>
              g.id === z.gruppe
                ? { ...g, anker: { x: g.anker.x + um.x, y: g.anker.y + um.y } }
                : g,
            ),
          },
          false,
        );
        return;
      }

      if (z.art === "kante") {
        const jetztM = bildZuMeter(k, jetzt);
        const um = { x: jetztM.x - z.letzte.x, y: jetztM.y - z.letzte.y };
        z.letzte = jetztM;
        const n = s.plan.flaechen.find((x) => x.id === z.flaeche)?.punkte.length ?? 0;
        aendereFlaeche(
          z.flaeche,
          (alt) => ({
            ...alt,
            punkte: alt.punkte.map((pp, i) =>
              i === z.index % n || i === (z.index + 1) % n
                ? { x: pp.x + um.x, y: pp.y + um.y }
                : pp,
            ),
          }),
          false,
        );
      }
    };

    const hoch = (e: PointerEvent) => {
      const bp = ortVon(e);
      const s = stand.current;
      const z = zieht.current;
      druckLoesen();
      setLangerDruck(false);
      zeiger.delete(e.pointerId);
      if (zeiger.size < 2) letzterAbstand = 0;
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);

      if (z?.art === "hindernis" && entwurf.current.length === 4) {
        entwurfAbschliessen();
        zieht.current = null;
        return;
      }
      if (z?.art === "malen") {
        zieht.current = null;
        // Einen Rückschritt für den ganzen Zug, nicht je Modul.
        s.onPlan(s.plan, true);
        return;
      }

      if (z?.art === "drehen" || z?.art === "erweitern" || z?.art === "schieben") {
        zieht.current = null;
        const g = s.plan.gruppen.find((x) => x.id === z.gruppe);
        const f = g ? s.plan.flaechen.find((x) => x.id === g.flaeche) : null;
        if (!g || !f) return;
        // Erst jetzt nachführen und einen Rückschritt anlegen — während
        // des Ziehens wären es dreissig.
        s.onPlan(
          {
            ...s.plan,
            gruppen: s.plan.gruppen.map((x) =>
              x.id === g.id ? nachfuehren(x, f, fremdeModule(s.plan, g)) : x,
            ),
          },
          true,
        );
        return;
      }

      if (z?.art === "modul") {
        zieht.current = null;
        const g = s.plan.gruppen.find((x) => x.id === z.gruppe);
        if (!g) return;
        if (bewegt <= 6) {
          // Tippen im Modul-Werkzeug holt es ins Raster zurück.
          s.onPlan(
            {
              ...s.plan,
              gruppen: s.plan.gruppen.map((x) =>
                x.id === g.id ? insRasterZurueck(x, z.reihe, z.spalte) : x,
              ),
            },
            true,
          );
          return;
        }
        s.onPlan(s.plan, true);
        return;
      }

      if (z?.art === "auswahl") {
        zieht.current = null;
        const rechteck = auswahl.current;
        auswahl.current = null;
        const g = s.plan.gruppen.find((x) => x.id === s.aktiveGruppe);
        const f = g ? s.plan.flaechen.find((x) => x.id === g.flaeche) : null;
        if (!rechteck || !g || !f) {
          setMeldung("Zuerst eine Modulgruppe wählen, dann den Teil aufziehen.");
          anstossen();
          return;
        }

        const links = Math.min(rechteck.von.x, rechteck.nach.x);
        const rechts = Math.max(rechteck.von.x, rechteck.nach.x);
        const unten = Math.min(rechteck.von.y, rechteck.nach.y);
        const oben = Math.max(rechteck.von.y, rechteck.nach.y);
        const gewaehlt: Array<{ reihe: number; spalte: number }> = [];
        for (let r = 0; r < g.reihen; r++) {
          for (let c = 0; c < g.spalten; c++) {
            const m = modulMitte(g, f, r, c);
            if (m.x >= links && m.x <= rechts && m.y >= unten && m.y <= oben) {
              gewaehlt.push({ reihe: r, spalte: c });
            }
          }
        }

        const neueId = `g${s.plan.gruppen.length + 1}${gewaehlt.length}`;
        const geteilt = teileGruppe(g, f, gewaehlt, neueId, `Feld ${s.plan.gruppen.length + 1}`);
        if (!geteilt) {
          setMeldung(
            gewaehlt.length === 0
              ? "Im Rechteck lag kein Modul."
              : "Das ist die ganze Gruppe — zum Teilen einen Teil aufziehen.",
          );
          anstossen();
          return;
        }
        s.onPlan(
          {
            ...s.plan,
            gruppen: [...s.plan.gruppen.map((x) => (x.id === g.id ? geteilt.alt : x)), geteilt.neu],
          },
          true,
        );
        s.onAktiveGruppe(geteilt.neu.id);
        s.onWerkzeug("auswahl");
        return;
      }

      if (z?.art === "gruppe") {
        zieht.current = null;
        const g = s.plan.gruppen.find((x) => x.id === z.gruppe);
        const f = g ? s.plan.flaechen.find((x) => x.id === g.flaeche) : null;
        if (!g || !f) return;

        if (bewegt <= 6) {
          /*
           * Tippen: Modul abschalten oder zurückholen. Es wird nicht
           * gelöscht — die Zelle bleibt im Raster, damit man sie
           * wiederfindet (Briefing 4.2).
           */
          const schluessel = zellSchluessel(z.reihe, z.spalte);
          const aus = g.aus.includes(schluessel)
            ? g.aus.filter((x) => x !== schluessel)
            : [...g.aus, schluessel];
          s.onAktiveGruppe(g.id);
          s.onPlan(
            { ...s.plan, gruppen: s.plan.gruppen.map((x) => (x.id === g.id ? { ...x, aus } : x)) },
            true,
          );
          return;
        }

        /*
         * Verschoben: Module, die jetzt über den Rand oder ein Hindernis
         * ragen, fallen weg — und kommen zurück, sobald wieder Platz ist.
         * Fremde Gruppen bleiben besetzt.
         */
        const besetzt = s.plan.gruppen
          .filter((x) => x.id !== g.id && x.flaeche === g.flaeche)
          .flatMap((x) => {
            const ff = s.plan.flaechen.find((y) => y.id === x.flaeche)!;
            return aktiveZellen(x).map((zz) => modulEcken(x, ff, zz.reihe, zz.spalte));
          });
        const gefuehrt = nachfuehren(g, f, besetzt);
        s.onPlan(
          { ...s.plan, gruppen: s.plan.gruppen.map((x) => (x.id === g.id ? gefuehrt : x)) },
          true,
        );
        return;
      }

      if (z?.art === "ecke" || z?.art === "kante") {
        // Jetzt erst ein Rückschritt — nicht für jede Mausbewegung.
        s.onPlan(s.plan, true);
        zieht.current = null;
        return;
      }
      if (z?.art === "messen") {
        zieht.current = null;
        const strecke = messung.current;
        if (
          strecke &&
          (s.werkzeug === "kalibrieren" || s.werkzeug === "gegenprobe") &&
          laenge(strecke.von, strecke.nach) > 0.01
        ) {
          const a = meterZuBild(kamera.current, strecke.von);
          const b = meterZuBild(kamera.current, strecke.nach);
          setKalibrierEingabe({
            art: s.werkzeug,
            gemessen: laenge(strecke.von, strecke.nach),
            x: (a.x + b.x) / 2,
            y: (a.y + b.y) / 2,
            wert: "",
          });
        }
        return;
      }
      zieht.current = null;

      // Ab hier: ein Tippen, kein Ziehen.
      if (bewegt > 6) return;

      if (s.werkzeug === "flaeche") {
        const bezug = entwurf.current.length
          ? entwurf.current[entwurf.current.length - 1]!
          : null;
        const neu = gefangen(bp, bezug);
        // Auf den Anfangspunkt getippt: Umriss schliessen.
        if (entwurf.current.length >= 3) {
          const erst = meterZuBild(kamera.current, entwurf.current[0]!);
          if (Math.hypot(erst.x - bp.x, erst.y - bp.y) <= GRIFF) {
            entwurfAbschliessen();
            return;
          }
        }
        entwurf.current = [...entwurf.current, neu];
        setEntwurfLaenge(entwurf.current.length);
        anstossen();
        return;
      }

      const t = treffer(bp);
      if (t?.art === "masz") {
        const f = s.plan.flaechen.find((x) => x.id === t.flaeche)!;
        const kante = kanten(f.punkte)[t.index]!;
        const m = kantenMitte(kamera.current, kante.a, kante.b);
        s.onAktiv(f.id);
        setMaszEingabe({
          flaeche: f.id,
          kante: t.index,
          x: m.x,
          y: m.y,
          wert: laenge(kante.a, kante.b).toFixed(2).replace(".", ","),
        });
        return;
      }
      if (t?.art === "flaeche" || t?.art === "kante" || t?.art === "ecke") {
        s.onAktiv(t.flaeche);
        return;
      }
      s.onAktiv(null);
    };

    const doppel = (e: MouseEvent) => {
      const r = el.getBoundingClientRect();
      const bp = { x: e.clientX - r.left, y: e.clientY - r.top };
      const s = stand.current;

      if (s.werkzeug === "flaeche") {
        entwurfAbschliessen();
        return;
      }
      if (s.werkzeug === "teilen") {
        const m = bildZuMeter(kamera.current, bp);
        auswahl.current = { von: m, nach: m };
        zieht.current = { art: "auswahl", von: m };
        return;
      }

      const t = treffer(bp);
      if (s.werkzeug === "string" && t?.art === "modul") {
        malenAnStrang(t.gruppe, t.reihe, t.spalte);
        zieht.current = { art: "malen" };
        return;
      }
      if (t?.art === "griff") {
        zieht.current =
          t.welcher === "drehen"
            ? { art: "drehen", gruppe: t.gruppe }
            : t.welcher === "verschieben"
              ? { art: "schieben", gruppe: t.gruppe, letzte: bildZuMeter(kamera.current, bp) }
              : {
                  art: "erweitern",
                  gruppe: t.gruppe,
                  richtung: t.welcher,
                  start: bildZuMeter(kamera.current, bp),
                  angewandt: 0,
                };
      } else if (t?.art === "modul" && s.werkzeug === "modul") {
        zieht.current = { art: "modul", gruppe: t.gruppe, reihe: t.reihe, spalte: t.spalte };
      } else if (t?.art === "modul" && !s.bearbeitbar.module) {
        // In einem späteren Schritt ist das Modul nur noch anzusehen.
        zieht.current = { art: "schwenk" };
      } else if (t?.art === "modul") {
        // Tippen schaltet das Modul, Ziehen verschiebt die Gruppe —
        // entschieden wird erst beim Loslassen, an der Wegstrecke.
        zieht.current = {
          art: "gruppe",
          gruppe: t.gruppe,
          reihe: t.reihe,
          spalte: t.spalte,
          letzte: bildZuMeter(kamera.current, bp),
        };
      } else if (t?.art === "ecke") {
        const f = s.plan.flaechen.find((x) => x.id === t.flaeche)!;
        // Unter drei Punkten ist es kein Polygon mehr.
        if (f.punkte.length <= 3) return;
        aendereFlaeche(
          t.flaeche,
          (alt) => ({
            ...alt,
            punkte: alt.punkte.filter((_, i) => i !== t.index),
            traufe: alt.traufe === null ? null : Math.min(alt.traufe, alt.punkte.length - 2),
          }),
          true,
        );
        return;
      }
      if (t?.art === "kante") {
        const f = s.plan.flaechen.find((x) => x.id === t.flaeche)!;
        const kante = kanten(f.punkte)[t.index]!;
        const bei = naechsterAufStrecke(bildZuMeter(kamera.current, bp), kante.a, kante.b);
        aendereFlaeche(t.flaeche, (alt) => ({ ...alt, punkte: punktEinfuegen(alt.punkte, t.index, bei) }), true);
      }
    };

    const rad = (e: WheelEvent) => {
      e.preventDefault();
      const schritt = e.ctrlKey ? -e.deltaY / 120 : -e.deltaY / 420;
      Object.assign(kamera.current, zoomeAn(kamera.current, ortVon(e), kamera.current.zoom + schritt));
      anstossen();
    };

    const taste = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === "Escape") {
        entwurf.current = [];
        setEntwurfLaenge(0);
        messung.current = null;
        stand.current.onWerkzeug("auswahl");
        anstossen();
      } else if (e.key === "Enter" && entwurf.current.length >= 3) {
        entwurfAbschliessen();
      }
    };

    el.addEventListener("pointerdown", runter);
    el.addEventListener("pointermove", bewegung);
    el.addEventListener("pointerup", hoch);
    el.addEventListener("pointercancel", hoch);
    el.addEventListener("dblclick", doppel);
    el.addEventListener("wheel", rad, { passive: false });
    window.addEventListener("keydown", taste);
    return () => {
      druckLoesen();
      el.removeEventListener("pointerdown", runter);
      el.removeEventListener("pointermove", bewegung);
      el.removeEventListener("pointerup", hoch);
      el.removeEventListener("pointercancel", hoch);
      el.removeEventListener("dblclick", doppel);
      el.removeEventListener("wheel", rad);
      window.removeEventListener("keydown", taste);
    };
  }, [aendereFlaeche, anstossen, entwurfAbschliessen, malenAnStrang, treffer]);

  useEffect(() => {
    if (!meldung) return;
    const uhr = setTimeout(() => setMeldung(null), 4000);
    return () => clearTimeout(uhr);
  }, [meldung]);

  /* Werkzeugwechsel bricht einen offenen Umriss ab. */
  useEffect(() => {
    entwurf.current = [];
    setEntwurfLaenge(0);
    messung.current = null;
    auswahl.current = null;
    anstossen();
  }, [p.werkzeug, anstossen]);

  const quelle = anbieterZu(p.anbieter);

  return (
    <div
      ref={huelle}
      data-testid="planer-leinwand"
      data-gruppenrahmen={rahmenAttribut}
      className="relative h-full w-full overflow-hidden bg-pl-flaeche"
      style={{
        touchAction: "none",
        cursor: p.werkzeug === "auswahl" ? "grab" : "crosshair",
      }}
    >
      <div ref={kachelSchicht} data-planer-kacheln className="absolute inset-0" aria-hidden />
      <canvas
        ref={flaeche}
        data-planer-canvas
        className="absolute inset-0 h-full w-full"
        style={{ pointerEvents: "none" }}
      />

      {/* Maßeingabe an der Kante (Briefing 3.2). */}
      {maszEingabe ? (
        <form
          className="absolute z-20"
          style={{ left: maszEingabe.x - 52, top: maszEingabe.y - 22 }}
          onSubmit={(e) => {
            e.preventDefault();
            const meter = Number(maszEingabe.wert.replace(",", "."));
            if (Number.isFinite(meter) && meter > 0) {
              aendereFlaeche(
                maszEingabe.flaeche,
                (f) => {
                  /*
                   * Eingetippt wird die Länge AUF DEM DACH — dieselbe,
                   * die an der Kante steht. Gespeichert wird der
                   * Grundriss, also muss die Neigung herausgerechnet
                   * werden. Ohne das wüchse die Fläche bei jeder
                   * Eingabe um den Neigungsfaktor.
                   */
                  const n = f.punkte.length;
                  const a = f.punkte[maszEingabe.kante % n]!;
                  const b = f.punkte[(maszEingabe.kante + 1) % n]!;
                  const plan = planlaengeFuerDach(a, b, falllinie(f), f.neigung, meter);
                  return { ...f, punkte: setzeKantenlaenge(f.punkte, maszEingabe.kante, plan) };
                },
                true,
              );
            }
            setMaszEingabe(null);
          }}
        >
          <input
            autoFocus
            aria-label="Kantenlänge in Metern"
            value={maszEingabe.wert}
            onChange={(e) => setMaszEingabe({ ...maszEingabe, wert: e.target.value })}
            onBlur={() => setMaszEingabe(null)}
            onKeyDown={(e) => e.key === "Escape" && setMaszEingabe(null)}
            className="num h-11 w-[104px] rounded-[10px] border-2 border-accent bg-surface px-3 text-center text-[14px] tabular-nums outline-none shadow-soft"
          />
        </form>
      ) : null}

      {meldung ? (
        <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center">
          <p className="rounded-pill bg-s-crit px-3 py-1.5 text-[12.5px] font-semibold text-white shadow-soft">
            {meldung}
          </p>
        </div>
      ) : null}

      {kalibrierEingabe ? (
        <form
          className="absolute z-20"
          style={{ left: kalibrierEingabe.x - 96, top: kalibrierEingabe.y - 34 }}
          onSubmit={(e) => {
            e.preventDefault();
            const echt = Number(kalibrierEingabe.wert.replace(",", "."));
            const gemessen = kalibrierEingabe.gemessen;
            if (Number.isFinite(echt) && echt > 0 && gemessen > 0) {
              const verhaeltnis = echt / gemessen;
              if (kalibrierEingabe.art === "kalibrieren") {
                const f = stand.current.foto;
                const alt = f?.meterProPixel ?? vorlaeufigerMassstab(f?.breite ?? 1);
                stand.current.onKalibriert(alt * verhaeltnis, verhaeltnis);
              } else {
                /*
                 * Gegenprobe ändert den Massstab NICHT. Sie sagt nur, ob
                 * das Foto in beide Richtungen gleich massstäblich ist —
                 * bei einer schrägen Aufnahme ist es das nicht, und dann
                 * ist jede Länge quer zur Referenz falsch.
                 */
                const abweichung = Math.abs(verhaeltnis - 1) * 100;
                setMeldung(
                  abweichung > 3
                    ? `Foto ist verzerrt: ${abweichung.toFixed(1).replace(".", ",")} % Abweichung quer zur Referenz. Möglichst senkrecht von oben aufnehmen.`
                    : `Gegenprobe stimmt — ${abweichung.toFixed(1).replace(".", ",")} % Abweichung.`,
                );
              }
            }
            messung.current = null;
            setKalibrierEingabe(null);
            stand.current.onWerkzeug("auswahl");
            anstossen();
          }}
        >
          <div className="rounded-[12px] border border-pl-mess bg-surface p-3 shadow-soft">
            <p className="mb-1 text-[11px] text-muted">
              {kalibrierEingabe.art === "kalibrieren" ? "Wahre Länge dieser Strecke" : "Wahre Länge der Gegenprobe"}
            </p>
            <input
              autoFocus
              aria-label={
                kalibrierEingabe.art === "kalibrieren"
                  ? "Wahre Länge der Referenzstrecke in Metern"
                  : "Wahre Länge der Gegenprobe in Metern"
              }
              placeholder="z. B. 8,00"
              value={kalibrierEingabe.wert}
              onChange={(e) => setKalibrierEingabe({ ...kalibrierEingabe, wert: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  messung.current = null;
                  setKalibrierEingabe(null);
                }
              }}
              className="num h-11 w-[176px] rounded-[10px] border border-line bg-surface px-3 text-center text-[15px] tabular-nums outline-none focus:border-accent"
            />
          </div>
        </form>
      ) : null}

      {kachelFehler ? (
        <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center">
          <p className="rounded-pill border border-pl-chrome-linie bg-pl-chrome px-3.5 py-1.5 text-[12.5px] text-pl-auf-dunkel backdrop-blur-md">
            {quelle.label} liefert gerade keine Bilder — anderen Anbieter wählen.
          </p>
        </div>
      ) : null}

      {/*
        Was das aktive Werkzeug erwartet — statt eines Handbuchs. Tritt
        hinter eine Meldung zurück: beide sassen an derselben Stelle, und
        der Hinweis verdeckte die Ablehnung, auf die es gerade ankommt.
      */}
      {!meldung && (p.werkzeug !== "auswahl" || entwurfLaenge > 0) ? (
        /*
          Grosser, mittiger Hinweis wie im Entwurf — nicht als kleine
          Pille am Rand. Beim Zeichnen schaut der Nutzer auf die Mitte
          der Fläche, nicht auf die Randleisten.
        */
        <div className="pointer-events-none absolute left-1/2 top-[38%] z-10 w-[min(420px,80%)] -translate-x-1/2 -translate-y-1/2 text-center">
          <p
            className="text-[19px] font-bold text-pl-auf-dunkel"
            style={{ textShadow: "0 2px 12px rgba(0,0,0,.6)" }}
          >
            {p.werkzeug === "flaeche"
              ? "Zeichne die Dachfläche"
              : p.werkzeug === "hindernis"
                ? "Hindernis aufziehen"
                : p.werkzeug === "modul"
                  ? "Einzelnes Modul versetzen"
                  : p.werkzeug === "string"
                  ? "Module dem String zuordnen"
                  : p.werkzeug === "teilen"
                    ? "Gruppe teilen"
                    : p.werkzeug === "messen"
                      ? "Strecke messen"
                  : p.werkzeug === "kalibrieren"
                    ? "Foto kalibrieren"
                    : "Gegenprobe"}
          </p>
          <p
            className="mt-1.5 text-[13px] text-pl-auf-dunkel-2"
            style={{ textShadow: "0 2px 12px rgba(0,0,0,.6)" }}
          >
            {p.werkzeug === "flaeche"
              ? entwurfLaenge >= 3
                ? "Auf den ersten Punkt tippen oder Enter — schliesst die Fläche. Esc bricht ab."
                : "Ecken antippen. Ab drei Punkten lässt sich die Fläche schliessen."
              : p.werkzeug === "hindernis"
                ? "Rechteck über Kamin, Fenster oder Gaube ziehen."
                : p.werkzeug === "modul"
                  ? "Ein Modul aus dem Raster ziehen — Antippen setzt es zurück."
                  : p.werkzeug === "string"
                  ? "Über die Module fahren. Nochmal darüber nimmt sie wieder heraus."
                  : p.werkzeug === "teilen"
                    ? "Rechteck über einen Teil der gewählten Gruppe ziehen."
                    : p.werkzeug === "messen"
                      ? "Strecke ziehen. Esc beendet das Messen."
                      : p.werkzeug === "kalibrieren"
                        ? "Eine Strecke ziehen, deren wahre Länge du kennst — Firstlänge, Garagentor, Auto."
                        : "Zweite Strecke QUER zur ersten ziehen. Weicht sie ab, ist das Foto schräg aufgenommen."}
          </p>
        </div>
      ) : null}

      <div className="pointer-events-none absolute bottom-3.5 left-3 z-10 flex items-end gap-2">
        <div className="rounded-[12px] border border-pl-chrome-linie bg-pl-chrome px-2.5 py-1.5 backdrop-blur-md">
          <div
            className="border-b-2 border-l-2 border-r-2 border-pl-auf-dunkel-2"
            style={{ width: `${Math.round(anzeige.leiste.punkte)}px`, height: "6px" }}
          />
          <p className="num mt-1 text-[11px] tabular-nums text-pl-auf-dunkel-2">{anzeige.leiste.meter} m</p>
        </div>
        {zeigerMeter ? (
          <p className="num rounded-pill border border-pl-chrome-linie bg-pl-chrome px-2.5 py-1 text-[11px] tabular-nums text-pl-auf-dunkel-2 backdrop-blur-md">
            {zeigerMeter.x.toFixed(1)} / {zeigerMeter.y.toFixed(1)} m
          </p>
        ) : null}
        {fangHinweis ? (
          <p className="rounded-pill border border-pl-mess bg-pl-mess-flaeche px-2.5 py-1 text-[11px] font-semibold text-pl-mess backdrop-blur-md">
            {fangHinweis}
          </p>
        ) : null}
        {/*
          * Der lange Druck schaltet unter dem Finger um — ohne
          * Rückmeldung merkt das niemand, und das Modul wandert
          * scheinbar von selbst.
          */}
        {langerDruck ? (
          <p
            data-langer-druck
            className="rounded-pill border border-pl-hinweis bg-pl-chrome px-2.5 py-1 text-[11px] font-semibold text-pl-hinweis backdrop-blur-md"
          >
            Modul gelöst — frei ziehen
          </p>
        ) : null}
        {messung.current ? (
          <p className="num rounded-pill border border-pl-mess bg-pl-mess-flaeche px-2.5 py-1 text-[11px] tabular-nums text-pl-mess backdrop-blur-md">
            {meterText(laenge(messung.current.von, messung.current.nach))}
          </p>
        ) : null}
      </div>

      {/*
        Quellenangabe nur für die Karte. Im Fotobetrieb stand hier
        weiterhin „basemap.at" — eine Zuschreibung an einen Anbieter,
        dessen Bild gar nicht zu sehen ist.
      */}
      <p className="pointer-events-none absolute bottom-3 right-3 text-[10px] text-pl-auf-dunkel-4">
        {p.foto ? "eigenes Drohnenfoto" : quelle.quelle}
      </p>
    </div>
  );
}

export { ZOOM_GRENZEN };
