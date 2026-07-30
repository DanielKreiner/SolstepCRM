import { fromZonedTime, toZonedTime } from "date-fns-tz";
import { TZ } from "./format";

/*
 * Zeitrechnung. Gespeichert wird timestamptz in UTC, gedacht wird in
 * Europe/Vienna. Jede Tagesgrenze läuft über diese Datei — ein Betrieb
 * stempelt um 6:30 Ortszeit ein, nicht um 4:30 UTC.
 */

/** Beginn des Kalendertags in Wiener Zeit, als UTC-Instant. */
export function startOfViennaDay(day: string): Date {
  return fromZonedTime(`${day}T00:00:00`, TZ);
}

/** Ende (exklusiv) des Kalendertags in Wiener Zeit, als UTC-Instant. */
export function endOfViennaDay(day: string): Date {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  const next = d.toISOString().slice(0, 10);
  return fromZonedTime(`${next}T00:00:00`, TZ);
}

/** Montag der ISO-Woche, in der `day` liegt (Wiener Zeit), als YYYY-MM-DD. */
export function startOfViennaWeek(day: string): string {
  const local = toZonedTime(startOfViennaDay(day), TZ);
  const dow = (local.getDay() + 6) % 7; // Montag = 0
  local.setDate(local.getDate() - dow);
  return [
    local.getFullYear(),
    String(local.getMonth() + 1).padStart(2, "0"),
    String(local.getDate()).padStart(2, "0"),
  ].join("-");
}

/** ISO-Woche als "2026-W31" — Schlüssel für roster_publication. */
export function isoWeek(day: string): string {
  const d = toZonedTime(startOfViennaDay(day), TZ);
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dayNr = (target.getDay() + 6) % 7;
  target.setDate(target.getDate() - dayNr + 3); // Donnerstag der Woche
  const firstThursday = new Date(target.getFullYear(), 0, 4);
  const firstDayNr = (firstThursday.getDay() + 6) % 7;
  firstThursday.setDate(firstThursday.getDate() - firstDayNr + 3);
  const week =
    1 +
    Math.round(
      (target.getTime() - firstThursday.getTime()) / (7 * 24 * 3600 * 1000),
    );
  return `${target.getFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** Tag verschieben, in Wiener Kalendertagen. */
export function addDays(day: string, delta: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/**
 * Lokale Wanduhrzeit eines Wiener Tages als UTC-Instant.
 * "2026-07-30" + "07:30" -> 2026-07-30T05:30:00Z (Sommerzeit)
 */
export function viennaClock(day: string, hhmm: string): Date {
  return fromZonedTime(`${day}T${hhmm}:00`, TZ);
}

/** Minuten zwischen zwei Zeitpunkten, nie negativ. */
export function minutesBetween(from: Date | string, to: Date | string): number {
  const ms = new Date(to).getTime() - new Date(from).getTime();
  return Math.max(0, Math.round(ms / 60000));
}
