"use client";

import { useActionState } from "react";
import { LEER, Meldung, type AktionsStatus } from "@/components/ui/Formular";
import { num } from "@/lib/format";
import { verbrauchMelden } from "@/app/(app)/material/actions";

export type VanArtikel = {
  artikelId: string;
  bezeichnung: string;
  einheit: string;
  bestand: number;
};

/**
 * Die Verbrauchsmeldung nach dem Ausstempeln.
 *
 * Van-Stock wird nicht beim Laden gebucht, sondern beim Verbrauchen —
 * beim Laden weiss niemand, wie viel Kabel dieser Tag frisst. Der
 * Moment danach ist der einzige, in dem die Antwort noch frisch ist:
 * einen Tag später rät auch der Monteur.
 *
 * Ein Handgriff, überspringbar. Ein Pflichtfeld hier würde dazu führen,
 * dass jemand irgendeine Zahl einträgt, und eine erfundene Zahl ist
 * schlechter als keine.
 */
export function Verbrauch({
  vorgangId,
  lagerortId,
  fahrzeug,
  artikel,
  einsatzId,
  schliessen,
}: {
  vorgangId: string;
  lagerortId: string;
  fahrzeug: string;
  artikel: VanArtikel[];
  einsatzId: string | null;
  schliessen: () => void;
}) {
  const [status, melden] = useActionState<AktionsStatus, FormData>(
    verbrauchMelden,
    LEER,
  );

  if (status.ok) {
    return (
      <section className="rounded-[20px] bg-surface p-5 shadow-soft">
        <p className="text-[13.5px]">{status.ok}</p>
        <button
          type="button"
          onClick={schliessen}
          className="mt-3 min-h-[48px] w-full cursor-pointer rounded-pill border border-line bg-surface text-[15px] font-semibold text-ink"
        >
          Fertig
        </button>
      </section>
    );
  }

  return (
    <section className="rounded-[20px] bg-surface p-5 shadow-soft">
      <h2 className="text-[16px] font-semibold">Was ist verbraucht worden?</h2>
      <p className="mt-1 mb-3 text-[13px] text-muted">
        Aus {fahrzeug}. Nur eintragen, was weg ist — der Rest bleibt im Bus.
      </p>

      <form action={melden} className="flex flex-col gap-2">
        <input type="hidden" name="vorgangId" value={vorgangId} />
        <input type="hidden" name="lagerortId" value={lagerortId} />
        {einsatzId ? (
          <input type="hidden" name="einsatzId" value={einsatzId} />
        ) : null}

        {artikel.map((a) => (
          <label
            key={a.artikelId}
            className="flex flex-wrap items-center gap-3 rounded-card border border-line bg-panel px-3 py-[10px]"
          >
            <span className="min-w-[130px] flex-1">
              <span className="block truncate text-[14px]">{a.bezeichnung}</span>
              <span className="num block text-[11px] text-faint">
                {num(a.bestand)} {a.einheit} im Bus
              </span>
            </span>
            <input
              name={`menge:${a.artikelId}`}
              type="number"
              step="0.001"
              min="0"
              inputMode="decimal"
              placeholder="0"
              aria-label={`Verbraucht ${a.bezeichnung}`}
              className="num min-h-[48px] w-[110px] rounded-input border border-line bg-surface px-[11px] text-right text-[16px] outline-0 focus:border-accent"
            />
          </label>
        ))}

        <button
          type="submit"
          className="mt-2 min-h-[56px] cursor-pointer rounded-pill border-0 bg-[linear-gradient(150deg,var(--accent-from),var(--accent-to))] text-[16px] font-semibold text-white"
        >
          Melden
        </button>
        <button
          type="button"
          onClick={schliessen}
          className="min-h-[48px] cursor-pointer rounded-pill border border-line bg-surface text-[14px] font-medium text-ink"
        >
          Kein Verbrauch
        </button>

        <Meldung status={status} />
      </form>
    </section>
  );
}
