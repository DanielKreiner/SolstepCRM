/*
 * Elektrische Prüfung der Auslegung (Briefing 5.3).
 *
 * Die Formeln sind im Briefing als verbindlich gekennzeichnet und
 * stehen hier eins zu eins. Sie beantworten die Frage, an der eine
 * PV-Anlage tatsächlich scheitert: passt der String zum Wechselrichter?
 *
 * Zwei Grenzen, die aus verschiedenen Richtungen drücken:
 *
 *   Nach OBEN die Leerlaufspannung im Winter. Ein Modul liefert bei
 *   −10 °C mehr Spannung als bei 25 °C; wer bei Sommerwerten auslegt,
 *   zerstört im Februar den Wechselrichter.
 *
 *   Nach UNTEN das MPP-Fenster. Zu wenige Module und der Wechselrichter
 *   findet den Arbeitspunkt gar nicht erst — die Anlage steht, ohne
 *   dass etwas kaputt wäre.
 *
 * Jede Verletzung ergibt GENAU EINEN Klartextsatz mit der Lösung. Kein
 * Fehlercode: wer auf dem Dach steht, braucht die Zahl und den Ausweg,
 * nicht eine Kennung zum Nachschlagen.
 */

import { num } from "@/lib/format";

/** Auslegungstemperaturen laut Briefing. */
export const T_MIN = -10;
export const T_STC = 25;

export interface ModulElektrik {
  bezeichnung: string;
  /** Leerlaufspannung bei STC, in Volt. */
  uoc: number;
  /** MPP-Spannung bei STC, in Volt. */
  umpp: number;
  /** Kurzschlussstrom, in Ampere. */
  isc: number;
  /** MPP-Strom, in Ampere. */
  impp: number;
  /** Temperaturkoeffizient der Leerlaufspannung, je Kelvin. Negativ, z. B. −0,0025. */
  tkUoc: number;
  wp: number;
}

export interface Mppt {
  /** Unteres Ende des MPP-Fensters, in Volt. */
  uMin: number;
  uMax: number;
  /** Höchststrom je MPPT, in Ampere. */
  iMax: number;
  /** Wie viele Strings parallel an diesen MPPT dürfen. */
  maxStrings: number;
}

export interface Wechselrichter {
  bezeichnung: string;
  /** Höchste zulässige DC-Spannung, in Volt. */
  maxDc: number;
  mppt: Mppt[];
  /** AC-Nennleistung in kW. */
  acNenn: number;
  /** Höchste empfohlene DC-Leistung in kW. */
  maxDcLeistung?: number;
  hybrid: boolean;
}

export interface String {
  id: string;
  name: string;
  /** An welchen MPPT der String hängt (Index in wechselrichter.mppt). */
  mppt: number;
  /** Module des Strings — als Zellschlüssel "gruppe/reihe:spalte". */
  module: string[];
  /** Modultyp je String; bei Mischung steht hier mehr als einer. */
  typen: ModulElektrik[];
}

export type Schwere = "fehler" | "warnung" | "hinweis";

export interface Befund {
  schwere: Schwere;
  /** Ein Satz: was ist, und was hilft. */
  text: string;
  /** Woran es hängt — für die Markierung in der Oberfläche. */
  string?: string;
}

/*
 * ── Einzelformeln ──────────────────────────────────────────────────
 */

/**
 * Leerlaufspannung bei Auslegungstemperatur.
 *
 *   Uoc_kalt = Uoc_STC · (1 + tk_uoc · (T_min − T_STC))
 *
 * Bei tk = −0,25 %/K und −10 °C sind das 8,75 % ÜBER dem Datenblattwert,
 * weil der Koeffizient negativ ist und die Temperaturdifferenz auch.
 */
export function uocKalt(m: ModulElektrik, tMin = T_MIN): number {
  return m.uoc * (1 + m.tkUoc * (tMin - T_STC));
}

