"use client";

import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { createChannel, sendMessage, type ChatState } from "./actions";

const INITIAL: ChatState = { error: null, ok: null };

function SendeKnopf() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="min-h-[44px] shrink-0 cursor-pointer rounded-pill bg-[linear-gradient(150deg,var(--accent-from),var(--accent-to))] px-[22px] text-sm font-semibold text-white disabled:opacity-50"
    >
      {pending ? "…" : "Senden"}
    </button>
  );
}

export function MessageForm({ channelId }: { channelId: string }) {
  const [state, formAction] = useActionState(sendMessage, INITIAL);
  const ref = useRef<HTMLFormElement>(null);

  // Nach dem Senden leeren, sonst steht die alte Nachricht noch im Feld.
  useEffect(() => {
    if (!state.error) ref.current?.reset();
  }, [state]);

  return (
    <form ref={ref} action={formAction} className="mt-3 flex gap-2">
      <input type="hidden" name="channelId" value={channelId} />
      <input
        name="body"
        required
        maxLength={2000}
        placeholder="Nachricht an den Kanal"
        aria-label="Nachricht"
        className="min-h-[44px] flex-1 rounded-input border border-transparent bg-sunk px-[13px] text-sm text-ink outline-0 focus:border-accent focus:bg-surface"
      />
      <SendeKnopf />
      {state.error ? (
        <span role="alert" className="text-[12px] text-s-crit">
          {state.error}
        </span>
      ) : null}
    </form>
  );
}

export function ChannelForm({ jobs }: { jobs: { id: string; label: string }[] }) {
  const [state, formAction] = useActionState(createChannel, INITIAL);

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2">
      <div className="flex min-w-[200px] flex-1 flex-col gap-[4px]">
        <label htmlFor="ch-name" className="text-[11px] text-muted">
          Kanalname
        </label>
        <input
          id="ch-name"
          name="name"
          required
          minLength={2}
          placeholder="z. B. Baustelle Wels"
          className="rounded-input border border-transparent bg-sunk px-[11px] py-[9px] text-[13px] outline-0 focus:border-accent focus:bg-surface"
        />
      </div>

      <div className="flex flex-col gap-[4px]">
        <label htmlFor="ch-job" className="text-[11px] text-muted">
          Auftrag
        </label>
        <select
          id="ch-job"
          name="jobId"
          className="cursor-pointer rounded-input border border-transparent bg-sunk px-[11px] py-[9px] text-[13px] outline-0 focus:border-accent"
        >
          <option value="">— Teamkanal —</option>
          {jobs.map((j) => (
            <option key={j.id} value={j.id}>
              {j.label}
            </option>
          ))}
        </select>
      </div>

      <button
        type="submit"
        className="min-h-[40px] cursor-pointer rounded-pill bg-sunk px-[18px] text-[13px] font-medium text-ink hover:bg-line"
      >
        Kanal anlegen
      </button>

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
