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
  setzeKantenlaenge,
} from "@/lib/planer/flaeche";
import { naechsteId, naechsterFlaechenName, type Plan } from "@/lib/planer/plan";
import { anbieter as anbieterZu, type AnbieterId, kachelUrl } from "@/lib/planer/anbieter";
import {
  kantenMitte,
  meterText,
  zeichneEntwurf,
  zeichneFlaeche,
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

export type Werkzeug = "auswahl" | "flaeche" | "hindernis" | "messen";

export interface LeinwandProps {
  ursprung: { lat: number; lon: number };
  anbieter: AnbieterId;
  zoom: number;
  plan: Plan;
  werkzeug: Werkzeug;
  fang: FangOptionen;
  aktiv: string | null;
  onAktiv: (id: string | null) => void;
  /** `schritt` legt einen Rückschritt an; false für Zwischenstände beim Ziehen. */
  onPlan: (plan: Plan, schritt: boolean) => void;
  onWerkzeug: (w: Werkzeug) => void;
  onKamera?: (k: { zoom: number; mitte: Meter }) => void;
}

/** Trefferzone in Bildpunkten — grosszügig, weil am iPad ein Finger zielt. */
const GRIFF = 12;

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
  /** Kurze Rückmeldung, wenn eine Eingabe abgelehnt wurde. */
  const [meldung, setMeldung] = useState<string | null>(null);

  /** Umriss, der gerade entsteht. */
  const entwurf = useRef<Meter[]>([]);
  const [entwurfLaenge, setEntwurfLaenge] = useState(0);
  const messung = useRef<{ von: Meter; nach: Meter } | null>(null);
  const zieht = useRef<
    | { art: "ecke"; flaeche: string; index: number }
    | { art: "kante"; flaeche: string; index: number; letzte: Meter }
    | { art: "hindernis"; flaeche: string; von: Meter }
    | { art: "messen" }
    | { art: "schwenk" }
    | null
  >(null);

  const [maszEingabe, setMaszEingabe] = useState<
    { flaeche: string; kante: number; x: number; y: number; wert: string } | null
  >(null);

  const neuZeichnen = useRef(false);
  const bilder = useRef(new Map<string, HTMLImageElement>());

  /* ── Kacheln ─────────────────────────────────────────────────── */

  const legeKacheln = useCallback(() => {
    const schicht = kachelSchicht.current;
    if (!schicht) return;
    const k = kamera.current;
    const grenze = anbieterZu(stand.current.anbieter).maxStufe;
    const gebraucht = new Set<string>();

    for (const t of kachelnFuer(k, grenze)) {
      const schluessel = `${t.z}/${t.x}/${t.y}`;
      gebraucht.add(schluessel);
      let b = bilder.current.get(schluessel);
      if (!b) {
        b = new Image();
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
  }, []);

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

    if (entwurf.current.length > 0) {
      const vorschau = zeigerRef.current;
      const kette = vorschau ? [...entwurf.current, vorschau] : entwurf.current;
      zeichneEntwurf(ctx, k, entwurf.current, vorschau, schneidetSichSelbst(kette));
    }
    if (messung.current) zeichneMessung(ctx, k, messung.current.von, messung.current.nach);
  }, []);

  const zeigerRef = useRef<Meter | null>(null);

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
  }, [p.plan, p.aktiv, p.werkzeug, anstossen]);

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

    if (aktive) {
      for (let i = 0; i < aktive.punkte.length; i++) {
        const b = meterZuBild(k, aktive.punkte[i]!);
        if (Math.hypot(b.x - bp.x, b.y - bp.y) <= GRIFF) {
          return { art: "ecke" as const, flaeche: aktive.id, index: i };
        }
      }
    }

    // Pillen zuerst: sie liegen auf der Kante und sollen sie überstimmen.
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

  /* ── Eingabe ─────────────────────────────────────────────────── */

  useEffect(() => {
    const el = huelle.current;
    if (!el) return;

    const zeiger = new Map<number, { x: number; y: number }>();
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

      if (zeiger.size === 2) {
        const [a, b] = [...zeiger.values()];
        letzterAbstand = Math.hypot(b!.x - a!.x, b!.y - a!.y);
        letzteMitte = { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 };
        zieht.current = null;
        return;
      }

      const s = stand.current;
      if (s.werkzeug === "messen") {
        const m = bildZuMeter(kamera.current, bp);
        messung.current = { von: m, nach: m };
        zieht.current = { art: "messen" };
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

      const t = treffer(bp);
      if (t?.art === "ecke") {
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
      if (z?.art === "ecke" || z?.art === "kante") {
        // Jetzt erst ein Rückschritt — nicht für jede Mausbewegung.
        s.onPlan(s.plan, true);
        zieht.current = null;
        return;
      }
      if (z?.art === "messen") {
        zieht.current = null;
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
      const t = treffer(bp);
      if (t?.art === "ecke") {
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
  }, [aendereFlaeche, anstossen, entwurfAbschliessen, treffer]);

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
    anstossen();
  }, [p.werkzeug, anstossen]);

  const quelle = anbieterZu(p.anbieter);

  return (
    <div
      ref={huelle}
      data-testid="planer-leinwand"
      className="relative h-full w-full overflow-hidden bg-sunk"
      style={{
        touchAction: "none",
        cursor: p.werkzeug === "auswahl" ? "grab" : "crosshair",
      }}
    >
      <div ref={kachelSchicht} className="absolute inset-0" aria-hidden />
      <canvas ref={flaeche} className="absolute inset-0 h-full w-full" style={{ pointerEvents: "none" }} />

      {/* Maßeingabe an der Kante (Briefing 3.2). */}
      {maszEingabe ? (
        <form
          className="absolute z-20"
          style={{ left: maszEingabe.x - 46, top: maszEingabe.y - 15 }}
          onSubmit={(e) => {
            e.preventDefault();
            const meter = Number(maszEingabe.wert.replace(",", "."));
            if (Number.isFinite(meter) && meter > 0) {
              aendereFlaeche(
                maszEingabe.flaeche,
                (f) => ({ ...f, punkte: setzeKantenlaenge(f.punkte, maszEingabe.kante, meter) }),
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
            className="num h-[30px] w-[92px] rounded-pill border-2 border-accent bg-surface px-3 text-center text-[12px] tabular-nums outline-none"
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

      {kachelFehler ? (
        <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center">
          <p className="rounded-pill bg-surface/95 px-3 py-1.5 text-[12.5px] shadow-soft">
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
        <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center">
          <p className="rounded-pill bg-surface/95 px-3 py-1.5 text-[12.5px] shadow-soft">
            {p.werkzeug === "flaeche"
              ? entwurfLaenge >= 3
                ? "Auf den ersten Punkt tippen oder Enter — schliesst die Fläche. Esc bricht ab."
                : "Ecken antippen. Ab drei Punkten lässt sich die Fläche schliessen."
              : p.werkzeug === "hindernis"
                ? "Rechteck über das Hindernis ziehen — Kamin, Fenster, Gaube."
                : p.werkzeug === "messen"
                  ? "Strecke ziehen. Esc beendet das Messen."
                  : ""}
          </p>
        </div>
      ) : null}

      <div className="pointer-events-none absolute bottom-3 left-3 flex items-end gap-3">
        <div className="rounded-card bg-surface/90 px-2.5 py-1.5 shadow-soft">
          <div
            className="border-b-2 border-l-2 border-r-2 border-ink/70"
            style={{ width: `${Math.round(anzeige.leiste.punkte)}px`, height: "6px" }}
          />
          <p className="num mt-1 text-[11px] tabular-nums text-muted">{anzeige.leiste.meter} m</p>
        </div>
        {zeigerMeter ? (
          <p className="num rounded-pill bg-surface/90 px-2.5 py-1 text-[11px] tabular-nums text-muted shadow-soft">
            {zeigerMeter.x.toFixed(1)} / {zeigerMeter.y.toFixed(1)} m
          </p>
        ) : null}
        {fangHinweis ? (
          <p className="rounded-pill bg-accent px-2.5 py-1 text-[11px] font-semibold text-white shadow-soft">
            {fangHinweis}
          </p>
        ) : null}
        {messung.current ? (
          <p className="num rounded-pill bg-surface/90 px-2.5 py-1 text-[11px] tabular-nums shadow-soft">
            {meterText(laenge(messung.current.von, messung.current.nach))}
          </p>
        ) : null}
      </div>

      <p className="pointer-events-none absolute bottom-3 right-3 text-[11px] text-muted/80">
        {quelle.quelle}
      </p>
    </div>
  );
}

export { ZOOM_GRENZEN };
