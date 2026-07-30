"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { decideAbsence, requestAbsence, type AbsenceState } from "./actions";

const INITIAL: AbsenceState = { error: null, ok: null };

function Meldung({ state }: { state: AbsenceState }) {
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

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="min-h-[44px] w-full cursor-pointer rounded-pill border-0 bg-[linear-gradient(150deg,var(--accent-from),var(--accent-to))] px-6 text-sm font-semibold text-white shadow-[0_6px_18px_rgba(201,121,24,0.28)] disabled:opacity-50"
    >
      {pending ? "Wird gesendet …" : "Eintragen"}
    </button>
  );
}

export function RequestForm({
  meId,
  users,
  canForOthers,
}: {
  meId: string;
  users: { id: string; name: string }[];
  canForOthers: boolean;
}) {
  const [state, formAction] = useActionState(requestAbsence, INITIAL);
  const [kind, setKind] = useState("vacation");

  return (
    <form action={formAction} className="rounded-[20px] bg-surface p-[22px] shadow-soft">
      <h2 className="text-[15px] font-semibold">Abwesenheit eintragen</h2>
      <p className="mt-1 mb-4 text-[12.5px] text-muted">
        Krankenstand gilt sofort und wird nicht genehmigt.
      </p>

      <div className="flex flex-col gap-3">
        {canForOthers ? (
          <div className="flex flex-col gap-[6px]">
            <label htmlFor="ab-user" className="text-[12.5px] font-semibold text-muted">
              Person
            </label>
            <select id="ab-user" name="userId" defaultValue={meId} className={select}>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <input type="hidden" name="userId" value={meId} />
        )}

        <div className="flex flex-col gap-[6px]">
          <label htmlFor="ab-kind" className="text-[12.5px] font-semibold text-muted">
            Art
          </label>
          <select
            id="ab-kind"
            name="kind"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            className={select}
          >
            <option value="vacation">Urlaub</option>
            <option value="sick">Krankenstand</option>
            <option value="leave_comp">Zeitausgleich</option>
            <option value="care">Pflegefreistellung</option>
            <option value="school">Schulung</option>
            <option value="special">Sonderurlaub</option>
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-[6px]">
            <label htmlFor="ab-von" className="text-[12.5px] font-semibold text-muted">
              Von
            </label>
            <input id="ab-von" type="date" name="from" required className={`${input} num`} />
          </div>
          <div className="flex flex-col gap-[6px]">
            <label htmlFor="ab-bis" className="text-[12.5px] font-semibold text-muted">
              Bis
            </label>
            <input id="ab-bis" type="date" name="to" required className={`${input} num`} />
          </div>
        </div>

        <label className="flex items-center gap-2 text-[13px]">
          <input type="checkbox" name="halfDay" value="ja" className="h-4 w-4 accent-[var(--accent)]" />
          Halber Tag
        </label>

        {kind === "sick" ? (
          <p className="rounded-input bg-panel px-3 py-2 text-[12px] text-muted">
            Zum Krankenstand wird kein Grund erfasst. Die Art genügt.
          </p>
        ) : (
          <div className="flex flex-col gap-[6px]">
            <label htmlFor="ab-note" className="text-[12.5px] font-semibold text-muted">
              Hinweis
            </label>
            <input
              id="ab-note"
              name="note"
              maxLength={300}
              placeholder="optional, z. B. Vertretung"
              className={input}
            />
          </div>
        )}
      </div>

      <Meldung state={state} />

      <div className="mt-4">
        <Submit />
      </div>
    </form>
  );
}

export function DecideForm({ absenceId }: { absenceId: string }) {
  const [state, formAction] = useActionState(decideAbsence, INITIAL);

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="absenceId" value={absenceId} />
      <button
        type="submit"
        name="entscheidung"
        value="approved"
        className="cursor-pointer rounded-pill bg-s-done/12 px-[13px] py-[5px] text-[12px] font-medium text-s-done"
      >
        genehmigen
      </button>
      <button
        type="submit"
        name="entscheidung"
        value="rejected"
        className="cursor-pointer rounded-pill bg-s-crit/12 px-[13px] py-[5px] text-[12px] font-medium text-s-crit"
      >
        ablehnen
      </button>
      {state.error ? (
        <span role="alert" className="text-[12px] text-s-crit">
          {state.error}
        </span>
      ) : null}
    </form>
  );
}

const input =
  "w-full rounded-input border border-transparent bg-sunk px-[13px] py-[10px] text-sm text-ink outline-0 transition-colors duration-200 focus:border-accent focus:bg-surface";
const select = `${input} cursor-pointer`;
