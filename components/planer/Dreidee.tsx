"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import {
  aktiveZellen,
  anbaustellen,
  eckenUm,
  modulEcken,
  rasterMitte,
} from "@/lib/planer/module";
import { falllinie } from "@/lib/planer/flaeche";
import type { Punkt3D } from "@/lib/planer/gebaeude";
import {
  kachelnFuer,
  type Kamera,
  type Meter,
  meterProPixel,
  weltPixel,
} from "@/lib/planer/geo";
import { anbieter as anbieterZu, kachelUrlGleicheHerkunft } from "@/lib/planer/anbieter";
import { modulVorschau } from "@/lib/planer/setzen";
import type { AnbieterId } from "@/lib/planer/anbieter";
import { type Plan, strangFarbe } from "@/lib/planer/plan";
import { strangWeg } from "@/lib/planer/strings";

/*
 * Die räumliche Ansicht (BRIEFING-planer-3d.md, Stufe 3D-2 und 3D-4).
 *
 * Sie zeigt dieselben Daten wie die Zeichenfläche, nur von der Seite:
 * Boden und Dachflächen mit dem Luftbild, Gebäudekörper aus den
 * Dachparametern, Module darauf, die Kabelwege der Strings darüber.
 *
 * Zwei Dinge sind hier bewusst anders als im ersten Entwurf:
 *
 * 1. Das Luftbild liegt AUCH auf dem Dach. Es ist dasselbe Bild wie am
 *    Boden, nur von oben auf die geneigte Fläche projiziert — und weil
 *    das Luftbild ein Dach von oben zeigt, ist genau das die richtige
 *    Textur. Ein brauner Ersatzton daneben sah aus wie ein Modellhaus;
 *    mit dem Bild erkennt der Kunde sein eigenes Dach wieder.
 * 2. Hier wird auch belegt, nicht nur geschaut. Der erste Entwurf hat
 *    das ausgeschlossen („trifft nie die Zelle, die man meint"). Das
 *    stimmt für ein Raster mit fünfzig Zellen, nicht für den Fall, um
 *    den es geht: ein Modul dazu, eines weg. Getroffen wird per
 *    Strahlwurf auf die Dachfläche, und die Rechnung dahinter ist
 *    dieselbe wie in der Draufsicht (lib/planer/setzen.ts).
 *
 * three.js direkt, ohne React-Wrapper. Der Planer hält seine Kamera
 * schon in der Zeichenfläche in Refs statt im State, weil sonst keine
 * 60 Bilder je Sekunde herauskommen; ein deklarativer Wrapper würde
 * genau das rückgängig machen.
 */

export interface DreideeProps {
  plan: Plan;
  ursprung: { lat: number; lon: number };
  anbieter: AnbieterId;
  /** Kartenausschnitt der 2D-Ansicht — bestimmt, welche Kacheln geladen werden. */
  kamera: Kamera;
  wandhoehe: number;
  ueberstand: number;
  /**
   * Verschattungsgrad je Modul (Schlüssel `gruppe/reihe:spalte`). Bestimmt
   * nur die Farbe: Ein echter Schattenwurf mit Lichtquelle wäre schöner,
   * würde aber eine andere Zahl zeigen als die Ertragsrechnung — und
   * zwei Wahrheiten über denselben Schatten sind eine zu viel.
   */
  schatten?: Map<string, { grad: number }>;
  /** Gewählte Dachfläche — sie gilt, wenn der Klick keine trifft. */
  aktiv?: string | null;
  /**
   * Was ein Tipp bedeutet.
   *
   * `ansehen` — nichts, die Kamera gehört sich selbst.
   * `belegen` — Modul setzen bzw. wegnehmen.
   * `strings` — Modul dem gewählten String zuschlagen oder herausnehmen.
   *
   * Getrennte Betriebsarten und keine Sondertaste: Beides fängt mit
   * derselben Geste an, und wer das Haus dreht, tippt am Ende auf das
   * Dach.
   */
  modus?: "ansehen" | "belegen" | "strings";
  /** Ein Modul an diesen Punkt setzen (Meter im Planursprung). */
  onSetzen?: (punkt: Meter) => void;
  /** Dieses Modul wegnehmen. */
  onModulWeg?: (gruppe: string, reihe: number, spalte: number) => void;
  /** Dieses Modul dem gewählten String zuschlagen oder herausnehmen. */
  onModulStrang?: (gruppe: string, reihe: number, spalte: number) => void;
  /** An dieser Anbaustelle ein Modul anhängen. */
  onAnbauen?: (gruppe: string, reihe: number, spalte: number) => void;
}

/**
 * Schraffur für Sperrzonen — dieselbe Aussage wie in der Draufsicht.
 *
 * Als wiederholte Textur und nicht als einzelne Linien: Eine Zone kann
 * jede Form haben, und Striche einzeln zu beschneiden hiesse, das
 * Clipping der Zeichenfläche in three nachzubauen.
 */
