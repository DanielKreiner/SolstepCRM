/**
 * Gesetzliche Feiertage für die Sollstunden.
 *
 * Bisher blieben sie aussen vor, und das Soll lag in Feiertagsmonaten zu
 * hoch — im Dezember baut ein Betrieb so rechnerisch Minusstunden auf,
 * die niemand verursacht hat. Für ein Stundenkonto ist das kein
 * Schönheitsfehler, sondern falsch.
 *
 * Bewusst ohne Dienst und ohne Tabelle: die beweglichen Feiertage hängen
 * alle am Ostersonntag, und der lässt sich rechnen. Eine Tabelle müsste
 * jedes Jahr jemand pflegen — und würde es irgendwann nicht mehr.
 *
 * Abgedeckt sind Österreich (bundesweit) und Deutschland (bundesweit).
 * Regionale Feiertage wie Mariä Himmelfahrt in Bayern fehlen bewusst:
 * lieber ein Feiertag zu wenig als ein Soll, das für die Hälfte der
 * Belegschaft falsch ist. Die Region steht an location.holiday_region.
 */

/** Ostersonntag nach Gauß. */
function ostern(jahr: number): Date {
  const a = jahr % 19;
  const b = Math.floor(jahr / 100);
  const c = jahr % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const monat = Math.floor((h + l - 7 * m + 114) / 31);
  const tag = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(jahr, monat - 1, tag));
}

function plus(d: Date, tage: number): string {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + tage);
  return x.toISOString().slice(0, 10);
}

const FIX_AT: [number, number][] = [
  [1, 1], // Neujahr
  [1, 6], // Heilige Drei Könige
  [5, 1], // Staatsfeiertag
  [8, 15], // Mariä Himmelfahrt
  [10, 26], // Nationalfeiertag
  [11, 1], // Allerheiligen
  [12, 8], // Mariä Empfängnis
  [12, 25],
  [12, 26],
];

const FIX_DE: [number, number][] = [
  [1, 1],
  [5, 1],
  [10, 3], // Tag der Deutschen Einheit
  [12, 25],
  [12, 26],
];

/**
 * Alle Feiertage eines Jahres als ISO-Daten.
 *
 * @param region z. B. "AT-4" oder "DE-BY". Ausgewertet wird nur das Land.
 */
export function feiertage(jahr: number, region: string | null): Set<string> {
  const land = (region ?? "AT").slice(0, 2).toUpperCase();
  const o = ostern(jahr);

  const tage = new Set<string>();
  const fix = land === "DE" ? FIX_DE : FIX_AT;
  for (const [m, t] of fix) {
    tage.add(
      `${jahr}-${String(m).padStart(2, "0")}-${String(t).padStart(2, "0")}`,
    );
  }

  /* Beweglich, in beiden Ländern gleich. */
  tage.add(plus(o, 1)); // Ostermontag
  tage.add(plus(o, 39)); // Christi Himmelfahrt
  tage.add(plus(o, 50)); // Pfingstmontag
  if (land === "AT") tage.add(plus(o, 60)); // Fronleichnam
  if (land === "DE") tage.add(plus(o, -2)); // Karfreitag

  return tage;
}

/** Ist der Tag ein Werktag, an dem gearbeitet würde? */
export function istArbeitstag(tag: string, region: string | null): boolean {
  const wt = new Date(`${tag}T12:00:00Z`).getUTCDay();
  if (wt === 0 || wt === 6) return false;
  const jahr = Number(tag.slice(0, 4));
  return !feiertage(jahr, region).has(tag);
}

/** Arbeitstage eines Monats „2026-08" ohne Wochenende und Feiertage. */
export function arbeitstageImMonat(monat: string, region: string | null): number {
  const [jahr, m] = monat.split("-").map(Number);
  if (!jahr || !m) return 0;
  const letzter = new Date(Date.UTC(jahr, m, 0)).getUTCDate();

  let zahl = 0;
  for (let t = 1; t <= letzter; t++) {
    const tag = `${monat}-${String(t).padStart(2, "0")}`;
    if (istArbeitstag(tag, region)) zahl++;
  }
  return zahl;
}
