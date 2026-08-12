"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { aktiveZellen, modulEcken } from "@/lib/planer/module";
import { falllinie } from "@/lib/planer/flaeche";
import type { Punkt3D } from "@/lib/planer/gebaeude";
import {
  kachelnFuer,
  type Kamera,
  type Meter,
  meterProPixel,
  weltPixel,
} from "@/lib/planer/geo";
import { kachelUrl } from "@/lib/planer/anbieter";
import type { AnbieterId } from "@/lib/planer/anbieter";
import type { Plan } from "@/lib/planer/plan";

/*
 * Die räumliche Ansicht (BRIEFING-planer-3d.md, Stufe 3D-2).
 *
 * Sie zeigt dieselben Daten wie die Zeichenfläche, nur von der Seite:
 * Boden mit dem Luftbild, Gebäudekörper aus den Dachparametern, Module
 * darauf. Geplant wird weiterhin in der Draufsicht — hier wird nur
 * geschaut. Das ist Absicht: Eine Belegung mit der Maus in einer
 * gedrehten Perspektive zu setzen, trifft nie die Zelle, die man meint.
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
function flaecheGeometrie(punkte: Punkt3D[]): THREE.BufferGeometry {
  const ecken = punkte.map(zuWelt);
  const positionen: number[] = [];
  for (let i = 1; i + 1 < ecken.length; i++) {
    positionen.push(
      ecken[0]!.x, ecken[0]!.y, ecken[0]!.z,
      ecken[i]!.x, ecken[i]!.y, ecken[i]!.z,
      ecken[i + 1]!.x, ecken[i + 1]!.y, ecken[i + 1]!.z,
    );
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positionen, 3));
  g.computeVertexNormals();
  return g;
}

export function Dreidee(p: DreideeProps) {
  const halter = useRef<HTMLDivElement | null>(null);
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
    szene.add(new THREE.AmbientLight(0xffffff, 1.5));
    const sonne = new THREE.DirectionalLight(0xffffff, 2.2);
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
    };

    const bewegung = (e: PointerEvent) => {
      if (!zeiger.has(e.pointerId)) return;
      const vorher = zeiger.get(e.pointerId)!;
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
      zeiger.delete(e.pointerId);
      if (zeiger.size < 2) letzterAbstand = 0;
      if (zeiger.size === 0) zieht = null;
    };

    const rad = (e: WheelEvent) => {
      e.preventDefault();
      blick.abstand = Math.max(8, Math.min(300, blick.abstand * (1 + e.deltaY * 0.0012)));
      kameraSetzen();
    };

    renderer.domElement.addEventListener("pointerdown", runter);
    renderer.domElement.addEventListener("pointermove", bewegung);
    renderer.domElement.addEventListener("pointerup", hoch);
    renderer.domElement.addEventListener("pointercancel", hoch);
    renderer.domElement.addEventListener("wheel", rad, { passive: false });
    renderer.domElement.addEventListener("contextmenu", (e) => e.preventDefault());

    /* ── Szene aus dem Plan aufbauen ──────────────────────────── */
    const aufbauen = () => {
      const s = stand.current;
      gruppe.clear();

      boden(gruppe, s);

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
        const fall = falllinie(f);
        const steig = Math.tan((f.neigung * Math.PI) / 180);
        const a = f.traufe !== null ? f.punkte[f.traufe % f.punkte.length]! : f.punkte[0]!;

        /** Höhe eines Punktes: Wandhöhe plus Anstieg ab der Traufe. */
        const hoeheAn = (q: Meter) =>
          s.wandhoehe + (fall ? ((q.x - a.x) * fall.x + (q.y - a.y) * fall.y) * steig : 0);

        const dach: Punkt3D[] = f.punkte.map((q) => ({ x: q.x, y: q.y, z: hoeheAn(q) }));
        gruppe.add(
          new THREE.Mesh(
            flaecheGeometrie(dach),
            new THREE.MeshLambertMaterial({ color: 0x8b6b52, side: THREE.DoubleSide }),
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

        // Module auf dieser Fläche, auf derselben schiefen Ebene.
        for (const mg of s.plan.gruppen.filter((x) => x.flaeche === f.id)) {
          for (const z of aktiveZellen(mg)) {
            const flach = modulEcken(mg, f, z.reihe, z.spalte);
            if (flach.length < 3) continue;
            gruppe.add(
              new THREE.Mesh(
                // 4 cm über der Dachhaut, sonst flimmern beide gegeneinander.
                flaecheGeometrie(flach.map((q) => ({ x: q.x, y: q.y, z: hoeheAn(q) + 0.04 }))),
                new THREE.MeshLambertMaterial({ color: 0x1b2a4a, side: THREE.DoubleSide }),
              ),
            );
          }
        }
      }
    };

    /*
     * Der Boden ist eine Ebene mit dem Luftbild darauf. Die Kacheln
     * stammen aus derselben Quelle wie in der Draufsicht — nur werden
     * sie hier in eine einzige Textur gezeichnet, weil hundert
     * Einzelflächen die Bildrate kosten würden.
     */
    const boden = (ziel3: THREE.Group, s: DreideeProps) => {
      const seite = 200;
      const flaeche = new THREE.Mesh(
        new THREE.PlaneGeometry(seite, seite),
        new THREE.MeshLambertMaterial({ color: 0x3f4a35 }),
      );
      flaeche.rotation.x = -Math.PI / 2;
      flaeche.position.y = -0.02;
      ziel3.add(flaeche);

      const leinwand = document.createElement("canvas");
      leinwand.width = 1024;
      leinwand.height = 1024;
      const ctx = leinwand.getContext("2d");
      if (!ctx) return;

      const kacheln = kachelnFuer(s.kamera, 21);
      if (kacheln.length === 0) return;

      const textur = new THREE.CanvasTexture(leinwand);
      (flaeche.material as THREE.MeshLambertMaterial).map = textur;
      (flaeche.material as THREE.MeshLambertMaterial).color.set(0xffffff);

      /*
       * Kachel → Meter über Weltpixel: Eine Kachel (x, y) auf Stufe z
       * beginnt bei Weltpixel (x·256, y·256). Der Planursprung liegt
       * bei `weltPixel(ursprung, z)`. Die Differenz mal Meter je Pixel
       * ergibt die Lage in der Ebene.
       *
       * Der erste Anlauf hat aus `kamera.mitte` gerechnet und lag
       * daneben — der Boden blieb schwarz. Über die Weltpixel gibt es
       * keinen Zweifel, weil beide Seiten dieselbe Projektion benutzen.
       */
      for (const t of kacheln) {
        const mppStufe = meterProPixel(s.ursprung.lat, t.z);
        const nullpunkt = weltPixel(s.ursprung, t.z);
        const bild = new Image();
        bild.crossOrigin = "anonymous";
        bild.onload = () => {
          const xM = (t.x * 256 - nullpunkt.x) * mppStufe;
          // y wächst nach Süden, Meter nach Norden — daher das Minus.
          const yM = -(t.y * 256 - nullpunkt.y) * mppStufe;
          const groesse = 256 * mppStufe;

          const proMeter = leinwand.width / seite;
          ctx.drawImage(
            bild,
            (xM + seite / 2) * proMeter,
            (seite / 2 - yM) * proMeter,
            groesse * proMeter,
            groesse * proMeter,
          );
          textur.needsUpdate = true;
        };
        bild.src = kachelUrl(s.anbieter, t.z, t.x, t.y);
      }
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
    w: p.wandhoehe,
    u: p.ueberstand,
  });
  useEffect(() => {
    neuAufbauen.current?.();
  }, [abbild]);

  return <div ref={halter} data-testid="planer-3d" className="h-full w-full" />;
}
