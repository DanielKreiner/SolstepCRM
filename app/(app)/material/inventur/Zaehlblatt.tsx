"use client";

import { useActionState } from "react";
import { LEER, Meldung, type AktionsStatus } from "@/components/ui/Formular";
import { num } from "@/lib/format";
import { inventurErfassen } from "@/app/(app)/material/actions";

export type Zaehlzeile = {
  artikelId: string;
  sku: string;
  bezeichnung: string;
  einheit: string;
  soll: number;
};

/**
 * Das Zählblatt.
 *
 * Der Sollbestand steht daneben und nicht im Feld — wer ihn vorgefüllt
 * bekäme, tippt zehnmal Enter und hat nichts gezählt. Leer gelassene
 * Zeilen werden übersprungen; niemand muss den ganzen Bus zählen, um
 * eine Kabeltrommel zu korrigieren.
 */
export function Zaehlblatt({
  lagerortId,
  zeilen,
}: {
  lagerortId: string;
  zeilen: Zaehlzeile[];
}) {
  const [status, zaehlen] = useActionState<AktionsStatus, FormData>(
    inventurErfassen,
    LEER,
  );

  if (zeilen.length === 0) {
    return (
      <section className="rounded-[20px] bg-surface p-6 shadow-soft">
        <p className="text-[13px] text-muted">
          Für diesen Ort ist nichts geführt. Van-Stock-Artikel bekommen ihre
          Min- und Max-Mengen im Artikelstamm.
        </p>
      </section>
    );
  }

  return (
    <form action={zaehlen}>
      <input type="hidden" name="lagerortId" value={lagerortId} />

      <section className="rounded-[20px] bg-surface p-5 shadow-soft">
        <ul className="flex flex-col gap-[6px]">
          {zeilen.map((z) => (
            <li
              key={z.artikelId}
              className="flex flex-wrap items-center gap-3 rounded-card border border-line bg-panel px-3 py-[10px]"
            >
              <span className="min-w-[150px] flex-1">
                <span className="block truncate text-[13.5px]">
                  {z.bezeichnung}
                </span>
                <span className="num block text-[11px] text-faint">{z.sku}</span>
              </span>
              <span className="num text-[12px] text-muted">
                gebucht {num(z.soll)} {z.einheit}
              </span>
              <input
                name={`ist:${z.artikelId}`}
                type="number"
                step="0.001"
                min="0"
                placeholder="gezählt"
                aria-label={`Gezählt ${z.bezeichnung}`}
                className="num min-h-[44px] w-[110px] rounded-input border border-line bg-surface px-[11px] text-right text-[14px] outline-0 focus:border-accent"
              />
            </li>
          ))}
        </ul>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="submit"
            className="min-h-[44px] cursor-pointer rounded-pill border-0 bg-[linear-gradient(150deg,var(--accent-from),var(--accent-to))] px-[22px] text-[13.5px] font-semibold text-white"
          >
            Zählung buchen
          </button>
          <span className="text-[12px] text-faint">
            Leere Zeilen bleiben unverändert.
          </span>
        </div>

        <Meldung status={status} />
      </section>
    </form>
  );
}
