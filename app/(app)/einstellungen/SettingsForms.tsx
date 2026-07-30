"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  addPhase,
  deletePhase,
  renamePhase,
  setPermission,
  type SettingsState,
} from "./actions";

const INITIAL: SettingsState = { error: null, ok: null };

function Meldung({ state }: { state: SettingsState }) {
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

/** Eine Zelle der Rollenmatrix. Speichert bei Auswahl, ohne Speichern-Knopf. */
export function PermissionCell({
  role,
  area,
  level,
  gesperrt,
}: {
  role: string;
  area: string;
  level: string;
  gesperrt: boolean;
}) {
  const [state, formAction] = useActionState(setPermission, INITIAL);

  return (
    <form action={formAction} className="contents">
      <input type="hidden" name="role" value={role} />
      <input type="hidden" name="area" value={area} />
      <div className="px-[6px] py-2">
        <select
          name="level"
          defaultValue={level}
          disabled={gesperrt}
          aria-label={`${area} für ${role}`}
          onChange={(e) => e.currentTarget.form?.requestSubmit()}
          className={[
            "w-full cursor-pointer rounded-input border border-transparent px-2 py-[6px] text-[12.5px] outline-0 focus:border-accent",
            level === "write"
              ? "bg-s-done/12 text-s-done"
              : level === "read"
                ? "bg-s-doing/12 text-s-doing"
                : "bg-sunk text-muted",
            gesperrt ? "cursor-not-allowed opacity-60" : "",
          ].join(" ")}
        >
          <option value="none">kein Zugriff</option>
          <option value="read">lesen</option>
          <option value="write">schreiben</option>
        </select>
        <Meldung state={state} />
      </div>
    </form>
  );
}

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="min-h-[40px] cursor-pointer rounded-pill bg-[linear-gradient(150deg,var(--accent-from),var(--accent-to))] px-[18px] text-[13px] font-semibold text-white disabled:opacity-50"
    >
      {pending ? "…" : label}
    </button>
  );
}

export function AddPhaseForm({
  pipelineId,
  naechsteSortierung,
}: {
  pipelineId: string;
  naechsteSortierung: number;
}) {
  const [state, formAction] = useActionState(addPhase, INITIAL);

  return (
    <form action={formAction} className="mt-3 flex flex-wrap items-end gap-2">
      <input type="hidden" name="pipelineId" value={pipelineId} />

      <div className="flex flex-col gap-[4px]">
        <label htmlFor={`p-label-${pipelineId}`} className="text-[11px] text-muted">
          Bezeichnung
        </label>
        <input
          id={`p-label-${pipelineId}`}
          name="label"
          required
          minLength={2}
          placeholder="z. B. Gerüst bestellt"
          className={feld}
        />
      </div>

      <div className="flex flex-col gap-[4px]">
        <label htmlFor={`p-key-${pipelineId}`} className="text-[11px] text-muted">
          Schlüssel
        </label>
        <input
          id={`p-key-${pipelineId}`}
          name="key"
          required
          pattern="[a-z0-9_]+"
          placeholder="geruest"
          className={`${feld} num w-[140px]`}
        />
      </div>

      <div className="flex flex-col gap-[4px]">
        <label htmlFor={`p-sort-${pipelineId}`} className="text-[11px] text-muted">
          Position
        </label>
        <input
          id={`p-sort-${pipelineId}`}
          type="number"
          name="sort"
          min="1"
          max="99"
          defaultValue={naechsteSortierung}
          className={`${feld} num w-[80px]`}
        />
      </div>

      <Submit label="Phase anlegen" />
      <div className="w-full">
        <Meldung state={state} />
      </div>
    </form>
  );
}

export function PhaseRowForm({
  phaseId,
  label,
  systemKey,
  belegt,
}: {
  phaseId: string;
  label: string;
  systemKey: string | null;
  belegt: number;
}) {
  const [renameState, renameAction] = useActionState(renamePhase, INITIAL);
  const [deleteState, deleteAction] = useActionState(deletePhase, INITIAL);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <form action={renameAction} className="flex items-center gap-2">
        <input type="hidden" name="phaseId" value={phaseId} />
        <input
          name="label"
          defaultValue={label}
          aria-label={`Bezeichnung von ${label}`}
          className={`${feld} w-[200px]`}
        />
        <button
          type="submit"
          className="cursor-pointer rounded-pill bg-sunk px-[13px] py-[6px] text-[12px] font-medium text-ink hover:bg-line"
        >
          umbenennen
        </button>
      </form>

      {systemKey ? (
        <span className="num rounded-pill bg-s-warn/12 px-[9px] py-[3px] text-[11px] text-accent-ink">
          {systemKey}
        </span>
      ) : null}

      <span className="num text-[11.5px] text-faint">
        {belegt} {belegt === 1 ? "Eintrag" : "Einträge"}
      </span>

      {!systemKey ? (
        <form action={deleteAction}>
          <input type="hidden" name="phaseId" value={phaseId} />
          <button
            type="submit"
            className="cursor-pointer rounded-pill bg-transparent px-[11px] py-[6px] text-[12px] text-muted hover:text-s-crit"
          >
            löschen
          </button>
        </form>
      ) : null}

      <div className="w-full">
        <Meldung state={renameState} />
        <Meldung state={deleteState} />
      </div>
    </div>
  );
}

const feld =
  "rounded-input border border-transparent bg-sunk px-[11px] py-[7px] text-[13px] text-ink outline-0 focus:border-accent focus:bg-surface";
