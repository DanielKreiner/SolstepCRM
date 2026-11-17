"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  fahrzeugAnlegen,
  fahrzeugEntfernen,
  fahrzeugSpeichern,
  lagerortAnlegen,
  lagerortSpeichern,
  type BetriebsmittelState,
} from "./betriebsmittel-actions";

const INITIAL: BetriebsmittelState = { error: null, ok: null };

const feld =
  "rounded-input border border-transparent bg-sunk px-[11px] py-[7px] text-[13px] text-ink outline-0 focus:border-accent focus:bg-surface";

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

function Meldung({ state }: { state: BetriebsmittelState }) {
  if (!state.error && !state.ok) return null;
  return (
    <p
      role={state.error ? "alert" : "status"}
      className={`mt-[9px] rounded-input px-[11px] py-[8px] text-[12.5px] leading-[1.45] font-medium ${
        state.error ? "bg-s-crit/10 text-s-crit" : "bg-s-done/10 text-s-done"
      }`}
    >
      {state.error ?? state.ok}
    </p>
  );
}

export type FahrzeugWerte = {
  id: string;
  name: string;
  kennzeichen: string;
  aktiv: boolean;
};

export type LagerWerte = { id: string; name: string; aktiv: boolean };

export function FahrzeugForm({
  fahrzeug,
  gesperrt,
}: {
  fahrzeug: FahrzeugWerte;
  gesperrt: boolean;
}) {
  const [state, formAction] = useActionState(fahrzeugSpeichern, INITIAL);
  const [wegState, wegAction] = useActionState(fahrzeugEntfernen, INITIAL);

  return (
    <div data-testid={`fahrzeug-${fahrzeug.id}`} className="rounded-input bg-panel p-4">
      <form action={formAction} className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="fahrzeugId" value={fahrzeug.id} />

        <label className="flex min-w-[170px] flex-1 flex-col gap-[6px]">
          <span className="text-[12px] font-semibold text-muted">Bezeichnung</span>
          <input
            name="name"
            defaultValue={fahrzeug.name}
            disabled={gesperrt}
            required
            maxLength={60}
            className={`${feld} w-full`}
          />
        </label>

        <label className="flex min-w-[140px] flex-col gap-[6px]">
          <span className="text-[12px] font-semibold text-muted">Kennzeichen</span>
          <input
            name="kennzeichen"
            defaultValue={fahrzeug.kennzeichen}
            disabled={gesperrt}
            maxLength={20}
            placeholder="NK-123AB"
            className={`${feld} num w-full`}
          />
        </label>

        <label className="flex flex-col gap-[6px]">
          <span className="text-[12px] font-semibold text-muted">Im Einsatz</span>
          <select
            name="aktiv"
            defaultValue={fahrzeug.aktiv ? "ja" : "nein"}
            disabled={gesperrt}
            className={feld}
          >
            <option value="ja">ja</option>
            <option value="nein">stillgelegt</option>
          </select>
        </label>

        {!gesperrt ? <Submit label="Speichern" /> : null}
      </form>

      <Meldung state={state} />

      {!gesperrt ? (
        <form action={wegAction} className="mt-2">
          <input type="hidden" name="fahrzeugId" value={fahrzeug.id} />
          <button
            type="submit"
            data-testid={`fahrzeug-entfernen-${fahrzeug.id}`}
            className="cursor-pointer text-[12px] font-medium text-faint hover:text-s-crit hover:underline"
          >
            Fahrzeug entfernen
          </button>
          <Meldung state={wegState} />
        </form>
      ) : null}
    </div>
  );
}

export function FahrzeugNeu() {
  const [state, formAction] = useActionState(fahrzeugAnlegen, INITIAL);

  return (
    <form action={formAction} className="rounded-input bg-panel p-4">
      <h3 className="mb-3 text-[13.5px] font-semibold">Fahrzeug hinzufügen</h3>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-[170px] flex-1 flex-col gap-[6px]">
          <span className="text-[12px] font-semibold text-muted">Bezeichnung</span>
          <input
            name="name"
            required
            maxLength={60}
            placeholder="Sprinter gross"
            className={`${feld} w-full`}
          />
        </label>
        <label className="flex min-w-[140px] flex-col gap-[6px]">
          <span className="text-[12px] font-semibold text-muted">Kennzeichen</span>
          <input
            name="kennzeichen"
            maxLength={20}
            placeholder="NK-123AB"
            className={`${feld} num w-full`}
          />
        </label>
        <Submit label="Fahrzeug anlegen" />
      </div>
      <p className="mt-[9px] text-[12px] leading-[1.5] text-muted">
        Der Lagerort für das Fahrzeug entsteht automatisch mit. Material, das
        darauf gebucht wird, liegt damit auf dem Fahrzeug und nicht mehr im
        Hauptlager.
      </p>
      <Meldung state={state} />
    </form>
  );
}

export function LagerortForm({
  lagerort,
  gesperrt,
}: {
  lagerort: LagerWerte;
  gesperrt: boolean;
}) {
  const [state, formAction] = useActionState(lagerortSpeichern, INITIAL);

  return (
    <form action={formAction} className="rounded-input bg-panel p-4">
      <input type="hidden" name="lagerortId" value={lagerort.id} />
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-[200px] flex-1 flex-col gap-[6px]">
          <span className="text-[12px] font-semibold text-muted">Name</span>
          <input
            name="name"
            defaultValue={lagerort.name}
            disabled={gesperrt}
            required
            maxLength={60}
            className={`${feld} w-full`}
          />
        </label>
        <label className="flex flex-col gap-[6px]">
          <span className="text-[12px] font-semibold text-muted">In Verwendung</span>
          <select
            name="aktiv"
            defaultValue={lagerort.aktiv ? "ja" : "nein"}
            disabled={gesperrt}
            className={feld}
          >
            <option value="ja">ja</option>
            <option value="nein">stillgelegt</option>
          </select>
        </label>
        {!gesperrt ? <Submit label="Speichern" /> : null}
      </div>
      <Meldung state={state} />
    </form>
  );
}

export function LagerortNeu() {
  const [state, formAction] = useActionState(lagerortAnlegen, INITIAL);

  return (
    <form action={formAction} className="rounded-input bg-panel p-4">
      <h3 className="mb-3 text-[13.5px] font-semibold">Lagerort hinzufügen</h3>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-[200px] flex-1 flex-col gap-[6px]">
          <span className="text-[12px] font-semibold text-muted">Name</span>
          <input
            name="name"
            required
            maxLength={60}
            placeholder="Aussenlager Edlitz"
            className={`${feld} w-full`}
          />
        </label>
        <Submit label="Lagerort anlegen" />
      </div>
      <Meldung state={state} />
    </form>
  );
}
