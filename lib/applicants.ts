/*
 * Bewerberstufen.
 *
 * Bewusst NICHT in der Server-Action-Datei: eine Datei mit "use server" darf
 * ausschließlich async Funktionen exportieren. Eine Konstante dort lässt die
 * Seite zur Laufzeit mit "invalid use server value" abstürzen — der Build
 * meldet es nicht.
 */
export const STUFEN = [
  "neu",
  "sichtung",
  "telefonat",
  "gespraech",
  "probearbeit",
  "zusage",
  "abgelehnt",
] as const;

export type Stufe = (typeof STUFEN)[number];

export const STUFE_LABEL: Record<Stufe, string> = {
  neu: "Neu",
  sichtung: "Sichtung",
  telefonat: "Telefonat",
  gespraech: "Gespräch",
  probearbeit: "Probearbeit",
  zusage: "Zusage",
  abgelehnt: "Abgelehnt",
};
