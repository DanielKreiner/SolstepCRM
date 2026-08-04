"use client";

import { useActionState } from "react";
import { LEER, Meldung, type AktionsStatus } from "@/components/ui/Formular";
import { Pill } from "@/components/ui/Pill";
import { date } from "@/lib/format";
import { seriennummerErfassen } from "@/app/(app)/material/actions";

export type SerienAnsicht = {
  erfasst: { id: string; nummer: string; artikel: string; am: string }[];
  offen: { artikelId: string; bezeichnung: string; fehlen: number }[];
};

/**
 * Die Seriennummern der Anlage.
 *
 * Sie werden zweimal gebraucht und beide Male Jahre später: beim
 * Garantiefall und bei der Netzbetreibermeldung. Deshalb stehen sie am
 * Vorgang und nicht an einer Bewegung — und deshalb bleibt ein fehlender
 * Nachtrag sichtbar, statt still zu verschwinden.
 */
export function Seriennummern({
  vorgangId,
  stand,
  darfSchreiben,
}: {
  vorgangId: string;
  stand: SerienAnsicht;
  darfSchreiben: boolean;
}) {
  const [status, erfassen] = useActionState<AktionsStatus, FormData>(
    seriennummerErfassen,
    LEER,
  );

  if (stand.erfasst.length === 0 && stand.offen.length === 0) return null;

  return (
    <section className="rounded-[20px] bg-surface p-5 shadow-soft">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <h2 className="text-[15px] font-semibold">Seriennummern</h2>
        {stand.offen.length > 0 ? (
          <Pill tone="warn">
            {stand.offen.reduce((s, o) => s + o.fehlen, 0)} nachzutragen
          </Pill>
        ) : (
          <Pill tone="done">vollständig</Pill>
        )}
      </div>
      <p className="mb-3 text-[12.5px] text-muted">
        Für Garantie, Netzbetreibermeldung und Übergabeprotokoll.
      </p>

      {/*
        Die Rückmeldung steht über den Formularen: mit der letzten
        Nummer verschwindet der offene Posten — und nähme das Formular
        samt seiner eigenen Bestätigung mit.
      */}
      <Meldung status={status} />

      {stand.erfasst.length > 0 ? (
        <ul className="mb-3 flex flex-col gap-[5px]">
          {stand.erfasst.map((s) => (
            <li
              key={s.id}
              className="flex flex-wrap items-center gap-3 rounded-card border border-line bg-panel px-3 py-[9px]"
            >
              <span className="num text-[13px] font-semibold">{s.nummer}</span>
              <span className="min-w-0 flex-1 truncate text-[12.5px] text-muted">
                {s.artikel}
              </span>
              <span className="num text-[11px] text-faint">{date(s.am)}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {stand.offen.length > 0 && darfSchreiben ? (
        <div className="flex flex-col gap-2">
          {stand.offen.map((o) => (
            <form
              key={o.artikelId}
              action={erfassen}
              className="flex flex-wrap items-center gap-2"
            >
              <input type="hidden" name="vorgangId" value={vorgangId} />
              <input type="hidden" name="artikelId" value={o.artikelId} />
              <span className="min-w-[140px] flex-1 text-[12.5px]">
                {o.bezeichnung}
                <span className="text-faint"> · {o.fehlen} offen</span>
              </span>
              <input
                name="nummer"
                aria-label={`Seriennummer ${o.bezeichnung}`}
                placeholder="Seriennummer"
                className="num rounded-input border border-line bg-surface px-[11px] py-[7px] text-[13px] outline-0 focus:border-accent"
              />
              <button
                type="submit"
                className="cursor-pointer rounded-pill border border-line bg-surface px-[14px] py-[7px] text-[12.5px] font-medium text-ink transition-colors hover:bg-sunk"
              >
                Nachtragen
              </button>
            </form>
          ))}
        </div>
      ) : null}
    </section>
  );
}
