import type { ReactNode } from "react";

/*
 * Die fuenf Semantiken aus pipeline_phase.system_key plus die neutralen Zustaende.
 * Statusdarstellung immer Flaeche UND Text — nie Farbe allein (Abschnitt 9).
 * Das ist kein Stilthema: Rot-Gruen-Blindheit betrifft rund 8 % der Maenner,
 * und in dieser Zielgruppe sitzt der Bauleiter mit dem Tablet in der Sonne.
 */
export type Tone =
  | "new"
  | "doing"
  | "waiting"
  | "done"
  | "warn"
  | "crit"
  | "neutral";

const TONES: Record<Tone, string> = {
  new: "bg-s-new/12 text-s-new",
  doing: "bg-s-doing/12 text-s-doing",
  waiting: "bg-s-waiting/12 text-s-waiting",
  done: "bg-s-done/12 text-s-done",
  warn: "bg-s-warn/14 text-accent-ink",
  crit: "bg-s-crit/12 text-s-crit",
  neutral: "bg-sunk text-muted",
};

type Props = {
  tone?: Tone;
  children: ReactNode;
  /** Zahlen, Kuerzel und IDs in Mono setzen. */
  mono?: boolean;
  className?: string;
};

export function Pill({
  tone = "neutral",
  mono = false,
  children,
  className = "",
}: Props) {
  return (
    <span
      className={[
        "inline-flex items-center gap-1.5 rounded-pill px-[9px] py-[2.5px]",
        "text-[11.5px] font-semibold whitespace-nowrap",
        mono ? "num text-[10.5px]" : "",
        TONES[tone],
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </span>
  );
}
