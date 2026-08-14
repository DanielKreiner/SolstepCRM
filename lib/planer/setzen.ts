import type { Meter } from "./geo";
import { punktInPolygon } from "./flaeche";
import {
  aktiveZellen,
  eckenUm,
  einzelnesModul,
  leereZellen,
  modulAnbauen,
  modulEcken,
  modulLage,
  modulPasst,
  rasterIndex,
  rasterMitte,
  STANDARD_MODUL,
  stoesstAn,
  zelle,
  type Modultyp,
  type Modulgruppe,
} from "./module";
import { naechsteId, type Plan } from "./plan";

/*
 * Ein einzelnes Modul setzen — für die Draufsicht UND die räumliche
 * Ansicht.
 *
 * Der Code stand zuerst nur in der Leinwand. Als die räumliche Ansicht
 * dasselbe können sollte („in der 3D Vorschau die Module belegen"),
 * gab es zwei Möglichkeiten: kopieren oder herausziehen. Kopiert wäre
 * die Regel, welches Raster ein neues Modul erbt, an zwei Stellen
 * gestanden — und beim nächsten Wunsch an einer davon geändert worden.
 *
 * Rein rechnend: Plan hinein, Plan heraus. Keine Kamera, kein Canvas,
 * kein three.js.
 */

/**
 * Auf welcher Fläche liegt der Punkt?
 *
 * Zuerst geometrisch — wer über das Nachbardach fährt, meint das
 * Nachbardach. Erst wenn der Punkt auf keiner Fläche liegt, gilt die
 * gewählte.
 */
export function flaecheUnter(plan: Plan, punkt: Meter, aktiv: string | null) {
  return (
    plan.flaechen.find((x) => punktInPolygon(punkt, x.punkte)) ??
    plan.flaechen.find((x) => x.id === aktiv) ??
    null
  );
}

/**
 * Das Raster, das ein neues Modul auf dieser Fläche erbt.
 *
 * Liegt dort schon ein Feld, übernimmt das neue Modul dessen Masse,
 * Drehung und Aufständerung — sonst liesse es sich anschliessend nicht
 * mit den Pluszeichen weiterbauen, weil die Raster nicht
 * zusammenpassen.
 */
function vorbildFuer(plan: Plan, flaecheId: string, standard: Modultyp) {
  const vorbild = plan.gruppen.find((g) => g.flaeche === flaecheId);
  return {
    typ: vorbild?.typ ?? plan.gruppen[0]?.typ ?? standard,
    ausrichtung: vorbild?.ausrichtung ?? ("hoch" as const),
    reihenabstand: vorbild?.reihenabstand ?? 0.02,
    spaltenabstand: vorbild?.spaltenabstand ?? 0.02,
    winkel: vorbild?.winkel ?? 0,
    aufstaenderung: vorbild?.aufstaenderung ?? null,
  };
}

/**
 * Schliesst der Punkt an ein bestehendes Feld an?
 *
 * Das war der Grund für eine Beschwerde: Jeder Klick in der räumlichen
 * Ansicht legte ein NEUES Feld an — „Feld 2", „Feld 3", „Feld 4" —,
 * statt das Modul an das Feld daneben zu hängen. Damit liess sich ein
 * angefangenes Feld nicht weiterbauen, und die Liste füllte sich mit
 * Einzelmodulen.
 *
 * Gesucht wird der Rasterplatz unter dem Punkt. Liegt er im Raster
 * eines Feldes oder genau einen Schritt daneben, gehört das Modul
 * dorthin — dieselbe Regel, nach der auch die Pluszeichen arbeiten.
 * Erst wenn kein Feld in Reichweite ist, entsteht ein neues.
 */
