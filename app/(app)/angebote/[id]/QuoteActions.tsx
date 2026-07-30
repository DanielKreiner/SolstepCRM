"use client";

import { useActionState, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/Button";
import {
  acceptQuote,
  importPlanning,
  sendQuote,
  type QuoteState,
} from "../actions";

const INITIAL: QuoteState = { error: null, ok: null };

function Submit({ label, busy }: { label: string; busy: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} block>
      {pending ? busy : label}
    </Button>
  );
}

function Meldung({ state }: { state: QuoteState }) {
  if (state.error) {
    return (
      <p
        role="alert"
        className="mt-3 rounded-input bg-s-crit/10 px-[13px] py-[10px] text-[13px] font-medium text-s-crit"
      >
        {state.error}
      </p>
    );
  }
  if (state.ok) {
    return (
      <p
        role="status"
        className="mt-3 rounded-input bg-s-done/10 px-[13px] py-[10px] text-[13px] font-medium text-s-done"
      >
        {state.ok}
      </p>
    );
  }
  return null;
}

export function QuoteActions({
  quoteId,
  accepted,
  canWrite,
}: {
  quoteId: string;
  accepted: boolean;
  canWrite: boolean;
}) {
  if (!canWrite) {
    return (
      <div className="rounded-[20px] bg-surface p-[22px] text-[13px] text-muted shadow-soft">
        Für Angebote fehlt deiner Rolle das Schreibrecht.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <ImportCard quoteId={quoteId} />
      <SendCard quoteId={quoteId} />
      <AcceptCard quoteId={quoteId} accepted={accepted} />
    </div>
  );
}

function ImportCard({ quoteId }: { quoteId: string }) {
  const [state, formAction] = useActionState(importPlanning, INITIAL);
  const [dateiname, setDateiname] = useState<string | null>(null);
  const payloadRef = useRef<HTMLInputElement>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setDateiname(file.name);
    const text = await file.text();
    if (payloadRef.current) payloadRef.current.value = text;
  }

  return (
    <form action={formAction} className="rounded-[20px] bg-surface p-[22px] shadow-soft">
      <h2 className="text-[15px] font-semibold">Planung importieren</h2>
      <p className="mt-1 mb-3 text-[12.5px] text-muted">
        Step-Planer-JSON. Nicht zuordenbare Positionen werden als
        Freitextposition angelegt und rot markiert.
      </p>

      <input type="hidden" name="quoteId" value={quoteId} />
      <input type="hidden" name="payload" ref={payloadRef} />

      <label
        htmlFor="planung-datei"
        className="block cursor-pointer rounded-input border border-dashed border-line px-4 py-4 text-center text-[13px] text-muted transition-colors hover:border-accent hover:text-ink"
      >
        {dateiname ?? "Datei wählen"}
      </label>
      <input
        id="planung-datei"
        type="file"
        accept="application/json,.json"
        onChange={onFile}
        className="sr-only"
      />

      <Meldung state={state} />

      <div className="mt-4">
        <Submit label="Importieren" busy="Importiert …" />
      </div>
    </form>
  );
}

function SendCard({ quoteId }: { quoteId: string }) {
  const [state, formAction] = useActionState(sendQuote, INITIAL);

  return (
    <form action={formAction} className="rounded-[20px] bg-surface p-[22px] shadow-soft">
      <h2 className="text-[15px] font-semibold">Angebot senden</h2>
      <p className="mt-1 mb-3 text-[12.5px] text-muted">
        Geht in die Warteschlange und wird aus dem Postfach des Betriebs
        verschickt, nicht über einen Versanddienst.
      </p>
      <input type="hidden" name="quoteId" value={quoteId} />
      <Meldung state={state} />
      <div className="mt-4">
        <Submit label="In die Warteschlange" busy="Wird eingereiht …" />
      </div>
    </form>
  );
}

function AcceptCard({
  quoteId,
  accepted,
}: {
  quoteId: string;
  accepted: boolean;
}) {
  const [state, formAction] = useActionState(acceptQuote, INITIAL);

  return (
    <form action={formAction} className="rounded-[20px] bg-surface p-[22px] shadow-soft">
      <h2 className="text-[15px] font-semibold">Annahme erfassen</h2>
      <p className="mt-1 mb-3 text-[12.5px] text-muted">
        Legt den Auftrag an und setzt die Aufgabe „Termin fixieren“.
      </p>

      <input type="hidden" name="quoteId" value={quoteId} />

      <div className="flex flex-col gap-[6px]">
        <label
          htmlFor="annahme-name"
          className="text-[12.5px] font-semibold text-muted"
        >
          Angenommen durch
        </label>
        <input
          id="annahme-name"
          name="name"
          required
          minLength={2}
          placeholder="Name der Person"
          className="w-full rounded-input border border-transparent bg-sunk px-[13px] py-[10px] text-sm text-ink outline-0 transition-colors duration-200 focus:border-accent focus:bg-surface"
        />
      </div>

      <Meldung state={state} />

      <div className="mt-4">
        <Submit
          label={accepted ? "Erneut prüfen" : "Annahme erfassen"}
          busy="Legt an …"
        />
      </div>
    </form>
  );
}
