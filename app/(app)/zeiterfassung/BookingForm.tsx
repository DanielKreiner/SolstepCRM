"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/Button";
import { Suchauswahl } from "@/components/ui/Suchauswahl";
import { createTimeEntry, type ActionState } from "./actions";

const INITIAL: ActionState = { error: null, ok: null };

const KINDS = [
  ["work", "Arbeit"],
  ["travel", "Fahrt"],
  ["break", "Pause"],
  ["errand", "Besorgung"],
  ["training", "Schulung"],
] as const;

type Option = { id: string; label: string };

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Speichert …" : "Buchung anlegen"}
    </Button>
  );
}

export function BookingForm({
  day,
  jobs,
  users,
  meId,
  canBookOthers,
}: {
  day: string;
  jobs: Option[];
  users: Option[];
  meId: string;
  canBookOthers: boolean;
}) {
  const [state, formAction] = useActionState(createTimeEntry, INITIAL);
  const [kind, setKind] = useState<string>("work");

  return (
    <form
      action={formAction}
      className="rounded-[20px] bg-surface p-[22px] shadow-soft"
    >
      <h2 className="text-[15px] font-semibold">Buchung anlegen</h2>
      <p className="mt-1 mb-4 text-[12.5px] text-muted">
        Die Dauer rechnet die Datenbank aus Beginn und Ende.
      </p>

      <input type="hidden" name="day" value={day} />

      <div className="grid gap-3 sm:grid-cols-2">
        {canBookOthers ? (
          <FieldWrap label="Person" htmlFor="te-user">
            <select
              id="te-user"
              name="userId"
              defaultValue={meId}
              className={selectClass}
            >
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.label}
                </option>
              ))}
            </select>
          </FieldWrap>
        ) : (
          <input type="hidden" name="userId" value={meId} />
        )}

        <FieldWrap label="Art" htmlFor="te-kind">
          <select
            id="te-kind"
            name="kind"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            className={selectClass}
          >
            {KINDS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </FieldWrap>

        <FieldWrap label="Beginn" htmlFor="te-from">
          <input
            id="te-from"
            type="time"
            name="from"
            required
            defaultValue="07:00"
            className={`${inputClass} num`}
          />
        </FieldWrap>

        <FieldWrap label="Ende" htmlFor="te-to">
          <input
            id="te-to"
            type="time"
            name="to"
            required
            defaultValue="16:00"
            className={`${inputClass} num`}
          />
        </FieldWrap>

        {/*
          Suche statt Klappliste: wer eine Woche nachträgt, sucht den
          Auftrag nach Nummer oder Kundenname und scrollt nicht durch
          zweihundert Zeilen.
        */}
        <Suchauswahl
          name="jobId"
          label="Vorgang"
          pflicht={kind === "work"}
          platzhalter="Auftrag suchen — Nummer oder Kunde"
          leerLabel="— ohne Vorgang —"
          hinweis={kind === "work" ? "Pflicht bei Arbeit" : "optional"}
          optionen={jobs.map((j) => ({ wert: j.id, text: j.label }))}
        />

        <FieldWrap label="Notiz" htmlFor="te-note">
          <input
            id="te-note"
            type="text"
            name="note"
            maxLength={500}
            placeholder="optional"
            className={inputClass}
          />
        </FieldWrap>
      </div>

      {state.error ? (
        <p
          role="alert"
          className="mt-3 rounded-input bg-s-crit/10 px-[13px] py-[10px] text-[13px] font-medium text-s-crit"
        >
          {state.error}
        </p>
      ) : null}
      {state.ok ? (
        <p
          role="status"
          className="mt-3 rounded-input bg-s-done/10 px-[13px] py-[10px] text-[13px] font-medium text-s-done"
        >
          {state.ok}
        </p>
      ) : null}

      <div className="mt-4">
        <Submit />
      </div>
    </form>
  );
}

const inputClass =
  "w-full rounded-input border border-transparent bg-sunk px-[13px] py-[10px] text-sm text-ink outline-0 transition-colors duration-200 focus:border-accent focus:bg-surface";
const selectClass = `${inputClass} cursor-pointer`;

/*
 * htmlFor/id statt umschließendem <label>: sonst zählt der Optionstext eines
 * <select> zum zugänglichen Namen des Feldes.
 */
function FieldWrap({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-[6px]">
      <label
        htmlFor={htmlFor}
        className="text-[12.5px] font-semibold text-muted"
      >
        {label}
        {hint ? <span className="ml-1 font-normal text-faint">({hint})</span> : null}
      </label>
      {children}
    </div>
  );
}
