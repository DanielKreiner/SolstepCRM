import type { ReactNode } from "react";

/** Kennzahl-Kachel. Maße aus dem Mockup: Panel, 14px Radius, Wert in Mono. */
export function Stat({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: ReactNode;
  // exactOptionalPropertyTypes ist an: optionale Props, die ein Aufrufer
  // rechnerisch auf undefined setzen kann, müssen das auch zulassen.
  tone?: "done" | "warn" | "crit" | "doing" | undefined;
  hint?: string | undefined;
}) {
  const color =
    tone === "done"
      ? "text-s-done"
      : tone === "warn"
        ? "text-accent-ink"
        : tone === "crit"
          ? "text-s-crit"
          : tone === "doing"
            ? "text-s-doing"
            : "text-ink";

  return (
    <div className="rounded-input bg-panel px-[14px] py-3">
      <div className="text-[11.5px] text-muted">{label}</div>
      <div className={`num mt-[2px] text-[18px] font-semibold ${color}`}>
        {value}
      </div>
      {hint ? <div className="mt-[2px] text-[11px] text-faint">{hint}</div> : null}
    </div>
  );
}

/**
 * Fortschrittsring über conic-gradient — bewusst CSS statt Recharts
 * (CLAUDE.md Abschnitt 1: "Ringe via conic-gradient in CSS, nicht Recharts").
 */
export function RingStat({
  label,
  percent,
  center,
  tone = "accent",
}: {
  label: string;
  percent: number;
  center: string;
  tone?: "accent" | "done" | "crit";
}) {
  const p = Math.max(0, Math.min(100, Math.round(percent)));
  const stroke =
    tone === "done"
      ? "var(--s-done)"
      : tone === "crit"
        ? "var(--s-crit)"
        : "var(--accent)";

  return (
    <div className="flex items-center gap-3">
      <div
        role="img"
        aria-label={`${label}: ${p} Prozent`}
        className="grid h-[54px] w-[54px] shrink-0 place-items-center rounded-pill"
        style={{
          background: `conic-gradient(${stroke} ${p * 3.6}deg, var(--sunk) 0)`,
        }}
      >
        <span className="num grid h-[42px] w-[42px] place-items-center rounded-pill bg-surface text-[12px] font-semibold">
          {center}
        </span>
      </div>
      <span className="text-[12.5px] text-muted">{label}</span>
    </div>
  );
}
