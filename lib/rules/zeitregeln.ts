/**
 * Zeiterfassungsregeln eines Betriebs — Rundung, Pausenautomatik, Zuschläge.
 *
 * Reines Rechenmodul, keine Datenbank, keine Next-Abhängigkeit. Es wird an
 * drei Stellen gebraucht: beim Erfassen einer Zeit, beim Nachtragen im Büro
 * und im Stundenbericht. Läge die Rechnung in den Screens, gäbe es drei
 * Fassungen und zwei davon wären falsch — dieselbe Begründung wie bei
 * lib/rules/worktime.ts.
 *
 * Nicht enthalten und bewusst nicht: eine Lohnrechnung. Zuschläge werden
 * ausgewiesen, nicht ausbezahlt. Was ein Betrieb daraus macht, entscheidet
 * sein Kollektivvertrag, nicht diese Software.
 */

export type Zeitregeln = {
  /**
   * Rundung je Buchung in Minuten. 0 = keine Rundung.
   * Gerundet wird kaufmännisch: 7 Minuten bei 15er-Schritten werden 0,
   * 8 Minuten werden 15.
   */
  rundungMin: number;
  /**
   * Ab dieser Arbeitsdauer wird automatisch eine Pause abgezogen, in
   * Minuten. 0 = keine Automatik.
   */
  pauseAbMin: number;
  /** Höhe des automatischen Abzugs in Minuten. */
  pauseAbzugMin: number;
  /** Ab dieser Uhrzeit gilt Abendzuschlag, als "HH:MM" Ortszeit. */
  abendAb: string;
  /** Ab dieser Uhrzeit gilt Nachtzuschlag. */
  nachtAb: string;
  /** Bis zu dieser Uhrzeit gilt noch Nachtzuschlag (am Morgen). */
  nachtBis: string;
  /** Zuschlagssätze in Prozent, nur zur Ausweisung. */
  zuschlagAbendPct: number;
  zuschlagNachtPct: number;
  zuschlagSamstagPct: number;
  zuschlagSonntagPct: number;
  zuschlagFeiertagPct: number;
};

export const STANDARD_ZEITREGELN: Zeitregeln = {
  rundungMin: 0,
  pauseAbMin: 360,
  pauseAbzugMin: 30,
  abendAb: "18:00",
  nachtAb: "22:00",
  nachtBis: "06:00",
  zuschlagAbendPct: 25,
  zuschlagNachtPct: 50,
  zuschlagSamstagPct: 50,
  zuschlagSonntagPct: 100,
  zuschlagFeiertagPct: 100,
};

/**
 * Eine Dauer nach den Regeln des Betriebs runden.
 *
 * Kaufmännisch, nicht abwärts: eine Rundung, die immer zulasten des
 * Mitarbeiters geht, ist arbeitsrechtlich angreifbar und im Betrieb ein
 * Streitpunkt. Wer abwärts runden will, stellt die Rundung ab.
 */
export function runde(dauerMin: number, regeln: Zeitregeln): number {
  const schritt = Math.max(0, Math.round(regeln.rundungMin));
  if (schritt <= 1) return Math.max(0, Math.round(dauerMin));
  return Math.max(0, Math.round(dauerMin / schritt) * schritt);
}

export type PausenErgebnis = {
  /** Arbeitszeit nach Abzug. */
  nettoMin: number;
  /** Tatsächlich abgezogene Minuten. */
  abzugMin: number;
};

/**
 * Automatischer Pausenabzug.
 *
 * Greift nur, wenn die Buchung lang genug ist UND noch keine Pause
 * gebucht wurde. Wer selbst ausstempelt und wieder einstempelt, bekommt
 * nicht zusätzlich eine Pause abgezogen — sonst zahlt er sie zweimal.
 */
export function pausenabzug(
  dauerMin: number,
  bereitsGebuchtePauseMin: number,
  regeln: Zeitregeln,
): PausenErgebnis {
  if (regeln.pauseAbMin <= 0 || regeln.pauseAbzugMin <= 0) {
    return { nettoMin: dauerMin, abzugMin: 0 };
  }
  if (dauerMin < regeln.pauseAbMin) {
    return { nettoMin: dauerMin, abzugMin: 0 };
  }

  const fehlend = Math.max(0, regeln.pauseAbzugMin - bereitsGebuchtePauseMin);
  if (fehlend === 0) return { nettoMin: dauerMin, abzugMin: 0 };

  /*
   * Nie unter null: eine Buchung von 6 Stunden und einer Minute darf
   * nach dem Abzug nicht ins Minus laufen, auch wenn jemand einen
   * absurden Abzug einstellt.
   */
  const abzug = Math.min(fehlend, dauerMin);
  return { nettoMin: dauerMin - abzug, abzugMin: abzug };
}

export type Zuschlagsart =
  | "normal"
  | "abend"
  | "nacht"
  | "samstag"
  | "sonntag"
  | "feiertag";

/** Ein Abschnitt gleicher Zuschlagsart. */
export type Zuschlagsblock = {
  art: Zuschlagsart;
  minuten: number;
  prozent: number;
};

function alsMinuten(hhmm: string): number {
  const [h, m] = hhmm.split(":");
  return Number(h ?? 0) * 60 + Number(m ?? 0);
}

function satz(art: Zuschlagsart, regeln: Zeitregeln): number {
  switch (art) {
    case "abend":
      return regeln.zuschlagAbendPct;
    case "nacht":
      return regeln.zuschlagNachtPct;
    case "samstag":
      return regeln.zuschlagSamstagPct;
    case "sonntag":
      return regeln.zuschlagSonntagPct;
    case "feiertag":
      return regeln.zuschlagFeiertagPct;
    default:
      return 0;
  }
}

