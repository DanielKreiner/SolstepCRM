/*
 * Das Plandokument.
 *
 * Ein Planer-Projekt speichert seinen ganzen Stand als ein Dokument
 * (Briefing 9). Hier stehen dessen Form, die Prüfung beim Laden und die
 * Werkzeuge, die ganze Flächensätze erzeugen.
 *
 * Warum geprüft wird, was aus der eigenen Datenbank kommt: das Dokument
 * ist jsonb. Ein älterer Stand, ein abgebrochenes Speichern oder eine
 * Änderung von Hand liefern sonst `undefined` mitten in der Geometrie,
 * und der Fehler taucht erst drei Klicks später beim Rechnen auf.
 */

import { z } from "zod";
import { azimutAusTraufe, type Dachflaeche } from "./flaeche";
import type { Modulgruppe } from "./module";
import type { Meter } from "./geo";

export const PLAN_VERSION = 1;

const meterSchema = z.object({ x: z.number().finite(), y: z.number().finite() });

const hindernisSchema = z.object({
  id: z.string(),
  art: z.enum(["rechteck", "polygon"]),
  name: z.string().default(""),
  punkte: z.array(meterSchema).min(3),
  abstand: z.number().min(0).max(5).default(0.3),
});

const flaecheSchema = z.object({
  id: z.string(),
  name: z.string().default("Fläche"),
  punkte: z.array(meterSchema).min(3),
  neigung: z.number().min(0).max(75).default(30),
  azimut: z.number().min(0).max(359.9).default(180),
  traufe: z.number().int().nullable().default(null),
  randabstand: z.number().min(0).max(5).default(0.3),
  hindernisse: z.array(hindernisSchema).default([]),
});

const modultypSchema = z.object({
  breite: z.number().positive().max(5),
  hoehe: z.number().positive().max(5),
  wp: z.number().positive().max(2000),
  bezeichnung: z.string().default(""),
});

const gruppeSchema = z.object({
  id: z.string(),
  name: z.string().default("Feld"),
  flaeche: z.string(),
  typ: modultypSchema,
  ausrichtung: z.enum(["hoch", "quer"]).default("hoch"),
  reihenabstand: z.number().min(0).max(10).default(0.02),
  spaltenabstand: z.number().min(0).max(10).default(0.02),
  winkel: z.number().min(-180).max(180).default(0),
  anker: meterSchema,
  spalten: z.number().int().min(0).max(400).default(0),
  reihen: z.number().int().min(0).max(400).default(0),
  aufstaenderung: z
    .object({ art: z.enum(["sued", "ost-west"]), winkel: z.number().min(0).max(60) })
    .nullable()
    .default(null),
  aus: z.array(z.string()).default([]),
  frei: z.record(z.string(), meterSchema).default({}),
});

export const planSchema = z.object({
  version: z.number().default(PLAN_VERSION),
  flaechen: z.array(flaecheSchema).default([]),
  gruppen: z.array(gruppeSchema).default([]),
  /* Ab Stufe 4. Hier schon vorgesehen, damit das Dokument nicht später
     seine Form wechselt und alte Stände ungültig werden. */
  strings: z.array(z.unknown()).default([]),
});

export type Plan = {
  version: number;
  flaechen: Dachflaeche[];
  gruppen: Modulgruppe[];
  strings: unknown[];
};

export function leererPlan(): Plan {
  return { version: PLAN_VERSION, flaechen: [], gruppen: [], strings: [] };
}

/** Aus der Datenbank gelesenes Dokument prüfen; bei Unsinn leer starten. */
export function planLesen(roh: unknown): Plan {
  const geprueft = planSchema.safeParse(roh);
  if (!geprueft.success) return leererPlan();
  return geprueft.data as Plan;
}

/*
 * ── Namen und Kennungen ────────────────────────────────────────────
 */

/**
 * Kennung ohne Zufall und ohne Uhrzeit.
 *
 * Beides würde bei React-Server-Komponenten zwischen Server und Client
 * auseinanderlaufen. Gezählt wird stattdessen, was schon da ist.
 */
export function naechsteId(vorhandene: string[], praefix: string): string {
  let n = 1;
  while (vorhandene.includes(`${praefix}${n}`)) n++;
  return `${praefix}${n}`;
}

export function naechsterFlaechenName(flaechen: Dachflaeche[]): string {
  let n = flaechen.length + 1;
  const namen = new Set(flaechen.map((f) => f.name));
  while (namen.has(`Fläche ${n}`)) n++;
  return `Fläche ${n}`;
}

/*
 * ── Dachform-Assistent ─────────────────────────────────────────────
 *
 * Beschleunigt die Standardfälle (Briefing 3.2). Erzeugt NORMALE
 * Flächen, keinen Sondermodus: was der Assistent hinlegt, lässt sich
 * danach genauso ziehen, teilen und bearbeiten wie handgezeichnetes.
 */

export type Dachform = "pult" | "sattel" | "walm" | "zelt" | "flach";

export const DACHFORMEN: Array<{ id: Dachform; label: string; hinweis: string }> = [
  { id: "sattel", label: "Satteldach", hinweis: "Zwei Flächen, First in der Mitte" },
  { id: "pult", label: "Pultdach", hinweis: "Eine Fläche, eine Richtung" },
  { id: "walm", label: "Walmdach", hinweis: "Zwei Trapeze, zwei Dreiecke" },
  { id: "zelt", label: "Zeltdach", hinweis: "Vier Dreiecke auf einen Punkt" },
  { id: "flach", label: "Flachdach", hinweis: "Eine Fläche ohne Neigung" },
];

