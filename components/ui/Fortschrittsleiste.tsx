/*
 * Fortschrittsleiste des Kundenportals (SPEC 5.1).
 *
 * Zeigt den ganzen Weg, nicht nur den Stand: der Kunde soll sehen, was noch
 * kommt. Erreichte Schritte tragen den Akzent, der aktuelle einen Ring,
 * kommende bleiben grau.
 *
 * Klartext ist Pflicht — die Beschriftungen kommen aus pipeline_phase.label,
 * das der Betrieb selbst pflegt. Keine internen Kürzel, kein system_key im
 * sichtbaren Text.
 */

export type Schritt = {
  label: string;
  /** Datum, an dem der Schritt erreicht wurde oder geplant ist. */
  datum?: string | null;
  zustand: "erledigt" | "aktuell" | "offen";
};

export function Fortschrittsleiste({ schritte }: { schritte: Schritt[] }) {
  if (schritte.length === 0) return null;

  return (
    <ol className="flex gap-1 overflow-x-auto pb-1">
      {schritte.map((s, i) => {
        const erledigt = s.zustand === "erledigt";
        const aktuell = s.zustand === "aktuell";

        return (
          <li key={`${s.label}-${i}`} className="min-w-[104px] flex-1">
            <div
              className={[
                "h-[6px] rounded-pill",
                erledigt
                  ? "bg-[linear-gradient(90deg,var(--accent-from),var(--accent-to))]"
                  : aktuell
                    ? "bg-accent/35"
                    : "bg-sunk",
              ].join(" ")}
            />
            <div
              className={[
                "mt-2 text-[12px] leading-snug",
                aktuell
                  ? "font-semibold text-ink"
                  : erledigt
                    ? "text-muted"
                    : "text-faint",
              ].join(" ")}
            >
              {s.label}
            </div>
            {s.datum ? (
              <div className="num mt-[2px] text-[10.5px] text-faint">
                {s.datum}
              </div>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
