/*
 * Grosser Fortschrittsring. In der Vorlage steht er dreifach im
 * Auftragsdetail (Stunden ist/soll, Material ist/kalkuliert,
 * Deckungsbeitrag) und einfach im Cockpit als Pipeline-Fortschritt.
 *
 * conic-gradient statt SVG oder Chartbibliothek — CLAUDE.md Abschnitt 1.
 *
 * Die Farbe traegt keine Information allein: unter dem Ring steht immer der
 * Klartext ("42 von 56 h"), und der Prozentwert steht in der Mitte. Ein
 * Nutzer mit Rotsehschwaeche verliert nichts.
 */

export type RingTon = "accent" | "doing" | "done" | "kritisch";

const FARBE: Record<RingTon, string> = {
  accent: "var(--accent)",
  doing: "var(--s-doing)",
  done: "var(--s-done)",
  kritisch: "var(--s-crit)",
};

export function Ring({
  prozent,
  ton = "accent",
  size = 92,
  dicke = 9,
  label,
}: {
  prozent: number;
  ton?: RingTon;
  size?: number;
  dicke?: number;
  /** Fuer Screenreader. Sichtbar steht der Text daneben oder darunter. */
  label: string;
}) {
  /*
   * Der Ring wird bei 100 % gekappt, der Wert daneben nicht. Ein
   * ueberzeichneter Auftrag zeigt "134 %" im Text und einen vollen Ring —
   * ein Ring, der sich weiterdreht, waere schlicht falsch abzulesen.
   */
  const gefuellt = Math.max(0, Math.min(100, prozent));

  return (
    <div
      role="img"
      aria-label={`${label}: ${Math.round(prozent)} Prozent`}
      className="grid shrink-0 place-items-center rounded-pill"
      style={{
        width: size,
        height: size,
        background: `conic-gradient(${FARBE[ton]} ${gefuellt * 3.6}deg, var(--sunk) 0)`,
      }}
    >
      <span
        className="num grid place-items-center rounded-pill bg-surface font-semibold"
        style={{
          width: size - dicke * 2,
          height: size - dicke * 2,
          fontSize: Math.round(size * 0.19),
        }}
      >
        {Math.round(prozent)} %
      </span>
    </div>
  );
}

/** Ring mit Ueberschrift und Klartextzeile — die Kachel aus dem Auftragsdetail. */
export function RingKarte({
  titel,
  prozent,
  ton = "accent",
  fuss,
}: {
  titel: string;
  prozent: number;
  ton?: RingTon;
  fuss: string;
}) {
  return (
    <div className="rounded-[20px] bg-surface px-5 py-[18px] shadow-soft">
      <div className="text-[12.5px] text-muted">{titel}</div>
      <div className="mt-3 flex justify-center">
        <Ring prozent={prozent} ton={ton} label={titel} />
      </div>
      <div className="num mt-3 text-center text-[11.5px] text-faint">{fuss}</div>
    </div>
  );
}
