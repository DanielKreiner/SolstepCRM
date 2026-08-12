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
  /**
   * Verschattungsgrad je Modul (Schlüssel `gruppe/reihe:spalte`). Bestimmt
   * nur die Farbe: Ein echter Schattenwurf mit Lichtquelle wäre schöner,
   * würde aber eine andere Zahl zeigen als die Ertragsrechnung — und
   * zwei Wahrheiten über denselben Schatten sind eine zu viel.
   */
  schatten?: Map<string, { grad: number }>;
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
            /*
             * Verschattete Module heller und grauer — auf dunklem
             * Modulblau ist Abdunkeln nicht zu sehen. Dieselbe Schwelle
             * wie in der Draufsicht, damit beide Ansichten dieselben
             * Module hervorheben.
             */
            const grad = s.schatten?.get(`${mg.id}/${z.reihe}:${z.spalte}`)?.grad ?? 0;
            const farbe = new THREE.Color(0x1b2a4a);
            if (grad > 0.05) farbe.lerp(new THREE.Color(0x8e93a1), Math.min(0.85, grad * 1.1));
            gruppe.add(
              new THREE.Mesh(
                // 4 cm über der Dachhaut, sonst flimmern beide gegeneinander.
                flaecheGeometrie(flach.map((q) => ({ x: q.x, y: q.y, z: hoeheAn(q) + 0.04 }))),
                new THREE.MeshLambertMaterial({ color: farbe, side: THREE.DoubleSide }),
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
      const seite = 160;
      /*
       * Unbeleuchtet: In einem Luftbild steckt die Beleuchtung schon
       * drin. Ein Material, das zusätzlich angestrahlt wird, überstrahlt
       * das Bild und lässt den Boden aussehen wie eine Milchglasscheibe.
       */
      const material = new THREE.MeshBasicMaterial({ color: 0x3f4a35 });
      const flaeche = new THREE.Mesh(new THREE.PlaneGeometry(seite, seite), material);
      flaeche.rotation.x = -Math.PI / 2;
      flaeche.position.y = -0.02;
      ziel3.add(flaeche);

      const leinwand = document.createElement("canvas");
      leinwand.width = 2048;
      leinwand.height = 2048;
      const ctx = leinwand.getContext("2d");
      if (!ctx) return;

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
      const mppZiel = seite / leinwand.width;
      const stufe = Math.max(
        1,
        Math.min(
          21,
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
          breite: seite / meterProPixel(s.ursprung.lat, stufe),
          hoehe: seite / meterProPixel(s.ursprung.lat, stufe),
        },
        21,
      );
      if (kacheln.length === 0) return;

      const textur = new THREE.CanvasTexture(leinwand);
      textur.colorSpace = THREE.SRGBColorSpace;
      material.map = textur;
      material.color.set(0xffffff);
      /*
       * Ohne dieses Flag bleibt der Boden schwarz: Ein Material, das
       * ohne Textur übersetzt wurde, bekommt seinen Shader nicht von
       * selbst neu — die zugewiesene `map` wird stillschweigend
       * ignoriert. Genau daran ist der erste Anlauf gescheitert, und am
       * Bild sah es aus wie ein Rechenfehler bei den Kacheln.
       */
      material.needsUpdate = true;

      const proMeter = leinwand.width / seite;
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
            (xM + seite / 2) * proMeter,
            (seite / 2 - yM) * proMeter,
            gross,
            gross,
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
    o: p.plan.objekte,
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

  return <div ref={halter} data-testid="planer-3d" className="h-full w-full" />;
}
