/*
 * Die Punktarten einer Checkliste.
 *
 * Eigene Datei, weil beide Oberflächen sie brauchen — Einstellungen und
 * Vorgang — und die Server-Action-Dateien sie nicht exportieren dürfen:
 * ein "use server"-Modul gibt nur async-Funktionen heraus.
 */
export const CHECKLISTE_TYPEN = [
  ["haken", "Abhaken"],
  ["text", "Textangabe"],
  ["zahl", "Zahl"],
  ["foto", "Foto"],
  ["datei", "Datei"],
] as const;

export type ChecklisteTyp = (typeof CHECKLISTE_TYPEN)[number][0];