function schraffur(): THREE.CanvasTexture | null {
  const c = document.createElement("canvas");
  c.width = 32;
  c.height = 32;
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "rgba(232, 176, 43, 0.34)";
  ctx.fillRect(0, 0, 32, 32);
  ctx.strokeStyle = "rgba(150, 98, 6, 0.92)";
  ctx.lineWidth = 5;
  ctx.beginPath();
  // Zweimal versetzt, damit die Kachel an beiden Rändern zusammenpasst.
  ctx.moveTo(-8, 24);
  ctx.lineTo(24, -8);
  ctx.moveTo(8, 40);
  ctx.lineTo(40, 8);
  ctx.stroke();
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * Marke für eine Anbaustelle — dasselbe Pluszeichen wie in der
 * Draufsicht, nur als Textur statt als Strich.
 *
 * Ein echtes Kreuz aus Geometrie wäre bei fünfzig Anbaustellen
 * fünfzig weitere Netze; eine Textur ist eines, das fünfzigmal
 * benutzt wird.
 */
function plusmarke(): THREE.CanvasTexture | null {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext("2d");
  if (!ctx) return null;

  ctx.fillStyle = "rgba(232, 149, 43, 0.20)";
  ctx.fillRect(0, 0, 64, 64);

  // Gestrichelter Rand wie in der Draufsicht.
  ctx.strokeStyle = "rgba(232, 149, 43, 0.95)";
  ctx.lineWidth = 4;
  ctx.setLineDash([7, 5]);
  ctx.strokeRect(2, 2, 60, 60);
  ctx.setLineDash([]);

  // Scheibe mit Kreuz in der Mitte.
  ctx.beginPath();
  ctx.arc(32, 32, 14, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(232, 149, 43, 0.95)";
  ctx.fill();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(32, 24);
  ctx.lineTo(32, 40);
  ctx.moveTo(24, 32);
  ctx.lineTo(40, 32);
  ctx.stroke();

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Weltkoordinaten: x nach Osten, y nach oben, z nach Süden. */
function zuWelt(p: Punkt3D): THREE.Vector3 {
  return new THREE.Vector3(p.x, p.z, -p.y);
}

/**
 * Ein ebenes Vieleck als Dreiecksnetz.
 *
 * `ShapeGeometry` scheidet aus: Sie arbeitet in der xy-Ebene und müsste
 * anschliessend gedreht werden, was bei nicht ebenen Vierecken — und
 * genau die entstehen bei einem Pultdach über schiefem Grundriss —
 * sichtbar falsch aussieht. Ein Fächer aus Dreiecken um den ersten
 * Punkt ist für konvexe Flächen exakt und für unsere Dachformen
 * ausreichend.
 */
function flaecheGeometrie(
  punkte: Punkt3D[],
  kartenseite?: number,
  /** Kachelweite der Textur in Metern — für sich wiederholende Muster. */
  uvMeter?: number,
): THREE.BufferGeometry {
  const ecken = punkte.map(zuWelt);
  const positionen: number[] = [];
  const uvs: number[] = [];

  /*
   * Die Textur wird VON OBEN aufgelegt, nicht an der Fläche entlang
   * gewickelt: Das Luftbild ist eine Draufsicht, und nur eine
   * Draufsichtprojektion setzt den Schornstein im Bild dorthin, wo er
   * auf dem Dach auch steht. Die Neigung streckt das Bild dabei — das
   * ist richtig so, denn die geneigte Fläche ist in der Draufsicht
   * genauso verkürzt.
   */
  const uv = (p: Punkt3D): [number, number] => {
    if (uvMeter) return [p.x / uvMeter, p.y / uvMeter];
    if (kartenseite) return [(p.x + kartenseite / 2) / kartenseite, (p.y + kartenseite / 2) / kartenseite];
    return [0, 0];
  };

  for (let i = 1; i + 1 < ecken.length; i++) {
    positionen.push(
      ecken[0]!.x, ecken[0]!.y, ecken[0]!.z,
      ecken[i]!.x, ecken[i]!.y, ecken[i]!.z,
      ecken[i + 1]!.x, ecken[i + 1]!.y, ecken[i + 1]!.z,
    );
    uvs.push(...uv(punkte[0]!), ...uv(punkte[i]!), ...uv(punkte[i + 1]!));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positionen, 3));
  if (kartenseite || uvMeter) g.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  g.computeVertexNormals();
  return g;
}

export function Dreidee(p: DreideeProps) {
  const halter = useRef<HTMLDivElement | null>(null);
  /*
   * Ob gerade ein Geistermodul am Zeiger hängt und ob es dort passt.
   * Es liegt in der Szene und ist von aussen sonst nicht zu sehen —
   * dieselbe Angabe führt die Zeichenfläche schon.
   */
  const [geistAttribut, setGeistAttribut] = useState<string | undefined>(undefined);
  /*
   * Ob das Luftbild angekommen ist.
   *
   * Ein stiller Fehlschlag sah aus wie ein kaputter Renderer: eine
   * einfarbige Fläche, kein Haus zu erkennen, keine Meldung. Jetzt
   * steht da, was los ist.
   */
  const [bildFehlt, setBildFehlt] = useState(false);
  /*
   * Wie viele Pluszeichen gerade in der Szene stehen. Sie liegen im
   * WebGL-Bild und sind von aussen sonst nicht zu zählen — ohne diese
   * Angabe liesse sich nicht prüfen, ob sie überhaupt entstehen.
   */
  const [anbauZahl, setAnbauZahl] = useState(0);
  const stand = useRef(p);
  stand.current = p;
  /*
   * Der Neuaufbau der Szene lebt im ersten Effekt, angestossen wird er
   * aus dem zweiten. Über ein Ref statt über ein Ereignis: Ein
   * CustomEvent, das niemand abfängt, sieht aus wie eine Nachführung
   * und ist keine.
   */
  const neuAufbauen = useRef<(() => void) | null>(null);

  useEffect(() => {
    const el = halter.current;
    if (!el) return;

    const szene = new THREE.Scene();
    szene.background = new THREE.Color(0x0b0a08);

    const kamera = new THREE.PerspectiveCamera(50, 1, 0.5, 3000);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    el.appendChild(renderer.domElement);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.touchAction = "none";

    /*
     * Licht: eine Sonne aus Südwesten plus weiches Umgebungslicht. Kein
     * Schattenwurf — der kommt erst in Stufe 3D-3 und wäre hier nur
     * Dekoration, die Rechenzeit kostet.
     */
    szene.add(new THREE.AmbientLight(0xffffff, 1.1));
    const sonne = new THREE.DirectionalLight(0xffffff, 1.7);
    sonne.position.set(-30, 60, 40);
    szene.add(sonne);

    const gruppe = new THREE.Group();
    szene.add(gruppe);

    /* ── Kamera-Steuerung ─────────────────────────────────────────
     *
     * Eigene Umlaufsteuerung statt der OrbitControls aus den
     * three-Beispielen: Die bringen eigene Tastenbelegungen und ein
     * eigenes Trägheitsverhalten mit, das sich mit der Bedienung der
     * Zeichenfläche beisst. Hier ist genau das drin, was der Planer
     * braucht.
     */
    const blick = { azimut: Math.PI * 0.25, hoehe: 0.9, abstand: 45 };
    const ziel = new THREE.Vector3(0, 0, 0);

    const kameraSetzen = () => {
      const r = blick.abstand;
      kamera.position.set(
        ziel.x + r * Math.cos(blick.hoehe) * Math.sin(blick.azimut),
        ziel.y + r * Math.sin(blick.hoehe),
        ziel.z + r * Math.cos(blick.hoehe) * Math.cos(blick.azimut),
      );
      kamera.lookAt(ziel);
    };

    let zieht: { x: number; y: number; taste: number } | null = null;
    const zeiger = new Map<number, { x: number; y: number }>();
    let letzterAbstand = 0;
    /*
     * Wie weit der Zeiger seit dem Aufsetzen gewandert ist. Ein Klick
     * setzt ein Modul, ein Zug dreht die Kamera — ohne diese Zahl wäre
     * jedes Drehen am Ende auch ein Modul.
     */
    let bewegt = 0;

    const runter = (e: PointerEvent) => {
      renderer.domElement.setPointerCapture(e.pointerId);
      zeiger.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (zeiger.size === 2) {
        const [a, b] = [...zeiger.values()];
        letzterAbstand = Math.hypot(b!.x - a!.x, b!.y - a!.y);
        zieht = null;
        return;
      }
      zieht = { x: e.clientX, y: e.clientY, taste: e.button };
      bewegt = 0;
    };

    const bewegung = (e: PointerEvent) => {
      /*
       * Ohne gedrückte Taste ist es blosses Überfahren — und genau dann
       * gehört das Geistermodul unter den Zeiger. Der erste Anlauf
       * stieg hier aus, weil nur Zeiger mit einem `pointerdown`
       * verfolgt wurden: Die Vorschau erschien nie, das Setzen
       * funktionierte trotzdem. Man klickte also blind.
       */
      const vorher = zeiger.get(e.pointerId);
      if (!vorher) {
        geistFuehren(e);
        return;
      }
      zeiger.set(e.pointerId, { x: e.clientX, y: e.clientY });

      // Zwei Finger: kneifen zoomt, schieben verschiebt das Ziel.
      if (zeiger.size === 2) {
        const [a, b] = [...zeiger.values()];
        const abstand = Math.hypot(b!.x - a!.x, b!.y - a!.y);
        if (letzterAbstand > 0) {
          blick.abstand = Math.max(8, Math.min(300, blick.abstand * (letzterAbstand / abstand)));
        }
        letzterAbstand = abstand;
        kameraSetzen();
        return;
      }

      if (!zieht) return;
      const dx = e.clientX - vorher.x;
      const dy = e.clientY - vorher.y;
      bewegt += Math.abs(dx) + Math.abs(dy);

      /*
       * Rechte Maustaste schwenkt, linke dreht. Beim Schwenken wandert
       * das Ziel in der Bodenebene — nicht die Kamera, sonst kippt der
       * Horizont weg.
       */
      if (zieht.taste === 2 || e.shiftKey) {
        const seitlich = new THREE.Vector3(Math.cos(blick.azimut), 0, -Math.sin(blick.azimut));
        const vor = new THREE.Vector3(Math.sin(blick.azimut), 0, Math.cos(blick.azimut));
        const m = blick.abstand / 600;
        ziel.addScaledVector(seitlich, -dx * m);
        ziel.addScaledVector(vor, -dy * m);
      } else {
        blick.azimut -= dx * 0.006;
        // Nicht unter den Boden und nicht über den Scheitel.
        blick.hoehe = Math.max(0.12, Math.min(1.5, blick.hoehe + dy * 0.005));
      }
      kameraSetzen();
    };

    const hoch = (e: PointerEvent) => {
      const warZug = bewegt > 6;
      zeiger.delete(e.pointerId);
      if (zeiger.size < 2) letzterAbstand = 0;
      if (zeiger.size === 0) zieht = null;
      if (!warZug && e.button === 0) angetippt(e);
    };

    const rad = (e: WheelEvent) => {
      e.preventDefault();
      blick.abstand = Math.max(8, Math.min(300, blick.abstand * (1 + e.deltaY * 0.0012)));
      kameraSetzen();
    };

    /* ── Belegen in der Perspektive ────────────────────────────────
     *
     * Ein Strahl vom Zeiger in die Szene. Trifft er ein Modul, ist das
     * Modul gemeint; trifft er eine Dachfläche, ist die Stelle gemeint.
     * Umgerechnet wird nur die Draufsicht des Treffpunkts (x, -z) —
     * die Höhe ergibt sich aus der Fläche und muss nicht geraten
     * werden.
     */
    const strahl = new THREE.Raycaster();
    const stelle = new THREE.Vector2();

    const zeigerStrahl = (e: PointerEvent) => {
      const r = renderer.domElement.getBoundingClientRect();
      stelle.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      strahl.setFromCamera(stelle, kamera);
    };

    /** Was der Zeiger gerade meint. */
    const gemeint = (
      e: PointerEvent,
    ):
      | { art: "plus"; gruppe: string; reihe: number; spalte: number }
      | { art: "modul"; gruppe: string; reihe: number; spalte: number }
      | { art: "dach"; punkt: Meter }
      | null => {
      zeigerStrahl(e);
      /*
       * Pluszeichen zuerst: Sie liegen über der Dachhaut und meinen
       * genau einen Rasterplatz. Ohne den Vorrang träfe der Strahl das
       * Dach darunter, und das Modul landete auf der freien Fläche
       * statt am Feld — dasselbe Vorrecht haben sie in der Draufsicht.
       */
      const aufPlus = strahl.intersectObjects(plusNetze, false)[0];
      if (aufPlus) {
        const d = aufPlus.object.userData as { gruppe: string; reihe: number; spalte: number };
        return { art: "plus", gruppe: d.gruppe, reihe: d.reihe, spalte: d.spalte };
      }
      const aufModul = strahl.intersectObjects(modulNetze, false)[0];
      if (aufModul) {
        const d = aufModul.object.userData as { gruppe: string; reihe: number; spalte: number };
        return { art: "modul", gruppe: d.gruppe, reihe: d.reihe, spalte: d.spalte };
      }
      const aufDach = strahl.intersectObjects(dachNetze, false)[0];
      if (aufDach) {
        return { art: "dach", punkt: { x: aufDach.point.x, y: -aufDach.point.z } };
      }
      return null;
    };

    /**
     * Das Geistermodul unter dem Zeiger nachführen.
     *
     * Dieselbe Vorschau wie in der Draufsicht: grün, wenn es passt, rot,
     * wenn Randabstand, Sperrzone oder ein Nachbar im Weg sind. Wer
     * nichts sieht, hält den Planer für kaputt.
     */
    const geistFuehren = (e: PointerEvent) => {
      const s = stand.current;
      if (s.modus !== "belegen") {
        geistWeg();
        return;
      }
      const ziel2 = gemeint(e);
      if (!ziel2 || ziel2.art !== "dach") {
        /*
         * Über einem Pluszeichen kein Geisterbild: Das Pluszeichen
         * sagt selbst schon, wohin das Modul kommt.
         */
        geistWeg();
        return;
      }

      const v = modulVorschau(s.plan, ziel2.punkt, s.aktiv ?? null, s.plan.gruppen[0]?.typ);
      const f = v ? s.plan.flaechen.find((x) => x.id === v.flaeche) : null;
      if (!v || !f) return;

      if (geist) gruppe.remove(geist);
      setGeistAttribut(v.passt ? "passt" : "eng");
      geist = new THREE.Mesh(
        flaecheGeometrie(v.ecken.map((q) => ({ x: q.x, y: q.y, z: hoeheAuf(f, q) + 0.08 }))),
        new THREE.MeshBasicMaterial({
          color: v.passt ? 0x3e9e6b : 0xd2543f,
          transparent: true,
          opacity: 0.62,
          side: THREE.DoubleSide,
        }),
      );
      gruppe.add(geist);
    };

    /** Das Geistermodul wegräumen — an drei Stellen nötig. */
    const geistWeg = () => {
      if (geist) {
        gruppe.remove(geist);
        geist = null;
      }
      setGeistAttribut(undefined);
    };

    /** Ein Tipp ohne Zug: Modul setzen oder wegnehmen. */
    const angetippt = (e: PointerEvent) => {
      const s = stand.current;
      if (s.modus !== "belegen" && s.modus !== "strings") return;
      const ziel2 = gemeint(e);
      if (!ziel2) return;

      if (s.modus === "strings") {
        // Nur Module — der freie Dachbereich gehört zu keinem String.
        if (ziel2.art === "modul") s.onModulStrang?.(ziel2.gruppe, ziel2.reihe, ziel2.spalte);
        return;
      }

      if (ziel2.art === "plus") s.onAnbauen?.(ziel2.gruppe, ziel2.reihe, ziel2.spalte);
      else if (ziel2.art === "modul") s.onModulWeg?.(ziel2.gruppe, ziel2.reihe, ziel2.spalte);
      else s.onSetzen?.(ziel2.punkt);
    };

    renderer.domElement.addEventListener("pointerdown", runter);
    renderer.domElement.addEventListener("pointermove", bewegung);
    renderer.domElement.addEventListener("pointerup", hoch);
    renderer.domElement.addEventListener("pointercancel", hoch);
    renderer.domElement.addEventListener("wheel", rad, { passive: false });
    renderer.domElement.addEventListener("contextmenu", (e) => e.preventDefault());

    /* ── Das Luftbild als eine einzige Textur ──────────────────────
     *
     * Sie wird EINMAL gebaut und für Boden und Dächer benutzt. Der
     * erste Entwurf baute sie im Szenenaufbau — und weil der Aufbau
     * bei jeder Planänderung läuft, wurden bei jedem gesetzten Modul
     * gut zwanzig Kacheln neu angefordert.
     */
    const KARTENSEITE = 160;
    const sperrmuster = schraffur();
    const plusmuster = plusmarke();
    let karte: THREE.CanvasTexture | null = null;
    let karteSchluessel = "";

    const karteBauen = (s: DreideeProps): THREE.CanvasTexture | null => {
      const schluessel = `${s.anbieter}|${s.ursprung.lat.toFixed(5)}|${s.ursprung.lon.toFixed(5)}`;
      if (karte && schluessel === karteSchluessel) return karte;

      const leinwand = document.createElement("canvas");
      leinwand.width = 2048;
      leinwand.height = 2048;
      const ctx = leinwand.getContext("2d");
      if (!ctx) return null;

      /*
       * Grundfarbe zuerst: Ein frisches Canvas ist TRANSPARENT, und
       * three rendert Transparenz auf einem undurchsichtigen Material
       * als Schwarz. Der erste Anlauf hat deshalb einen schwarzen Boden
       * gezeigt, obwohl die Kacheln geladen und gezeichnet wurden — es
       * sah aus wie ein Rechenfehler und war keiner.
       */
      ctx.fillStyle = "#3f4a35";
      ctx.fillRect(0, 0, leinwand.width, leinwand.height);

      /*
       * Die Kachelstufe wird aus der Ebene bestimmt, nicht aus der
       * Kamera der Draufsicht. Erbte man sie, käme bei weit
       * herausgezoomter Karte eine Stufe heraus, deren Kacheln fünfzig
       * Meter breit sind — für eine 160-Meter-Ebene bleiben davon drei
       * Kacheln, entsprechend grob.
       */
      const mppZiel = KARTENSEITE / leinwand.width;
      /*
       * Nicht über das hinaus, was der Anbieter ausliefert. Die Rechnung
       * unten kommt bei 160 m auf 2048 Bildpunkten auf Stufe 20 —
       * basemap.at endet bei 19 und antwortet darüber mit 404. Dann
       * bleibt die Textur leer, und man sieht eine einfarbige Fläche
       * ohne Hinweis darauf, warum.
       */
      const hoechste = anbieterZu(s.anbieter).maxStufe;
      const stufe = Math.max(
        1,
        Math.min(
          hoechste,
          /*
           * mpp = 156543,03 · cos(lat) / 2^zoom, also
           * zoom = log2(156543,03 · cos(lat) / mpp). Ohne Abzug — der
           * erste Anlauf zog hier 8 ab (verwechselt mit der Formel für
           * Kachelindizes) und landete bei Stufe 12: eine einzige
           * Kachel, über die ganze Ebene gezogen.
           */
          Math.round(
            Math.log2((156543.03392 * Math.cos((s.ursprung.lat * Math.PI) / 180)) / mppZiel),
          ),
        ),
      );
      const kacheln = kachelnFuer(
        {
          ...s.kamera,
          zoom: stufe,
          mitte: { x: 0, y: 0 },
          breite: KARTENSEITE / meterProPixel(s.ursprung.lat, stufe),
          hoehe: KARTENSEITE / meterProPixel(s.ursprung.lat, stufe),
        },
        hoechste,
      );
      if (kacheln.length === 0) return null;

      const textur = new THREE.CanvasTexture(leinwand);
      textur.colorSpace = THREE.SRGBColorSpace;

      const proMeter = leinwand.width / KARTENSEITE;
      let angekommen = 0;
      let danebengegangen = 0;
      const bilanz = () => {
        // Erst urteilen, wenn alle Kacheln geantwortet haben.
        if (angekommen + danebengegangen < kacheln.length) return;
        setBildFehlt(angekommen === 0);
      };

      for (const t of kacheln) {
        const mppStufe = meterProPixel(s.ursprung.lat, t.z);
        const nullpunkt = weltPixel(s.ursprung, t.z);
        const bild = new Image();
        bild.crossOrigin = "anonymous";
        bild.onload = () => {
          // Kachelecke in Meter relativ zum Planursprung.
          const xM = (t.x * 256 - nullpunkt.x) * mppStufe;
          // Kachel-y wächst nach Süden, Meter nach Norden.
          const yM = -(t.y * 256 - nullpunkt.y) * mppStufe;
          const gross = 256 * mppStufe * proMeter;
          ctx.drawImage(
            bild,
            (xM + KARTENSEITE / 2) * proMeter,
            (KARTENSEITE / 2 - yM) * proMeter,
            gross,
            gross,
          );
          textur.needsUpdate = true;
          angekommen++;
          bilanz();
        };
        bild.onerror = () => {
          danebengegangen++;
          bilanz();
        };
        bild.src = kachelUrlGleicheHerkunft(s.anbieter, t.z, t.x, t.y);
      }

      karte = textur;
      karteSchluessel = schluessel;
      return textur;
    };

    /**
     * Höhe eines Punktes auf einer Dachfläche.
     *
     * Wandhöhe plus Anstieg ab der Traufe. Eine Stelle für Zeichnen und
     * für den Strahlwurf: Läge das gesetzte Modul auf einer anderen
     * Höhe als die Dachhaut, sähe man es kippen.
     */
    const hoeheAuf = (f: DreideeProps["plan"]["flaechen"][number], q: Meter): number => {
      const fall = falllinie(f);
      const steig = Math.tan((f.neigung * Math.PI) / 180);
      const a = f.traufe !== null ? f.punkte[f.traufe % f.punkte.length]! : f.punkte[0]!;
      return (
        stand.current.wandhoehe +
        (fall ? ((q.x - a.x) * fall.x + (q.y - a.y) * fall.y) * steig : 0)
      );
    };

    /* Was der Strahlwurf treffen darf. */
    const dachNetze: THREE.Mesh[] = [];
    const modulNetze: THREE.Mesh[] = [];
    /** Anbaustellen — dieselben Pluszeichen wie in der Draufsicht. */
    const plusNetze: THREE.Mesh[] = [];
    let geist: THREE.Mesh | null = null;

    /* ── Szene aus dem Plan aufbauen ──────────────────────────── */
    const aufbauen = () => {
      const s = stand.current;
      gruppe.clear();
      dachNetze.length = 0;
      modulNetze.length = 0;
      plusNetze.length = 0;
      geist = null;

      const textur = karteBauen(s);
      boden(gruppe, textur);

      /*
       * Bäume und Nachbargebäude. Sie stehen im Bild, weil sie im Ertrag
       * stehen: Wer den Abschlag sieht, soll auch sehen, woher er kommt.
       */
      for (const o of s.plan.objekte) {
        if (o.art === "baum" && o.mitte && o.radius) {
          /*
           * Der Stamm reicht bis zur Kronenmitte, nicht bis zu einem
           * Bruchteil der Baumhöhe: Bei einem hohen Baum mit kleiner
           * Krone blieb sonst eine Lücke, und die Krone schwebte über
           * dem Grundstück.
           */
          const stammHoehe = Math.max(0.5, o.hoehe - o.radius);
          const stamm = new THREE.Mesh(
            new THREE.CylinderGeometry(0.15, 0.2, stammHoehe, 6),
            new THREE.MeshLambertMaterial({ color: 0x6b4f3a }),
          );
          stamm.position.set(o.mitte.x, stammHoehe / 2, -o.mitte.y);
          gruppe.add(stamm);

          const krone = new THREE.Mesh(
            new THREE.SphereGeometry(o.radius, 12, 10),
            new THREE.MeshLambertMaterial({ color: 0x3e7a4a }),
          );
          // Die Kugelmitte so setzen, dass der Scheitel die Höhe trifft.
          krone.position.set(o.mitte.x, o.hoehe - o.radius, -o.mitte.y);
          krone.scale.set(1, 1.25, 1);
          gruppe.add(krone);
        } else if (o.art === "gebaeude" && o.punkte && o.punkte.length >= 3) {
          for (let i = 0; i < o.punkte.length; i++) {
            const a = o.punkte[i]!;
            const b = o.punkte[(i + 1) % o.punkte.length]!;
            gruppe.add(
              new THREE.Mesh(
                flaecheGeometrie([
                  { x: a.x, y: a.y, z: 0 },
                  { x: b.x, y: b.y, z: 0 },
                  { x: b.x, y: b.y, z: o.hoehe },
                  { x: a.x, y: a.y, z: o.hoehe },
                ]),
                new THREE.MeshLambertMaterial({ color: 0xb9b2a4, side: THREE.DoubleSide }),
              ),
            );
          }
          gruppe.add(
            new THREE.Mesh(
              flaecheGeometrie(o.punkte.map((q) => ({ x: q.x, y: q.y, z: o.hoehe }))),
              new THREE.MeshLambertMaterial({ color: 0x8f877d, side: THREE.DoubleSide }),
            ),
          );
        }
      }

      /* Farbe je Modul aus seiner Stringzugehörigkeit — wie in der Draufsicht. */
      const stringFarben = new Map<string, string>();
      s.plan.strings.forEach((st, i) => {
        for (const m of st.module) stringFarben.set(m, strangFarbe(i));
      });

      /*
       * Jede gezeichnete Fläche IST eine Dachfläche — mit Neigung und
       * Traufe. Sie wird deshalb angehoben und geneigt, nicht in ein
       * eigenes Gebäude verwandelt.
       *
       * Der erste Anlauf rief für JEDE Fläche `gebaeude()` mit dem
       * Dachtyp auf. Bei einem Satteldach, das der Assistent als zwei
       * Flächen anlegt, entstanden daraus zwei ineinander steckende
       * Häuser. Der Dachtyp gehört zum Gebäude, nicht zur Fläche.
       */
      for (const f of s.plan.flaechen) {
        const hoeheAn = (q: Meter) => hoeheAuf(f, q);
        const dach: Punkt3D[] = f.punkte.map((q) => ({ x: q.x, y: q.y, z: hoeheAn(q) }));

        /*
         * Unbeleuchtet mit einem festen Schattenfaktor statt Lambert:
         * Im Luftbild steckt die Beleuchtung schon drin. Ein zusätzlich
         * angestrahltes Dach wird weiss. Der Faktor aus Neigung und
         * Ausrichtung gibt dem Körper trotzdem Form — eine Nordfläche
         * ist dunkler als eine Südfläche, so wie im echten Bild auch.
         */
        const nord = Math.cos((f.azimut * Math.PI) / 180);
        const steil = Math.sin((f.neigung * Math.PI) / 180);
        const ton = Math.max(0.55, Math.min(1, 0.86 - nord * steil * 0.3));
        const dachNetz = new THREE.Mesh(
          flaecheGeometrie(dach, textur ? KARTENSEITE : undefined),
          textur
            ? new THREE.MeshBasicMaterial({
                map: textur,
                color: new THREE.Color(ton, ton, ton),
                side: THREE.DoubleSide,
              })
            : new THREE.MeshLambertMaterial({ color: 0x8b6b52, side: THREE.DoubleSide }),
        );
        dachNetz.userData = { flaeche: f.id };
        dachNetze.push(dachNetz);
        gruppe.add(dachNetz);

        /*
         * Eine Kante um die Dachfläche. Ohne sie geht der Umriss im
         * Luftbild darunter verloren — beide tragen dasselbe Bild, und
         * ohne Linie sieht man nur die Wände.
         */
        gruppe.add(
          new THREE.LineLoop(
            new THREE.BufferGeometry().setFromPoints(
              dach.map((q) => new THREE.Vector3(q.x, q.z + 0.02, -q.y)),
            ),
            new THREE.LineBasicMaterial({ color: 0x151210 }),
          ),
        );

        /*
         * Wände: vom Boden bis zur Dachkante, jede Ecke auf ihre eigene
         * Höhe. So schliesst die Wand an einem Giebel schräg ab, statt
         * waagrecht abgeschnitten zu sein.
         */
        for (let i = 0; i < f.punkte.length; i++) {
          const p1 = f.punkte[i]!;
          const p2 = f.punkte[(i + 1) % f.punkte.length]!;
          gruppe.add(
            new THREE.Mesh(
              flaecheGeometrie([
                { x: p1.x, y: p1.y, z: 0 },
                { x: p2.x, y: p2.y, z: 0 },
                { x: p2.x, y: p2.y, z: hoeheAn(p2) },
                { x: p1.x, y: p1.y, z: hoeheAn(p1) },
              ]),
              new THREE.MeshLambertMaterial({ color: 0xe8e2d8, side: THREE.DoubleSide }),
            ),
          );
        }

        /*
         * Sperrzonen auf der Dachhaut. Sie liegen ÜBER den Modulen
         * (8 cm statt 4), damit man sieht, wenn versehentlich in eine
         * Zone hinein belegt wurde — ein Modul unter der Schraffur ist
         * ein Fehler, den man sehen muss, kein Schönheitsfehler.
         */
        for (const h of f.hindernisse) {
          if (h.punkte.length < 3) continue;
          gruppe.add(
            new THREE.Mesh(
              flaecheGeometrie(
                h.punkte.map((q) => ({ x: q.x, y: q.y, z: hoeheAn(q) + 0.08 })),
                undefined,
                /*
                 * 60 cm je Kachel. Bei 1,4 m sah eine kleine Zone —
                 * ein Kamin misst keinen Meter — nach einer einzigen
                 * Kachel aus, also nach einer glatten gelben Fläche.
                 */
                0.6,
              ),
              new THREE.MeshBasicMaterial({
                map: sperrmuster,
                transparent: true,
                opacity: 0.85,
                side: THREE.DoubleSide,
                depthWrite: false,
              }),
            ),
          );
          gruppe.add(
            new THREE.LineLoop(
              new THREE.BufferGeometry().setFromPoints(
                h.punkte.map((q) => new THREE.Vector3(q.x, hoeheAn(q) + 0.09, -q.y)),
              ),
              new THREE.LineBasicMaterial({ color: 0xe8b02b }),
            ),
          );
        }

        // Module auf dieser Fläche, auf derselben schiefen Ebene.
        for (const mg of s.plan.gruppen.filter((x) => x.flaeche === f.id)) {
          for (const z of aktiveZellen(mg)) {
            const flach = modulEcken(mg, f, z.reihe, z.spalte);
            if (flach.length < 3) continue;
            const schluessel = `${mg.id}/${z.reihe}:${z.spalte}`;
            /*
             * Verschattete Module heller und grauer — auf dunklem
             * Modulblau ist Abdunkeln nicht zu sehen. Dieselbe Schwelle
             * wie in der Draufsicht, damit beide Ansichten dieselben
             * Module hervorheben.
             */
            const grad = s.schatten?.get(schluessel)?.grad ?? 0;
            const stringfarbe = stringFarben.get(schluessel);
            const farbe = new THREE.Color(stringfarbe ?? 0x1b2a4a);
            if (grad > 0.05) farbe.lerp(new THREE.Color(0x8e93a1), Math.min(0.85, grad * 1.1));
            const netz = new THREE.Mesh(
              // 4 cm über der Dachhaut, sonst flimmern beide gegeneinander.
              flaecheGeometrie(flach.map((q) => ({ x: q.x, y: q.y, z: hoeheAn(q) + 0.04 }))),
              new THREE.MeshLambertMaterial({ color: farbe, side: THREE.DoubleSide }),
            );
            netz.userData = { gruppe: mg.id, reihe: z.reihe, spalte: z.spalte };
            modulNetze.push(netz);
            gruppe.add(netz);

            /*
             * Ein dunkler Rand je Modul.
             *
             * Ohne ihn verschmelzen neun gleichfarbige Module eines
             * Strings zu einem Balken, und man sieht nicht mehr, dass
             * es Module sind. Die zwei Zentimeter Luft dazwischen sind
             * bei dieser Kameraentfernung weniger als ein Bildpunkt.
             */
            gruppe.add(
              new THREE.LineLoop(
                new THREE.BufferGeometry().setFromPoints(
                  flach.map((q) => new THREE.Vector3(q.x, hoeheAn(q) + 0.05, -q.y)),
                ),
                new THREE.LineBasicMaterial({ color: 0x0d1220 }),
              ),
            );
          }
        }
      }

      /*
       * Anbaustellen. Nur im Belegen-Modus: Wer nur schaut, will kein
       * Dach voller Pluszeichen sehen — genau wie in der Draufsicht,
       * wo sie an der gewählten Gruppe hängen.
       */
      if (s.modus === "belegen") anbaumarken(gruppe, s);
      setAnbauZahl(plusNetze.length);

      strangwege(gruppe, s);
    };

    /**
     * Die Pluszeichen an den Kanten der Felder.
     *
     * Gerechnet wird mit `anbaustellen` aus `lib/planer/module.ts` —
     * dieselbe Liste, die die Draufsicht zeichnet und die auch das
     * Setzen benutzt. Was hier zu sehen ist, ist damit genau das, was
     * ein Tipp auch tut.
     */
    const anbaumarken = (ziel3: THREE.Group, s: DreideeProps) => {
      if (!plusmuster) return;
      for (const f of s.plan.flaechen) {
        const eigene = s.plan.gruppen.filter((g) => g.flaeche === f.id);
        for (const g of eigene) {
          const besetzt = eigene
            .filter((x) => x.id !== g.id)
            .flatMap((x) => aktiveZellen(x).map((z) => modulEcken(x, f, z.reihe, z.spalte)));
          for (const stelle of anbaustellen(g, f, besetzt)) {
            const ecken = eckenUm(rasterMitte(g, f, stelle.reihe, stelle.spalte), g, f);
            if (ecken.length < 3) continue;
            const netz = new THREE.Mesh(
              flaecheGeometrie(
                ecken.map((q) => ({ x: q.x, y: q.y, z: hoeheAuf(f, q) + 0.06 })),
                undefined,
                // Eine Kachel je Modul: Das Kreuz sitzt in der Mitte.
                Math.max(...ecken.map((q) => Math.hypot(q.x - ecken[0]!.x, q.y - ecken[0]!.y))),
              ),
              new THREE.MeshBasicMaterial({
                map: plusmuster,
                transparent: true,
                side: THREE.DoubleSide,
                depthWrite: false,
              }),
            );
            netz.userData = { gruppe: g.id, reihe: stelle.reihe, spalte: stelle.spalte, plus: true };
            plusNetze.push(netz);
            ziel3.add(netz);
          }
        }
      }
    };

    /**
     * Die Kabelwege der Strings, 12 cm über der Dachhaut.
     *
     * Dieselbe Verlegung wie in der Draufsicht — gerechnet wird sie in
     * `lib/planer/strings.ts`, hier wird sie nur aufgestellt. Am Anfang
     * eine volle Kugel, am Ende ein Ring: Ohne die beiden ist bei einem
     * Bogen über vier Reihen nicht zu sehen, wo der String anfängt.
     */
    const strangwege = (ziel3: THREE.Group, s: DreideeProps) => {
      for (const st of s.plan.strings) {
        const weg = strangWeg(s.plan, st);
        if (weg.punkte.length === 0) continue;
        const f = s.plan.flaechen.find((x) => x.id === weg.flaeche);
        if (!f) continue;

        const punkte = weg.punkte.map(
          (q: Meter) => new THREE.Vector3(q.x, hoeheAuf(f, q) + 0.12, -q.y),
        );

        /*
         * Das Kabel hell, nicht in der Stringfarbe: Es liegt auf seinen
         * eigenen Modulen und wäre farbgleich unsichtbar. Dieselbe
         * Überlegung wie in der Draufsicht.
         */
        if (punkte.length > 1) {
          ziel3.add(
            new THREE.Line(
              new THREE.BufferGeometry().setFromPoints(punkte),
              new THREE.LineBasicMaterial({ color: 0xffffff }),
            ),
          );
        }

        const anfang = new THREE.Mesh(
          new THREE.SphereGeometry(0.22, 10, 8),
          new THREE.MeshBasicMaterial({ color: 0xffffff }),
        );
        anfang.position.copy(punkte[0]!);
        ziel3.add(anfang);

        if (punkte.length > 1) {
          const ende = new THREE.Mesh(
            new THREE.TorusGeometry(0.22, 0.07, 6, 12),
            new THREE.MeshBasicMaterial({ color: 0xffffff }),
          );
          ende.position.copy(punkte[punkte.length - 1]!);
          ende.rotation.x = -Math.PI / 2;
          ziel3.add(ende);
        }
      }
    };

    /*
     * Der Boden ist eine Ebene mit dem Luftbild darauf — dieselbe
     * Textur wie auf den Dächern, weil es dasselbe Bild ist.
     */
    const boden = (ziel3: THREE.Group, textur: THREE.CanvasTexture | null) => {
      /*
       * Unbeleuchtet: In einem Luftbild steckt die Beleuchtung schon
       * drin. Ein Material, das zusätzlich angestrahlt wird, überstrahlt
       * das Bild und lässt den Boden aussehen wie eine Milchglasscheibe.
       *
       * Und abgedunkelt: Boden und Dach tragen dasselbe Bild, und bei
       * gleicher Helligkeit ging das Dach im Grundstück unter — man sah
       * ein Haus nur an den Wänden. Der Boden ist Umgebung, das Dach ist
       * die Arbeitsfläche; das soll man sehen.
       */
      const material = new THREE.MeshBasicMaterial({ color: textur ? 0x9b9b9b : 0x3f4a35 });
      if (textur) material.map = textur;
      const flaeche = new THREE.Mesh(
        new THREE.PlaneGeometry(KARTENSEITE, KARTENSEITE),
        material,
      );
      flaeche.rotation.x = -Math.PI / 2;
      flaeche.position.y = -0.02;
      ziel3.add(flaeche);
    };

    neuAufbauen.current = aufbauen;
    aufbauen();
    kameraSetzen();

    let laeuft = true;
    const zeichnen = () => {
      if (!laeuft) return;
      renderer.render(szene, kamera);
      requestAnimationFrame(zeichnen);
    };
    zeichnen();

    const messen = new ResizeObserver(() => {
      const b = el.clientWidth;
      const h = el.clientHeight;
      if (b === 0 || h === 0) return;
      renderer.setSize(b, h, false);
      kamera.aspect = b / h;
      kamera.updateProjectionMatrix();
    });
    messen.observe(el);

    return () => {
      laeuft = false;
      messen.disconnect();
      renderer.domElement.removeEventListener("pointerdown", runter);
      renderer.domElement.removeEventListener("pointermove", bewegung);
      renderer.domElement.removeEventListener("pointerup", hoch);
      renderer.domElement.removeEventListener("pointercancel", hoch);
      renderer.domElement.removeEventListener("wheel", rad);
      renderer.dispose();
      neuAufbauen.current = null;
      el.removeChild(renderer.domElement);
    };
    // Absichtlich nur einmal: Der Plan kommt über `stand` herein, und
    // ein Neuaufbau der ganzen Szene bei jedem Tastendruck wäre nicht
    // zu gebrauchen. Die Nachführung macht der Effekt darunter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /*
   * Bei Planänderungen die Szene neu aufbauen. Nicht bei jedem Render:
   * `JSON.stringify` über den Plan ist hier billiger als ein falscher
   * Vergleich, weil die Szene sonst stehenbliebe.
   */
  const abbild = JSON.stringify({
    f: p.plan.flaechen,
    g: p.plan.gruppen.map((g) => ({ ...g, frei: undefined })),
    o: p.plan.objekte,
    /*
     * Die Strings gehören dazu: Sie färben die Module und zeichnen die
     * Kabelwege. Ohne sie blieb das Dach nach dem Verlegen unverändert
     * blau, und es sah aus, als hätte der Knopf nichts getan.
     */
    s: p.plan.strings,
    /*
     * Der Modus gehört ins Abbild: Die Pluszeichen erscheinen nur im
     * Belegen-Modus, und ohne ihn stünde das Dach nach dem Umschalten
     * unverändert da.
     */
    m: p.modus ?? "ansehen",
    w: p.wandhoehe,
    u: p.ueberstand,
    /*
     * Die Verschattung gehört in das Abbild: Sie kommt erst nach dem
     * ersten Aufbau aus der Ertragsrechnung herein. Ohne sie blieben die
     * Module in der räumlichen Ansicht für immer gleichmässig blau.
     */
    v: p.schatten ? [...p.schatten].map(([k, v]) => `${k}:${v.grad.toFixed(2)}`) : null,
  });
  useEffect(() => {
    neuAufbauen.current?.();
  }, [abbild]);

  /*
   * Zwei Ebenen: aussen der von React verwaltete Kasten, innen der
   * Kasten für three. Sonst hängen die Leinwand von three und ein
   * React-Kind im selben Elternknoten, und React stolpert beim
   * Entfernen über einen Knoten, den es nie eingefügt hat.
   */
  return (
    <div
      data-testid="planer-3d"
      data-geist={geistAttribut}
      data-luftbild={bildFehlt ? "fehlt" : "da"}
      data-anbaustellen={anbauZahl}
      className="relative h-full w-full"
    >
      <div ref={halter} className="absolute inset-0" />
      {bildFehlt ? (
        <p className="pointer-events-none absolute left-1/2 top-3 z-10 max-w-[26rem] -translate-x-1/2 rounded-[12px] bg-s-crit px-3 py-2 text-[12px] leading-[1.45] text-white">
          Das Luftbild ist für diese Ansicht nicht geladen — Dach und Boden bleiben einfarbig.
          Andere Bildquelle in der Leiste probieren; an der Planung ändert das nichts.
        </p>
      ) : null}
    </div>
  );
}
