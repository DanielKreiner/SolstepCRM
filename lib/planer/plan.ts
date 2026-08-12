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
  /*
   * Von Hand weggetippte Zellen. Alte Pläne haben das Feld nicht — die
   * Vorgabe greift beim Lesen, und ihre bisherigen Lücken stecken in
   * `aus`. Die kommen beim nächsten Verschieben zurück; das ist der
   * Preis dafür, dass sich beide Gründe rückwirkend nicht trennen
   * lassen.
   */
  entfernt: z.array(z.string()).default([]),
  frei: z.record(z.string(), meterSchema).default({}),
});

/*
 * Ein String ist eine geordnete Menge Module an einem MPP-Tracker
 * (Briefing 5.2). Die Module stehen als Schlüssel „gruppe/reihe:spalte"
 * darin — nicht als Kopie ihrer Werte: verschiebt jemand die Gruppe,
 * bleibt die Zuordnung gültig.
 */
const strangSchema = z.object({
  id: z.string(),
  name: z.string().default("String"),
  mppt: z.number().int().min(0).max(23).default(0),
  module: z.array(z.string()).default([]),
});

/** Gewählte Geräte. Verweise auf planer_modul / _wechselrichter / _speicher. */
const technikSchema = z.object({
  wechselrichter: z.string().uuid().nullable().default(null),
  speicher: z.string().uuid().nullable().default(null),
  modul: z.string().uuid().nullable().default(null),
});

/*
 * Die Eingaben der Wirtschaftlichkeit (Briefing 7).
 *
 * Sie gehören zum Plan, nicht in eine eigene Tabelle: Verbrauch und
 * Strompreis sind Aussagen ÜBER DIESES HAUS, die im Gespräch entstehen
 * und mit dem Angebot zusammen erhalten bleiben müssen. Wer eine Woche
 * später die Planung öffnet, muss dieselbe Zahl sehen, die der Kunde
 * genannt hat.
 *
 * `null` heisst überall: noch nicht angefasst, also gilt die
 * Vorbelegung des Betriebs. Ein einmal getippter Wert bleibt dagegen
 * stehen — auch wenn nebenan die Region wechselt (Abnahmetest 19).
 */
const wirtschaftSchema = z.object({
  verbrauchKwh: z.number().finite().nonnegative().nullable().default(null),
  /** Welche Verbrauchs-Chips aktiv sind, für die Anzeige. */
  chips: z.array(z.string()).default([]),
  strompreis: z.number().finite().nonnegative().nullable().default(null),
  verguetung: z.number().finite().nonnegative().nullable().default(null),
  anlagenpreis: z.number().finite().nonnegative().nullable().default(null),
  foerderung: z.number().finite().nonnegative().nullable().default(null),
  region: z.string().nullable().default(null),
  /** Ob die Rechnung mit Speicher gezeigt wird. */
  mitSpeicher: z.boolean().default(false),
});

/*
 * Gebäudeparameter für die räumliche Ansicht
 * (BRIEFING-planer-3d.md, Stufe 3D-2).
 *
 * Sie gehören zum Plan und nicht in den Bildschirmzustand: Die
 * Wandhöhe eines Hauses ändert sich nicht dadurch, dass jemand den
 * Browser schliesst, und beim nächsten Öffnen soll dasselbe Gebäude
 * dastehen.
 */
const gebaeudeSchema = z.object({
  typ: z.enum(["flach", "pult", "sattel", "walm"]).default("sattel"),
  /** Höhe der Aussenwand bis zur Traufe, in Metern. */
  wandhoehe: z.number().min(0).max(50).default(3),
  /** Wie weit das Dach über die Wand ragt, in Metern. */
  ueberstand: z.number().min(0).max(3).default(0.3),
});

export type GebaeudeStand = z.infer<typeof gebaeudeSchema>;

/*
 * Verschattungsobjekte: Bäume und Nachbargebäude
 * (BRIEFING-planer-3d.md, Stufe 3D-3).
 *
 * Sie gehören zum Plan, weil sie den Ertrag ändern — nicht zur
 * Darstellung. Ein Baum, der beim nächsten Öffnen verschwunden ist,
 * hebt den versprochenen Ertrag stillschweigend an.
 */
