"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { LEER, Meldung, type AktionsStatus } from "@/components/ui/Formular";
import { Pill } from "@/components/ui/Pill";
import { dateTime } from "@/lib/format";
import { Anhaenge, DateiFeld, type AnhangAnzeige } from "./Anhaenge";
import {
  anfrageErledigt,
  anfrageStellen,
  nachrichtSenden,
} from "@/app/(app)/vorgaenge/chat-actions";

export type ChatNachricht = {
  id: string;
  autor: "kunde" | "betrieb";
  autorName: string | null;
  body: string;
  intern: boolean;
  createdAt: string;
  anhaenge: AnhangAnzeige[];
};

export type ChatAnfrage = {
  id: string;
  titel: string;
  beschreibung: string | null;
  fotoNoetig: boolean;
  status: string;
  antwortText: string | null;
  beantwortetAm: string | null;
  anhaenge: AnhangAnzeige[];
};

/**
 * Das Gespräch mit dem Kunden — im Vorgang, nicht im Postfach.
 *
 * Links der Kunde, rechts der Betrieb, interne Notizen abgesetzt. Dazu
 * Rückfragen: „Schicken Sie ein Bild vom Zählerkasten" ist die häufigste
 * Frage vor jeder Montage, und per Mail gestellt bedeutet sie, die
 * Antwort später in einem Postfach zu suchen.
 */