/**
 * Zuschlagsart einer einzelnen Minute.
 *
 * Reihenfolge ist Absicht: Feiertag schlägt Sonntag, Sonntag schlägt
 * Samstag, und der Tagestyp schlägt die Uhrzeit. Ein Betrieb rechnet
 * einen Sonntagabend nicht doppelt ab — er rechnet ihn als Sonntag.
 */
function artDerMinute(
  wochentag: number,
  minuteDesTages: number,
  istFeiertag: boolean,
  regeln: Zeitregeln,
): Zuschlagsart {
  if (istFeiertag) return "feiertag";
  if (wochentag === 0) return "sonntag";
  if (wochentag === 6) return "samstag";

  const nachtAb = alsMinuten(regeln.nachtAb);
  const nachtBis = alsMinuten(regeln.nachtBis);
  if (minuteDesTages >= nachtAb || minuteDesTages < nachtBis) return "nacht";

  if (minuteDesTages >= alsMinuten(regeln.abendAb)) return "abend";
  return "normal";
}

/**
 * Eine Buchung in Zuschlagsblöcke zerlegen.
 *
 * Minutenweise gerechnet, weil eine Schicht über Mitternacht, über die
 * Tagesgrenze und über den Zuschlagsbeginn hinweg laufen kann — alles drei
 * gleichzeitig, etwa bei einer Störungsbehebung Samstagnacht.
 *
 * `lokal` liefert für einen Zeitpunkt Wochentag (0 = Sonntag), Minute des
 * Tages und ob der Tag ein Feiertag ist. Die Zeitzone bleibt damit ausserhalb
 * dieses Moduls — hier wird nur gerechnet.
 */
export function zuschlaege(
  startMs: number,
  endeMs: number,
  regeln: Zeitregeln,
  lokal: (ms: number) => {
    wochentag: number;
    minuteDesTages: number;
    istFeiertag: boolean;
  },
): Zuschlagsblock[] {
  const dauer = Math.max(0, Math.round((endeMs - startMs) / 60000));
  if (dauer === 0) return [];

  const zaehler = new Map<Zuschlagsart, number>();

  for (let i = 0; i < dauer; i++) {
    const t = lokal(startMs + i * 60000);
    const art = artDerMinute(
      t.wochentag,
      t.minuteDesTages,
      t.istFeiertag,
      regeln,
    );
    zaehler.set(art, (zaehler.get(art) ?? 0) + 1);
  }

  const reihenfolge: Zuschlagsart[] = [
    "normal",
    "abend",
    "nacht",
    "samstag",
    "sonntag",
    "feiertag",
  ];

  return reihenfolge
    .filter((a) => (zaehler.get(a) ?? 0) > 0)
    .map((a) => ({
      art: a,
      minuten: zaehler.get(a) ?? 0,
      prozent: satz(a, regeln),
    }));
}

/**
 * Zuschlagsminuten als Aufschlag — was der Betrieb über die reine
 * Arbeitszeit hinaus zu tragen hat, in Minuten.
 *
 * 60 Minuten Sonntag zu 100 % ergeben 60 Aufschlagsminuten. Damit lässt
 * sich der Aufschlag in derselben Einheit auswerten wie die Arbeitszeit,
 * ohne dass dieses Modul einen Stundensatz kennen muss.
 */
export function aufschlagMinuten(bloecke: Zuschlagsblock[]): number {
  return Math.round(
    bloecke.reduce((s, b) => s + (b.minuten * b.prozent) / 100, 0),
  );
}

/** Regeln aus dem JSON der Datenbank lesen, fehlende Werte aus dem Standard. */
export function ausJson(roh: unknown): Zeitregeln {
  const o = (roh ?? {}) as Record<string, unknown>;
  const zahl = (k: keyof Zeitregeln, standard: number): number => {
    const v = Number(o[k]);
    return Number.isFinite(v) && v >= 0 ? v : standard;
  };
  const text = (k: keyof Zeitregeln, standard: string): string => {
    const v = o[k];
    return typeof v === "string" && /^\d{2}:\d{2}$/.test(v) ? v : standard;
  };

  return {
    rundungMin: zahl("rundungMin", STANDARD_ZEITREGELN.rundungMin),
    pauseAbMin: zahl("pauseAbMin", STANDARD_ZEITREGELN.pauseAbMin),
    pauseAbzugMin: zahl("pauseAbzugMin", STANDARD_ZEITREGELN.pauseAbzugMin),
    abendAb: text("abendAb", STANDARD_ZEITREGELN.abendAb),
    nachtAb: text("nachtAb", STANDARD_ZEITREGELN.nachtAb),
    nachtBis: text("nachtBis", STANDARD_ZEITREGELN.nachtBis),
    zuschlagAbendPct: zahl("zuschlagAbendPct", STANDARD_ZEITREGELN.zuschlagAbendPct),
    zuschlagNachtPct: zahl("zuschlagNachtPct", STANDARD_ZEITREGELN.zuschlagNachtPct),
    zuschlagSamstagPct: zahl("zuschlagSamstagPct", STANDARD_ZEITREGELN.zuschlagSamstagPct),
    zuschlagSonntagPct: zahl("zuschlagSonntagPct", STANDARD_ZEITREGELN.zuschlagSonntagPct),
    zuschlagFeiertagPct: zahl("zuschlagFeiertagPct", STANDARD_ZEITREGELN.zuschlagFeiertagPct),
  };
}