const objektSchema = z.object({
  id: z.string(),
  art: z.enum(["baum", "gebaeude"]),
  name: z.string().default(""),
  hoehe: z.number().min(0).max(120).default(10),
  /** Baum: Mittelpunkt der Krone. */
  mitte: meterSchema.optional(),
  /** Baum: Kronenradius. */
  radius: z.number().min(0.2).max(30).optional(),
  /** Gebäude: Grundriss in der Draufsicht. */
  punkte: z.array(meterSchema).min(3).optional(),
});

export const planSchema = z.object({
  version: z.number().default(PLAN_VERSION),
  flaechen: z.array(flaecheSchema).default([]),
  gruppen: z.array(gruppeSchema).default([]),
  strings: z.array(strangSchema).default([]),
  technik: technikSchema.default({ wechselrichter: null, speicher: null, modul: null }),
  gebaeude: gebaeudeSchema.default({ typ: "sattel", wandhoehe: 3, ueberstand: 0.3 }),
  objekte: z.array(objektSchema).default([]),
  wirtschaft: wirtschaftSchema.default({
    verbrauchKwh: null,
    chips: [],
    strompreis: null,
    verguetung: null,
    anlagenpreis: null,
    foerderung: null,
    region: null,
    mitSpeicher: false,
  }),
});

export type Wirtschaft = z.infer<typeof wirtschaftSchema>;

export interface Strang {
  id: string;
  name: string;
  /** Index des MPP-Trackers am gewählten Wechselrichter. */
  mppt: number;
  /** Modulschlüssel „gruppe/reihe:spalte". */
  module: string[];
}

export interface Technik {
  wechselrichter: string | null;
  speicher: string | null;
  modul: string | null;
}

export type Plan = {
  version: number;
  flaechen: Dachflaeche[];
  gruppen: Modulgruppe[];
  strings: Strang[];
  technik: Technik;
  gebaeude: GebaeudeStand;
  objekte: z.infer<typeof objektSchema>[];
  wirtschaft: Wirtschaft;
};

export function leererPlan(): Plan {
  return {
    version: PLAN_VERSION,
    flaechen: [],
    gruppen: [],
    strings: [],
    technik: { wechselrichter: null, speicher: null, modul: null },
    gebaeude: { typ: "sattel", wandhoehe: 3, ueberstand: 0.3 },
    objekte: [],
    wirtschaft: {
      verbrauchKwh: null,
      chips: [],
      strompreis: null,
      verguetung: null,
      anlagenpreis: null,
      foerderung: null,
      region: null,
      mitSpeicher: false,
    },
  };
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


/*
 * ── Module und Strings ─────────────────────────────────────────────
 */

/** Schlüssel eines Moduls — die Kennung, unter der Strings es führen. */
export function modulSchluessel(gruppe: string, reihe: number, spalte: number): string {
  return `${gruppe}/${reihe}:${spalte}`;
}

/**
 * Farben der Strings.
 *
 * Das Briefing erlaubt ausdrücklich neue Farben NUR hier (Abschnitt 13).
 * Sechs kräftige, gut unterscheidbare Töne; danach beginnt die Reihe von
 * vorn — mehr als sechs Strings gleichzeitig zu verfolgen, schafft
 * ohnehin niemand am Bildschirm.
 */
export const STRING_FARBEN = [
  "#7fd1c8",
  "#e8952b",
  "#8465c4",
  "#3e9e6b",
  "#d2543f",
  "#3e7bc6",
] as const;

export function strangFarbe(index: number): string {
  return STRING_FARBEN[((index % STRING_FARBEN.length) + STRING_FARBEN.length) % STRING_FARBEN.length]!;
}

/** Zu welchem String gehört ein Modul? Null, wenn zu keinem. */
export function strangVon(plan: Plan, schluessel: string): Strang | null {
  return plan.strings.find((s) => s.module.includes(schluessel)) ?? null;
}
