"use client";

import { useActionState } from "react";
import { LEER, Meldung, type AktionsStatus } from "@/components/ui/Formular";
import { Pill } from "@/components/ui/Pill";
import { date, num } from "@/lib/format";
import { wareneingangErfassen } from "@/app/(app)/bestellungen/actions";

export type LieferZeile = {
  positionId: string;
  bezeichnung: string;
  offen: number;
  einheit: string;
};

export type Lieferung = {
  bestellungId: string;
  nummer: string | null;
  lieferant: string;
  vorgangNummer: string;
  termin: string | null;
  zeilen: LieferZeile[];
};

/**
 * Direktlieferung auf die Baustelle bestätigen.
 *
 * Wer davorsteht, weiss als Einziger, was tatsächlich abgeladen wurde.
 * Die Bestätigung bucht die Ware direkt auf den Vorgang — sie sieht kein
 * Regal und kostet sofort, weil sie genau das getan hat.
 */
export function Baustellenlieferung({
  lieferungen,
  touch,
}: {
  lieferungen: Lieferung[];
  touch: boolean;
}) {
  const [status, bestaetigen] = useActionState<AktionsStatus, FormData>(
    wareneingangErfassen,
    LEER,
  );

  /*
   * Nach der letzten Bestätigung ist die Liste leer — der Abschnitt
   * bleibt trotzdem stehen, bis er seine Rückmeldung gezeigt hat.
   * Sonst verschwindet er im selben Moment, in dem er Erfolg hat.
   */
  if (lieferungen.length === 0 && !status.ok && !status.error) return null;

  return (
    <section className="rounded-[20px] bg-surface p-5 shadow-soft">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <h2 className="text-[15px] font-semibold">Lieferung auf die Baustelle</h2>
        <Pill tone="waiting">{lieferungen.length}</Pill>
      </div>
      <p className="mb-3 text-[12.5px] text-muted">
        Bestätigen, was abgeladen wurde. Nur die Menge eintragen, die
        tatsächlich da ist.
      </p>

      <div className="flex flex-col gap-4">
        {lieferungen.map((l) => (
          <form key={l.bestellungId} action={bestaetigen} className="flex flex-col gap-2">
            <input type="hidden" name="bestellungId" value={l.bestellungId} />

            <p className="text-[12px] font-semibold text-muted">
              {l.nummer} · {l.lieferant} · für {l.vorgangNummer}
              {l.termin ? ` · angekündigt ${date(l.termin)}` : ""}
            </p>

            {l.zeilen.map((z) => (
              <label
                key={z.positionId}
                className="flex flex-wrap items-center gap-3 rounded-card border border-line bg-panel px-3 py-[10px]"
              >
                <span className="min-w-[140px] flex-1 truncate text-[13.5px]">
                  {z.bezeichnung}
                </span>
                <span className="num text-[11.5px] text-faint">
                  angekündigt {num(z.offen)} {z.einheit}
                </span>
                <input
                  name={`menge:${z.positionId}`}
                  type="number"
                  step="0.001"
                  min="0"
                  inputMode="decimal"
                  placeholder="0"
                  aria-label={`Angekommen ${z.bezeichnung}`}
                  className={`num w-[110px] rounded-input border border-line bg-surface px-[11px] text-right outline-0 focus:border-accent ${
                    touch ? "min-h-[48px] text-[16px]" : "py-[7px] text-[13px]"
                  }`}
                />
              </label>
            ))}

            <button
              type="submit"
              className={`cursor-pointer rounded-pill border-0 bg-[linear-gradient(150deg,var(--accent-from),var(--accent-to))] font-semibold text-white ${
                touch ? "min-h-[56px] text-[16px]" : "min-h-[40px] text-[13px]"
              }`}
            >
              Abgeladen bestätigen
            </button>
          </form>
        ))}
      </div>

      <Meldung status={status} />
    </section>
  );
}
