import { formatInTimeZone } from "date-fns-tz";

/*
 * Anzeige. Gerechnet wird woanders — hier wird nur dargestellt.
 * Alles in Europe/Vienna, alles de-AT. Die Datenbank steht auf UTC und
 * bleibt dort (CLAUDE.md Abschnitt 5.3).
 */
export const TZ = "Europe/Vienna";

const money = new Intl.NumberFormat("de-AT", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const moneyCompact = new Intl.NumberFormat("de-AT", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const decimal = new Intl.NumberFormat("de-AT", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

/** Beträge sind netto. Wo sie stehen, muss "exkl. USt." dabeistehen. */
export function eur(value: number | string | null | undefined): string {
  const n = toNumber(value);
  return n === null ? "—" : money.format(n);
}

/** Für KPI-Kacheln und Listen, wo Cent nur Lärm sind. */
export function eurShort(value: number | string | null | undefined): string {
  const n = toNumber(value);
  return n === null ? "—" : moneyCompact.format(n);
}

export function num(
  value: number | string | null | undefined,
  unit?: string,
): string {
  const n = toNumber(value);
  if (n === null) return "—";
  return unit ? `${decimal.format(n)} ${unit}` : decimal.format(n);
}

/** Minuten als 7:30 — die Schreibweise, in der ein Betrieb Stunden liest. */
export function hhmm(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return "—";
  const sign = minutes < 0 ? "−" : "";
  const abs = Math.abs(Math.round(minutes));
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `${sign}${h}:${String(m).padStart(2, "0")}`;
}

/** Saldo mit Vorzeichen: +7:30 / −2:15. Null bleibt 0:00 ohne Vorzeichen. */
export function hhmmSigned(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return "—";
  const rounded = Math.round(minutes);
  if (rounded === 0) return "0:00";
  return rounded > 0 ? `+${hhmm(rounded)}` : hhmm(rounded);
}

export function hours(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return "—";
  return `${decimal.format(Math.round((minutes / 60) * 10) / 10)} h`;
}

export function date(value: string | Date | null | undefined): string {
  if (!value) return "—";
  return formatInTimeZone(new Date(value), TZ, "dd.MM.yyyy");
}

export function dateShort(value: string | Date | null | undefined): string {
  if (!value) return "—";
  return formatInTimeZone(new Date(value), TZ, "dd.MM.");
}

export function time(value: string | Date | null | undefined): string {
  if (!value) return "—";
  return formatInTimeZone(new Date(value), TZ, "HH:mm");
}

export function dateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  return formatInTimeZone(new Date(value), TZ, "dd.MM.yyyy HH:mm");
}

export function weekday(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = formatInTimeZone(new Date(value), TZ, "EEEEEE");
  return d;
}

/** Der Tag in Europe/Vienna als YYYY-MM-DD — Basis für alle Tagesgrenzen. */
export function viennaDay(value: Date | string = new Date()): string {
  return formatInTimeZone(new Date(value), TZ, "yyyy-MM-dd");
}

/** Initialen für Avatare. "Thomas Zauner" -> "TZ" */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

function toNumber(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}
