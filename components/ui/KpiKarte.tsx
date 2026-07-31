import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "@/components/ui/Icon";

/*
 * Die grosse Kennzahlkarte aus der Vorlage (export/solstep-betrieb.html,
 * Cockpit-Kopfreihe). Nicht zu verwechseln mit <Stat> — das ist die kleine
 * Kachel fuer Nebenangaben innerhalb einer Karte.
 *
 * Aufbau von oben nach unten: Bezeichnung, grosse Zahl in Mono, darunter
 * eine Pille mit dem Vergleichswert und ein Klartextsatz, der die Pille
 * einordnet. Die Pille allein sagt nichts — "+12 %" ohne "gegen Vormonat"
 * ist eine Zahl ohne Bezug.
 *
 * Die erste Karte einer Reihe ist die Akzentkarte (SPEC 4.1). Genau eine,
 * nicht mehr: Abschnitt 9 der Vorlage begrenzt Akzentelemente auf drei je
 * Screen, und Chart, Ring und Timerkarte brauchen ihren Anteil.
 */

export type KpiTon = "neutral" | "gut" | "warn" | "kritisch";

export function KpiKarte({
  label,
  wert,
  pille,
  ton = "neutral",
  notiz,
  href,
  akzent = false,
}: {
  label: string;
  wert: ReactNode;
  pille?: ReactNode;
  ton?: KpiTon;
  notiz?: ReactNode;
  /** Sprungziel. Setzt zugleich den Pfeilknopf oben rechts. */
  href?: string;
  akzent?: boolean;
}) {
  const pillenFarbe = akzent
    ? "bg-white/20 text-white"
    : ton === "gut"
      ? "bg-s-done/12 text-s-done"
      : ton === "warn"
        ? "bg-accent/14 text-accent-ink"
        : ton === "kritisch"
          ? "bg-s-crit/12 text-s-crit"
          : "bg-sunk text-muted";

  const inhalt = (
    <>
      <div className="flex items-start justify-between gap-3">
        <span
          className={[
            "text-[12.5px]",
            akzent ? "text-white/85" : "text-muted",
          ].join(" ")}
        >
          {label}
        </span>
        {href ? (
          <span
            aria-hidden
            className={[
              "grid h-[26px] w-[26px] shrink-0 place-items-center rounded-icon transition-colors duration-200 ease-out-quint",
              akzent
                ? "bg-white/20 text-white group-hover:bg-white/30"
                : "bg-panel text-faint group-hover:bg-sunk group-hover:text-ink",
            ].join(" ")}
          >
            <Icon name="pfeilRausOben" size={14} />
          </span>
        ) : null}
      </div>

      <div
        className={[
          "num mt-[10px] text-[32px] leading-[1.05] font-semibold tracking-[-0.03em]",
          akzent ? "text-white" : "text-ink",
        ].join(" ")}
      >
        {wert}
      </div>

      {pille || notiz ? (
        <div className="mt-[10px] flex flex-wrap items-center gap-2">
          {pille ? (
            <span
              className={`num rounded-pill px-[9px] py-[3px] text-[11px] font-semibold ${pillenFarbe}`}
            >
              {pille}
            </span>
          ) : null}
          {notiz ? (
            <span
              className={[
                "text-[11.5px]",
                akzent ? "text-white/80" : "text-faint",
              ].join(" ")}
            >
              {notiz}
            </span>
          ) : null}
        </div>
      ) : null}
    </>
  );

  const flaeche = [
    "group block rounded-[20px] px-5 py-[18px]",
    akzent
      ? "bg-[linear-gradient(150deg,var(--accent-from),var(--accent-to))] shadow-[0_8px_24px_rgba(201,121,24,0.26)]"
      : "bg-surface shadow-soft",
  ].join(" ");

  if (href) {
    return (
      <Link href={href} className={`${flaeche} text-inherit hover:text-inherit`}>
        {inhalt}
      </Link>
    );
  }

  return <div className={flaeche}>{inhalt}</div>;
}