export function Chat({
  vorgangId,
  nachrichten,
  anfragen,
  darfSchreiben,
}: {
  vorgangId: string;
  nachrichten: ChatNachricht[];
  anfragen: ChatAnfrage[];
  darfSchreiben: boolean;
}) {
  const offen = anfragen.filter((a) => a.status === "offen");
  const beantwortet = anfragen.filter((a) => a.status === "beantwortet");

  return (
    <section className="rounded-[20px] bg-surface p-5 shadow-soft">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[15px] font-semibold">Gespräch mit dem Kunden</h2>
        {beantwortet.length > 0 ? (
          <Pill tone="done">{beantwortet.length} beantwortet</Pill>
        ) : null}
        {offen.length > 0 ? <Pill tone="warn">{offen.length} offen</Pill> : null}
      </div>

      {anfragen.length > 0 ? (
        <ul className="mb-4 flex flex-col gap-2">
          {anfragen.map((a) => (
            <li
              key={a.id}
              className={[
                "rounded-card px-4 py-3",
                a.status === "beantwortet"
                  ? "bg-s-done/8"
                  : a.status === "erledigt"
                    ? "bg-panel"
                    : "border border-s-warn/30 bg-s-warn/8",
              ].join(" ")}
            >
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-[13px] font-semibold">{a.titel}</span>
                {a.fotoNoetig ? <Pill tone="neutral">Foto nötig</Pill> : null}
                <Pill
                  tone={
                    a.status === "beantwortet"
                      ? "done"
                      : a.status === "erledigt"
                        ? "neutral"
                        : "warn"
                  }
                >
                  {a.status}
                </Pill>
              </div>
              {a.beschreibung ? (
                <p className="mt-1 text-[12.5px] text-muted">{a.beschreibung}</p>
              ) : null}

              {a.antwortText ? (
                <p className="mt-2 rounded-input bg-surface px-3 py-2 text-[13px]">
                  {a.antwortText}
                </p>
              ) : null}
              <Anhaenge anhaenge={a.anhaenge} />

              {darfSchreiben && a.status === "beantwortet" ? (
                <ErledigtKnopf vorgangId={vorgangId} anfrageId={a.id} />
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {nachrichten.length === 0 ? (
        <p className="text-[13px] text-muted">Noch keine Nachricht.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {nachrichten.map((n) => (
            <li
              key={n.id}
              className={[
                "rounded-card px-4 py-3",
                n.intern
                  ? "border border-s-warn/30 bg-s-warn/8"
                  : n.autor === "kunde"
                    ? "bg-panel"
                    : "bg-accent-sunk",
              ].join(" ")}
            >
              <div className="mb-[2px] flex flex-wrap items-baseline gap-2">
                <span className="text-[12px] font-semibold">
                  {n.autor === "kunde" ? (n.autorName ?? "Kunde") : (n.autorName ?? "Betrieb")}
                </span>
                {n.intern ? <Pill tone="warn">intern</Pill> : null}
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

      {darfSchreiben ? (
        <>
          <Schreiben vorgangId={vorgangId} />
          <Fragen vorgangId={vorgangId} />
        </>
      ) : null}
    </section>
  );
}

function Schreiben({ vorgangId }: { vorgangId: string }) {
  const [status, formAction] = useActionState<AktionsStatus, FormData>(
    nachrichtSenden,
    LEER,
  );
  const [intern, setIntern] = useState(false);

  return (
    <form
      action={formAction}
      key={status.ok ?? "leer"}
      className="mt-4 border-t border-line pt-4"
    >
      <input type="hidden" name="vorgangId" value={vorgangId} />
      <input type="hidden" name="intern" value={intern ? "ja" : "nein"} />

      <label htmlFor="chat-body" className="mb-[5px] block text-[12px] font-medium text-muted">
        {intern ? "Interne Notiz — der Kunde sieht sie nicht" : "Nachricht an den Kunden"}
      </label>
      <textarea
        id="chat-body"
        name="body"
        rows={3}
        className={[
          "w-full resize-y rounded-input border px-[13px] py-[11px] text-[13.5px] outline-0 focus:border-accent",
          intern ? "border-s-warn/40 bg-s-warn/8" : "border-transparent bg-sunk",
        ].join(" ")}
      />

      <div className="mt-3">
        <DateiFeld id="chat-anhang" label="Bild oder Beleg anhängen" />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Absenden label={intern ? "Notiz speichern" : "Senden"} />
        <button
          type="button"
          role="switch"
          aria-checked={intern}
          onClick={() => setIntern((i) => !i)}
          className="flex items-center gap-2 rounded-pill border border-line px-4 py-[9px] text-[12.5px] font-medium"
        >
          <span
            aria-hidden
            className={[
              "grid h-[16px] w-[16px] place-items-center rounded-[5px] border-2 text-[10px]",
              intern ? "border-s-warn bg-s-warn text-white" : "border-line-strong",
            ].join(" ")}
          >
            {intern ? "✓" : ""}
          </span>
          Interne Notiz
        </button>
      </div>

      <Meldung status={status} />
    </form>
  );
}

function Fragen({ vorgangId }: { vorgangId: string }) {
  const [offen, setOffen] = useState(false);
  const [status, formAction] = useActionState<AktionsStatus, FormData>(
    anfrageStellen,
    LEER,
  );

  if (!offen) {
    return (
      <button
        type="button"
        onClick={() => setOffen(true)}
        className="mt-3 cursor-pointer border-0 bg-transparent text-[12.5px] font-medium text-accent-ink underline"
      >
        Rückfrage an den Kunden stellen
      </button>
    );
  }

  return (
    <form
      action={formAction}
      key={status.ok ?? "leer"}
      className="mt-4 border-t border-line pt-4"
    >
      <input type="hidden" name="vorgangId" value={vorgangId} />

      <h3 className="text-[13px] font-semibold">Rückfrage</h3>
      <p className="mt-1 mb-3 text-[11.5px] text-muted">
        Der Kunde sieht sie oben in seinem Portal und kann direkt antworten.
      </p>

      <label htmlFor="rf-titel" className="mb-[5px] block text-[12px] font-medium text-muted">
        Worum geht es?
      </label>
      <input
        id="rf-titel"
        name="titel"
        required
        placeholder="Foto vom Zählerkasten"
        className="w-full rounded-input border border-transparent bg-sunk px-[13px] py-[10px] text-[13.5px] outline-0 focus:border-accent"
      />

      <label htmlFor="rf-text" className="mt-3 mb-[5px] block text-[12px] font-medium text-muted">
        Erklärung
      </label>
      <textarea
        id="rf-text"
        name="beschreibung"
        rows={2}
        placeholder="Bitte mit geöffneter Tür, damit wir den Platz für den Smart Meter sehen."
        className="w-full resize-y rounded-input border border-transparent bg-sunk px-[13px] py-[10px] text-[13px] outline-0 focus:border-accent"
      />

      <label className="mt-3 flex items-center gap-2 text-[12.5px]">
        <input
          type="checkbox"
          name="fotoNoetig"
          value="ja"
          className="h-4 w-4 accent-[var(--accent)]"
        />
        Foto ist Pflicht — ohne Bild kann der Kunde nicht antworten
      </label>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Absenden label="Rückfrage stellen" />
        <button
          type="button"
          onClick={() => setOffen(false)}
          className="cursor-pointer border-0 bg-transparent text-[12.5px] text-muted underline"
        >
          Abbrechen
        </button>
      </div>

      <Meldung status={status} />
    </form>
  );
}

function ErledigtKnopf({
  vorgangId,
  anfrageId,
}: {
  vorgangId: string;
  anfrageId: string;
}) {
  const [status, formAction] = useActionState<AktionsStatus, FormData>(
    anfrageErledigt,
    LEER,
  );

  return (
    <form action={formAction} className="mt-2">
      <input type="hidden" name="vorgangId" value={vorgangId} />
      <input type="hidden" name="anfrageId" value={anfrageId} />
      <button
        type="submit"
        className="cursor-pointer rounded-pill border border-line bg-surface px-[13px] py-[6px] text-[11.5px] font-medium text-ink hover:bg-sunk"
      >
        Als erledigt vermerken
      </button>
      <Meldung status={status} />
    </form>
  );
}

function Absenden({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="min-h-[38px] cursor-pointer rounded-pill border-0 bg-ink px-[18px] text-[12.5px] font-semibold text-app disabled:opacity-50"
    >
      {pending ? "…" : label}
    </button>
  );
}
