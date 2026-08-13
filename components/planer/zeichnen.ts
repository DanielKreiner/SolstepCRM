/*
 * Zeichenroutinen der Leinwand.
 *
 * Getrennt von der Komponente, weil hier nichts von React weiss: rein
 * Kamera + Plan → Striche auf einem 2D-Kontext. Das lässt sich lesen,
 * ohne den Ereignisteil danebenzulegen, und es hält die Komponente auf
 * einer überschaubaren Länge.
 */

import {
  falllinie,
  kanten,
  laenge,
  schwerpunkt,
  versatzNachInnen,
  wahreKantenlaenge,
  type Dachflaeche,
} from "@/lib/planer/flaeche";
import { type Kamera, meterZuBild, type Meter } from "@/lib/planer/geo";
import {
  achsen,
  aktiveZellen,
  leereZellen,
  modulEcken,
  type Modulgruppe,
  zelle as zellSchluessel,
} from "@/lib/planer/module";

/* Farben aus tokens.css. Der Canvas kann keine CSS-Variablen lesen,
   deshalb stehen sie hier einmal als Werte — die einzige Stelle. */
export const FARBEN = {
  akzent: "#e8952b",
  akzentDunkel: "#b4690e",
  flaeche: "rgba(232, 149, 43, 0.16)",
  flaecheAktiv: "rgba(232, 149, 43, 0.28)",
  linie: "#ffffff",
  hindernis: "rgba(21, 18, 16, 0.55)",
  warnung: "#d2543f",
  schrift: "#151210",
  /* Module: dunkles Blau-Grau wie echte Zellen, nicht bunt. Die Fläche
     darunter soll erkennbar bleiben. */
  modul: "rgba(28, 42, 60, 0.88)",
  modulRand: "rgba(255, 255, 255, 0.55)",
  modulAus: "rgba(120, 120, 120, 0.28)",
  gruppeRahmen: "#7fd1c8",
} as const;

export interface Sicht {
  kamera: Kamera;
  aktiv: string | null;
  /** Kante, über der der Zeiger gerade steht: "flaecheId:index". */
  betont: string | null;
  /**
   * Es wird gerade an einer Modulgruppe gearbeitet.
   *
   * Dann verschwinden die Kantenmasse: Sie gehören zum Dach, und wer
   * das Feld verschiebt, braucht sie nicht — zusammen mit Rahmen,
   * Griffen und Symbolen lagen fünf Pillen auf den Modulen, und man
   * las keine einzige.
   */
  gruppeAktiv?: boolean;
}

export function bild(k: Kamera, m: Meter) {
  return meterZuBild(k, m);
}

function pfad(ctx: CanvasRenderingContext2D, k: Kamera, punkte: Meter[], schliessen = true) {
  ctx.beginPath();
  punkte.forEach((p, i) => {
    const b = bild(k, p);
    if (i === 0) ctx.moveTo(b.x, b.y);
    else ctx.lineTo(b.x, b.y);
  });
  if (schliessen) ctx.closePath();
}

/** Beschriftete Pille, wie im Prototyp — an Kanten und beim Messen. */
export function pille(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  text: string,
  betont = false,
) {
  ctx.font = "600 11px 'JetBrains Mono', ui-monospace, monospace";
  const breite = ctx.measureText(text).width + 12;
  const hoehe = 18;
  const links = x - breite / 2;
  const oben = y - hoehe / 2;

  ctx.beginPath();
  ctx.roundRect(links, oben, breite, hoehe, 9);
  ctx.fillStyle = betont ? FARBEN.akzent : "rgba(255,255,255,0.92)";
  ctx.fill();
  if (betont) {
    ctx.strokeStyle = FARBEN.akzentDunkel;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  ctx.fillStyle = betont ? "#ffffff" : FARBEN.schrift;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x, y + 0.5);
  return { links, oben, breite, hoehe };
}

export function meterText(m: number): string {
  return `${m.toFixed(2).replace(".", ",")} m`;
}

