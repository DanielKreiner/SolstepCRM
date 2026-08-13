"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  bildZuMeter,
  kachelnFuer,
  zoomFuerAufloesung,
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
  fangeBeimZiehen,
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
import { strangUmschalten, strangWeg } from "@/lib/planer/strings";
import { modulSetzen, modulVorschau } from "@/lib/planer/setzen";
import { anbieter as anbieterZu, type AnbieterId, hoechsterZoom, kachelUrl } from "@/lib/planer/anbieter";
import {
  aktiveZellen,
  anbaustellen,
  modulAnbauen,
  erweitere,
  fangeAufRaster,
  insRasterZurueck,
  einzelnesModul,
  modulEcken,
  modulLage,
  modulMitte,
  modulPasst,
  nachfuehren,
  planMasse,
  achsen as rasterAchsen,
  setzeFrei,
  STANDARD_MODUL,
  stoesstAn,
  teileGruppe,
  zelle as zellSchluessel,
} from "@/lib/planer/module";
import {
  masszahlOrt,
  meterText,
  zeichneEntwurf,
  zeichneFlaeche,
  griffe,
  anbauMitte,
  blockEcken,
  gruppenRahmen,
  zeichneObjekte,
  zeichneAnbaustellen,
  zeichneStrangwege,
  zeichneAuswahl,
  zeichneGruppe,
  zeichneGeistermodul,
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
  /** Ein einzelnes Modul setzen — mit Geisterbild am Zeiger. */
  | "setzen"
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
   * Zähler: Wird er hochgezählt, rückt die Karte so, dass alle
   * Dachflächen ins Bild passen.
   *
   * Als Zähler und nicht als Befehl, weil die Kamera in einem Ref liegt
   * — ein Zustandswert liesse sich nicht zweimal hintereinander
   * auslösen. Ohne dieses Einpassen lag ein frisch gesetztes Haus als
   * fingernagelgrosser Fleck auf einer Karte über den halben Ort; man
   * musste erst suchen, wo die eigene Planung liegt.
   */
  zeigeAlles?: number;
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
  /*
   * Ob gerade ein Geistermodul am Zeiger hängt und ob es dort passt.
   * Es liegt im Canvas und ist von aussen sonst nicht zu sehen — ohne
   * diese Angabe liesse sich nicht prüfen, ob das Setzen überhaupt
   * etwas anzeigt.
   */
  const [geistAttribut, setGeistAttribut] = useState<string | undefined>(undefined);
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
    /*
     * Die ganze Dachfläche schieben. Vorher liess sie sich nur über die
     * Ecken verformen: Wer die Standardform einen Meter neben dem Haus
     * gesetzt hatte, musste vier Ecken einzeln nachziehen und hatte
     * danach ein anderes Dach.
     */
    | { art: "flaecheZiehen"; flaeche: string; letzte: Meter }
    | { art: "gruppe"; gruppe: string; reihe: number; spalte: number; letzte: Meter }
    /*
     * Zug am Verschiebe-Symbol. Getrennt von "gruppe": Dort
     * entscheidet die Wegstrecke zwischen Tippen (Modul schalten) und
     * Ziehen. Am Symbol gibt es nichts zu schalten — ein kurzer Tipp
     * darf dort kein Modul abschalten, das gar nicht darunter liegt.
     */
    | { art: "schieben"; gruppe: string; letzte: Meter }
    /*
     * Beim Drehen wird der Winkel zwischen Zeiger und Feldmitte
     * gemessen. Gespeichert wird der Versatz zum Winkel der Gruppe im
     * Moment des Anfassens — sonst springt das Feld beim ersten
     * Pixel auf den absoluten Zeigerwinkel.
     */
    | { art: "drehen"; gruppe: string; versatz: number; mitte: Meter }
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
        /*
         * `max-width: none` ist hier kein Schmuck, sondern der Kern.
         *
         * Die CSS-Grundeinstellung setzt für jedes Bild
         * `max-width: 100%`. Solange eine Kachel kleiner ist als die
         * Zeichenfläche, fällt das nicht auf. Zoomt man aber so weit
         * heran, dass eine Kachel breiter wird als das Fenster — bei
         * einem Dach ab etwa fünf Metern Bildbreite —, wird ihre BREITE
         * auf die Fensterbreite gestaucht, ihre Höhe nicht: Das Luftbild
         * war verzerrt, und rechts oder links blieb ein schwarzer
         * Streifen ohne Kachel.
         */
        b.style.maxWidth = "none";
        b.style.maxHeight = "none";
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
    const sicht = {
      kamera: k,
      aktiv: stand.current.aktiv,
      betont: null,
      gruppeAktiv: stand.current.aktiveGruppe !== null,
    };
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

    /*
     * Die Kabelwege über die Module. Nur wenn es Strings gibt — ein
     * leeres Dach soll nicht aussehen, als fehle etwas.
     */
    if (stand.current.plan.strings.length > 0) {
      zeichneStrangwege(
        ctx,
        k,
        stand.current.plan.strings.map((s, i) => ({
          punkte: strangWeg(stand.current.plan, s).punkte,
          farbe: strangFarbe(i),
          betont: stand.current.aktiverStrang === null || stand.current.aktiverStrang === s.id,
        })),
      );
    }

    /*
     * Geistermodul am Zeiger. Es liegt über der Belegung, damit man
     * sieht, wo es hinkommt — und unter den Bäumen, weil die davor
     * stehen.
     */
    if (stand.current.werkzeug === "setzen" && geisterRef.current) {
      zeichneGeistermodul(ctx, k, geisterRef.current.ecken, geisterRef.current.passt);
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
     * Anbaustellen: dort, wo das nächste Modul liegen würde.
     *
     * Für ALLE Felder, nicht nur für das gewählte. Vorher verschwanden
     * die Pluszeichen, sobald man irgendwohin tippte und damit die
     * Auswahl verlor — sie waren „nur manchmal da". Wenn ein Modul
     * hinpasst, gehört das Zeichen hin, ohne dass man vorher etwas
     * auswählen muss.
     *
     * Sie werden bei jedem Zeichnen neu bestimmt; damit stimmen sie auch
     * nach dem Entfernen eines Moduls oder dem Verschieben einer Gruppe.
     */
    stellen.current = [];
    if (
      stand.current.werkzeug === "auswahl" &&
      stand.current.schreibrecht &&
      stand.current.bearbeitbar.module
    ) {
      for (const g of stand.current.plan.gruppen) {
        const f = stand.current.plan.flaechen.find((x) => x.id === g.flaeche);
        if (!f) continue;
        const eigene = anbaustellen(g, f, fremdeModule(stand.current.plan, g));
        for (const st of eigene) stellen.current.push({ gruppe: g.id, ...st });
        zeichneAnbaustellen(ctx, k, g, f, eigene);
      }
    }

    const rahmen = gewaehlt && gf ? gruppenRahmen(k, gewaehlt, gf) : null;
    setRahmenAttribut(
      rahmen
        ? [rahmen.links, rahmen.oben, rahmen.rechts, rahmen.unten].map((v) => Math.round(v)).join(",")
        : undefined,
    );
  }, []);

  const zeigerRef = useRef<Meter | null>(null);
  /** Das Modul am Zeiger im Werkzeug „setzen" — Ecken und ob es passt. */
  const geisterRef = useRef<{ ecken: Meter[]; passt: boolean } | null>(null);
  /** Anbaustellen aus dem letzten Zeichnen — Grundlage für den Treffer. */
  const stellen = useRef<Array<{ gruppe: string; reihe: number; spalte: number }>>([]);

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

  /* Alle Dachflächen ins Bild rücken. */
  useEffect(() => {
    if (!p.zeigeAlles) return;
    const k = kamera.current;
    const punkte = stand.current.plan.flaechen.flatMap((f) => f.punkte);
    if (punkte.length === 0 || k.breite === 0 || k.hoehe === 0) return;

    const xs = punkte.map((q) => q.x);
    const ys = punkte.map((q) => q.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    /*
     * Ein Drittel Luft rundherum: Das Dach soll nicht am Bildrand
     * kleben, und die Kantenmasse liegen aussen davor.
     */
    const breiteM = Math.max(8, (maxX - minX) * 1.45);
    const hoeheM = Math.max(8, (maxY - minY) * 1.45);
    const mpp = Math.max(breiteM / k.breite, hoeheM / k.hoehe);
    const roh = zoomFuerAufloesung(k.ursprung.lat, mpp);
    /*
     * Nicht weiter heran, als das Luftbild hergibt: Ein kleines Dach
     * würde sonst formatfüllend gezeigt — und zwar als Farbbrei.
     */
    const obergrenze = Math.min(ZOOM_GRENZEN.max, hoechsterZoom(stand.current.anbieter));
    k.zoom = Math.max(ZOOM_GRENZEN.min, Math.min(obergrenze, roh));
    k.mitte = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
    anstossen();
    stand.current.onKamera?.({ zoom: k.zoom, mitte: k.mitte });
  }, [p.zeigeAlles, anstossen]);

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
    /*
     * Pluszeichen zuerst: Sie liegen ausserhalb der Felder und damit
     * genau dort, wo sonst „nichts" wäre — der Klick würde sonst als
     * Schwenk verpuffen. Sie stammen aus dem letzten Zeichnen und sind
     * damit immer auf dem Stand des Bildes; gültig sind sie für JEDES
     * Feld, nicht nur für das gewählte.
     */
    for (const stelle of stellen.current) {
      const g = s.plan.gruppen.find((x) => x.id === stelle.gruppe);
      const f = g ? s.plan.flaechen.find((x) => x.id === g.flaeche) : null;
      if (!g || !f) continue;
      const m = anbauMitte(k, g, f, stelle);
      if (Math.hypot(m.x - bp.x, m.y - bp.y) <= GRIFF + 2) {
        return { art: "anbau" as const, gruppe: g.id, reihe: stelle.reihe, spalte: stelle.spalte };
      }
    }

    const gewaehlt =
      s.werkzeug === "auswahl" && s.bearbeitbar.module
        ? s.plan.gruppen.find((g) => g.id === s.aktiveGruppe)
        : undefined;
    if (gewaehlt) {
      const gf = s.plan.flaechen.find((x) => x.id === gewaehlt.flaeche);
      const rahmen = gf ? gruppenRahmen(k, gewaehlt, gf) : null;
      if (rahmen && gf) {
        // Dieselben Stellen wie beim Zeichnen — mit den gedrehten Ecken.
        for (const griff of griffe(rahmen, blockEcken(k, gewaehlt, gf))) {
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

    /*
     * Massangaben zuerst: Sie liegen vor der Kante und sollen sie
     * überstimmen. Getroffen wird nur, was auch zu sehen ist — die
     * gewählte Fläche, und nur solange keine Modulgruppe bearbeitet
     * wird. Sonst öffnete ein Klick neben dem Feld eine Eingabe, deren
     * Pille gar nicht auf dem Bild steht.
     */
    if (s.bearbeitbar.flaechen && aktive && !s.aktiveGruppe) {
      for (const kante of kanten(aktive.punkte)) {
        const m = masszahlOrt(k, aktive.punkte, kante.a, kante.b);
        const p1 = meterZuBild(k, kante.a);
        const p2 = meterZuBild(k, kante.b);
        if (Math.hypot(p2.x - p1.x, p2.y - p1.y) < 46) continue;
        if (Math.abs(m.x - bp.x) <= 34 && Math.abs(m.y - bp.y) <= 11) {
          return { art: "masz" as const, flaeche: aktive.id, index: kante.i };
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
        setMeldung("Die Sperrzone muss auf der gewählten Dachfläche liegen.");
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
                name: `Sperrzone ${f.hindernisse.length + 1}`,
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

    if (!s.plan.strings.some((x) => x.id === s.aktiverStrang)) return;
    s.onPlan(strangUmschalten(s.plan, s.aktiverStrang, schluessel), false);
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

    /**
     * Fang beim Ziehen einer vorhandenen Ecke.
     *
     * Anderer Fang als beim Zeichnen: Dort zeigt man eine Richtung, hier
     * hält man einen Punkt fest. Die Toleranz ist deshalb keine
     * Winkeltoleranz, sondern eine Entfernung — und zwar eine, die sich
     * am Bildschirm gleich anfühlt: zwölf Bildpunkte, in Meter
     * umgerechnet. Vorher zog eine 4°-Toleranz die Ecke eines
     * 18-Meter-Dachs um über einen Meter zur Seite.
     */
    const gefangenBeimZiehen = (bp: { x: number; y: number }, bezuege: Meter[]): Meter => {
      const s = stand.current;
      const k = kamera.current;
      const roh = bildZuMeter(k, bp);
      const bestehende = s.plan.flaechen.flatMap((f) =>
        kanten(f.punkte).map((kk) => ({ a: kk.a, b: kk.b })),
      );
      const toleranzMeter = 12 * meterProPixel(k.ursprung.lat, k.zoom);
      const { punkt, hinweis } = fangeBeimZiehen(roh, bezuege, bestehende, s.fang, toleranzMeter);
      setFangHinweis(
        hinweis === "rechter-winkel" ? "rechter Winkel" : hinweis === "parallel" ? "parallel" : null,
      );
      return punkt;
    };

    /**
     * Wo läge das Modul, wenn man jetzt klickt — und passt es dort?
     *
     * Gerechnet wird auf der Fläche unter dem Zeiger, nicht auf der
     * gewählten: Wer über das Nachbardach fährt, meint das Nachbardach.
     */
    const geisterFuer = (m: Meter): { ecken: Meter[]; passt: boolean } | null => {
      const s = stand.current;
      const v = modulVorschau(s.plan, m, s.aktiv, s.plan.gruppen[0]?.typ ?? STANDARD_MODUL);
      return v ? { ecken: v.ecken, passt: v.passt } : null;
    };

    /**
     * Wie weit Zeiger und Gruppenwinkel beim Anfassen auseinanderliegen.
     *
     * Ohne diesen Versatz springt das Feld in dem Moment, in dem man den
     * Drehgriff berührt: Es übernähme den Winkel des Zeigers, und der
     * ist selten der Winkel, den das Feld gerade hat.
     */
    const drehStart = (
      gruppeId: string,
      bp: { x: number; y: number },
    ): { versatz: number; mitte: Meter } => {
      const s = stand.current;
      const g = s.plan.gruppen.find((x) => x.id === gruppeId);
      const f = g ? s.plan.flaechen.find((x) => x.id === g.flaeche) : null;
      if (!g || !f) return { versatz: 0, mitte: { x: 0, y: 0 } };

      /*
       * Der Drehpunkt wird EINMAL bestimmt und in Metern gemerkt.
       *
       * Vorher wurde er bei jeder Bewegung aus dem umschliessenden
       * Rechteck gerechnet — und das ändert sich beim Drehen selbst.
       * Der Bezugspunkt wanderte also unter der Drehung weg, der
       * gemessene Winkel zappelte, und das Feld zuckte statt zu folgen.
       */
      const zellen = aktiveZellen(g);
      const punkte = zellen.flatMap((z) => modulEcken(g, f, z.reihe, z.spalte));
      const mitte = punkte.length
        ? {
            x: punkte.reduce((sum, q) => sum + q.x, 0) / punkte.length,
            y: punkte.reduce((sum, q) => sum + q.y, 0) / punkte.length,
          }
        : g.anker;

      const m = meterZuBild(kamera.current, mitte);
      const zeigerWinkel = (Math.atan2(bp.x - m.x, m.y - bp.y) * 180) / Math.PI;
      /*
       * PLUS, nicht minus: Ein positiver Gruppenwinkel dreht das Raster
       * im Metersystem gegen den Uhrzeigersinn — und weil die
       * Bildschirmachse nach unten zeigt, sieht man das ebenfalls gegen
       * den Uhrzeigersinn. Wer den Griff nach rechts zieht, meint aber
       * im Uhrzeigersinn. Das Feld drehte sich deshalb genau andersherum
       * als die Hand.
       */
      return { versatz: zeigerWinkel + g.winkel, mitte };
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
      if (s.werkzeug === "setzen") {
        /*
         * Ein Klick setzt genau ein Modul dorthin, wo das Geisterbild
         * steht. Passt es nicht, passiert nichts — das Bild hat das
         * vorher in Rot gesagt.
         */
        const m = bildZuMeter(kamera.current, bp);
        const erg = modulSetzen(s.plan, m, s.aktiv, s.plan.gruppen[0]?.typ ?? STANDARD_MODUL);
        if (!erg.ok) {
          setMeldung(erg.meldung);
          zieht.current = null;
          return;
        }

        s.onPlan(erg.plan, true);
        s.onAktiv(erg.flaeche);
        s.onAktiveGruppe(erg.gruppe);
        /*
         * Nach dem ersten Modul zurück auf „Wählen".
         *
         * Sonst hängt sofort das nächste Geistermodul am Zeiger, und
         * man setzt aus Versehen ein zweites irgendwohin. Weitergebaut
         * wird mit den Pluszeichen — die zeigen genau dort, wo ein
         * Modul auch wirklich anschliesst.
         */
        s.onWerkzeug("auswahl");
        geisterRef.current = null;
        setGeistAttribut(undefined);
        zieht.current = null;
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
            ? { art: "drehen", gruppe: t.gruppe, ...drehStart(t.gruppe, bp) }
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
        /*
         * Tippen schaltet das Modul, Ziehen verschiebt die Gruppe —
         * entschieden wird erst beim Loslassen, an der Wegstrecke.
         *
         * Kein langer Druck mehr: Der löste nach 450 ms ohne Bewegung
         * ein einzelnes Modul aus dem Raster. Mit der Maus passiert das
         * ständig aus Versehen — man setzt an, überlegt kurz, zieht
         * dann —, und danach lag ein Modul irgendwo neben dem Feld.
         * Wer ein Modul freistellen will, nimmt das Modul-Werkzeug;
         * dort ist es eine Entscheidung und kein Zufall.
         */
        zieht.current = {
          art: "gruppe",
          gruppe: t.gruppe,
          reihe: t.reihe,
          spalte: t.spalte,
          letzte: bildZuMeter(kamera.current, bp),
        };
      } else if (
        t?.art === "flaeche" &&
        s.bearbeitbar.flaechen &&
        s.werkzeug === "auswahl" &&
        s.aktiv === t.flaeche
      ) {
        /*
         * In der GEWÄHLTEN Fläche zieht man sie; in einer anderen wählt
         * man sie erst aus. Sonst verschöbe der erste Klick auf ein
         * fremdes Dach dieses gleich mit.
         */
        zieht.current = {
          art: "flaecheZiehen",
          flaeche: t.flaeche,
          letzte: bildZuMeter(kamera.current, bp),
        };
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

        /*
         * Geistermodul: Bei jeder Zeigerbewegung neu berechnet, damit
         * man vor dem Klick sieht, wohin das Modul kommt und ob es
         * überhaupt passt.
         */
        if (s.werkzeug === "setzen") {
          const vorschau = geisterFuer(m);
          const alt = geisterRef.current;
          geisterRef.current = vorschau;
          const gleich =
            alt &&
            vorschau &&
            alt.passt === vorschau.passt &&
            Math.abs((alt.ecken[0]?.x ?? 0) - (vorschau.ecken[0]?.x ?? 0)) < 1e-6 &&
            Math.abs((alt.ecken[0]?.y ?? 0) - (vorschau.ecken[0]?.y ?? 0)) < 1e-6;
          if (!gleich) anstossen();
          setGeistAttribut(vorschau ? (vorschau.passt ? "passt" : "eng") : undefined);
          return;
        }
        if (geisterRef.current) {
          geisterRef.current = null;
          setGeistAttribut(undefined);
          anstossen();
        }

        if (entwurf.current.length) anstossen();
        return;
      }

      const vorher = zeiger.get(e.pointerId)!;
      zeiger.set(e.pointerId, jetzt);
      bewegt += Math.hypot(jetzt.x - vorher.x, jetzt.y - vorher.y);
      // Mehr als ein Wackeln heisst: schieben, nicht halten.
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
        /*
         * Gefangen wird gegen BEIDE Nachbarecken: Eine Ecke gehört zu
         * zwei Kanten, und beide sollen gerade werden können. Vorher
         * zählte nur die vorige — die andere Kante liess sich nicht
         * ausrichten.
         */
        const n = f.punkte.length;
        const bezuege = [
          f.punkte[(z.index - 1 + n) % n]!,
          f.punkte[(z.index + 1) % n]!,
        ];
        const ziel = gefangenBeimZiehen(jetzt, bezuege);
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
        // Fester Drehpunkt aus dem Moment des Anfassens.
        const mitteBild = meterZuBild(k, z.mitte);
        // Winkel des Zeigers gegen „oben" — der Drehgriff sitzt dort.
        const zeigerWinkel =
          (Math.atan2(jetzt.x - mitteBild.x, mitteBild.y - jetzt.y) * 180) / Math.PI;
        /*
         * Der beim Anfassen gemerkte Versatz macht das Drehen ruhig:
         * Vorher übernahm das Feld sofort den absoluten Zeigerwinkel
         * und sprang beim ersten Pixel um den Betrag, um den Griff und
         * Zeiger auseinanderlagen.
         */
        const roh = z.versatz - zeigerWinkel;
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

      if (z.art === "flaecheZiehen") {
        const jetztM = bildZuMeter(k, jetzt);
        const um = { x: jetztM.x - z.letzte.x, y: jetztM.y - z.letzte.y };
        z.letzte = jetztM;

        /*
         * Alles, was auf dem Dach liegt, wandert mit: Hindernisse und
         * Modulfelder. Bliebe die Belegung stehen, läge sie nach dem
         * Verschieben neben dem Haus — und `nachfuehren` würde sie beim
         * nächsten Anfassen wegwerfen.
         */
        s.onPlan(
          {
            ...s.plan,
            flaechen: s.plan.flaechen.map((f) =>
              f.id === z.flaeche
                ? {
                    ...f,
                    punkte: f.punkte.map((pp) => ({ x: pp.x + um.x, y: pp.y + um.y })),
                    hindernisse: f.hindernisse.map((h) => ({
                      ...h,
                      punkte: h.punkte.map((pp) => ({ x: pp.x + um.x, y: pp.y + um.y })),
                    })),
                  }
                : f,
            ),
            gruppen: s.plan.gruppen.map((g) =>
              g.flaeche === z.flaeche
                ? {
                    ...g,
                    anker: { x: g.anker.x + um.x, y: g.anker.y + um.y },
                    frei: Object.fromEntries(
                      Object.entries(g.frei).map(([schluessel, p]) => [
                        schluessel,
                        { x: p.x + um.x, y: p.y + um.y },
                      ]),
                    ),
                  }
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

      if (z?.art === "flaecheZiehen") {
        zieht.current = null;
        // Ein Rückschritt für den ganzen Zug, nicht dreissig.
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
        const gf = s.plan.flaechen.find((x) => x.id === g.flaeche) ?? null;
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

        /*
         * Abgelegt: Das Modul muss auf dem Dach liegen. Ohne diese
         * Prüfung liess sich ein freigestelltes Modul überallhin ziehen
         * — auch neben das Haus. Auf dem Bild lagen dann Module im
         * Nachbargarten, und die Stückliste zählte sie mit.
         *
         * Passt es nicht, geht es dorthin zurück, wo es im Raster
         * hingehört; passt auch das nicht, bleibt die Zelle leer.
         */
        if (gf) {
          const ecken = modulEcken(g, gf, z.reihe, z.spalte);
          const fremde = fremdeModule(s.plan, g);
          if (!modulPasst(ecken, gf) || stoesstAn(ecken, fremde)) {
            const zurueck = insRasterZurueck(g, z.reihe, z.spalte);
            const imRaster = modulEcken(zurueck, gf, z.reihe, z.spalte);
            const gehtDoch = modulPasst(imRaster, gf) && !stoesstAn(imRaster, fremde);
            const wieder = gehtDoch
              ? zurueck
              : { ...zurueck, aus: [...new Set([...zurueck.aus, zellSchluessel(z.reihe, z.spalte)])] };
            setMeldung(
              gehtDoch
                ? "Dort ist kein Platz — das Modul ist zurück im Raster."
                : "Dort ist kein Platz, und im Raster auch nicht.",
            );
            s.onPlan(
              { ...s.plan, gruppen: s.plan.gruppen.map((x) => (x.id === g.id ? wieder : x)) },
              true,
            );
            return;
          }
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
          /*
           * In `entfernt`, nicht in `aus`: `aus` gehört der Geometrie
           * und wird bei jeder Bewegung neu bestimmt. Weggetippte
           * Module kamen deshalb zurück, sobald jemand die Gruppe
           * verschob oder drehte.
           */
          const bisher = g.entfernt ?? [];
          const entfernt = bisher.includes(schluessel)
            ? bisher.filter((x) => x !== schluessel)
            : [...bisher, schluessel];
          s.onAktiveGruppe(g.id);
          s.onPlan(
            {
              ...s.plan,
              gruppen: s.plan.gruppen.map((x) => (x.id === g.id ? { ...x, entfernt } : x)),
            },
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
        const m = masszahlOrt(kamera.current, f.punkte, kante.a, kante.b);
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
            ? { art: "drehen", gruppe: t.gruppe, ...drehStart(t.gruppe, bp) }
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
      data-geist={geistAttribut}
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
        /*
         * Als schmale Leiste am oberen Rand, nicht als grosser Text in
         * der Bildmitte.
         *
         * Vorher stand er in 19 px weiss mitten auf dem Luftbild: über
         * einem hellen Dach war er unlesbar, über einer dunklen Strasse
         * überdeckte er genau das, worauf man gerade zeichnet. Ein
         * Hinweis, der die Arbeitsfläche verdeckt, ist keiner.
         *
         * Die Leiste sitzt unter der Schrittanzeige (oben Mitte) und
         * trägt denselben dunklen Grund wie die übrigen Bedienleisten.
         */
        <div className="pointer-events-none absolute left-1/2 top-[58px] z-10 flex max-w-[min(520px,88%)] -translate-x-1/2 items-baseline gap-2 rounded-pill border border-pl-chrome-linie bg-pl-chrome px-3 py-1.5 backdrop-blur-md">
          <span className="shrink-0 text-[12px] font-bold text-pl-auf-dunkel">
            {p.werkzeug === "flaeche"
              ? "Dachfläche zeichnen"
              : p.werkzeug === "hindernis"
                ? "Sperrzone aufziehen"
                : p.werkzeug === "modul"
                  ? "Modul versetzen"
                  : p.werkzeug === "string"
                    ? "String zuordnen"
                    : p.werkzeug === "teilen"
                      ? "Gruppe teilen"
                      : p.werkzeug === "messen"
                        ? "Strecke messen"
                        : p.werkzeug === "kalibrieren"
                          ? "Foto kalibrieren"
                          : "Gegenprobe"}
          </span>
          <span className="truncate text-[11.5px] text-pl-auf-dunkel-2">
            {p.werkzeug === "flaeche"
              ? entwurfLaenge >= 3
                ? "Ersten Punkt antippen oder Enter schliesst die Fläche · Esc bricht ab"
                : "Ecken antippen · ab drei Punkten schliessbar"
              : p.werkzeug === "hindernis"
                ? "Rechteck über Kamin, Gaube, Fenster oder Wartungsweg ziehen"
                : p.werkzeug === "modul"
                  ? "Modul aus dem Raster ziehen · Antippen setzt es zurück"
                  : p.werkzeug === "string"
                    ? "Über die Module fahren · nochmal nimmt sie heraus"
                    : p.werkzeug === "teilen"
                      ? "Rechteck über einen Teil der Gruppe ziehen"
                      : p.werkzeug === "messen"
                        ? "Strecke ziehen · Esc beendet"
                        : p.werkzeug === "kalibrieren"
                          ? "Strecke mit bekannter Länge ziehen — First, Garagentor, Auto"
                          : "Zweite Strecke QUER zur ersten ziehen"}
          </span>
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