export function anschluss(
  plan: Plan,
  flaecheId: string,
  punkt: Meter,
):
  | { art: "anbauen"; gruppe: Modulgruppe; reihe: number; spalte: number; ecken: Meter[] }
  | { art: "besetzt"; gruppe: Modulgruppe; reihe: number; spalte: number }
  | null {
  const f = plan.flaechen.find((x) => x.id === flaecheId);
  if (!f) return null;

  const eigene = plan.gruppen.filter((g) => g.flaeche === flaecheId);
  let beste:
    | { art: "anbauen"; gruppe: Modulgruppe; reihe: number; spalte: number; ecken: Meter[]; naehe: number }
    | { art: "besetzt"; gruppe: Modulgruppe; reihe: number; spalte: number; naehe: number }
    | null = null;

  for (const g of eigene) {
    if (aktiveZellen(g).length === 0) continue;
    const { reihe, spalte } = rasterIndex(g, f, punkt);

    /*
     * Wie weit der Platz aus dem Raster herausfällt. Null heisst mitten
     * drin, eins heisst direkt an der Kante — mehr wird nicht
     * angebaut, sonst wüchse ein Feld über das halbe Dach.
     */
    const drausR = reihe < 0 ? -reihe : reihe >= g.reihen ? reihe - g.reihen + 1 : 0;
    const drausC = spalte < 0 ? -spalte : spalte >= g.spalten ? spalte - g.spalten + 1 : 0;
    const naehe = Math.max(drausR, drausC);
    if (naehe > 1) continue;
    if (beste && naehe >= beste.naehe) continue;

    // Steht dort schon ein Modul, ist nichts anzubauen.
    const drin = reihe >= 0 && reihe < g.reihen && spalte >= 0 && spalte < g.spalten;
    if (drin && !leereZellen(g).has(zelle(reihe, spalte))) {
      beste = { art: "besetzt", gruppe: g, reihe, spalte, naehe };
      continue;
    }

    /*
     * Passt dort überhaupt eins? Geprüft wird an der Rasterlage, gegen
     * Dachrand, Sperrzonen und die Module aller Felder dieser Fläche.
     */
    const ecken = eckenUm(rasterMitte(g, f, reihe, spalte), g, f);
    const besetzt = eigene.flatMap((x) =>
      aktiveZellen(x).map((z) => modulEcken(x, f, z.reihe, z.spalte)),
    );
    if (!modulPasst(ecken, f) || stoesstAn(ecken, besetzt)) continue;

    beste = { art: "anbauen", gruppe: g, reihe, spalte, ecken, naehe };
  }

  if (!beste) return null;
  if (beste.art === "besetzt") {
    return { art: "besetzt", gruppe: beste.gruppe, reihe: beste.reihe, spalte: beste.spalte };
  }
  return {
    art: "anbauen",
    gruppe: beste.gruppe,
    reihe: beste.reihe,
    spalte: beste.spalte,
    ecken: beste.ecken,
  };
}

/**
 * Wo läge das Modul, wenn man jetzt klickt — und passt es dort?
 *
 * `passt: false` heisst: Es wird trotzdem gezeichnet, nur rot. Wer
 * nichts sieht, hält den Planer für kaputt; wer ein rotes Modul sieht,
 * weiss, dass der Randabstand im Weg ist.
 */
export function modulVorschau(
  plan: Plan,
  punkt: Meter,
  aktiv: string | null,
  standard: Modultyp = STANDARD_MODUL,
): { ecken: Meter[]; passt: boolean; flaeche: string } | null {
  const f = flaecheUnter(plan, punkt, aktiv);
  if (!f) return null;

  /*
   * Schliesst es an ein Feld an, wird die Vorschau AUF DEM RASTER
   * dieses Feldes gezeigt — nicht dort, wo der Zeiger genau steht.
   * Sonst verspricht das Geisterbild eine Lage, die das Setzen
   * nachher nicht einhält.
   */
  const an = anschluss(plan, f.id, punkt);
  if (an?.art === "anbauen") return { ecken: an.ecken, passt: true, flaeche: f.id };
  if (an?.art === "besetzt") {
    const ecken = modulEcken(an.gruppe, f, an.reihe, an.spalte);
    return { ecken, passt: false, flaeche: f.id };
  }

  const opt = vorbildFuer(plan, f.id, standard);
  const gruppe = einzelnesModul(f, punkt, "geist", "Geist", opt);
  if (gruppe) return { ecken: modulEcken(gruppe, f, 0, 0), passt: true, flaeche: f.id };

  const roh = modulLage(f, punkt, "geist", "Geist", opt);
  return { ecken: modulEcken(roh, f, 0, 0), passt: false, flaeche: f.id };
}

