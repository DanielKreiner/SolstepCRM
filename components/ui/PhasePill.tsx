import { Pill, type Tone } from "./Pill";

/*
 * Die Farbe hängt an pipeline_phase.system_key, niemals am Label.
 * Ein Betrieb, der "In Montage" in "Auf der Baustelle" umbenennt, behält
 * dieselbe Darstellung — CLAUDE.md Abschnitt 5.1a.
 */
const BY_SYSTEM_KEY: Record<string, Tone> = {
  won: "done",
  lost: "crit",
  in_execution: "doing",
  ready_to_invoice: "warn",
  closed: "done",
};

export function PhasePill({
  label,
  systemKey,
}: {
  label: string;
  systemKey: string | null;
}) {
  const tone = systemKey ? (BY_SYSTEM_KEY[systemKey] ?? "new") : "new";
  return <Pill tone={tone}>{label}</Pill>;
}
