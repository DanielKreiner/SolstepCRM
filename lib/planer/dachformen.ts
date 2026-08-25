import type { Meter } from "./geo";
import {
  azimutAusTraufe,
  type Dachflaeche,
  flaecheMitVorzeichen,
  kanten,
  schwerpunkt,
} from "./flaeche";

/*
 * Aus einem gezeichneten Umriss ein Dach machen.
 *
 * Der Weg, den ein Betrieb erwartet (und den Reonic vormacht): einmal
 * das Haus umfahren, dann sagen, was für ein Dach draufsitzt. Nicht:
 * fünf Dachformen als Vorlage anbieten und den Betrieb hinterher jede
 * Ecke einzeln nachziehen lassen.
 *
 * Gerechnet wird auf dem Umriss selbst, nicht auf einem umschliessenden
 * Rechteck. Das ist der ganze Unterschied: Ein Haus steht selten
 * achsparallel, und die Ecken, die jemand von Hand gesetzt hat, sind
 * die Ecken, die er meint. Ein Rechteck darüber wäre wieder eine
 * Vorlage.
 *
 * Reines Rechenmodul: Punkte hinein, Flächen heraus.
 */

export type Dachform = "flach" | "pult" | "sattel" | "walm" | "kruppelwalm" | "zelt";

export const DACHTYPEN: Array<{ id: Dachform; label: string; hinweis: string }> = [
  { id: "sattel", label: "Satteldach", hinweis: "Zwei Flächen, First in der Mitte" },
  { id: "walm", label: "Walmdach", hinweis: "Zwei Trapeze, zwei Dreiecke" },
  { id: "kruppelwalm", label: "Krüppelwalmdach", hinweis: "Satteldach mit abgeschrägten Giebeln" },
  { id: "pult", label: "Pultdach", hinweis: "Eine Fläche, eine Richtung" },
  { id: "zelt", label: "Zeltdach", hinweis: "Vier Dreiecke auf einen Punkt" },
  { id: "flach", label: "Flachdach", hinweis: "Eine Fläche ohne Neigung" },
];

/** Eine erzeugte Teilfläche: Punkte, Traufkante, Neigung. */
export interface Teilflaeche {
  punkte: Meter[];
  /** Index der Traufkante — daraus folgen Falllinie und Azimut. */
  traufe: number | null;
  neigung: number;
}

export interface Dachvorgaben {
  neigung: number;
  /**
   * Welches Kantenpaar der First begleitet.
   *
   * 0 heisst: parallel zu Kante 0 und 2, also quer zu 1 und 3.
   * 1 dreht das um — in Reonic heisst der Knopf „Schräge Seiten
   * tauschen", und genau das tut er.
   */
  richtung: 0 | 1;
  /**
   * Wie weit die Walmflächen hereinreichen, als Anteil der halben
   * Gebäudetiefe. 1 = voller Walm, 0,5 = Krüppelwalm.
   */
  walmAnteil?: number;
  /**
   * Wie weit der First aus der Mitte wandert, als Anteil der halben
   * Tiefe (−0,8 bis 0,8). Damit wird aus einem symmetrischen Dach eines
   * mit ungleichen Seiten, ohne dass jemand Ecken zieht.
   */
  firstVersatz?: number;
}

/**
 * Die Tiefe des Baukörpers quer zum First.
 *
 * Das sind die Giebelseiten (Kante 1 und 3), nicht die Traufen. Der
 * erste Anlauf hat hier die Traufenlänge genommen — bei einem 12 × 8
 * Meter grossen Haus rückte der First deshalb um 6 statt 4 Meter ein,
 * lief in die Begrenzung von 0,45 und liess sich nicht mehr sauber
 * zurückrechnen: Ein volles Walmdach kam als 90 % wieder heraus.
 */
function tiefeVon(q: Meter[]): number {
  const [a, b, c, d] = q as [Meter, Meter, Meter, Meter];
  return (Math.hypot(c.x - b.x, c.y - b.y) + Math.hypot(a.x - d.x, a.y - d.y)) / 2;
}

