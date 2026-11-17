"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  nummernkreisSetzen,
  type NummernkreisState,
} from "./nummernkreis-actions";

const INITIAL: NummernkreisState = { error: null, ok: null };

export type KreisWerte = {
  kind: string;
  label: string;
  praefix: string;
  jahr: number;
  /** Zuletzt vergebene laufende Nummer. 0 = noch keine. */
  stand: number;
};

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="min-h-[38px] cursor-pointer rounded-pill bg-[linear-gradient(150deg,var(--accent-from),var(--accent-to))] px-[16px] text-[12.5px] font-semibold text-white disabled:opacity-50"
    >
      Übernehmen
    </button>
  );
}

function nummer(praefix: string, jahr: number, laufend: number): string {
  return `${praefix}-${jahr}-${String(laufend).padStart(4, "0")}`;
}

export function KreisForm({
  kreis,
  gesperrt,
}: {
  kreis: KreisWerte;
  gesperrt: boolean;
}) {
  const [state, formAction] = useActionState(nummernkreisSetzen, INITIAL);
  const naechste = kreis.stand + 1;

  return (
    <li className="rounded-input bg-panel px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="min-w-[150px] flex-1 text-[13.5px] font-semibold">
          {kreis.label}
        </span>

        <span className="num text-[12.5px] text-muted">
          {kreis.stand === 0
            ? "noch keine vergeben"
            : `${kreis.stand} vergeben, zuletzt ${nummer(kreis.praefix, kreis.jahr, kreis.stand)}`}
        </span>

        <span className="num rounded-pill bg-sunk px-[11px] py-[5px] text-[12.5px] font-medium">
          nächste {nummer(kreis.praefix, kreis.jahr, naechste)}
        </span>
      </div>

      {!gesperrt ? (
        <form action={formAction} className="mt-3 flex flex-wrap items-end gap-3">
          <input type="hidden" name="kind" value={kreis.kind} />
          <input type="hidden" name="jahr" value={kreis.jahr} />

          <label className="flex flex-col gap-[6px]">
            <span className="text-[12px] font-semibold text-muted">
              Nächste Nummer
            </span>
            <input
              name="naechste"
              type="number"
              /*
               * Absichtlich min=1 und nicht die nächste freie Nummer:
               * Mit einem engeren min blockt der Browser das Abschicken
               * und zeigt seinen eigenen Hinweis in seiner eigenen
               * Sprache. Die Absage vom Server ist deutsch und nennt die
               * nächste freie Nummer — die will man lesen.
               */
              min={1}
              max={999999}
              defaultValue={naechste}
              className="num w-[130px] rounded-input border border-transparent bg-sunk px-[11px] py-[7px] text-[13px] text-ink outline-0 focus:border-accent focus:bg-surface"
            />
          </label>

          <Submit />

          {state.error ? (
            <p
              role="alert"
              className="w-full rounded-input bg-s-crit/10 px-[11px] py-[8px] text-[12.5px] leading-[1.45] font-medium text-s-crit"
            >
              {state.error}
            </p>
          ) : null}
          {state.ok ? (
            <p
              role="status"
              className="w-full rounded-input bg-s-done/10 px-[11px] py-[8px] text-[12.5px] font-medium text-s-done"
            >
              {state.ok}
            </p>
          ) : null}
        </form>
      ) : null}
    </li>
  );
}
