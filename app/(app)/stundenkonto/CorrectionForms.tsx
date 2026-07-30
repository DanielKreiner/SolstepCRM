"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  decideCorrection,
  requestCorrection,
  type CorrectionState,
} from "./actions";

const INITIAL: CorrectionState = { error: null, ok: null };

function Meldung({ state }: { state: CorrectionState }) {
  if (state.error) {
    return (
      <p role="alert" className="mt-2 text-[12.5px] font-medium text-s-crit">
        {state.error}
      </p>
    );
  }
  if (state.ok) {
    return (
      <p role="status" className="mt-2 text-[12.5px] font-medium text-s-done">
        {state.ok}
      </p>
    );
  }
  return null;
}

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="min-h-[40px] cursor-pointer rounded-pill bg-sunk px-[16px] text-[13px] font-medium text-ink transition-colors hover:bg-line disabled:opacity-50"
    >
      {pending ? "…" : label}
    </button>
  );
}

export function RequestCorrectionForm({
  entryId,
  day,
  from,
  to,
}: {
  entryId: string;
  day: string;
  from: string;
  to: string;
}) {
  const [state, formAction] = useActionState(requestCorrection, INITIAL);

  return (
    <form action={formAction} className="mt-2 flex flex-wrap items-end gap-2">
      <input type="hidden" name="entryId" value={entryId} />
      <input type="hidden" name="day" value={day} />

      <div className="flex flex-col gap-[4px]">
        <label htmlFor={`k-von-${entryId}`} className="text-[11px] text-muted">
          Beginn
        </label>
        <input
          id={`k-von-${entryId}`}
          type="time"
          name="from"
          defaultValue={from}
          required
          className="num w-[104px] rounded-input border border-transparent bg-sunk px-2 py-[7px] text-[13px] outline-0 focus:border-accent"
        />
      </div>

      <div className="flex flex-col gap-[4px]">
        <label htmlFor={`k-bis-${entryId}`} className="text-[11px] text-muted">
          Ende
        </label>
        <input
          id={`k-bis-${entryId}`}
          type="time"
          name="to"
          defaultValue={to}
          required
          className="num w-[104px] rounded-input border border-transparent bg-sunk px-2 py-[7px] text-[13px] outline-0 focus:border-accent"
        />
      </div>

      <div className="flex min-w-[200px] flex-1 flex-col gap-[4px]">
        <label htmlFor={`k-grund-${entryId}`} className="text-[11px] text-muted">
          Begründung
        </label>
        <input
          id={`k-grund-${entryId}`}
          name="reason"
          required
          minLength={5}
          placeholder="z. B. Ausstempeln vergessen"
          className="w-full rounded-input border border-transparent bg-sunk px-[11px] py-[7px] text-[13px] outline-0 focus:border-accent"
        />
      </div>

      <Submit label="Korrektur beantragen" />
      <div className="w-full">
        <Meldung state={state} />
      </div>
    </form>
  );
}

export function DecideCorrectionForm({
  correctionId,
}: {
  correctionId: string;
}) {
  const [state, formAction] = useActionState(decideCorrection, INITIAL);

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="correctionId" value={correctionId} />
      <input
        name="kommentar"
        maxLength={300}
        placeholder="Kommentar (optional)"
        aria-label="Kommentar zur Entscheidung"
        className="min-w-[180px] flex-1 rounded-input border border-transparent bg-sunk px-[11px] py-[7px] text-[12.5px] outline-0 focus:border-accent"
      />
      <button
        type="submit"
        name="entscheidung"
        value="approved"
        className="cursor-pointer rounded-pill bg-s-done/12 px-[13px] py-[6px] text-[12px] font-medium text-s-done"
      >
        genehmigen
      </button>
      <button
        type="submit"
        name="entscheidung"
        value="rejected"
        className="cursor-pointer rounded-pill bg-s-crit/12 px-[13px] py-[6px] text-[12px] font-medium text-s-crit"
      >
        ablehnen
      </button>
      <div className="w-full">
        <Meldung state={state} />
      </div>
    </form>
  );
}
