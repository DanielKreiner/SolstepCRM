"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  confirmAppointmentFromPortal,
  createTicketFromPortal,
  nachfrageSenden,
  type PortalState,
} from "./actions";

const INITIAL: PortalState = { error: null, ok: null };

function Meldung({ state }: { state: PortalState }) {
  if (state.error) {
    return (
      <p role="alert" className="mt-3 rounded-input bg-s-crit/10 px-[13px] py-[10px] text-[13px] font-medium text-s-crit">
        {state.error}
      </p>
    );
  }
  if (state.ok) {
    return (
      <p role="status" className="mt-3 rounded-input bg-s-done/10 px-[13px] py-[10px] text-[13px] font-medium text-s-done">
        {state.ok}
      </p>
    );
  }
  return null;
}

function Submit({ label, busy }: { label: string; busy: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="min-h-[52px] w-full cursor-pointer rounded-pill border-0 bg-[linear-gradient(150deg,var(--accent-from),var(--accent-to))] px-6 text-[15px] font-semibold text-white shadow-[0_6px_18px_rgba(201,121,24,0.28)] disabled:opacity-50"
    >
      {pending ? busy : label}
    </button>
  );
}

export function TicketForm({ token }: { token: string }) {
  const [state, formAction] = useActionState(createTicketFromPortal, INITIAL);

  return (
    <form action={formAction} className="rounded-[20px] bg-surface p-5 shadow-soft">
      <h2 className="text-[15px] font-semibold">Anliegen melden</h2>
      <p className="mt-1 mb-3 text-[12.5px] text-muted">
        Ihre Meldung landet direkt beim zuständigen Team.
      </p>

      <input type="hidden" name="token" value={token} />

      <div className="flex flex-col gap-[6px]">
        <label htmlFor="ticket-kategorie" className="text-[12.5px] font-semibold text-muted">
          Art
        </label>
        <select
          id="ticket-kategorie"
          name="category"
          defaultValue="stoerung"
          className="w-full cursor-pointer rounded-input border border-transparent bg-sunk px-[13px] py-[11px] text-sm outline-0 focus:border-accent focus:bg-surface"
        >
          <option value="stoerung">Störung</option>
          <option value="frage">Frage</option>
          <option value="beschwerde">Beschwerde</option>
          <option value="rechnung">Rechnung</option>
        </select>
      </div>

      <div className="mt-3 flex flex-col gap-[6px]">
        <label htmlFor="ticket-text" className="text-[12.5px] font-semibold text-muted">
          Beschreibung
        </label>
        <textarea
          id="ticket-text"
          name="body"
          required
          minLength={10}
          rows={4}
          placeholder="Was ist passiert?"
          className="w-full rounded-input border border-transparent bg-sunk px-[13px] py-[11px] text-sm outline-0 focus:border-accent focus:bg-surface"
        />
      </div>

      <Meldung state={state} />

      <div className="mt-4">
        <Submit label="Anliegen senden" busy="Wird gesendet …" />
      </div>
    </form>
  );
}

/**
 * Terminbestätigung. Ein Knopf, kein Formular mit Feldern — der Kunde
 * bestätigt einen Termin, den der Betrieb gesetzt hat, und hat dabei nichts
 * einzutragen.
 */
export function ConfirmAppointmentForm({
  token,
  appointmentId,
}: {
  token: string;
  appointmentId: string;
}) {
  const [state, formAction] = useActionState(
    confirmAppointmentFromPortal,
    INITIAL,
  );

  return (
    <form action={formAction}>
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="appointmentId" value={appointmentId} />
      <Submit label="Termin bestätigen" busy="Wird bestätigt …" />
      <Meldung state={state} />
    </form>
  );
}

/**
 * Nachfrage zu einem laufenden Anliegen. Bewusst schmal gehalten — ein
 * Feld und ein Knopf, direkt unter dem Verlauf.
 */
export function NachfrageForm({
  token,
  ticketId,
  nummer,
}: {
  token: string;
  ticketId: string;
  /* Die Nummer steht im Label: der Kunde hat oft mehrere Anliegen offen,
     und "Nachricht zu diesem Anliegen" sagt vorgelesen nicht, zu welchem. */
  nummer: string;
}) {
  const [status, formAction] = useActionState(nachfrageSenden, INITIAL);

  return (
    <form action={formAction} key={status.ok ?? "leer"} className="mt-3">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="ticketId" value={ticketId} />

      <label htmlFor={`nachfrage-${ticketId}`} className="sr-only">
        Nachricht zu Anliegen {nummer}
      </label>
      <textarea
        id={`nachfrage-${ticketId}`}
        name="body"
        rows={2}
        placeholder="Etwas nachfragen oder ergänzen …"
        className="w-full resize-y rounded-input border border-transparent bg-panel px-[13px] py-[10px] text-[13px] outline-0 focus:border-accent focus:bg-surface"
      />

      <div className="mt-2 flex flex-wrap items-center gap-3">
        <span className="w-[180px]">
          <Submit label="Senden" busy="Wird gesendet …" />
        </span>
        {status.error ? (
          <span role="alert" className="text-[12px] font-medium text-s-crit">
            {status.error}
          </span>
        ) : null}
        {status.ok ? (
          <span role="status" className="text-[12px] font-medium text-s-done">
            {status.ok}
          </span>
        ) : null}
      </div>
    </form>
  );
}