export interface AssistentEingabe {
  form: Dachform;
  /** Länge in Firstrichtung. */
  breite: number;
  /** Tiefe quer dazu. */
  tiefe: number;
  /** Mittelpunkt im lokalen Metersystem. */
  mitte: Meter;
  /** Drehung des Firsts gegen Osten, in Grad. */
  drehung: number;
  neigung: number;
}

function dreh(p: Meter, grad: number, mitte: Meter): Meter {
  const r = (grad * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { x: mitte.x + p.x * c - p.y * s, y: mitte.y + p.x * s + p.y * c };
}

/**
 * Legt die Flächen einer Standard-Dachform an.
 *
 * Jede Fläche bekommt ihre Traufkante ausdrücklich mitgegeben — daraus
 * folgt die Falllinie und daraus der Azimut. Die Reihenfolge der Punkte
 * ist deshalb nicht beliebig: Kante 0 ist immer die Traufe.
 */
export function dachformFlaechen(e: AssistentEingabe, vorhandene: Dachflaeche[]): Dachflaeche[] {
  const B = Math.max(0.5, e.breite);
  const T = Math.max(0.5, e.tiefe);
  const hb = B / 2;
  const ht = T / 2;

  /** Punkte im ungedrehten System, First entlang x. */
  const bau = (punkte: Meter[]): Meter[] => punkte.map((p) => dreh(p, e.drehung, e.mitte));

  const roh: Array<{ punkte: Meter[]; traufe: number | null; neigung: number }> = [];

  if (e.form === "flach") {
    roh.push({
      punkte: [
        { x: -hb, y: -ht },
        { x: hb, y: -ht },
        { x: hb, y: ht },
        { x: -hb, y: ht },
      ],
      traufe: null,
      neigung: 0,
    });
  } else if (e.form === "pult") {
    roh.push({
      punkte: [
        { x: -hb, y: -ht },
        { x: hb, y: -ht },
        { x: hb, y: ht },
        { x: -hb, y: ht },
      ],
      traufe: 0,
      neigung: e.neigung,
    });
  } else if (e.form === "sattel") {
    // Zwei Rechtecke, First auf y = 0. Kante 0 ist jeweils die Traufe.
    roh.push({
      punkte: [
        { x: -hb, y: -ht },
        { x: hb, y: -ht },
        { x: hb, y: 0 },
        { x: -hb, y: 0 },
      ],
      traufe: 0,
      neigung: e.neigung,
    });
    roh.push({
      punkte: [
        { x: hb, y: ht },
        { x: -hb, y: ht },
        { x: -hb, y: 0 },
        { x: hb, y: 0 },
      ],
      traufe: 0,
      neigung: e.neigung,
    });
  } else if (e.form === "walm") {
    /*
     * First auf halber Tiefe eingerückt: die Walmflächen steigen dann
     * unter demselben Winkel an wie die Hauptflächen. Bei sehr kurzem
     * Baukörper (B < T) bliebe kein First übrig — dann wird das Dach zum
     * Zeltdach, und genau das legen wir hin.
     */
    if (B <= T) return dachformFlaechen({ ...e, form: "zelt" }, vorhandene);
    const fx = hb - ht;
    roh.push({
      punkte: [
        { x: -hb, y: -ht },
        { x: hb, y: -ht },
        { x: fx, y: 0 },
        { x: -fx, y: 0 },
      ],
      traufe: 0,
      neigung: e.neigung,
    });
    roh.push({
      punkte: [
        { x: hb, y: ht },
        { x: -hb, y: ht },
        { x: -fx, y: 0 },
        { x: fx, y: 0 },
      ],
      traufe: 0,
      neigung: e.neigung,
    });
    // Die beiden Walme: Kante 0 ist die kurze Aussenkante.
    roh.push({
      punkte: [
        { x: hb, y: -ht },
        { x: hb, y: ht },
        { x: fx, y: 0 },
      ],
      traufe: 0,
      neigung: e.neigung,
    });
    roh.push({
      punkte: [
        { x: -hb, y: ht },
        { x: -hb, y: -ht },
        { x: -fx, y: 0 },
      ],
      traufe: 0,
      neigung: e.neigung,
    });
  } else {
    // Zeltdach: vier Dreiecke auf die Mitte.
    const ecken: Meter[] = [
      { x: -hb, y: -ht },
      { x: hb, y: -ht },
      { x: hb, y: ht },
      { x: -hb, y: ht },
    ];
    for (let i = 0; i < 4; i++) {
      roh.push({
        punkte: [ecken[i]!, ecken[(i + 1) % 4]!, { x: 0, y: 0 }],
        traufe: 0,
        neigung: e.neigung,
      });
    }
  }

  const namen = vorhandene.slice();
  const ids = vorhandene.map((f) => f.id);

  return roh.map((r) => {
    const id = naechsteId(ids, "f");
    ids.push(id);
    const flaeche: Dachflaeche = {
      id,
      name: naechsterFlaechenName(namen),
      punkte: bau(r.punkte),
      neigung: r.neigung,
      azimut: 180,
      traufe: r.traufe,
      randabstand: r.neigung === 0 ? 1 : 0.3,
      hindernisse: [],
    };
    // Azimut folgt aus der Traufe — beim Flachdach bleibt er als
    // Vorgabe stehen und wird im Panel gesetzt.
    flaeche.azimut = azimutAusTraufe(flaeche) ?? 180;
    namen.push(flaeche);
    return flaeche;
  });
}

/*
 * ── Kennzahlen ─────────────────────────────────────────────────────
 */

export function planKennzahlen(plan: Plan): { flaechen: number; hindernisse: number } {
  return {
    flaechen: plan.flaechen.length,
    hindernisse: plan.flaechen.reduce((s, f) => s + f.hindernisse.length, 0),
  };
}
