"use client";

import { useActionState } from "react";
import { LEER, Meldung, type AktionsStatus } from "@/components/ui/Formular";
import { num } from "@/lib/format";
import { vanstockRegel } from "./stammdaten-actions";

export type RegelZeile = {
  lagerortId: string;
  fahrzeug: string;
  min: number;
  max: number | null;
  bestand: number;
};

/**
 * Min und Max je Fahrzeug.
 *
 * Das ist der halbe Sinn des Van-Stocks: nicht der Bestand interessiert,
 * sondern der Moment, in dem er nicht mehr reicht. Fällt der
 * Fahrzeugbestand unter min, erscheint der Artikel automatisch auf der
 * Nachfüll-Liste — beim Lager und morgens beim Monteur.
 */
export function Vanstock({
  artikelId,
  einheit,
  zeilen,
}: {
  artikelId: string;
  einheit: string;
  zeilen: RegelZeile[];
}) {
  const [status, speichern] = useActionState<AktionsStatus, FormData>(
    vanstockRegel,
    LEER,
  );

  return (
    <section className="rounded-[20px] bg-surface p-5 shadow-soft">
      <h2 className="text-[15px] font-semibold">Van-Stock je Fahrzeug</h2>
      <p className="mt-1 mb-3 text-[12.5px] text-muted">
        Unter der Mindestmenge erscheint der Artikel auf der Nachfüll-Liste.
        Die Sollmenge ist, worauf aufgefüllt wird.
      </p>

      <ul className="flex flex-col gap-[6px]">
        {zeilen.map((z) => (
          <li key={z.lagerortId}>
            <form
              action={speichern}
              className="flex flex-wrap items-center gap-2 rounded-card border border-line bg-panel px-3 py-[9px]"
            >
              <input type="hidden" name="artikelId" value={artikelId} />
              <input type="hidden" name="lagerortId" value={z.lagerortId} />

              <span className="min-w-[110px] flex-1">
                <span className="block text-[13.5px]">{z.fahrzeug}</span>
                <span className="num block text-[11px] text-faint">
                  {num(z.bestand)} {einheit} an Bord
                </span>
              </span>

              <label className="flex items-center gap-1 text-[11.5px] text-muted">
                min
                <input
                  name="min"
                  type="number"
                  step="0.001"
                  min="0"
                  defaultValue={z.min}
                  aria-label={`Mindestmenge ${z.fahrzeug}`}
                  className="num w-[80px] rounded-input border border-line bg-surface px-[9px] py-[6px] text-right text-[13px] outline-0 focus:border-accent"
                />
              </label>
              <label className="flex items-center gap-1 text-[11.5px] text-muted">
                soll
                <input
                  name="max"
                  type="number"
                  step="0.001"
                  min="0"
                  defaultValue={z.max ?? ""}
                  aria-label={`Sollmenge ${z.fahrzeug}`}
                  className="num w-[80px] rounded-input border border-line bg-surface px-[9px] py-[6px] text-right text-[13px] outline-0 focus:border-accent"
                />
              </label>

              <button
                type="submit"
                className="cursor-pointer rounded-pill border border-line bg-surface px-[12px] py-[6px] text-[12px] font-medium text-ink transition-colors hover:bg-sunk"
              >
                Setzen
              </button>
            </form>
          </li>
        ))}
      </ul>

      <Meldung status={status} />
    </section>
  );
}
