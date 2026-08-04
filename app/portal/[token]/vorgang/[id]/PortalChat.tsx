"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { dateTime } from "@/lib/format";
import { Anhaenge, DateiFeld, type AnhangAnzeige } from "@/components/vorgang/Anhaenge";
import {
  anfrageBeantworten,
  kundeSchreibt,
  type PortalChatState,
} from "./chat-actions";

const LEER: PortalChatState = { error: null, ok: null };

export type PortalNachricht = {
  id: string;
  autor: "kunde" | "betrieb";
  autorName: string | null;
  body: string;
  createdAt: string;
  anhaenge: AnhangAnzeige[];
};

export type PortalAnfrage = {
  id: string;
  titel: string;
  beschreibung: string | null;
  fotoNoetig: boolean;
  status: string;
  antwortText: string | null;
  anhaenge: AnhangAnzeige[];
};

/**
 * Offene Rückfragen — ganz oben, nicht im Gespräch versteckt.
 *
 * Wer das Portal öffnet, soll als Erstes sehen, dass jemand etwas von ihm
 * braucht. Steht die Frage unten im Verlauf, wird sie überlesen und der
 * Techniker steht am Montagetag vor einem Zählerkasten, in den nichts
 * hineinpasst.
 */
export function OffeneAnfragen({
  token,
  vorgangId,
  anfragen,
}: {
  token: string;
  vorgangId: string;
  anfragen: PortalAnfrage[];
}) {
  const offen = anfragen.filter((a) => a.status === "offen");
  if (offen.length === 0) return null;

  return (
    <section className="mb-4 rounded-panel border-2 border-accent bg-accent-sunk p-6 shadow-soft sm:p-8">
      <p className="text-[11.5px] font-semibold tracking-[0.14em] text-accent-ink uppercase">
        {offen.length === 1 ? "Wir brauchen etwas von Ihnen" : "Wir haben Fragen"}
      </p>

      <ul className="mt-4 flex flex-col gap-4">
        {offen.map((a) => (
          <li key={a.id}>
            <AnfrageFormular token={token} vorgangId={vorgangId} anfrage={a} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function AnfrageFormular({
  token,
  vorgangId,
  anfrage,
}: {
  token: string;
  vorgangId: string;
  anfrage: PortalAnfrage;
}) {
  const [status, formAction] = useActionState(anfrageBeantworten, LEER);

  if (status.ok) {
    return (
      <p role="status" className="rounded-card bg-surface px-4 py-3 text-[13.5px] font-medium text-s-done">
        {status.ok}
      </p>
    );
  }

  return (
    <form action={formAction} className="rounded-card bg-surface p-5">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="vorgangId" value={vorgangId} />
      <input type="hidden" name="anfrageId" value={anfrage.id} />

      <h3 className="text-[16px] leading-snug font-semibold">{anfrage.titel}</h3>
      {anfrage.beschreibung ? (
        <p className="mt-1 text-[13px] leading-relaxed text-muted">
          {anfrage.beschreibung}
        </p>
      ) : null}

      <div className="mt-4">
        <label
          htmlFor={`ant-${anfrage.id}`}
          className="mb-[5px] block text-[12px] font-medium text-muted"
        >
          Ihre Antwort
        </label>
        <textarea
          id={`ant-${anfrage.id}`}
          name="antwort"
          rows={2}
          className="w-full resize-y rounded-input border border-transparent bg-panel px-[13px] py-[10px] text-[13.5px] outline-0 focus:border-accent focus:bg-surface"
        />
      </div>

      <div className="mt-3">
        <DateiFeld
          id={`foto-${anfrage.id}`}
          label={anfrage.fotoNoetig ? "Foto (nötig)" : "Foto anhängen"}
          pflicht={anfrage.fotoNoetig}
        />
      </div>

      <div className="mt-4">
        <Absenden label="Antwort senden" gross />
      </div>

      {status.error ? (
        <p role="alert" className="mt-2 text-[12.5px] font-medium text-s-crit">
          {status.error}
        </p>
      ) : null}
    </form>
  );
}

/**
 * Das Gespräch mit dem Betrieb.
 *
 * Ein Feld, ein Knopf, ein Foto. Wer auf der Baustelle steht und etwas
 * zeigen will, soll nicht erst ein Anliegen kategorisieren müssen.
 */
export function PortalChat({
  token,
  vorgangId,
  nachrichten,
  firmaName,
}: {
  token: string;
  vorgangId: string;
  nachrichten: PortalNachricht[];
  firmaName: string;
}) {
  const [status, formAction] = useActionState(kundeSchreibt, LEER);
  const [offen, setOffen] = useState(false);

  return (
    <section className="mb-4 rounded-panel bg-surface p-6 shadow-soft sm:p-8">
      <h2 className="mb-3 text-[17px] font-bold tracking-[-0.02em]">
        Nachrichten
      </h2>

      {nachrichten.length === 0 ? (
        <p className="text-[13px] text-muted">
          Noch keine Nachricht. Schreiben Sie uns, wenn etwas unklar ist.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {nachrichten.map((n) => (
            <li
              key={n.id}
              className={[
                "rounded-card px-4 py-3",
                n.autor === "kunde" ? "bg-accent-sunk" : "bg-panel",
              ].join(" ")}
            >
              <div className="mb-[2px] flex flex-wrap items-baseline gap-2">
                <span className="text-[12px] font-semibold">
                  {n.autor === "kunde" ? "Sie" : (n.autorName ?? firmaName)}
                </span>
                <span className="num ml-auto text-[11px] text-faint">
                  {dateTime(n.createdAt)}
                </span>
              </div>
              <p className="text-[13.5px] leading-[1.55] whitespace-pre-line">
                {n.body}
              </p>
              <Anhaenge anhaenge={n.anhaenge} />
            </li>
          ))}
        </ul>
      )}

      {status.ok ? (
        <p role="status" className="mt-3 text-[12.5px] font-medium text-s-done">
          {status.ok}
        </p>
      ) : null}

      {!offen ? (
        <button
          type="button"
          data-testid="portal-chat-oeffnen"
          onClick={() => setOffen(true)}
          className="mt-4 min-h-[44px] w-full cursor-pointer rounded-pill border border-line bg-panel px-6 text-[13.5px] font-semibold text-ink"
        >
          Nachricht schreiben
        </button>
      ) : (
        <form
          action={formAction}
          key={status.ok ?? "leer"}
          className="mt-4 border-t border-line pt-4"
        >
          <input type="hidden" name="token" value={token} />
          <input type="hidden" name="vorgangId" value={vorgangId} />

          <label htmlFor="pk-body" className="sr-only">
            Ihre Nachricht
          </label>
          <textarea
            id="pk-body"
            data-testid="portal-chat-text"
            name="body"
            rows={3}
            placeholder="Was möchten Sie uns sagen?"
            className="w-full resize-y rounded-input border border-transparent bg-panel px-[13px] py-[11px] text-[13.5px] outline-0 focus:border-accent focus:bg-surface"
          />

          <div className="mt-3">
            <DateiFeld id="pk-anhang" label="Bild anhängen" />
          </div>

          <div
            className="mt-3 flex flex-wrap items-center gap-2"
            data-testid="portal-chat-senden"
          >
            <Absenden label="Senden" />
            <button
              type="button"
              onClick={() => setOffen(false)}
              className="cursor-pointer border-0 bg-transparent text-[12.5px] text-muted underline"
            >
              Abbrechen
            </button>
          </div>

          {status.error ? (
            <p role="alert" className="mt-2 text-[12.5px] font-medium text-s-crit">
              {status.error}
            </p>
          ) : null}
        </form>
      )}
    </section>
  );
}

function Absenden({ label, gross = false }: { label: string; gross?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={
        gross
          ? "min-h-[48px] w-full cursor-pointer rounded-pill border-0 bg-[linear-gradient(150deg,var(--accent-from),var(--accent-to))] px-6 text-[14px] font-semibold text-white shadow-[0_6px_18px_rgba(201,121,24,0.28)] disabled:opacity-60"
          : "min-h-[42px] cursor-pointer rounded-pill border-0 bg-ink px-[20px] text-[13px] font-semibold text-app disabled:opacity-50"
      }
    >
      {pending ? "Wird gesendet …" : label}
    </button>
  );
}
