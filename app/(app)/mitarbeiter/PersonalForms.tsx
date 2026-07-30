"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  addQualification,
  markSigned,
  uploadDocument,
  type PersonalState,
} from "./actions";

const INITIAL: PersonalState = { error: null, ok: null };

function Meldung({ state }: { state: PersonalState }) {
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
      className="min-h-[40px] cursor-pointer rounded-pill bg-[linear-gradient(150deg,var(--accent-from),var(--accent-to))] px-[18px] text-[13px] font-semibold text-white disabled:opacity-50"
    >
      {pending ? "…" : label}
    </button>
  );
}

export function QualificationForm({ userId }: { userId: string }) {
  const [state, formAction] = useActionState(addQualification, INITIAL);

  return (
    <form action={formAction} className="mt-3 flex flex-wrap items-end gap-2">
      <input type="hidden" name="userId" value={userId} />

      <div className="flex min-w-[200px] flex-1 flex-col gap-[4px]">
        <label htmlFor="q-name" className="text-[11px] text-muted">
          Nachweis
        </label>
        <input
          id="q-name"
          name="name"
          required
          minLength={2}
          placeholder="z. B. Elektrofachkraft, PSA gegen Absturz"
          className={feld}
        />
      </div>

      <div className="flex flex-col gap-[4px]">
        <label htmlFor="q-von" className="text-[11px] text-muted">
          Ausgestellt
        </label>
        <input id="q-von" type="date" name="issuedOn" className={`${feld} num`} />
      </div>

      <div className="flex flex-col gap-[4px]">
        <label htmlFor="q-bis" className="text-[11px] text-muted">
          Gültig bis
        </label>
        <input id="q-bis" type="date" name="validUntil" className={`${feld} num`} />
      </div>

      <Submit label="Eintragen" />
      <div className="w-full">
        <Meldung state={state} />
      </div>
    </form>
  );
}

export function DocumentForm({ userId }: { userId: string }) {
  const [state, formAction] = useActionState(uploadDocument, INITIAL);

  return (
    <form action={formAction} className="mt-3 flex flex-wrap items-end gap-2">
      <input type="hidden" name="userId" value={userId} />

      <div className="flex flex-col gap-[4px]">
        <label htmlFor="d-kind" className="text-[11px] text-muted">
          Art
        </label>
        <select id="d-kind" name="kind" defaultValue="contract" className={feld}>
          <option value="contract">Vertrag</option>
          <option value="payslip">Lohnzettel</option>
          <option value="certificate">Zertifikat</option>
          <option value="other">Sonstiges</option>
        </select>
      </div>

      <div className="flex flex-col gap-[4px]">
        <label htmlFor="d-sig" className="text-[11px] text-muted">
          Unterschrift
        </label>
        <select id="d-sig" name="signature" defaultValue="none" className={feld}>
          <option value="none">nicht nötig</option>
          <option value="pending">steht aus</option>
        </select>
      </div>

      <div className="flex min-w-[220px] flex-1 flex-col gap-[4px]">
        <label htmlFor="d-datei" className="text-[11px] text-muted">
          Datei (PDF oder Bild, max. 25 MB)
        </label>
        <input
          id="d-datei"
          type="file"
          name="datei"
          required
          accept=".pdf,.jpg,.jpeg,.png,.heic,.webp,.csv,.xlsx"
          className="text-[12.5px] text-muted file:mr-3 file:cursor-pointer file:rounded-pill file:border-0 file:bg-sunk file:px-4 file:py-2 file:text-[12.5px] file:text-ink"
        />
      </div>

      <Submit label="Hochladen" />
      <div className="w-full">
        <Meldung state={state} />
      </div>
    </form>
  );
}

export function SignForm({
  documentId,
  filename,
}: {
  documentId: string;
  filename: string;
}) {
  const [state, formAction] = useActionState(markSigned, INITIAL);

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="documentId" value={documentId} />
      <button
        type="submit"
        aria-label={`${filename} als unterschrieben erfassen`}
        className="cursor-pointer rounded-pill bg-s-done/12 px-[13px] py-[5px] text-[12px] font-medium text-s-done"
      >
        unterschrieben
      </button>
      <Meldung state={state} />
    </form>
  );
}

const feld =
  "rounded-input border border-transparent bg-sunk px-[11px] py-[7px] text-[13px] text-ink outline-0 focus:border-accent focus:bg-surface";
