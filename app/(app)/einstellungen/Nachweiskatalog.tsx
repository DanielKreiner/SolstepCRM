"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  nachweisAnlegen,
  nachweisEntfernen,
  nachweisSpeichern,
  type NachweisState,
} from "./nachweis-actions";

const INITIAL: NachweisState = { error: null, ok: null };

const feld =
  "rounded-input border border-transparent bg-sunk px-[11px] py-[7px] text-[13px] text-ink outline-0 focus:border-accent focus:bg-surface";

export type NachweisWerte = {
  id: string;
  schluessel: string;
  label: string;
  nachweis: boolean;
  traeger: number;
};

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="min-h-[38px] cursor-pointer rounded-pill bg-[linear-gradient(150deg,var(--accent-from),var(--accent-to))] px-[16px] text-[12.5px] font-semibold text-white disabled:opacity-50"
    >
      {label}
    </button>
  );
}

function Meldung({ state }: { state: NachweisState }) {
  if (!state.error && !state.ok) return null;
  return (
    <p
      role={state.error ? "alert" : "status"}
      className={`mt-[9px] w-full rounded-input px-[11px] py-[8px] text-[12.5px] leading-[1.45] font-medium ${
        state.error ? "bg-s-crit/10 text-s-crit" : "bg-s-done/10 text-s-done"
      }`}
    >
      {state.error ?? state.ok}
    </p>
  );
}

export function NachweisForm({
  eintrag,
  gesperrt,
}: {
  eintrag: NachweisWerte;
  gesperrt: boolean;
}) {
  const [state, formAction] = useActionState(nachweisSpeichern, INITIAL);
  const [wegState, wegAction] = useActionState(nachweisEntfernen, INITIAL);

  return (
    <li data-testid={`nachweis-${eintrag.id}`} className="rounded-input bg-panel p-4">
      <form action={formAction} className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="id" value={eintrag.id} />

        <label className="flex min-w-[190px] flex-1 flex-col gap-[6px]">
          <span className="text-[12px] font-semibold text-muted">Bezeichnung</span>
          <input
            name="label"
            defaultValue={eintrag.label}
            disabled={gesperrt}
            required
            maxLength={80}
            className={`${feld} w-full`}
          />
        </label>

        <label className="flex flex-col gap-[6px]">
          <span className="text-[12px] font-semibold text-muted">Läuft ab</span>
          <select
            name="nachweis"
            defaultValue={eintrag.nachweis ? "ja" : "nein"}
            disabled={gesperrt}
            className={feld}
          >
            <option value="ja">ja, mit Ablaufdatum</option>
            <option value="nein">nein, reine Fähigkeit</option>
          </select>
        </label>

        {!gesperrt ? <Submit label="Speichern" /> : null}
      </form>

      <div className="mt-[9px] flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="num text-[11.5px] text-faint">
          Schlüssel {eintrag.schluessel}
        </span>
        <span className="text-[11.5px] text-faint">
          {eintrag.traeger === 0
            ? "niemandem zugeordnet"
            : eintrag.traeger === 1
              ? "1 Mitarbeiter"
              : `${eintrag.traeger} Mitarbeiter`}
        </span>
      </div>

      <Meldung state={state} />

      {!gesperrt ? (
        <form action={wegAction} className="mt-1">
          <input type="hidden" name="id" value={eintrag.id} />
          <button
            type="submit"
            data-testid={`nachweis-entfernen-${eintrag.id}`}
            className="cursor-pointer text-[12px] font-medium text-faint hover:text-s-crit hover:underline"
          >
            Aus dem Katalog entfernen
          </button>
          <Meldung state={wegState} />
        </form>
      ) : null}
    </li>
  );
}

export function NachweisNeu() {
  const [state, formAction] = useActionState(nachweisAnlegen, INITIAL);

  return (
    <li className="rounded-input bg-panel p-4">
      <form action={formAction} className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-[190px] flex-1 flex-col gap-[6px]">
          <span className="text-[12px] font-semibold text-muted">Bezeichnung</span>
          <input
            name="label"
            required
            maxLength={80}
            placeholder="z. B. Unterweisung §5 ETV"
            className={`${feld} w-full`}
          />
        </label>
        <label className="flex flex-col gap-[6px]">
          <span className="text-[12px] font-semibold text-muted">Läuft ab</span>
          <select name="nachweis" defaultValue="ja" className={feld}>
            <option value="ja">ja, mit Ablaufdatum</option>
            <option value="nein">nein, reine Fähigkeit</option>
          </select>
        </label>
        <Submit label="In den Katalog" />
      </form>
      <Meldung state={state} />
    </li>
  );
}
