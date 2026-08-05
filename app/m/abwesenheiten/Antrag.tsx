"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { requestAbsence } from "@/app/(app)/abwesenheiten/actions";

const LEER = { error: null, ok: null };

/**
 * Urlaub beantragen, Krankenstand melden — vom Handy aus.
 *
 * Beides ging bisher nur im Büro. Das heisst in der Praxis: der Monteur
 * ruft an, jemand tippt es ab, und zwischen Anruf und Eintrag steht in
 * der Plantafel jemand, der nicht kommt. Der Antrag gehört dorthin, wo
 * die Person ist.
 *
 * Der Unterschied zwischen den beiden ist keine Kosmetik: Urlaub wird
 * BEANTRAGT und wartet auf eine Entscheidung, Krankenstand wird
 * GEMELDET und gilt sofort. Wer krank ist, fragt nicht um Erlaubnis.
 */
export function Antrag({ heute }: { heute: string }) {
  const [status, senden] = useActionState(requestAbsence, LEER);
  const [offen, setOffen] = useState<"vacation" | "sick" | null>(null);

  if (status.ok && offen) setOffen(null);

  if (!offen) {
    return (
      <div className="mb-4 flex gap-2">
        <button
          type="button"
          data-testid="urlaub-beantragen"
          onClick={() => setOffen("vacation")}
          className="min-h-[52px] flex-1 cursor-pointer rounded-pill border-0 bg-[linear-gradient(150deg,var(--accent-from),var(--accent-to))] px-5 text-[14.5px] font-semibold text-white"
        >
          Urlaub beantragen
        </button>
        <button
          type="button"
          data-testid="krank-melden"
          onClick={() => setOffen("sick")}
          className="min-h-[52px] flex-1 cursor-pointer rounded-pill border border-line bg-surface px-5 text-[14.5px] font-semibold text-ink"
        >
          Krank melden
        </button>
      </div>
    );
  }

  const krank = offen === "sick";

  return (
    <section className="mb-4 rounded-[20px] bg-surface p-5 shadow-soft">
      <h2 className="text-[16px] font-semibold">
        {krank ? "Krankenstand melden" : "Urlaub beantragen"}
      </h2>
      <p className="mt-1 mb-3 text-[13px] text-muted">
        {krank
          ? "Gilt sofort. Das Büro sieht es und plant um."
          : "Geht als Antrag ins Büro. Du siehst hier, sobald entschieden ist."}
      </p>

      <form action={senden} className="flex flex-col gap-3">
        <input type="hidden" name="kind" value={offen} />

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-[5px]">
            <span className="text-[12px] font-medium text-muted">Von</span>
            <input
              name="from"
              type="date"
              required
              defaultValue={heute}
              data-testid="abwesenheit-von"
              className="num min-h-[48px] w-full rounded-input border border-line bg-surface px-[13px] text-[15px] outline-0 focus:border-accent"
            />
          </label>
          <label className="flex flex-col gap-[5px]">
            <span className="text-[12px] font-medium text-muted">Bis</span>
            <input
              name="to"
              type="date"
              required
              defaultValue={heute}
              data-testid="abwesenheit-bis"
              className="num min-h-[48px] w-full rounded-input border border-line bg-surface px-[13px] text-[15px] outline-0 focus:border-accent"
            />
          </label>
        </div>

        {/*
          Kein Grundfeld beim Krankenstand — auch nicht optional.
          Ein Freitext neben "krank" wird zum Diagnosefeld, und das ist
          ein Gesundheitsdatum nach Art. 9 DSGVO (CLAUDE.md 12.b).
        */}
        {krank ? null : (
          <label className="flex flex-col gap-[5px]">
            <span className="text-[12px] font-medium text-muted">
              Anmerkung — optional
            </span>
            <input
              name="note"
              placeholder="z. B. schon lange geplant"
              data-testid="abwesenheit-notiz"
              className="min-h-[48px] w-full rounded-input border border-line bg-surface px-[13px] text-[15px] outline-0 focus:border-accent"
            />
          </label>
        )}

        <label className="flex items-center gap-2 text-[13.5px]">
          <input
            type="checkbox"
            name="halfDay"
            value="ja"
            className="h-[18px] w-[18px] accent-[var(--accent)]"
          />
          Nur ein halber Tag
        </label>

        {status.error ? (
          <p
            role="alert"
            className="rounded-input bg-s-crit/10 px-4 py-3 text-[13px] text-s-crit"
          >
            {status.error}
          </p>
        ) : null}

        <div className="flex gap-2">
          <Absenden label={krank ? "Krankenstand melden" : "Antrag senden"} />
          <button
            type="button"
            onClick={() => setOffen(null)}
            className="min-h-[52px] cursor-pointer rounded-pill border border-line bg-surface px-5 text-[14px] text-ink"
          >
            Abbrechen
          </button>
        </div>
      </form>
    </section>
  );
}

function Absenden({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      data-testid="abwesenheit-senden"
      className="min-h-[52px] flex-1 cursor-pointer rounded-pill border-0 bg-[linear-gradient(150deg,var(--accent-from),var(--accent-to))] px-5 text-[15px] font-semibold text-white disabled:opacity-60"
    >
      {pending ? "…" : label}
    </button>
  );
}
