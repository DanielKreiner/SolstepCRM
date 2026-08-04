"use client";

import { useActionState, useState } from "react";
import { LEER, Meldung, type AktionsStatus } from "@/components/ui/Formular";
import { Pill } from "@/components/ui/Pill";
import { dateTime, time } from "@/lib/format";
import type { Antrag } from "./page";
import { antragEntscheiden, nacherfassen, wocheGenehmigen } from "./actions";

/**
 * Nacherfassung für vergessenes Stempeln.
 *
 * Der Einsatz ist Pflicht — deshalb steht hier eine Liste des Tages und
 * kein freies Feld. Ohne Einsatz gehört die Zeit niemandem, und die Art
 * müsste jemand raten.
 */
export function Nacherfassen({
  tag,
  personen,
  einsaetze,
}: {
  tag: string;
  personen: { id: string; name: string }[];
  einsaetze: { id: string; label: string }[];
}) {
  const [status, erfassen] = useActionState<AktionsStatus, FormData>(
    nacherfassen,
    LEER,
  );

  return (
    <section className="rounded-[20px] bg-surface p-5 shadow-soft">
      <h2 className="text-[15px] font-semibold">Zeit nachtragen</h2>
      <p className="mt-1 mb-3 text-[12.5px] text-muted">
        Für vergessenes Stempeln. Such den Einsatz, auf dem gearbeitet wurde.
      </p>

      <form action={erfassen} className="flex flex-col gap-3">
        <input type="hidden" name="tag" value={tag} />

        <label className="flex flex-col gap-[5px]">
          <span className="text-[12px] font-medium text-muted">Person</span>
          <select
            name="userId"
            data-testid="nacherfassen-person"
            required
            className="w-full cursor-pointer rounded-input border border-line bg-surface px-[13px] py-[10px] text-[13.5px] outline-0 focus:border-accent"
          >
            {personen.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-[5px]">
          <span className="text-[12px] font-medium text-muted">Einsatz</span>
          <select
            name="einsatzId"
            data-testid="nacherfassen-einsatz"
            required
            className="w-full cursor-pointer rounded-input border border-line bg-surface px-[13px] py-[10px] text-[13.5px] outline-0 focus:border-accent"
          >
            <option value="">— wählen —</option>
            {einsaetze.map((e) => (
              <option key={e.id} value={e.id}>
                {e.label}
              </option>
            ))}
          </select>
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-[5px]">
            <span className="text-[12px] font-medium text-muted">Von</span>
            <input
              name="von"
              type="time"
              data-testid="nacherfassen-von"
              required
              className="num w-full rounded-input border border-line bg-surface px-[13px] py-[10px] text-[13.5px] outline-0 focus:border-accent"
            />
          </label>
          <label className="flex flex-col gap-[5px]">
            <span className="text-[12px] font-medium text-muted">Bis</span>
            <input
              name="bis"
              type="time"
              data-testid="nacherfassen-bis"
              required
              className="num w-full rounded-input border border-line bg-surface px-[13px] py-[10px] text-[13.5px] outline-0 focus:border-accent"
            />
          </label>
        </div>

        <button
          type="submit"
          data-testid="nacherfassen-speichern"
          className="min-h-[40px] cursor-pointer rounded-pill border-0 bg-[linear-gradient(150deg,var(--accent-from),var(--accent-to))] px-[20px] text-[13px] font-semibold text-white"
        >
          Nachtragen
        </button>

        <Meldung status={status} />
      </form>
    </section>
  );
}

/**
 * Der Wochenabschluss.
 *
 * Erst genehmigte Zeiten zählen in den Saldo — der Abschluss ist der
 * Moment, in dem jemand hinsieht.
 */
export function Wochenabschluss({
  userId,
  montag,
  offen,
}: {
  userId: string;
  montag: string;
  offen: number;
}) {
  const [status, genehmigen] = useActionState<AktionsStatus, FormData>(
    wocheGenehmigen,
    LEER,
  );

  if (offen === 0) {
    return <span className="text-[11.5px] text-s-done">genehmigt</span>;
  }

  return (
    <form action={genehmigen}>
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="montag" value={montag} />
      <button
        type="submit"
        data-testid={`woche-genehmigen-${userId}`}
        className="cursor-pointer rounded-pill border border-line bg-surface px-[12px] py-[6px] text-[11.5px] font-medium text-ink transition-colors hover:bg-sunk"
      >
        {offen} genehmigen
      </button>
      <Meldung status={status} />
    </form>
  );
}

/**
 * Offene Korrekturanträge.
 *
 * Genehmigen führt die Korrektur wirklich durch: die alte Zeit bleibt
 * als ersetzt stehen, die neue verweist auf sie.
 */
export function Korrekturen({
  antraege,
  darfSchreiben,
}: {
  antraege: Antrag[];
  darfSchreiben: boolean;
}) {
  const [status, entscheiden] = useActionState<AktionsStatus, FormData>(
    antragEntscheiden,
    LEER,
  );
  const [offenerAntrag, setOffenerAntrag] = useState<string | null>(null);

  return (
    <section className="rounded-[20px] bg-surface p-5 shadow-soft">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="text-[15px] font-semibold">Korrekturanträge</h2>
        <Pill tone="warn">{antraege.length}</Pill>
      </div>

      <Meldung status={status} />

      <ul className="flex flex-col gap-[6px]">
        {antraege.map((a) => (
          <li
            key={a.id}
            className="rounded-card border border-line bg-panel px-3 py-[10px]"
          >
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="text-[13.5px] font-semibold">{a.person}</span>
              <span className="num text-[12px] text-muted">
                {a.vonAlt ? dateTime(a.vonAlt) : "—"}
                {a.bisAlt ? `–${time(a.bisAlt)}` : ""}
              </span>
            </div>
            <p className="mt-1 text-[12.5px] text-muted">{a.grund}</p>
            {a.vonNeu && a.bisNeu ? (
              <p className="num mt-1 text-[12.5px]">
                Neu: {a.vonNeu}–{a.bisNeu}
              </p>
            ) : null}

            {darfSchreiben ? (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <form action={entscheiden}>
                  <input type="hidden" name="antragId" value={a.id} />
                  <input type="hidden" name="entscheidung" value="genehmigen" />
                  <button
                    type="submit"
                    data-testid={`antrag-genehmigen-${a.id}`}
                    className="cursor-pointer rounded-pill border-0 bg-[linear-gradient(150deg,var(--accent-from),var(--accent-to))] px-[14px] py-[7px] text-[12.5px] font-semibold text-white"
                  >
                    Genehmigen
                  </button>
                </form>
                <button
                  type="button"
                  onClick={() =>
                    setOffenerAntrag(offenerAntrag === a.id ? null : a.id)
                  }
                  className="cursor-pointer rounded-pill border border-line bg-surface px-[14px] py-[7px] text-[12.5px] font-medium text-ink"
                >
                  Ablehnen
                </button>

                {offenerAntrag === a.id ? (
                  <form action={entscheiden} className="flex w-full gap-2">
                    <input type="hidden" name="antragId" value={a.id} />
                    <input type="hidden" name="entscheidung" value="ablehnen" />
                    <input
                      name="kommentar"
                      placeholder="Warum nicht?"
                      className="min-w-0 flex-1 rounded-input border border-line bg-surface px-[11px] py-[7px] text-[12.5px] outline-0 focus:border-accent"
                    />
                    <button
                      type="submit"
                      data-testid={`antrag-ablehnen-${a.id}`}
                      className="cursor-pointer rounded-pill border border-line bg-surface px-[14px] py-[7px] text-[12.5px] font-medium text-s-crit"
                    >
                      Ablehnen
                    </button>
                  </form>
                ) : null}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
