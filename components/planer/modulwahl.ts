import { nachfuehren } from "@/lib/planer/module";
import type { Modultyp } from "@/lib/planer/module";
import type { Plan } from "@/lib/planer/plan";
import type { GeraetModul } from "./TechnikPanel";

/*
 * Welches Modul verbaut wird — und was das für die Belegung heisst.
 *
 * Die Wahl steht an ZWEI Stellen: in der Belegung, weil die Modulmasse
 * das Raster bestimmen, und in der Technik, weil Spannung und Strom die
 * Auslegung bestimmen. Beide schreiben dasselbe Feld und müssen
 * dieselbe Nachführung auslösen — sonst hat die eine Seite ein anderes
 * Modul als die andere.
 *
 * Vorher lag die Rechnung nur im Technik-Panel, und die Belegung
 * arbeitete bis dahin mit einem Standardmodul. Wer erst belegte und
 * dann sein Modul wählte, bekam eine Belegung, die für ein anderes
 * Modul gerechnet war — bei 40 mm Unterschied in der Breite ist das je
 * nach Dach eine Spalte mehr oder weniger.
 */

export function modulTyp(m: GeraetModul): Modultyp {
  return {
    breite: Number(m.breite),
    hoehe: Number(m.hoehe),
    wp: Number(m.wp),
    bezeichnung: `${m.hersteller} ${m.bezeichnung}`,
  };
}

/**
 * Modul im Plan setzen und alle Gruppen darauf nachführen.
 *
 * Andere Masse heissen andere Belegung: `nachfuehren` prüft jede Zelle
 * neu gegen Fläche und Hindernisse. Module, die mit dem grösseren Typ
 * nicht mehr passen, fallen dabei heraus — sichtbar, statt über den
 * Rand zu ragen.
 */
export function planMitModul(plan: Plan, id: string | null, module: GeraetModul[]): Plan {
  const gewaehlt = module.find((m) => m.id === id);
  if (!gewaehlt) return { ...plan, technik: { ...plan.technik, modul: null } };

  const typ = modulTyp(gewaehlt);
  const gruppen = plan.gruppen.map((g) => {
    const flaeche = plan.flaechen.find((f) => f.id === g.flaeche);
    const mitTyp = { ...g, typ };
    return flaeche ? nachfuehren(mitTyp, flaeche) : mitTyp;
  });
  return { ...plan, gruppen, technik: { ...plan.technik, modul: id } };
}
