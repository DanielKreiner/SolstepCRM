"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ticketPhaseSetzen } from "@/app/(app)/service/actions";

/**
 * Phasenwechsel ausserhalb des Boards.
 *
 * Auf dem Board zieht man Karten. Auf der Detailseite geht das nicht, und
 * bisher musste man dafür zurück ins Board wechseln — genau die Reibung,
 * wegen der Phasen dann tagelang falsch stehen. Hier steht der Weg als
 * Leiste: die aktuelle Phase hervorgehoben, ein Klick auf die nächste
 * schiebt weiter.
 *
 * Übrig ist die Leiste nur noch für Service-Tickets: Vertrieb und
 * Projekte laufen über den Vorgang, dessen Phasen ein Enum sind und
 * eigene Regeln tragen (lib/vorgang/modell.ts).
 */
export type Phase = {
  id: string;
  label: string;
  systemKey: string | null;
};

export function PhasenWechsel({
  cardId,
  phasen,
  aktuelleId,
  gesperrt = false,
}: {
  /** ID des Service-Tickets */
  cardId: string;
  phasen: Phase[];
  aktuelleId: string | null;
  gesperrt?: boolean;
}) {
  const router = useRouter();
  const [laeuft, starte] = useTransition();
  const [fehler, setFehler] = useState<string | null>(null);
  /* Optimistisch, damit die Leiste nicht erst nach dem Serverlauf springt. */
  const [gezeigt, setGezeigt] = useState(aktuelleId);

  const aktuellerIndex = phasen.findIndex((p) => p.id === gezeigt);

  function wechsle(phaseId: string) {
    if (gesperrt || phaseId === gezeigt) return;
    const vorher = gezeigt;
    setFehler(null);
    setGezeigt(phaseId);

    starte(async () => {
      const ergebnis = await ticketPhaseSetzen(cardId, phaseId);
      if (!ergebnis.ok) {
        setGezeigt(vorher);
        setFehler(ergebnis.error ?? "Der Wechsel hat nicht geklappt.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <section className="rounded-[20px] bg-surface p-5 shadow-soft">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[15px] font-semibold">Phase</h2>
        {laeuft ? (
          <span className="text-[11.5px] text-faint">wird gespeichert …</span>
        ) : null}
      </div>

      <ol className="flex flex-wrap gap-[6px]">
        {phasen.map((p, i) => {
          const ist = p.id === gezeigt;
          const erledigt = aktuellerIndex >= 0 && i < aktuellerIndex;
          return (
            <li key={p.id}>
              <button
                type="button"
                disabled={gesperrt || laeuft}
                aria-current={ist ? "step" : undefined}
                onClick={() => wechsle(p.id)}
                className={[
                  "rounded-pill px-[13px] py-[8px] text-[12.5px] font-medium transition-colors duration-200",
                  ist
                    ? "bg-ink text-app"
                    : erledigt
                      ? "bg-s-done/12 text-s-done"
                      : "bg-sunk text-muted",
                  gesperrt || laeuft
                    ? "cursor-not-allowed opacity-70"
                    : "cursor-pointer hover:text-ink",
                ].join(" ")}
              >
                {p.label}
              </button>
            </li>
          );
        })}
      </ol>

      {fehler ? (
        <p role="alert" className="mt-3 text-[12.5px] font-medium text-s-crit">
          {fehler}
        </p>
      ) : null}

      {gesperrt ? (
        <p className="mt-3 text-[11.5px] text-faint">
          Für Phasenwechsel fehlt deiner Rolle das Schreibrecht.
        </p>
      ) : null}
    </section>
  );
}
