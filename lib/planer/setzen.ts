import type { Meter } from "./geo";
import { punktInPolygon } from "./flaeche";
import {
  aktiveZellen,
  einzelnesModul,
  modulEcken,
  modulLage,
  STANDARD_MODUL,
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