/** Wie viele Module höchstens in Reihe dürfen. */
export function maxModuleProString(m: ModulElektrik, wr: Wechselrichter, tMin = T_MIN): number {
  return Math.floor(wr.maxDc / uocKalt(m, tMin));
}

/** Wie viele Module mindestens nötig sind, damit der MPP-Punkt erreicht wird. */
export function minModuleProString(m: ModulElektrik, mppt: Mppt): number {
  return Math.ceil(mppt.uMin / m.umpp);
}

export function stringSpannungKalt(anzahl: number, m: ModulElektrik, tMin = T_MIN): number {
  return anzahl * uocKalt(m, tMin);
}

export function stringSpannungMpp(anzahl: number, m: ModulElektrik): number {
  return anzahl * m.umpp;
}

/*
 * ── Zahlenformat ───────────────────────────────────────────────────
 */

/*
 * Zahlen wie im Rest der Anwendung: `num()` aus lib/format.ts, also
 * de-AT. Das Briefing schreibt „1.000 V" mit Punkt; de-AT setzt dort ein
 * schmales Leerzeichen. Ich bleibe bei der Anwendung — ein zweiter
 * Tausendertrenner im selben Produkt wäre schlimmer als die Abweichung
 * von einem Beispielsatz.
 */
function volt(v: number): string {
  return num(Math.round(v * 10) / 10, "V");
}

function ampere(a: number): string {
  return num(Math.round(a * 10) / 10, "A");
}

/*
 * ── Prüfung ────────────────────────────────────────────────────────
 */

export interface PruefEingabe {
  strings: String[];
  wechselrichter: Wechselrichter;
  /** Aktive Module, die keinem String zugeordnet sind. */
  ohneString: number;
  tMin?: number;
}

export interface PruefErgebnis {
  befunde: Befund[];
  /** Grün nur ohne Fehler UND ohne unzugeordnete Module. */
  geprueft: boolean;
  /** Verhältnis DC zu AC — reine Information. */
  dcAc: number | null;
}

