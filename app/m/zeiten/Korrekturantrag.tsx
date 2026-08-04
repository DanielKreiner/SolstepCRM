"use client";

import { useActionState, useState } from "react";
import { LEER, Meldung, type AktionsStatus } from "@/components/ui/Formular";
import { korrekturBeantragen } from "./actions";

/**
 * „Da stimmt was nicht."
 *
 * Der Mitarbeiter ändert nichts selbst — er sagt, wie es richtig wäre.
 * Eine Zeit, die sich still ändern lässt, ist als Nachweis wertlos.
 */
export function Korrekturantrag({
  entryId,
  vonVorgabe,
  bisVorgabe,
  laeuftAntrag,
}: {
  entryId: string;
  vonVorgabe: string;
  bisVorgabe: string;
  laeuftAntrag: boolean;
}) {
  const [status, beantragen] = useActionState<AktionsStatus, FormData>(
    korrekturBeantragen,
    LEER,
  );
  const [offen, setOffen] = useState(false);

  if (laeuftAntrag) {
    return (
      <span className="text-[12px] text-accent-ink">Antrag läuft</span>
    );
  }

  if (!offen) {
    return (
      <button
        type="button"
        data-testid={`korrektur-oeffnen-${entryId}`}
        onClick={() => setOffen(true)}
        className="min-h-[40px] cursor-pointer rounded-pill border border-line bg-surface px-[14px] text-[12.5px] font-medium text-ink"
      >
        Stimmt nicht
      </button>
    );
  }

  return (
    <form action={beantragen} className="mt-2 flex w-full flex-col gap-2">
      <input type="hidden" name="entryId" value={entryId} />

      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-[4px]">
          <span className="text-[11px] text-muted">Von</span>
          <input
            name="von"
            type="time"
            defaultValue={vonVorgabe}
            data-testid={`korrektur-von-${entryId}`}
            className="num min-h-[48px] w-full rounded-input border border-line bg-surface px-[11px] text-[15px] outline-0 focus:border-accent"
          />
        </label>
        <label className="flex flex-col gap-[4px]">
          <span className="text-[11px] text-muted">Bis</span>
          <input
            name="bis"
            type="time"
            defaultValue={bisVorgabe}
            data-testid={`korrektur-bis-${entryId}`}
            className="num min-h-[48px] w-full rounded-input border border-line bg-surface px-[11px] text-[15px] outline-0 focus:border-accent"
          />
        </label>
      </div>

      <input
        name="grund"
        placeholder="Was stimmt nicht?"
        data-testid={`korrektur-grund-${entryId}`}
        className="min-h-[48px] w-full rounded-input border border-line bg-surface px-[13px] text-[15px] outline-0 focus:border-accent"
      />

      <div className="flex gap-2">
        <button
          type="submit"
          data-testid={`korrektur-senden-${entryId}`}
          className="min-h-[48px] flex-1 cursor-pointer rounded-pill border-0 bg-[linear-gradient(150deg,var(--accent-from),var(--accent-to))] text-[15px] font-semibold text-white"
        >
          Antrag senden
        </button>
        <button
          type="button"
          onClick={() => setOffen(false)}
          className="min-h-[48px] cursor-pointer rounded-pill border border-line bg-surface px-4 text-[14px] text-ink"
        >
          Abbrechen
        </button>
      </div>

      <Meldung status={status} />
    </form>
  );
}
