"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { LEER, Meldung, type AktionsStatus } from "@/components/ui/Formular";
import { dateTime } from "@/lib/format";
import { notizAnlegen } from "@/app/(app)/vorgaenge/actions";

export type StromEintrag = {
  id: string;
  typ: string;
  titel: string;
  body: string | null;
  createdAt: string;
  autorName: string | null;
};

/**
 * Farbe und Kurzname je Ereignisart.
 *
 * Der Strom mischt zehn Arten. Ohne Kennzeichnung liest man eine Wand aus
 * Absätzen und findet die Phasenwechsel nicht wieder — die sind aber das,
 * wonach man sucht, wenn man drei Wochen später nachvollzieht, was
 * passiert ist.
 */
const ART: Record<string, { label: string; klasse: string }> = {
  notiz: { label: "Notiz", klasse: "bg-sunk text-muted" },
  phase_wechsel: { label: "Phase", klasse: "bg-s-done/14 text-s-done" },
  gate_update: { label: "Gate", klasse: "bg-s-warn/14 text-accent-ink" },
  dokument: { label: "Dokument", klasse: "bg-s-waiting/14 text-s-waiting" },
  email: { label: "Mail", klasse: "bg-s-doing/14 text-s-doing" },
  termin: { label: "Termin", klasse: "bg-s-waiting/14 text-s-waiting" },
  zeit: { label: "Zeit", klasse: "bg-s-doing/14 text-s-doing" },
  rechnung: { label: "Rechnung", klasse: "bg-s-warn/14 text-accent-ink" },
  zahlung: { label: "Zahlung", klasse: "bg-s-done/14 text-s-done" },
  status_override: { label: "Override", klasse: "bg-s-crit/12 text-s-crit" },
};

export function Strom({
  vorgangId,
  eintraege,
  darfSchreiben,
}: {
  vorgangId: string;
  eintraege: StromEintrag[];
  darfSchreiben: boolean;
}) {
  return (
    <section className="rounded-[20px] bg-surface p-5 shadow-soft">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[15px] font-semibold">Verlauf</h2>
        <span className="num text-[11.5px] text-faint">
          {eintraege.length}{" "}
          {eintraege.length === 1 ? "Eintrag" : "Einträge"}
        </span>
      </div>

      {darfSchreiben ? <Composer vorgangId={vorgangId} /> : null}

      {eintraege.length === 0 ? (
        <p className="text-[13px] text-muted">Noch nichts passiert.</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {eintraege.map((e) => {
            const a = ART[e.typ] ?? { label: e.typ, klasse: "bg-sunk text-muted" };
            return (
              <li key={e.id} className="rounded-card bg-panel px-4 py-3">
                <div className="mb-[3px] flex flex-wrap items-baseline gap-2">
                  <span
                    className={`rounded-pill px-[8px] py-[2px] text-[10px] font-semibold ${a.klasse}`}
                  >
                    {a.label}
                  </span>
                  <span className="text-[13px] font-semibold">{e.titel}</span>
                  <span className="num ml-auto text-[11px] text-faint">
                    {dateTime(e.createdAt)}
                    {e.autorName ? ` · ${e.autorName}` : ""}
                  </span>
                </div>
                {e.body ? (
                  <p className="text-[13px] leading-[1.55] whitespace-pre-line text-muted">
                    {e.body}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

/**
 * Der Composer steht oben, nicht unten.
 *
 * Der Strom ist neueste zuerst. Ein Eingabefeld am Ende einer Liste mit
 * zweihundert Einträgen findet niemand.
 */
function Composer({ vorgangId }: { vorgangId: string }) {
  const [status, formAction] = useActionState<AktionsStatus, FormData>(
    notizAnlegen,
    LEER,
  );

  return (
    <form
      action={formAction}
      key={status.ok ?? "leer"}
      className="mb-4 border-b border-line pb-4"
    >
      <input type="hidden" name="vorgangId" value={vorgangId} />

      <label htmlFor="composer" className="sr-only">
        Notiz zum Vorgang
      </label>
      <textarea
        id="composer"
        name="body"
        rows={2}
        placeholder="Notiz — was besprochen wurde, was auffällt, was als Nächstes ansteht."
        className="w-full resize-y rounded-input border border-transparent bg-sunk px-[13px] py-[10px] text-[13.5px] outline-0 focus:border-accent focus:bg-surface"
      />

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <ComposerKnopf />
        <span className="text-[11px] text-faint">
          Landet mit Zeitstempel und Namen im Verlauf.
        </span>
      </div>

      <Meldung status={status} />
    </form>
  );
}

function ComposerKnopf() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="min-h-[38px] cursor-pointer rounded-pill border-0 bg-ink px-[18px] text-[12.5px] font-semibold text-app disabled:opacity-50"
    >
      {pending ? "Wird gespeichert …" : "Notiz hinzufügen"}
    </button>
  );
}
