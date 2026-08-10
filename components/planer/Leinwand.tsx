"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  bildZuMeter,
  kachelnFuer,
  type Kamera,
  massstab,
  type Meter,
  meterProPixel,
  zoomeAn,
  ZOOM_GRENZEN,
} from "@/lib/planer/geo";
import { anbieter as anbieterZu, type AnbieterId, kachelUrl } from "@/lib/planer/anbieter";

/*
 * Die Zeichenfläche des Planers.
 *
 * Zwei Schichten über derselben Kamera:
 *
 *   unten  DOM-Bilder für die Kacheln — der Browser dekodiert sie
 *          nebenläufig und cacht sie selbst. Ein Canvas müsste jede
 *          Kachel bei jedem Bild neu zeichnen.
 *   oben   ein Canvas für die Geometrie. Ab Stufe 3 liegen dort
 *          zweihundert Module; als DOM-Knoten wäre das am iPad zäh.
 *
 * Die Kamera liegt in einem Ref, nicht im State: beim Schwenken ändert
 * sie sich sechzig Mal je Sekunde, und jedes davon wäre sonst ein
 * React-Durchlauf. Für die Anzeige (Zoomstufe, Massstab) wird ein
 * gedrosselter State nachgeführt.
 */

export interface LeinwandProps {
  ursprung: { lat: number; lon: number };
  anbieter: AnbieterId;
  zoom: number;
  /** Meldet Kamerabewegungen nach aussen, gedrosselt — für Autosave. */
  onKamera?: (k: { zoom: number; mitte: Meter }) => void;
}

