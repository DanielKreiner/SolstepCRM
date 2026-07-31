"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { STUFEN, STUFE_LABEL } from "@/lib/applicants";
import { addApplicant, moveApplicant, type ApplicantState } from "./actions";

const INITIAL: ApplicantState = { error: null, ok: null };

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

export function AddApplicantForm() {
  const [state, formAction] = useActionState(addApplicant, INITIAL);

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2">
      {[
        ["name", "Name", "Vor- und Nachname", true],
        ["position", "Position", "z. B. Monteur PV", true],
        ["email", "E-Mail", "optional", false],
        ["phone", "Telefon", "optional", false],
      ].map(([name, label, platzhalter, pflicht]) => (
        <div key={name as string} className="flex min-w-[160px] flex-1 flex-col gap-[4px]">
          <label htmlFor={`b-${name as string}`} className="text-[11px] text-muted">
            {label as string}
          </label>
          <input
            id={`b-${name as string}`}
            name={name as string}
            required={pflicht as boolean}
            type={name === "email" ? "email" : "text"}
            placeholder={platzhalter as string}
            className="rounded-input border border-transparent bg-sunk px-[11px] py-[9px] text-[13px] outline-0 focus:border-accent focus:bg-surface"
          />
        </div>
      ))}

      <Submit label="Aufnehmen" />

      {state.error ? (
        <span role="alert" className="w-full text-[12.5px] text-s-crit">
          {state.error}
        </span>
      ) : null}
      {state.ok ? (
        <span role="status" className="w-full text-[12.5px] text-s-done">
          {state.ok}
        </span>
      ) : null}
    </form>
  );
}

export function StageSelect({
  applicantId,
  stage,
  name,
}: {
  applicantId: string;
  stage: string;
  name: string;
}) {
  const [state, formAction] = useActionState(moveApplicant, INITIAL);

  return (
    <form action={formAction}>
      <input type="hidden" name="applicantId" value={applicantId} />
      <select
        name="stage"
        defaultValue={stage}
        aria-label={`Stufe von ${name}`}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="cursor-pointer rounded-input border border-transparent bg-sunk px-[11px] py-[6px] text-[12.5px] outline-0 focus:border-accent"
      >
        {STUFEN.map((s) => (
          <option key={s} value={s}>
            {STUFE_LABEL[s]}
          </option>
        ))}
      </select>
      {state.error ? (
        <span role="alert" className="text-[12px] text-s-crit">
          {state.error}
        </span>
      ) : null}
    </form>
  );
}
