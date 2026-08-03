import { PHASEN, phaseIndex, type Phase } from "@/lib/vorgang/modell";

/**
 * Der Phasen-Stepper im Kopf.
 *
 * Sechs Stufen, genau eine aktiv. Erledigte tragen einen Haken, die
 * aktuelle die Erklärzeile, die kommenden einen Strich — man soll auf
 * einen Blick sehen, wo der Vorgang steht, ohne eine Legende zu lesen.
 *
 * Anzeige, kein Bedienelement: gewechselt wird über die Aktionen im
 * Panel. Ein Stepper, an dem man klicken kann, ist ein Dropdown mit
 * anderer Optik — und dann steht ein Vorgang in Montage, ohne dass je
 * ein Angebot existiert hat.
 */
export function Stepper({ phase }: { phase: Phase }) {
  const aktuell = phaseIndex(phase);
  const verloren = phase === "verloren";

  return (
    <ol className="flex flex-wrap gap-[6px]" aria-label="Phasen">
      {PHASEN.map((p, i) => {
        const erledigt = !verloren && i < aktuell;
        const ist = !verloren && i === aktuell;

        return (
          <li
            key={p.key}
            aria-current={ist ? "step" : undefined}
            className={[
              "flex items-center gap-2 rounded-pill px-[11px] py-[7px] text-[12.5px]",
              ist
                ? "bg-accent-sunk font-semibold text-accent-ink"
                : erledigt
                  ? "bg-sunk text-muted"
                  : "bg-panel text-faint",
            ].join(" ")}
          >
            <span
              aria-hidden
              className={[
                "num grid h-[18px] w-[18px] shrink-0 place-items-center rounded-pill text-[10px] font-bold",
                ist
                  ? "bg-accent text-white"
                  : erledigt
                    ? "bg-s-done text-white"
                    : "bg-line text-faint",
              ].join(" ")}
            >
              {erledigt ? "✓" : i + 1}
            </span>
            <span>
              {p.label}
              <span className="ml-[6px] text-[11px] font-normal opacity-70">
                {ist ? p.meta : erledigt ? "erledigt" : "—"}
              </span>
            </span>
          </li>
        );
      })}

      {verloren ? (
        <li className="flex items-center gap-2 rounded-pill bg-s-crit/12 px-[11px] py-[7px] text-[12.5px] font-semibold text-s-crit">
          Verloren
        </li>
      ) : null}
    </ol>
  );
}