/** Mitte einer Kante in Bildpunkten. */
export function kantenMitte(k: Kamera, a: Meter, b: Meter) {
  const p1 = bild(k, a);
  const p2 = bild(k, b);
  return { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
}

/**
 * Wo die Masszahl einer Kante sitzt: aussen vor der Kante.
 *
 * Eine Stelle für Zeichnen UND Trefferprüfung. Als ich die Pille nach
 * aussen versetzt und den Treffer auf der Kantenmitte gelassen hatte,
 * öffnete ein Klick auf die sichtbare Pille nichts mehr, während ein
 * Klick ins Leere daneben die Eingabe aufmachte.
 */
export function masszahlOrt(k: Kamera, punkte: Meter[], a: Meter, b: Meter) {
  const m = kantenMitte(k, a, b);
  const mitte = bild(k, schwerpunkt(punkte));
  const dx = m.x - mitte.x;
  const dy = m.y - mitte.y;
  const l = Math.hypot(dx, dy) || 1;
  const versatz = 15;
  return { x: m.x + (dx / l) * versatz, y: m.y + (dy / l) * versatz };
}

export function zeichneFlaeche(ctx: CanvasRenderingContext2D, s: Sicht, f: Dachflaeche) {
  const k = s.kamera;
  const istAktiv = s.aktiv === f.id;

  pfad(ctx, k, f.punkte);
  ctx.fillStyle = istAktiv ? FARBEN.flaecheAktiv : FARBEN.flaeche;
  ctx.fill();
  ctx.strokeStyle = istAktiv ? FARBEN.akzent : FARBEN.linie;
  ctx.lineWidth = istAktiv ? 2.5 : 1.8;
  ctx.stroke();

  // Randabstand: gestrichelt nach innen. Nur Anzeige — geprüft wird
  // über den Abstand zum Rand, nicht gegen dieses Polygon.
  if (f.randabstand > 0) {
    ctx.save();
    ctx.setLineDash([5, 4]);
    pfad(ctx, k, versatzNachInnen(f.punkte, f.randabstand));
    ctx.strokeStyle = "rgba(255,255,255,0.7)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }

  // Hindernisse mit Sperrsaum.
  for (const h of f.hindernisse) {
    ctx.save();
    ctx.setLineDash([4, 3]);
    pfad(ctx, k, versatzNachInnen(h.punkte, -h.abstand));
    ctx.strokeStyle = "rgba(255,255,255,0.75)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();

    pfad(ctx, k, h.punkte);
    ctx.fillStyle = FARBEN.hindernis;
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.lineWidth = 1.4;
    ctx.stroke();
  }

  zeichneFalllinie(ctx, s, f);

  /*
   * Kantenmasse — als WAHRE Länge auf dem Dach, nicht als Draufsicht.
   *
   * Gezeichnet wird auf dem Luftbild; was dort 8 m misst, sind auf
   * einem 30°-Dach 9,24 m. Die Draufsicht-Zahl an die Kante zu
   * schreiben hiesse, jemanden mit falschen Sparrenlängen aufs Dach zu
   * schicken. Traufparallele Kanten ändern sich dabei nicht — nur der
   * Anteil in Falllinienrichtung wird gestreckt.
   *
   * Bei zu kurzen Kanten weggelassen: sonst überdecken sich die Pillen
   * gegenseitig und man liest keine einzige.
   */
  /*
   * Masse nur an der gewählten Fläche und nur, solange keine
   * Modulgruppe bearbeitet wird. Bei drei Dachflächen wären es sonst
   * zwölf Pillen gleichzeitig.
   */
  const zeigeMasse = istAktiv && !s.gruppeAktiv;
  const gefaelle = falllinie(f);
  for (const kante of kanten(f.punkte)) {
    const p1 = bild(k, kante.a);
    const p2 = bild(k, kante.b);
    if (Math.hypot(p2.x - p1.x, p2.y - p1.y) < 46) continue;
    const istTraufe = f.traufe === kante.i;
    if (!zeigeMasse && !(s.betont === `${f.id}:${kante.i}`)) continue;

    /*
     * Die Pille sitzt AUSSERHALB der Fläche, nicht auf ihr. Auf der
     * Kantenmitte lag sie über den Modulen — bei einem vollen Dach war
     * die Belegung darunter nicht mehr zu erkennen.
     */
    const ort = masszahlOrt(k, f.punkte, kante.a, kante.b);
    pille(
      ctx,
      ort.x,
      ort.y,
      istTraufe ? `Traufe · ${text(kante)}` : text(kante),
      s.betont === `${f.id}:${kante.i}` || istTraufe,
    );
  }

  function text(kante: { a: Meter; b: Meter }): string {
    return meterText(wahreKantenlaenge(kante.a, kante.b, gefaelle, f.neigung));
  }

  if (istAktiv) {
    for (const p of f.punkte) {
      const b = bild(k, p);
      ctx.beginPath();
      ctx.arc(b.x, b.y, 5.5, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      ctx.strokeStyle = FARBEN.akzentDunkel;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }
}

function zeichneFalllinie(ctx: CanvasRenderingContext2D, s: Sicht, f: Dachflaeche) {
  const richtung = falllinie(f);
  if (!richtung) return;
  const k = s.kamera;
  const mitte = schwerpunkt(f.punkte);
  // Pfeillänge in Metern, damit er beim Zoomen mitwächst wie das Dach.
  const l = 2.2;
  const von = bild(k, mitte);
  const nach = bild(k, { x: mitte.x + richtung.x * l, y: mitte.y + richtung.y * l });

  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.85)";
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(von.x, von.y);
  ctx.lineTo(nach.x, nach.y);
  ctx.stroke();

  const winkel = Math.atan2(nach.y - von.y, nach.x - von.x);
  ctx.beginPath();
  ctx.moveTo(nach.x, nach.y);
  ctx.lineTo(nach.x - Math.cos(winkel - 0.4) * 9, nach.y - Math.sin(winkel - 0.4) * 9);
  ctx.lineTo(nach.x - Math.cos(winkel + 0.4) * 9, nach.y - Math.sin(winkel + 0.4) * 9);
  ctx.closePath();
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.fill();
  ctx.restore();
}

/** Umriss, der gerade entsteht — mit Vorschau bis zum Zeiger. */
export function zeichneEntwurf(
  ctx: CanvasRenderingContext2D,
  k: Kamera,
  punkte: Meter[],
  zeiger: Meter | null,
  ungueltig: boolean,
) {
  if (punkte.length === 0) return;
  const kette = zeiger ? [...punkte, zeiger] : punkte;

  ctx.save();
  pfad(ctx, k, kette, false);
  ctx.strokeStyle = ungueltig ? FARBEN.warnung : FARBEN.akzent;
  ctx.lineWidth = 2.2;
  ctx.stroke();

  if (kette.length > 2) {
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    const erst = bild(k, kette[0]!);
    const letzt = bild(k, kette[kette.length - 1]!);
    ctx.moveTo(letzt.x, letzt.y);
    ctx.lineTo(erst.x, erst.y);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  for (let i = 0; i < kette.length; i++) {
    const b = bild(k, kette[i]!);
    ctx.beginPath();
    ctx.arc(b.x, b.y, i === 0 ? 6 : 4.5, 0, Math.PI * 2);
    ctx.fillStyle = i === 0 ? FARBEN.akzent : "#ffffff";
    ctx.fill();
    ctx.strokeStyle = FARBEN.akzentDunkel;
    ctx.lineWidth = 1.8;
    ctx.stroke();
  }

  for (let i = 0; i < kette.length - 1; i++) {
    const a = kette[i]!;
    const b = kette[i + 1]!;
    const p1 = bild(k, a);
    const p2 = bild(k, b);
    if (Math.hypot(p2.x - p1.x, p2.y - p1.y) < 40) continue;
    pille(ctx, (p1.x + p2.x) / 2, (p1.y + p2.y) / 2, meterText(laenge(a, b)));
  }
  ctx.restore();
}

/** Freie Messstrecke. */
export function zeichneMessung(ctx: CanvasRenderingContext2D, k: Kamera, von: Meter, nach: Meter) {
  const p1 = bild(k, von);
  const p2 = bild(k, nach);
  ctx.save();
  ctx.setLineDash([6, 4]);
  ctx.strokeStyle = FARBEN.akzent;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(p1.x, p1.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.stroke();
  ctx.restore();
  pille(ctx, (p1.x + p2.x) / 2, (p1.y + p2.y) / 2, meterText(laenge(von, nach)), true);
}

/** Der Projektursprung — Nullpunkt des Metersystems. */
export function zeichneUrsprung(ctx: CanvasRenderingContext2D, k: Kamera) {
  const p = bild(k, { x: 0, y: 0 });
  ctx.save();
  ctx.strokeStyle = "rgba(232, 149, 43, 0.9)";
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(p.x - 8, p.y);
  ctx.lineTo(p.x + 8, p.y);
  ctx.moveTo(p.x, p.y - 8);
  ctx.lineTo(p.x, p.y + 8);
  ctx.stroke();
  ctx.restore();
}


/*
 * ── Module ─────────────────────────────────────────────────────────
 */

/**
 * Eine Modulgruppe zeichnen.
 *
 * Abgeschaltete Module verschwinden nicht, sie werden blass und
 * gestrichelt (Briefing 4.2) — wer ein Modul wegtippt, soll sehen, wo
 * es war, und es zurückholen können.
 */
export function zeichneGruppe(
  ctx: CanvasRenderingContext2D,
  k: Kamera,
  g: Modulgruppe,
  f: Dachflaeche,
  gewaehlt: boolean,
  /** Modulschlüssel → Stringfarbe. Fehlt einer, bleibt das Modul neutral. */
  stringFarben?: Map<string, string>,
  /**
   * Modulschlüssel → Verschattungsgrad (0 bis 1). Wird als Schleier über
   * das Modul gelegt, nicht als Ersatzfarbe: Die Stringzugehörigkeit
   * bleibt erkennbar, und beides zugleich ablesbar zu machen ist der
   * Zweck der Ansicht.
   */
  schatten?: Map<string, { grad: number }>,
) {
  // Beide Gründe zusammen: kein Platz UND weggetippt.
  const aus = leereZellen(g);
  /* Nur diese bleiben als blasse Kästchen stehen. */
  const weggetippt = new Set(g.entfernt ?? []);
  // Klein gezeichnete Module brauchen keinen Rand — sonst ist das Feld
  // nur noch Rand.
  const probe = modulEcken(g, f, 0, 0);
  const p1 = bild(k, probe[0]!);
  const p2 = bild(k, probe[1]!);
  const breitePx = Math.hypot(p2.x - p1.x, p2.y - p1.y);
  const feineLinie = breitePx > 9;

  for (let r = 0; r < g.reihen; r++) {
    for (let c = 0; c < g.spalten; c++) {
      const an = !aus.has(zellSchluessel(r, c));
      const ecken = modulEcken(g, f, r, c);
      ctx.beginPath();
      ecken.forEach((p, i) => {
        const b = bild(k, p);
        if (i === 0) ctx.moveTo(b.x, b.y);
        else ctx.lineTo(b.x, b.y);
      });
      ctx.closePath();

      if (an) {
        const farbe = stringFarben?.get(`${g.id}/${r}:${c}`);
        ctx.fillStyle = farbe ?? FARBEN.modul;
        ctx.fill();
        /*
         * Schleier über verschattete Module. Unter 5 % wird nichts
         * gezeichnet — eine Rechnung mit Stichzeitpunkten liefert für
         * fast jedes Modul einen Kleinstwert, und ein Dach voller
         * kaum sichtbarer Flecken wäre nur Unruhe.
         */
        const grad = schatten?.get(`${g.id}/${r}:${c}`)?.grad ?? 0;
        if (grad > 0.05) {
          ctx.fillStyle = `rgba(20,26,38,${Math.min(0.72, 0.2 + grad * 0.7)})`;
          ctx.fill();
        }
        if (feineLinie) {
          ctx.strokeStyle = FARBEN.modulRand;
          ctx.lineWidth = 0.7;
          ctx.stroke();
        }
      } else if (feineLinie && weggetippt.has(zellSchluessel(r, c))) {
        /*
         * Nur die von HAND weggetippten Zellen bleiben sichtbar: Sie
         * sind Löcher, die jemand gemacht hat, und er soll sie
         * wiederfinden.
         *
         * Zellen, in die geometrisch nichts passt (`aus`), verschwinden.
         * Sie lagen als blasses Raster rund um das Dach und über die
         * Nachbargrundstücke — Information, die niemand braucht und die
         * vom Dach ablenkt. An der Rechnung ändert das nichts: Das
         * Raster bleibt, es wird nur nicht mehr gezeichnet.
         */
        ctx.save();
        ctx.setLineDash([3, 3]);
        ctx.fillStyle = FARBEN.modulAus;
        ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.35)";
        ctx.lineWidth = 0.8;
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  if (gewaehlt) zeichneGruppenRahmen(ctx, k, g, f);
}

export interface Rahmen {
  links: number;
  oben: number;
  rechts: number;
  unten: number;
}

/**
 * Umschliessendes Rechteck der Gruppe in Bildpunkten.
 *
 * Eine Stelle für Zeichnen UND Trefferprüfung — liefen die auseinander,
 * säßen die Griffe woanders, als sie aussehen.
 */
export function gruppenRahmen(k: Kamera, g: Modulgruppe, f: Dachflaeche): Rahmen | null {
  const zellen = aktiveZellen(g);
  if (zellen.length === 0) return null;
  const punkte = zellen.flatMap((z) => modulEcken(g, f, z.reihe, z.spalte)).map((p) => bild(k, p));
  return {
    links: Math.min(...punkte.map((p) => p.x)) - 4,
    oben: Math.min(...punkte.map((p) => p.y)) - 4,
    rechts: Math.max(...punkte.map((p) => p.x)) + 4,
    unten: Math.max(...punkte.map((p) => p.y)) + 4,
  };
}

export type GriffArt = "drehen" | "verschieben" | "oben" | "unten" | "links" | "rechts";

/**
 * Die vier Ecken des Modulblocks in Bildpunkten — im Winkel der Gruppe.
 *
 * Nicht das umschliessende Rechteck: Bei einer gedrehten Gruppe stand
 * darum ein achsenparalleles Kästchen, das mit dem Feld nichts zu tun
 * hatte. Zwei Rechtecke übereinander, von denen nur eines gemeint ist —
 * genau die Unruhe, wegen der die Fläche unübersichtlich wirkte.
 *
 * Reihenfolge: links-oben, rechts-oben, rechts-unten, links-unten,
 * wobei „oben" bergauf heisst (Richtung First).
 */
export function blockEcken(
  k: Kamera,
  g: Modulgruppe,
  f: Dachflaeche,
): [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }, { x: number; y: number }] | null {
  const zellen = aktiveZellen(g);
  if (zellen.length === 0) return null;
  const a = achsen(g, f);

  /*
   * Alle Modulecken auf die beiden Gruppenachsen projizieren. Ein frei
   * gezogenes Modul liegt ausserhalb des Rasters — auch das gehört in
   * den Rahmen, sonst rahmt er nicht die Gruppe, sondern das Raster.
   */
  let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity;
  for (const z of zellen) {
    for (const p of modulEcken(g, f, z.reihe, z.spalte)) {
      const u = p.x * a.quer.x + p.y * a.quer.y;
      const v = p.x * a.laengs.x + p.y * a.laengs.y;
      if (u < uMin) uMin = u;
      if (u > uMax) uMax = u;
      if (v < vMin) vMin = v;
      if (v > vMax) vMax = v;
    }
  }
  // Etwas Luft, damit der Rahmen nicht auf den Modulkanten klebt.
  const luft = 0.12;
  uMin -= luft; uMax += luft; vMin -= luft; vMax += luft;

  const zuMeter = (u: number, v: number): Meter => ({
    x: a.quer.x * u + a.laengs.x * v,
    y: a.quer.y * u + a.laengs.y * v,
  });
  return [
    bild(k, zuMeter(uMin, vMax)),
    bild(k, zuMeter(uMax, vMax)),
    bild(k, zuMeter(uMax, vMin)),
    bild(k, zuMeter(uMin, vMin)),
  ];
}

/**
 * Wo die Griffe sitzen — ebenfalls für beides: zeichnen und treffen.
 *
 * Mit `ecken` sitzen sie an den Kantenmitten des gedrehten Blocks; ohne
 * (Rückfall, wenn kein Modul aktiv ist) am umschliessenden Rechteck.
 */
export function griffe(
  r: Rahmen,
  ecken?: ReturnType<typeof blockEcken>,
): Array<{ art: GriffArt; x: number; y: number }> {
  if (ecken) {
    const [lo, ro, ru, lu] = ecken;
    const mitte = (a: { x: number; y: number }, b: { x: number; y: number }) => ({
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2,
    });
    const oben = mitte(lo, ro);
    const unten = mitte(lu, ru);
    /*
     * Die Symbole sitzen über der Oberkante, in Richtung der
     * Rahmennormalen — bei gedrehtem Feld also mitgedreht. Ein fest
     * nach oben gesetztes Paar hinge sonst schief über der Kante.
     */
    const nx = oben.x - unten.x;
    const ny = oben.y - unten.y;
    const l = Math.hypot(nx, ny) || 1;
    const auf = { x: nx / l, y: ny / l };
    // Quer dazu, damit die beiden Scheiben nebeneinander stehen.
    const quer = { x: -auf.y, y: auf.x };
    return [
      { art: "verschieben", x: oben.x + auf.x * 26 - quer.x * 16, y: oben.y + auf.y * 26 - quer.y * 16 },
      { art: "drehen", x: oben.x + auf.x * 26 + quer.x * 16, y: oben.y + auf.y * 26 + quer.y * 16 },
      { art: "oben", x: oben.x, y: oben.y },
      { art: "unten", x: unten.x, y: unten.y },
      { art: "links", ...mitte(lo, lu) },
      { art: "rechts", ...mitte(ro, ru) },
    ];
  }

  const mx = (r.links + r.rechts) / 2;
  const my = (r.oben + r.unten) / 2;
  return [
    /*
     * Verschieben und Drehen sitzen als Symbolpaar über dem Rahmen.
     *
     * Verschieben geht auch durch Ziehen in der Fläche — nur sieht man
     * das nicht. Wer eine Gruppe zum ersten Mal bewegen will, tippt auf
     * ein Modul und schaltet es aus Versehen ab. Das Symbol macht die
     * Bewegung auffindbar, ohne die Fläche zu blockieren.
     */
    { art: "verschieben", x: mx - 16, y: r.oben - 26 },
    { art: "drehen", x: mx + 16, y: r.oben - 26 },
    { art: "oben", x: mx, y: r.oben },
    { art: "unten", x: mx, y: r.unten },
    { art: "links", x: r.links, y: my },
    { art: "rechts", x: r.rechts, y: my },
  ];
}

/** Weisse Scheibe als Untergrund für ein Symbol. */
function scheibe(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.beginPath();
  ctx.arc(x, y, 11, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.strokeStyle = FARBEN.gruppeRahmen;
  ctx.lineWidth = 2;
  ctx.stroke();
}

/** Pfeilspitze am Ende einer Strecke. */
function spitze(ctx: CanvasRenderingContext2D, x: number, y: number, dx: number, dy: number) {
  const l = 3.4;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x - dx * l - dy * l * 0.8, y - dy * l + dx * l * 0.8);
  ctx.moveTo(x, y);
  ctx.lineTo(x - dx * l + dy * l * 0.8, y - dy * l - dx * l * 0.8);
  ctx.stroke();
}

/**
 * Kreuz mit vier Pfeilspitzen — das übliche Zeichen für „verschieben".
 *
 * Gezeichnet, nicht als Schriftzeichen gesetzt: Ein Glyph aus einer
 * Schrift wäre je nach Gerät ein anderer, und auf dem iPad fehlen die
 * Pfeilzeichen teils ganz.
 */
function zeichenVerschieben(ctx: CanvasRenderingContext2D, x: number, y: number) {
  const a = 6;
  ctx.strokeStyle = FARBEN.akzentDunkel;
  ctx.lineWidth = 1.6;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x - a, y);
  ctx.lineTo(x + a, y);
  ctx.moveTo(x, y - a);
  ctx.lineTo(x, y + a);
  ctx.stroke();
  spitze(ctx, x + a, y, 1, 0);
  spitze(ctx, x - a, y, -1, 0);
  spitze(ctx, x, y + a, 0, 1);
  spitze(ctx, x, y - a, 0, -1);
}

/** Kreisbogen mit Pfeilspitze — das Zeichen für „drehen". */
function zeichenDrehen(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.strokeStyle = FARBEN.akzentDunkel;
  ctx.lineWidth = 1.6;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.arc(x, y, 5.5, -Math.PI * 0.85, Math.PI * 0.5);
  ctx.stroke();
  // Spitze am Bogenende, tangential nach unten.
  spitze(ctx, x, y + 5.5, -1, 0.35);
}

/** Rahmen samt Griffen — erscheint, sobald die Gruppe gewählt ist. */
function zeichneGruppenRahmen(
  ctx: CanvasRenderingContext2D,
  k: Kamera,
  g: Modulgruppe,
  f: Dachflaeche,
) {
  const r = gruppenRahmen(k, g, f);
  if (!r) return;

  const ecken = blockEcken(k, g, f);

  ctx.save();
  ctx.setLineDash([6, 4]);
  ctx.strokeStyle = FARBEN.gruppeRahmen;
  ctx.lineWidth = 1.6;
  if (ecken) {
    ctx.beginPath();
    ecken.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.closePath();
    ctx.stroke();
  } else {
    ctx.strokeRect(r.links, r.oben, r.rechts - r.links, r.unten - r.oben);
  }
  ctx.setLineDash([]);

  const stellen = griffe(r, ecken);

  // Verbindung von der Oberkante zum Symbolpaar.
  const obenGriff = stellen.find((x) => x.art === "oben");
  const drehGriff = stellen.find((x) => x.art === "drehen");
  const schiebGriff = stellen.find((x) => x.art === "verschieben");
  if (obenGriff && drehGriff && schiebGriff) {
    ctx.beginPath();
    ctx.moveTo(obenGriff.x, obenGriff.y);
    ctx.lineTo((drehGriff.x + schiebGriff.x) / 2, (drehGriff.y + schiebGriff.y) / 2);
    ctx.stroke();
  }

  for (const griff of stellen) {
    if (griff.art === "drehen" || griff.art === "verschieben") {
      scheibe(ctx, griff.x, griff.y);
      if (griff.art === "drehen") zeichenDrehen(ctx, griff.x, griff.y);
      else zeichenVerschieben(ctx, griff.x, griff.y);
      continue;
    }
    ctx.beginPath();
    ctx.rect(griff.x - 5, griff.y - 5, 10, 10);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.strokeStyle = FARBEN.gruppeRahmen;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  ctx.restore();
}

/** Auswahlrechteck beim Teilen. */
export function zeichneAuswahl(
  ctx: CanvasRenderingContext2D,
  k: Kamera,
  von: Meter,
  nach: Meter,
) {
  const a = bild(k, von);
  const b = bild(k, nach);
  ctx.save();
  ctx.setLineDash([5, 4]);
  ctx.fillStyle = "rgba(127, 209, 200, 0.16)";
  ctx.strokeStyle = FARBEN.gruppeRahmen;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.rect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/*
 * ── Anbaustellen ───────────────────────────────────────────────────
 */

/** Bildkoordinate der Mitte einer Rasterzelle, auch ausserhalb des Rasters. */
export function anbauMitte(
  k: Kamera,
  g: Modulgruppe,
  f: Dachflaeche,
  stelle: { reihe: number; spalte: number },
): { x: number; y: number } {
  const ecken = modulEcken(g, f, stelle.reihe, stelle.spalte).map((p) => bild(k, p));
  const x = ecken.reduce((s, p) => s + p.x, 0) / ecken.length;
  const y = ecken.reduce((s, p) => s + p.y, 0) / ecken.length;
  return { x, y };
}

/**
 * Die Plus-Marken zum modulweisen Anbauen.
 *
 * Sie sitzen dort, wo das nächste Modul liegen würde — nicht am
 * Gruppenrand. So sieht man vor dem Klick, wohin es kommt, und ob es
 * noch aufs Dach passt.
 *
 * Gezeichnet wird der Umriss des künftigen Moduls schwach mit, sonst
 * schwebt das Plus im Nichts.
 */
export function zeichneAnbaustellen(
  ctx: CanvasRenderingContext2D,
  k: Kamera,
  g: Modulgruppe,
  f: Dachflaeche,
  stellen: Array<{ reihe: number; spalte: number }>,
) {
  for (const stelle of stellen) {
    const ecken = modulEcken(g, f, stelle.reihe, stelle.spalte).map((p) => bild(k, p));
    if (ecken.length < 4) continue;

    ctx.beginPath();
    ctx.moveTo(ecken[0]!.x, ecken[0]!.y);
    for (const p of ecken.slice(1)) ctx.lineTo(p.x, p.y);
    ctx.closePath();
    ctx.fillStyle = "rgba(232, 149, 43, 0.14)";
    ctx.fill();
    ctx.strokeStyle = FARBEN.akzent;
    ctx.setLineDash([4, 3]);
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.setLineDash([]);

    const m = anbauMitte(k, g, f, stelle);
    // Nur zeichnen, wenn genug Platz für die Marke ist — bei weit
    // herausgezoomter Karte wäre sie grösser als das Modul.
    const breite = Math.hypot(ecken[1]!.x - ecken[0]!.x, ecken[1]!.y - ecken[0]!.y);
    if (breite < 22) continue;

    const r = Math.min(11, breite / 2.6);
    ctx.beginPath();
    ctx.arc(m.x, m.y, r, 0, Math.PI * 2);
    ctx.fillStyle = FARBEN.akzent;
    ctx.fill();

    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(m.x - r * 0.45, m.y);
    ctx.lineTo(m.x + r * 0.45, m.y);
    ctx.moveTo(m.x, m.y - r * 0.45);
    ctx.lineTo(m.x, m.y + r * 0.45);
    ctx.stroke();
    ctx.lineCap = "butt";
  }
}

/*
 * ── Verschattungsobjekte ───────────────────────────────────────────
 */

/**
 * Bäume und Nachbargebäude in der Draufsicht.
 *
 * Der Kreis ist die Krone, die Zahl daneben die Höhe. Beides muss
 * dastehen: Ein Kreis ohne Höhe sagt nichts darüber, ob das Ding
 * Schatten wirft — ein zwei Meter hoher Strauch und eine
 * zwanzigmeterhohe Fichte sähen gleich aus.
 */
export function zeichneObjekte(
  ctx: CanvasRenderingContext2D,
  k: Kamera,
  objekte: Array<{
    id: string;
    art: "baum" | "gebaeude";
    hoehe: number;
    mitte?: Meter | undefined;
    radius?: number | undefined;
    punkte?: Meter[] | undefined;
  }>,
) {
  for (const o of objekte) {
    if (o.art === "baum" && o.mitte && o.radius) {
      const m = bild(k, o.mitte);
      const rand = bild(k, { x: o.mitte.x + o.radius, y: o.mitte.y });
      const r = Math.max(4, Math.abs(rand.x - m.x));

      ctx.beginPath();
      ctx.arc(m.x, m.y, r, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(62, 158, 107, 0.28)";
      ctx.fill();
      ctx.strokeStyle = "#3e9e6b";
      ctx.lineWidth = 1.6;
      ctx.stroke();

      if (r > 12) pille(ctx, m.x, m.y, `${meterText(o.hoehe)} hoch`);
    } else if (o.art === "gebaeude" && o.punkte && o.punkte.length >= 3) {
      const ecken = o.punkte.map((q) => bild(k, q));
      ctx.beginPath();
      ctx.moveTo(ecken[0]!.x, ecken[0]!.y);
      for (const q of ecken.slice(1)) ctx.lineTo(q.x, q.y);
      ctx.closePath();
      ctx.fillStyle = "rgba(122, 114, 106, 0.35)";
      ctx.fill();
      ctx.strokeStyle = "#7a726a";
      ctx.lineWidth = 1.6;
      ctx.stroke();

      const s2 = schwerpunkt(o.punkte);
      const m = bild(k, s2);
      pille(ctx, m.x, m.y, `${meterText(o.hoehe)} hoch`);
    }
  }
}

/**
 * Das Modul am Zeiger, bevor es gesetzt wird.
 *
 * Ohne dieses Bild ist das Setzen ein Ratespiel: Ein Modul ist gut
 * anderthalb Meter lang, und wohin es sich dreht, hängt an der Traufe
 * der Fläche. Grün heisst „passt", rot heisst „hier nicht" — dann legt
 * der Klick auch nichts an.
 */
export function zeichneGeistermodul(
  ctx: CanvasRenderingContext2D,
  k: Kamera,
  ecken: Meter[],
  passt: boolean,
) {
  if (ecken.length < 3) return;
  ctx.save();
  ctx.beginPath();
  ecken.forEach((p, i) => {
    const b = bild(k, p);
    if (i === 0) ctx.moveTo(b.x, b.y);
    else ctx.lineTo(b.x, b.y);
  });
  ctx.closePath();
  ctx.fillStyle = passt ? "rgba(28, 42, 60, 0.45)" : "rgba(210, 84, 63, 0.28)";
  ctx.fill();
  ctx.setLineDash([5, 4]);
  ctx.strokeStyle = passt ? "rgba(255,255,255,0.9)" : FARBEN.warnung;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
}