export function pruefe(e: PruefEingabe): PruefErgebnis {
  const befunde: Befund[] = [];
  const tMin = e.tMin ?? T_MIN;
  const wr = e.wechselrichter;

  for (const s of e.strings) {
    const anzahl = s.module.length;
    if (anzahl === 0) continue;

    /*
     * Gemischte Modultypen: nur eine Warnung, kein Block. Es gibt
     * Anlagen, in denen das bewusst passiert (Nachrüstung, Ersatz für
     * ein defektes Modul) — verboten ist es nicht, nur ungünstig.
     */
    if (s.typen.length > 1) {
      befunde.push({
        schwere: "warnung",
        string: s.id,
        text:
          `${s.name}: verschiedene Modultypen in einem String ` +
          `(${s.typen.map((t) => t.bezeichnung).join(", ")}) — der schwächste bestimmt den Strom.`,
      });
    }

    const m = s.typen[0];
    if (!m) continue;
    const mppt = wr.mppt[s.mppt];
    if (!mppt) {
      befunde.push({
        schwere: "fehler",
        string: s.id,
        text: `${s.name}: MPPT ${s.mppt + 1} gibt es an ${wr.bezeichnung} nicht.`,
      });
      continue;
    }

    // 1) Leerlaufspannung im Winter gegen die DC-Grenze.
    const uString = stringSpannungKalt(anzahl, m, tMin);
    if (uString > wr.maxDc) {
      const nMax = maxModuleProString(m, wr, tMin);
      befunde.push({
        schwere: "fehler",
        string: s.id,
        text:
          `${s.name} mit ${anzahl} Modulen: Leerlaufspannung ${volt(uString)} bei ${tMin} °C ` +
          `überschreitet die max. DC-Spannung ${volt(wr.maxDc)} — maximal ${nMax} Module.`,
      });
    }

    // 2) MPP-Fenster: zu wenig ist so falsch wie zu viel.
    const uMpp = stringSpannungMpp(anzahl, m);
    if (uMpp < mppt.uMin) {
      const nMin = minModuleProString(m, mppt);
      befunde.push({
        schwere: "fehler",
        string: s.id,
        text:
          `${s.name} mit ${anzahl} Modulen: MPP-Spannung ${volt(uMpp)} liegt unter dem ` +
          `MPP-Fenster ab ${volt(mppt.uMin)} — mindestens ${nMin} Module.`,
      });
    } else if (uMpp > mppt.uMax) {
      const nMax = Math.floor(mppt.uMax / m.umpp);
      befunde.push({
        schwere: "fehler",
        string: s.id,
        text:
          `${s.name} mit ${anzahl} Modulen: MPP-Spannung ${volt(uMpp)} liegt über dem ` +
          `MPP-Fenster bis ${volt(mppt.uMax)} — höchstens ${nMax} Module.`,
      });
    }
  }

  // 3) Je MPPT: Strom der parallelen Strings und deren Anzahl.
  for (let i = 0; i < wr.mppt.length; i++) {
    const mppt = wr.mppt[i]!;
    const dran = e.strings.filter((s) => s.mppt === i && s.module.length > 0);
    if (dran.length === 0) continue;

    const strom = dran.reduce((sum, s) => sum + (s.typen[0]?.impp ?? 0), 0);
    if (strom > mppt.iMax) {
      befunde.push({
        schwere: "fehler",
        text:
          `MPPT ${i + 1}: ${dran.length} parallele Strings ergeben ${ampere(strom)} — ` +
          `zulässig sind ${ampere(mppt.iMax)}. Einen String auf einen freien MPPT legen.`,
      });
    }

    if (dran.length > mppt.maxStrings) {
      befunde.push({
        schwere: "fehler",
        text:
          `MPPT ${i + 1}: ${dran.length} Strings angeschlossen, erlaubt sind ${mppt.maxStrings}.`,
      });
    }

    /*
     * Parallele Strings mit ungleicher Modulzahl (Abnahmetest 16):
     * beide arbeiten dann am selben Arbeitspunkt, und der längere gibt
     * einen Teil seiner Leistung nicht ab. Kein Defekt, aber verschenkt.
     */
    const laengen = [...new Set(dran.map((s) => s.module.length))];
    if (dran.length > 1 && laengen.length > 1) {
      befunde.push({
        schwere: "warnung",
        text:
          `MPPT ${i + 1}: parallele Strings mit ${laengen.sort((a, b) => a - b).join(" und ")} Modulen — ` +
          "ungleich lange Strings kosten Ertrag. Gleich lang verteilen.",
      });
    }
  }

  // 4) Nicht zugeordnete Module (Abnahmetest 15).
  if (e.ohneString > 0) {
    befunde.push({
      schwere: "hinweis",
      text:
        `${e.ohneString} ${e.ohneString === 1 ? "Modul ist" : "Module sind"} keinem String zugeordnet — ` +
        "sie liefern nichts, solange das so ist.",
    });
  }

  // 5) DC/AC — nur Information, ab 1,5 mit Warnung.
  const kwp =
    e.strings.reduce((sum, s) => sum + s.module.length * (s.typen[0]?.wp ?? 0), 0) / 1000;
  const dcAc = wr.acNenn > 0 ? kwp / wr.acNenn : null;
  if (dcAc !== null && dcAc > 1.5) {
    befunde.push({
      schwere: "warnung",
      text:
        `Verhältnis DC zu AC ist ${dcAc.toFixed(2).replace(".", ",")} — über 1,5 wird an klaren ` +
        "Tagen dauerhaft abgeregelt. Grösseren Wechselrichter prüfen.",
    });
  }

  return {
    befunde,
    geprueft: befunde.every((b) => b.schwere !== "fehler") && e.ohneString === 0,
    dcAc,
  };
}
