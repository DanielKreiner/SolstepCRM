"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { createInvoice, updateInvoice, type InvoiceState } from "./actions";

const INITIAL: InvoiceState = { error: null, ok: null };

function Meldung({ state }: { state: InvoiceState }) {
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

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="min-h-[44px] cursor-pointer rounded-pill bg-[linear-gradient(150deg,var(--accent-from),var(--accent-to))] px-[22px] text-sm font-semibold text-white shadow-[0_6px_18px_rgba(201,121,24,0.28)] disabled:opacity-50"
    >
      {pending ? "Legt an …" : label}
    </button>
  );
}

export function CreateInvoiceForm({
  jobs,
}: {
  jobs: { id: string; label: string; offen: number }[];
}) {
  const [state, formAction] = useActionState(createInvoice, INITIAL);

  return (
    <form action={formAction} className="rounded-[20px] bg-surface p-[22px] shadow-soft">
      <h2 className="text-[15px] font-semibold">Rechnung erzeugen</h2>
      <p className="mt-1 mb-4 text-[12.5px] text-muted">
        Der Betrag wird gerechnet, nicht eingetippt. Die Schlussrechnung ist
        immer der Rest.
      </p>

      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-[6px]">
          <label htmlFor="inv-job" className="text-[12.5px] font-semibold text-muted">
            Auftrag
          </label>
          <select id="inv-job" name="jobId" required className={select}>
            <option value="">— wählen —</option>
            {jobs.map((j) => (
              <option key={j.id} value={j.id}>
                {j.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-[6px]">
          <label htmlFor="inv-kind" className="text-[12.5px] font-semibold text-muted">
            Art
          </label>
          <select id="inv-kind" name="kind" defaultValue="deposit" className={select}>
            <option value="deposit">Anzahlung (30 %)</option>
            <option value="partial">Teilrechnung (40 %)</option>
            <option value="final">Schlussrechnung (Rest)</option>
          </select>
        </div>

        <div className="flex flex-col gap-[6px]">
          <label htmlFor="inv-due" className="text-[12.5px] font-semibold text-muted">
            Zahlungsziel in Tagen
          </label>
          <input
            id="inv-due"
            type="number"
            name="dueDays"
            min="0"
            max="90"
            defaultValue="14"
            className={`${input} num`}
          />
        </div>
      </div>

      <Meldung state={state} />

      <div className="mt-4">
        <Submit label="Rechnung erzeugen" />
      </div>
    </form>
  );
}

export function InvoiceRowActions({
  invoiceId,
  status,
}: {
  invoiceId: string;
  status: string;
}) {
  const [state, formAction] = useActionState(updateInvoice, INITIAL);

  const aktionen: [string, string][] = [];
  if (status === "draft") aktionen.push(["send", "versenden"]);
  if (status !== "paid" && status !== "cancelled") {
    aktionen.push(["paid", "bezahlt"]);
    aktionen.push(["cancel", "stornieren"]);
  }

  if (aktionen.length === 0) return null;

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="invoiceId" value={invoiceId} />
      {aktionen.map(([wert, label]) => (
        <button
          key={wert}
          type="submit"
          name="aktion"
          value={wert}
          className="cursor-pointer rounded-pill bg-sunk px-[11px] py-[5px] text-[12px] font-medium text-ink transition-colors hover:bg-line"
        >
          {label}
        </button>
      ))}
      {state.error ? (
        <span role="alert" className="text-[12px] text-s-crit">
          {state.error}
        </span>
      ) : null}
      {state.ok ? (
        <span role="status" className="text-[12px] text-s-done">
          {state.ok}
        </span>
      ) : null}
    </form>
  );
}

const input =
  "w-full rounded-input border border-transparent bg-sunk px-[13px] py-[10px] text-sm text-ink outline-0 transition-colors duration-200 focus:border-accent focus:bg-surface";
const select = `${input} cursor-pointer`;