/** Mitte einer Strecke. */
function mitteVon(a: Meter, b: Meter, t = 0.5): Meter {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/**
 * Den Umriss so drehen, dass Kante 0 die gewünschte ist.
 *
 * Damit braucht der Rest der Rechnung nur einen Fall zu kennen: First
 * parallel zu Kante 0.
 */
function gedreht(punkte: Meter[], um: number): Meter[] {
  return punkte.map((_, i) => punkte[(i + um) % punkte.length]!);
}

/**
 * Die Firstlinie über diesem Umriss.
 *
 * Eine Stelle für drei Zwecke: Zeichnen, Greifen und das Erzeugen der
 * Teilflächen. Liefen die auseinander, säße der Griff woanders, als
 * der First zu sehen ist — und ein Zug daran verschöbe etwas anderes,
 * als man anfasst.
 *
 * `null`, wo es keinen First gibt (Flach-, Pult- und Zeltdach).
 */
export function firstLinie(
  umriss: Meter[],
  form: Dachform,
  vorgaben: Dachvorgaben,
): { a: Meter; b: Meter } | null {
  if (umriss.length !== 4) return null;
  if (form !== "sattel" && form !== "walm" && form !== "kruppelwalm") return null;

  const p = flaecheMitVorzeichen(umriss) < 0 ? [...umriss].reverse() : [...umriss];
  const q = gedreht(p, vorgaben.richtung);
  const [a, b, c, d] = q as [Meter, Meter, Meter, Meter];

  const versatz = Math.max(-0.8, Math.min(0.8, vorgaben.firstVersatz ?? 0));
  const t = 0.5 + versatz / 2;
  const f1 = mitteVon(b, c, t);
  const f2 = mitteVon(a, d, t);
  if (form === "sattel") return { a: f2, b: f1 };

  const anteil = Math.max(0.05, Math.min(1, vorgaben.walmAnteil ?? 1));
  const firstLaenge = Math.hypot(f1.x - f2.x, f1.y - f2.y);
  const rueck = Math.min(0.45, ((tiefeVon(q) / 2) * anteil) / Math.max(0.001, firstLaenge));
  return { a: mitteVon(f2, f1, rueck), b: mitteVon(f2, f1, 1 - rueck) };
}

/**
 * Wie weit der First von der Mitte weg müsste, damit er durch diesen
 * Punkt läuft — als Anteil, wie ihn `firstVersatz` erwartet.
 *
 * Gerechnet wird die Verschiebung QUER zum First: Ein Zug in
 * Firstrichtung soll nichts tun, sonst rutscht das Dach beim kleinsten
 * seitlichen Wackeln.
 */
export function firstVersatzFuer(umriss: Meter[], richtung: 0 | 1, ziel: Meter): number {
  if (umriss.length !== 4) return 0;
  const p = flaecheMitVorzeichen(umriss) < 0 ? [...umriss].reverse() : [...umriss];
  const q = gedreht(p, richtung);
  const [a, b, c, d] = q as [Meter, Meter, Meter, Meter];

  /*
   * Die beiden Kanten, auf denen die Firstenden gleiten (b→c und a→d).
   * Der Anteil ergibt sich aus der Projektion des Zeigers auf eine
   * davon — beide sind gleich lang parametrisiert.
   */
  const mitteAlt = mitteVon(mitteVon(b, c, 0.5), mitteVon(a, d, 0.5), 0.5);
  const richtungQuer = { x: mitteVon(b, c, 1).x - mitteVon(b, c, 0).x, y: mitteVon(b, c, 1).y - mitteVon(b, c, 0).y };
  const laenge = Math.hypot(richtungQuer.x, richtungQuer.y);
  if (laenge < 0.001) return 0;

  const e = { x: richtungQuer.x / laenge, y: richtungQuer.y / laenge };
  const weg = (ziel.x - mitteAlt.x) * e.x + (ziel.y - mitteAlt.y) * e.y;
  // `t` läuft von 0 bis 1 über die Kante; der Versatz ist das Doppelte.
  return Math.max(-0.8, Math.min(0.8, (weg / laenge) * 2));
}

/**
 * Welcher Walmanteil bringt das Firstende an diese Stelle?
 *
 * Umkehrung der Einrückung aus `flaechenAusUmriss`. Gezogen wird das
 * Firstende LÄNGS des Firsts; der Anteil ergibt sich aus der Strecke,
 * die es dabei von der Giebelseite zurücklegt.
 *
 * Beide Enden rücken immer gleich weit ein — ein Walmdach mit zwei
 * verschiedenen Walmen wäre kein Walmdach, sondern ein Sonderfall, den
 * man zeichnet statt einstellt.
 */
export function walmAnteilFuer(
  umriss: Meter[],
  richtung: 0 | 1,
  firstVersatz: number,
  ziel: Meter,
): number {
  if (umriss.length !== 4) return 1;
  const p = flaecheMitVorzeichen(umriss) < 0 ? [...umriss].reverse() : [...umriss];
  const q = gedreht(p, richtung);
  const [a, b, c, d] = q as [Meter, Meter, Meter, Meter];

  const t = 0.5 + Math.max(-0.8, Math.min(0.8, firstVersatz)) / 2;
  const f1 = mitteVon(b, c, t);
  const f2 = mitteVon(a, d, t);

  const richtungFirst = { x: f1.x - f2.x, y: f1.y - f2.y };
  const firstLaenge = Math.hypot(richtungFirst.x, richtungFirst.y);
  if (firstLaenge < 0.001) return 1;

  // Wo liegt der Zeiger auf der Firstlinie, als Anteil von f2 nach f1?
  const s2 =
    ((ziel.x - f2.x) * richtungFirst.x + (ziel.y - f2.y) * richtungFirst.y) /
    (firstLaenge * firstLaenge);
  // Vom näheren Ende aus gemessen — beide Enden sind gleich.
  const rueck = Math.max(0, Math.min(0.45, Math.min(s2, 1 - s2)));

  const tiefe = tiefeVon(q);
  if (tiefe < 0.001) return 1;
  return Math.max(0.05, Math.min(1, (rueck * firstLaenge) / (tiefe / 2)));
}

/**
 * Die Flächen eines Dachs über diesem Umriss.
 *
 * Vier Ecken sind die Voraussetzung für alles ausser Flach- und
 * Pultdach — ein Satteldach über einem Sechseck ist keine Dachform
 * mehr, sondern eine Konstruktion. Bei anderer Eckenzahl wird deshalb
 * die Fläche selbst zurückgegeben, geneigt oder flach.
 */
export function flaechenAusUmriss(
  umriss: Meter[],
  form: Dachform,
  vorgaben: Dachvorgaben,
): Teilflaeche[] {
  if (umriss.length < 3) return [];

  /*
   * Einheitlicher Umlaufsinn. Ohne ihn zeigt die Traufe bei einem im
   * Uhrzeigersinn gezeichneten Umriss nach der falschen Seite, und das
   * ganze Dach schaut nach Norden statt nach Süden.
   */
  const p = flaecheMitVorzeichen(umriss) < 0 ? [...umriss].reverse() : [...umriss];
  const neigung = Math.max(0, Math.min(75, vorgaben.neigung));

  if (form === "flach") return [{ punkte: p, traufe: null, neigung: 0 }];

  /*
   * Pultdach geht über jedem Umriss, auch über einem Fünfeck — und es
   * ist die Vorbelegung nach dem Zeichnen. Die Traufe liegt auf der
   * LÄNGSTEN Kante: Bei einem Pultdach, einem Satteldach und den
   * allermeisten Grundrissen ist die lange Seite die Traufe, und ohne
   * Traufe gäbe es weder Falllinie noch Azimut.
   */
  if (form === "pult" || p.length !== 4) {
    const laengen = kanten(p).map((kk) => Math.hypot(kk.b.x - kk.a.x, kk.b.y - kk.a.y));
    const lang = laengen.indexOf(Math.max(...laengen));
    return [
      {
        punkte: gedreht(p, (lang + vorgaben.richtung) % p.length),
        traufe: 0,
        neigung,
      },
    ];
  }

  const q = gedreht(p, vorgaben.richtung);
  const [a, b, c, d] = q as [Meter, Meter, Meter, Meter];

  if (form === "zelt") {
    const s = schwerpunkt(q);
    return [
      { punkte: [a, b, s], traufe: 0, neigung },
      { punkte: [b, c, s], traufe: 0, neigung },
      { punkte: [c, d, s], traufe: 0, neigung },
      { punkte: [d, a, s], traufe: 0, neigung },
    ];
  }

  /*
   * First: die Verbindung der Mitten von Kante 1 (b→c) und Kante 3
   * (d→a). Bei einem Rechteck ist das die Mittellinie parallel zu
   * Kante 0; bei einem schiefen Viereck läuft sie genauso schief wie
   * das Haus, und das ist richtig so.
   */
  const versatz = Math.max(-0.8, Math.min(0.8, vorgaben.firstVersatz ?? 0));
  const t = 0.5 + versatz / 2;
  const f1 = mitteVon(b, c, t); // auf der rechten Seite
  const f2 = mitteVon(a, d, t); // auf der linken Seite

  if (form === "sattel") {
    return [
      { punkte: [a, b, f1, f2], traufe: 0, neigung },
      { punkte: [c, d, f2, f1], traufe: 0, neigung },
    ];
  }

  /*
   * Walm und Krüppelwalm: Der First wird an beiden Enden eingerückt,
   * und aus den Enden werden Walmflächen. Der Anteil sagt, wie weit —
   * voll (1) ergibt das klassische Walmdach, halb den Krüppelwalm.
   */
  const anteil = Math.max(0.05, Math.min(1, vorgaben.walmAnteil ?? (form === "walm" ? 1 : 0.45)));
  /*
   * Wie weit der First einrückt: bei vollem Walm um die halbe
   * Gebäudetiefe — dann steigen Walm- und Hauptflächen unter demselben
   * Winkel an. Gemessen wird an der Länge der Firstlinie, damit auch
   * ein schiefes Haus ein sauberes Dach bekommt.
   */
  const firstLaenge = Math.hypot(f1.x - f2.x, f1.y - f2.y);
  const rueck = Math.min(0.45, ((tiefeVon(q) / 2) * anteil) / Math.max(0.001, firstLaenge));

  const g1 = mitteVon(f2, f1, rueck); // First-Ende auf der linken Seite
  const g2 = mitteVon(f2, f1, 1 - rueck); // First-Ende rechts

  return [
    { punkte: [a, b, g2, g1], traufe: 0, neigung },
    { punkte: [c, d, g1, g2], traufe: 0, neigung },
    // Die beiden Walmflächen — Traufe ist wieder ihre erste Kante.
    { punkte: [b, c, g2], traufe: 0, neigung },
    { punkte: [d, a, g1], traufe: 0, neigung },
  ];
}

/**
 * Grösste Kantenlänge des Umrisses — für die Vorbelegung der Neigung
 * und um zu erkennen, ob überhaupt etwas Sinnvolles gezeichnet wurde.
 */
export function umrissWeite(umriss: Meter[]): number {
  return kanten(umriss).reduce((m, k) => Math.max(m, Math.hypot(k.b.x - k.a.x, k.b.y - k.a.y)), 0);
}

/**
 * Die Dachflächen eines Baukörpers — mit stabilen Kennungen.
 *
 * Beim Wechsel des Dachtyps bekommt die erste Teilfläche wieder
 * dieselbe Kennung wie vorher. Das ist der Grund, warum eine Belegung
 * einen Wechsel von Sattel auf Walm überlebt: Die Modulgruppen zeigen
 * auf `bau-0`, und `bau-0` gibt es danach immer noch. Was wegfällt —
 * beim Wechsel auf Flachdach etwa die Flächen 1 bis 3 —, nimmt seine
 * Gruppen mit; das muss der Aufrufer aufräumen.
 */
export function flaechenFuerBau(
  bau: {
    id: string;
    name: string;
    umriss: Meter[];
    form: Dachform;
    neigung: number;
    richtung: 0 | 1;
    walmAnteil: number;
    firstVersatz: number;
  },
  /** Bestehende Flächen dieses Baus — für Randabstand und Sperrzonen. */
  vorhanden: Dachflaeche[] = [],
): Dachflaeche[] {
  const teile = flaechenAusUmriss(bau.umriss, bau.form, {
    neigung: bau.neigung,
    richtung: bau.richtung,
    walmAnteil: bau.walmAnteil,
    firstVersatz: bau.firstVersatz,
  });

  return teile.map((t, i) => {
    const alt = vorhanden.find((f) => f.teil === i);
    const flaeche: Dachflaeche = {
      id: `${bau.id}-${i}`,
      name: teile.length === 1 ? bau.name : `${bau.name} ${i + 1}`,
      punkte: t.punkte,
      neigung: t.neigung,
      azimut: 180,
      traufe: t.traufe,
      /*
       * Randabstand und Sperrzonen gehören dem Betrieb, nicht der
       * Dachform: Wer den Kamin eingezeichnet hat, will ihn nach dem
       * Umschalten auf Walmdach nicht neu ziehen.
       */
      randabstand: alt?.randabstand ?? 0.3,
      hindernisse: alt?.hindernisse ?? [],
      bau: bau.id,
      teil: i,
    };
    const az = azimutAusTraufe(flaeche);
    return { ...flaeche, azimut: az ?? 180 };
  });
}