export type Setzergebnis =
  | { ok: true; plan: Plan; flaeche: string; gruppe: string }
  | { ok: false; meldung: string };

/**
 * Ein Modul an diesen Punkt setzen.
 *
 * Es entsteht ein neues Feld mit genau einem Modul. Nicht als Zelle in
 * einem bestehenden Feld: Ein Feld ist ein Rechteck aus Reihen und
 * Spalten, und ein Modul, das drei Meter daneben liegt, würde daraus
 * ein Raster mit zwanzig leeren Zellen machen.
 */
export function modulSetzen(
  plan: Plan,
  punkt: Meter,
  aktiv: string | null,
  standard: Modultyp = STANDARD_MODUL,
): Setzergebnis {
  const f = flaecheUnter(plan, punkt, aktiv);
  if (!f) return { ok: false, meldung: "Zuerst eine Dachfläche zeichnen." };

  /*
   * Erst anbauen, dann neu anlegen. Ein Feld ist eine Einheit, die
   * gedreht, verschoben und verkabelt wird — dreissig Einzelfelder
   * neben einander sind keine Anlage, sondern eine Liste.
   */
  const an = anschluss(plan, f.id, punkt);
  if (an?.art === "besetzt") {
    return { ok: false, meldung: "Hier liegt schon ein Modul." };
  }
  if (an?.art === "anbauen") {
    const erweitert = modulAnbauen(an.gruppe, f, { reihe: an.reihe, spalte: an.spalte });
    return {
      ok: true,
      plan: {
        ...plan,
        gruppen: plan.gruppen.map((g) => (g.id === an.gruppe.id ? erweitert : g)),
      },
      flaeche: f.id,
      gruppe: an.gruppe.id,
    };
  }

  const belegt = plan.gruppen
    .filter((g) => g.flaeche === f.id)
    .flatMap((g: Modulgruppe) => aktiveZellen(g).map((z) => modulEcken(g, f, z.reihe, z.spalte)));

  const neu = einzelnesModul(
    f,
    punkt,
    naechsteId(plan.gruppen.map((g) => g.id), "g"),
    `Feld ${plan.gruppen.length + 1}`,
    { ...vorbildFuer(plan, f.id, standard), besetzt: belegt },
  );

  if (!neu) {
    return { ok: false, meldung: "Hier ist kein Platz — Randabstand, Hindernis oder ein Modul im Weg." };
  }

  return {
    ok: true,
    plan: { ...plan, gruppen: [...plan.gruppen, neu] },
    flaeche: f.id,
    gruppe: neu.id,
  };
}

/**
 * Ein Modul wieder wegnehmen.
 *
 * Es kommt in `entfernt` und nicht aus dem Raster heraus: Ein Loch,
 * das jemand gemacht hat, bleibt als blasses Kästchen sichtbar und
 * lässt sich mit einem Klick zurückholen. Bleibt von einer Gruppe
 * nichts übrig, verschwindet sie ganz — ein leeres Feld in der Liste
 * ist nur Ballast.
 */
export function modulEntfernen(plan: Plan, gruppeId: string, reihe: number, spalte: number): Plan {
  const zelle = `${reihe}:${spalte}`;
  const gruppen = plan.gruppen
    .map((g) => {
      if (g.id !== gruppeId) return g;
      if ((g.entfernt ?? []).includes(zelle)) return g;
      return { ...g, entfernt: [...(g.entfernt ?? []), zelle] };
    })
    .filter((g) => aktiveZellen(g).length > 0);

  const weg = new Set(plan.gruppen.map((g) => g.id).filter((id) => !gruppen.some((g) => g.id === id)));
  const schluessel = `${gruppeId}/${zelle}`;

  return {
    ...plan,
    gruppen,
    /*
     * Aus den Strings muss es ebenfalls heraus. Sonst zeigt der
     * Kabelweg auf ein Modul, das es nicht mehr gibt, und die
     * elektrische Prüfung rechnet mit einer Spannung, die nie anliegt.
     */
    strings: plan.strings.map((s) => ({
      ...s,
      module: s.module.filter(
        (m) => m !== schluessel && !weg.has(m.slice(0, Math.max(0, m.lastIndexOf("/")))),
      ),
    })),
  };
}
