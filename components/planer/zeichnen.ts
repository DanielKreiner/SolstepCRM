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
  type Dachflaeche,
} from "@/lib/planer/flaeche";
import { type Kamera, meterZuBild, type Meter } from "@/lib/planer/geo";
import {
  aktiveZellen,
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

/** Wo die Pille einer Kante sitzt — auch für die Trefferprüfung gebraucht. */
export function kantenMitte(k: Kamera, a: Meter, b: Meter) {
  const p1 = bild(k, a);
  const p2 = bild(k, b);
  return { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
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

  // Kantenmasse. Bei zu kurzen Kanten weggelassen — sonst überdecken
  // sich die Pillen gegenseitig und man liest keine einzige.
  for (const kante of kanten(f.punkte)) {
    const p1 = bild(k, kante.a);
    const p2 = bild(k, kante.b);
    if (Math.hypot(p2.x - p1.x, p2.y - p1.y) < 46) continue;
    const m = kantenMitte(k, kante.a, kante.b);
    const istTraufe = f.traufe === kante.i;
    pille(
      ctx,
      m.x,
      m.y,
      istTraufe ? `Traufe · ${meterText(laenge(kante.a, kante.b))}` : meterText(laenge(kante.a, kante.b)),
      s.betont === `${f.id}:${kante.i}` || istTraufe,
    );
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
) {
  const aus = new Set(g.aus);
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
        ctx.fillStyle = FARBEN.modul;
        ctx.fill();
        if (feineLinie) {
          ctx.strokeStyle = FARBEN.modulRand;
          ctx.lineWidth = 0.7;
          ctx.stroke();
        }
      } else if (feineLinie) {
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

export type GriffArt = "drehen" | "oben" | "unten" | "links" | "rechts";

/** Wo die Griffe sitzen — ebenfalls für beides: zeichnen und treffen. */
export function griffe(r: Rahmen): Array<{ art: GriffArt; x: number; y: number }> {
  const mx = (r.links + r.rechts) / 2;
  const my = (r.oben + r.unten) / 2;
  return [
    // Der Drehgriff sitzt über dem Rahmen, damit er nicht mit dem
    // Kantengriff zusammenfällt.
    { art: "drehen", x: mx, y: r.oben - 24 },
    { art: "oben", x: mx, y: r.oben },
    { art: "unten", x: mx, y: r.unten },
    { art: "links", x: r.links, y: my },
    { art: "rechts", x: r.rechts, y: my },
  ];
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

  ctx.save();
  ctx.setLineDash([6, 4]);
  ctx.strokeStyle = FARBEN.gruppeRahmen;
  ctx.lineWidth = 1.6;
  ctx.strokeRect(r.links, r.oben, r.rechts - r.links, r.unten - r.oben);
  ctx.setLineDash([]);

  // Verbindung zum Drehgriff.
  const mx = (r.links + r.rechts) / 2;
  ctx.beginPath();
  ctx.moveTo(mx, r.oben);
  ctx.lineTo(mx, r.oben - 24);
  ctx.stroke();

  for (const griff of griffe(r)) {
    ctx.beginPath();
    if (griff.art === "drehen") {
      ctx.arc(griff.x, griff.y, 6, 0, Math.PI * 2);
    } else {
      ctx.rect(griff.x - 5, griff.y - 5, 10, 10);
    }
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
