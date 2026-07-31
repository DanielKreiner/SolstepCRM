import type { ReactNode } from "react";

/*
 * Die Standardkarte mit Ueberschrift, wie sie in der Vorlage auf jedem
 * Screen mehrfach vorkommt: Titel links, Zaehler oder Aktion rechts,
 * darunter der Inhalt.
 *
 * Bisher stand dieser Aufbau in jeder Seite noch einmal ausgeschrieben.
 * Das ist die Stelle, an der Abstaende und Radien auseinanderlaufen.
 */

export function Abschnitt({
  titel,
  rechts,
  children,
  className = "",
  /* Listen sitzen buendig an der Kartenkante, Fliesstext braucht Rand. */
  dicht = false,
}: {
  titel?: ReactNode;
  rechts?: ReactNode;
  children: ReactNode;
  className?: string;
  dicht?: boolean;
}) {
  return (
    <section
      className={`rounded-[20px] bg-surface shadow-soft ${dicht ? "px-5 py-[18px]" : "p-5"} ${className}`}
    >
      {titel || rechts ? (
        <div className="mb-3 flex min-h-[26px] items-center justify-between gap-3">
          {typeof titel === "string" ? (
            <h2 className="text-[15px] font-semibold">{titel}</h2>
          ) : (
            titel
          )}
          {rechts}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/** Der Zaehler rechts neben einer Abschnittsueberschrift. */
export function Zaehler({ children }: { children: ReactNode }) {
  return (
    <span className="num rounded-pill bg-sunk px-[9px] py-[3px] text-[11px] text-muted">
      {children}
    </span>
  );
}

/**
 * Dunkle Karte. In der Vorlage traegt sie die laufende Zeit — die einzige
 * Flaeche im hellen Layout, die dunkel ist, und genau deshalb sieht man von
 * ueberall, dass gerade jemand auf der Uhr steht.
 *
 * Sparsam einsetzen: zwei dunkle Karten auf einem Screen heben sich
 * gegenseitig auf.
 */
export function DunkleKarte({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-[20px] bg-[#151210] px-5 py-[18px] text-white shadow-soft ${className}`}
    >
      {children}
    </section>
  );
}