export function Leinwand({ ursprung, anbieter, zoom, onKamera }: LeinwandProps) {
  const huelle = useRef<HTMLDivElement>(null);
  const kachelSchicht = useRef<HTMLDivElement>(null);
  const zeichenflaeche = useRef<HTMLCanvasElement>(null);

  const kamera = useRef<Kamera>({
    ursprung,
    mitte: { x: 0, y: 0 },
    zoom,
    breite: 0,
    hoehe: 0,
  });

  /** Angezeigte Werte — bewusst getrennt von der Kamera, siehe oben. */
  const [anzeige, setAnzeige] = useState({ zoom, leiste: { meter: 10, punkte: 0 } });
  const [zeiger, setZeiger] = useState<Meter | null>(null);
  const [kachelFehler, setKachelFehler] = useState(false);

  const neuZeichnen = useRef(false);
  const bilder = useRef(new Map<string, HTMLImageElement>());

  /* ── Kacheln ─────────────────────────────────────────────────── */

  const legeKacheln = useCallback(() => {
    const schicht = kachelSchicht.current;
    if (!schicht) return;
    const k = kamera.current;
    const grenze = anbieterZu(anbieter).maxStufe;
    const gebraucht = new Set<string>();

    for (const t of kachelnFuer(k, grenze)) {
      const schluessel = `${t.z}/${t.x}/${t.y}`;
      gebraucht.add(schluessel);

      let bild = bilder.current.get(schluessel);
      if (!bild) {
        bild = new Image();
        bild.decoding = "async";
        bild.draggable = false;
        bild.style.position = "absolute";
        bild.style.left = "0";
        bild.style.top = "0";
        bild.style.transformOrigin = "0 0";
        bild.style.opacity = "0";
        bild.style.transition = "opacity 140ms linear";
        bild.addEventListener("load", () => {
          bild!.style.opacity = "1";
        });
        bild.addEventListener("error", () => setKachelFehler(true));
        bild.src = kachelUrl(anbieter, t.z, t.x, t.y);
        schicht.appendChild(bild);
        bilder.current.set(schluessel, bild);
      }

      /*
       * Eine Zehntel-Punkt Überlappung. Ohne sie stehen bei
       * gebrochenem Zoom hauchdünne helle Linien zwischen den Kacheln —
       * Rundungsreste, die als Raster über dem Luftbild liegen.
       */
      bild.style.width = `${t.groesse + 0.6}px`;
      bild.style.height = `${t.groesse + 0.6}px`;
      bild.style.transform = `translate3d(${t.links}px, ${t.oben}px, 0)`;
    }

    for (const [schluessel, bild] of bilder.current) {
      if (gebraucht.has(schluessel)) continue;
      bild.remove();
      bilder.current.delete(schluessel);
    }
  }, [anbieter]);

  /* ── Geometrie ───────────────────────────────────────────────── */

  const zeichne = useCallback(() => {
    const flaeche = zeichenflaeche.current;
    if (!flaeche) return;
    const ctx = flaeche.getContext("2d");
    if (!ctx) return;

    const k = kamera.current;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (flaeche.width !== Math.round(k.breite * dpr)) {
      flaeche.width = Math.round(k.breite * dpr);
      flaeche.height = Math.round(k.hoehe * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, k.breite, k.hoehe);

    /*
     * Stufe 1 zeichnet noch keine Dachflächen — die kommen in Stufe 2.
     * Sichtbar ist nur der Projektursprung: der Nullpunkt des
     * Metersystems. Er ist die Probe aufs Exempel, dass Kacheln und
     * Geometrie auf derselben Kamera sitzen — er muss beim Zoomen und
     * Schwenken auf demselben Fleck Dach kleben bleiben.
     */
    const mitte = {
      x: k.breite / 2 - k.mitte.x / meterProPixel(k.ursprung.lat, k.zoom),
      y: k.hoehe / 2 + k.mitte.y / meterProPixel(k.ursprung.lat, k.zoom),
    };
    ctx.strokeStyle = "rgba(232, 149, 43, 0.95)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(mitte.x - 9, mitte.y);
    ctx.lineTo(mitte.x + 9, mitte.y);
    ctx.moveTo(mitte.x, mitte.y - 9);
    ctx.lineTo(mitte.x, mitte.y + 9);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(mitte.x, mitte.y, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(232, 149, 43, 0.95)";
    ctx.fill();
  }, []);

  /* ── Bildschleife ────────────────────────────────────────────── */

  const anstossen = useCallback(() => {
    if (neuZeichnen.current) return;
    neuZeichnen.current = true;
    requestAnimationFrame(() => {
      neuZeichnen.current = false;
      legeKacheln();
      zeichne();
      const k = kamera.current;
      setAnzeige({ zoom: k.zoom, leiste: massstab(k) });
      onKamera?.({ zoom: k.zoom, mitte: k.mitte });
    });
  }, [legeKacheln, zeichne, onKamera]);

  /* ── Grösse ──────────────────────────────────────────────────── */

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

  /* Anbieterwechsel: Bildschicht leeren, sonst mischen sich zwei Quellen. */
  useEffect(() => {
    for (const [, bild] of bilder.current) bild.remove();
    bilder.current.clear();
    setKachelFehler(false);
    anstossen();
  }, [anbieter, anstossen]);

  /* ── Eingabe ─────────────────────────────────────────────────── */

  useEffect(() => {
    const el = huelle.current;
    if (!el) return;

    /*
     * Alle Zeiger in einer Karte: Maus, ein Finger und zwei Finger
     * laufen über denselben Weg. Ein Finger schwenkt, zwei Finger
     * zoomen und schwenken gleichzeitig (Briefing 1.3).
     */
    const zeiger = new Map<number, { x: number; y: number }>();
    let letzterAbstand = 0;
    let letzteMitte = { x: 0, y: 0 };

    const ortVon = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    const runter = (e: PointerEvent) => {
      el.setPointerCapture(e.pointerId);
      zeiger.set(e.pointerId, ortVon(e));
      if (zeiger.size === 2) {
        const [a, b] = [...zeiger.values()];
        letzterAbstand = Math.hypot(b!.x - a!.x, b!.y - a!.y);
        letzteMitte = { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 };
      }
    };

    const bewegt = (e: PointerEvent) => {
      const jetzt = ortVon(e);
      if (!zeiger.has(e.pointerId)) {
        // Nur Zeigen, nicht Ziehen: Koordinatenanzeige nachführen.
        setZeiger(bildZuMeter(kamera.current, jetzt));
        return;
      }
      const vorher = zeiger.get(e.pointerId)!;
      zeiger.set(e.pointerId, jetzt);
      const k = kamera.current;
      const mpp = meterProPixel(k.ursprung.lat, k.zoom);

      if (zeiger.size === 1) {
        k.mitte = {
          x: k.mitte.x - (jetzt.x - vorher.x) * mpp,
          // Bildschirm-y wächst nach unten, Meter-y nach Norden.
          y: k.mitte.y + (jetzt.y - vorher.y) * mpp,
        };
      } else if (zeiger.size === 2) {
        const [a, b] = [...zeiger.values()];
        const abstand = Math.hypot(b!.x - a!.x, b!.y - a!.y);
        const mittePunkt = { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 };

        if (letzterAbstand > 0 && abstand > 0) {
          // Zoomen am Mittelpunkt zwischen den Fingern: der Fleck Dach
          // dort bleibt liegen, sonst rutscht das Bild unter der Hand weg.
          Object.assign(k, zoomeAn(k, mittePunkt, k.zoom + Math.log2(abstand / letzterAbstand)));
        }
        const mppNeu = meterProPixel(k.ursprung.lat, k.zoom);
        k.mitte = {
          x: k.mitte.x - (mittePunkt.x - letzteMitte.x) * mppNeu,
          y: k.mitte.y + (mittePunkt.y - letzteMitte.y) * mppNeu,
        };
        letzterAbstand = abstand;
        letzteMitte = mittePunkt;
      }
      anstossen();
    };

    const hoch = (e: PointerEvent) => {
      zeiger.delete(e.pointerId);
      if (zeiger.size < 2) letzterAbstand = 0;
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    };

    const rad = (e: WheelEvent) => {
      e.preventDefault();
      // ctrlKey setzt das Trackpad beim Pinch — dort feiner auflösen.
      const schritt = e.ctrlKey ? -e.deltaY / 120 : -e.deltaY / 420;
      Object.assign(kamera.current, zoomeAn(kamera.current, ortVon(e as unknown as PointerEvent), kamera.current.zoom + schritt));
      anstossen();
    };

    el.addEventListener("pointerdown", runter);
    el.addEventListener("pointermove", bewegt);
    el.addEventListener("pointerup", hoch);
    el.addEventListener("pointercancel", hoch);
    el.addEventListener("pointerleave", () => setZeiger(null));
    el.addEventListener("wheel", rad, { passive: false });
    return () => {
      el.removeEventListener("pointerdown", runter);
      el.removeEventListener("pointermove", bewegt);
      el.removeEventListener("pointerup", hoch);
      el.removeEventListener("pointercancel", hoch);
      el.removeEventListener("wheel", rad);
    };
  }, [anstossen]);

  /* Von aussen gesetzte Zoomstufe (Knöpfe in der Kopfleiste). */
  useEffect(() => {
    const k = kamera.current;
    if (Math.abs(k.zoom - zoom) < 0.001) return;
    Object.assign(k, zoomeAn(k, { x: k.breite / 2, y: k.hoehe / 2 }, zoom));
    anstossen();
  }, [zoom, anstossen]);

  /* Ursprungswechsel (neue Adresse): zurück auf die Bildmitte. */
  useEffect(() => {
    kamera.current.ursprung = ursprung;
    kamera.current.mitte = { x: 0, y: 0 };
    for (const [, bild] of bilder.current) bild.remove();
    bilder.current.clear();
    anstossen();
  }, [ursprung, anstossen]);

  const quelle = anbieterZu(anbieter);

  return (
    <div
      ref={huelle}
      data-testid="planer-leinwand"
      className="relative h-full w-full overflow-hidden bg-sunk"
      // Ohne das übernimmt der Browser am iPad Pinch und Scroll selbst.
      style={{ touchAction: "none", cursor: "grab" }}
    >
      <div ref={kachelSchicht} className="absolute inset-0" aria-hidden />
      <canvas
        ref={zeichenflaeche}
        className="absolute inset-0 h-full w-full"
        style={{ pointerEvents: "none" }}
      />

      {kachelFehler ? (
        <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center">
          <p className="rounded-pill bg-surface/95 px-3 py-1.5 text-[12.5px] text-ink shadow-card">
            {quelle.label} liefert gerade keine Bilder — anderen Anbieter wählen.
          </p>
        </div>
      ) : null}

      {/* Massstab und Koordinaten: die Probe, dass in Metern gerechnet wird. */}
      <div className="pointer-events-none absolute bottom-3 left-3 flex items-end gap-3">
        <div className="rounded-card bg-surface/90 px-2.5 py-1.5 shadow-card">
          <div
            className="border-b-2 border-l-2 border-r-2 border-ink/70"
            style={{ width: `${Math.round(anzeige.leiste.punkte)}px`, height: "6px" }}
          />
          <p className="mono mt-1 text-[11px] tabular-nums text-muted">
            {anzeige.leiste.meter} m
          </p>
        </div>
        {zeiger ? (
          <p className="mono rounded-pill bg-surface/90 px-2.5 py-1 text-[11px] tabular-nums text-muted shadow-card">
            {zeiger.x.toFixed(1)} / {zeiger.y.toFixed(1)} m
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
