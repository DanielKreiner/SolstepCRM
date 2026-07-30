"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/Button";
import { publishRoster, type DispoState } from "./actions";

const INITIAL: DispoState = { error: null, ok: null };

function Submit({ blockiert }: { blockiert: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} variant={blockiert ? "ghost" : "primary"}>
      {pending ? "Veröffentlicht …" : "Dienstplan veröffentlichen"}
    </Button>
  );
}

export function PublishForm({
  week,
  blockierende,
}: {
  week: string;
  blockierende: number;
}) {
  const [state, formAction] = useActionState(publishRoster, INITIAL);
  const [bestaetigt, setBestaetigt] = useState(false);
  const blockiert = blockierende > 0;

  return (
    <form action={formAction} className="rounded-[20px] bg-surface p-5 shadow-soft">
      <input type="hidden" name="week" value={week} />

      <h2 className="text-[15px] font-semibold">Veröffentlichen</h2>
      <p className="mt-1 text-[12.5px] text-muted">
        {blockiert
          ? `${blockierende} ${blockierende === 1 ? "Verstoß blockiert" : "Verstöße blockieren"} die Veröffentlichung.`
          : "Keine blockierenden Verstöße."}
      </p>

      {blockiert ? (
        <div className="mt-3 flex flex-col gap-3">
          <label className="flex items-start gap-2 text-[13px]">
            <input
              type="checkbox"
              name="bestaetigt"
              value="ja"
              checked={bestaetigt}
              onChange={(e) => setBestaetigt(e.target.checked)}
              className="mt-[2px] h-4 w-4 accent-[var(--accent)]"
            />
            <span>
              Ich veröffentliche trotz der Verstöße. Die Bestätigung wird mit
              meinem Namen protokolliert.
            </span>
          </label>

          {bestaetigt ? (
            <div className="flex flex-col gap-[6px]">
              <label
                htmlFor="dispo-grund"
                className="text-[12.5px] font-semibold text-muted"
              >
                Begründung
              </label>
              <input
                id="dispo-grund"
                name="grund"
                required
                maxLength={300}
                placeholder="z. B. Störungseinsatz, mit Betriebsrat abgestimmt"
                className="w-full rounded-input border border-transparent bg-sunk px-[13px] py-[10px] text-sm outline-0 focus:border-accent focus:bg-surface"
              />
            </div>
          ) : null}
        </div>
      ) : null}

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
        <Submit blockiert={blockiert} />
      </div>
    </form>
  );
}
