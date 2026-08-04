"use client";

import { useActionState } from "react";
import { LEER, Meldung, type AktionsStatus } from "@/components/ui/Formular";
import { Pill, type Tone } from "@/components/ui/Pill";
import { mailErneutSenden } from "@/app/(app)/vorgaenge/versand-actions";

/**
 * Was an den Kunden rausgegangen ist.
 *
 * Ohne diese Liste ist der Versand ein schwarzes Loch: es steht nirgends,
 * ob die Rückfrage von Dienstag angekommen ist oder in der Warteschlange
 * hängt. Und wenn eine Mail im Spam gelandet ist, muss man sie ein
 * zweites Mal schicken können, ohne den Text neu zu tippen.
 *
 * Kein „zugestellt": über das Postfach des Mandanten gibt es kein
 * Zustellereignis (CLAUDE.md 6.1), und etwas anderes zu behaupten wäre
 * gelogen.
 */

export type MailZeile = {
  id: string;
  art: string | null;
  betreff: string;
  an: string[];
  status: string;
  versuche: number;
  fehler: string | null;
  gesendetAm: string | null;
  erstelltAm: string;
  erneutZu: string | null;
};

const ART: Record<string, string> = {
  angebot: "Angebot",
  rueckfrage: "Rückfrage",
  nachricht: "Nachricht",
  mahnung: "Mahnung",
  bestellung: "Bestellung",
};

const ZUSTAND: Record<string, { label: string; tone: Tone }> = {
  queued: { label: "in der Warteschlange", tone: "waiting" },
  sending: { label: "geht gerade raus", tone: "doing" },
  sent: { label: "gesendet", tone: "done" },
  failed: { label: "gescheitert", tone: "crit" },
};

export function Postausgang({
  vorgangId,
  mails,
  darfSchreiben,
}: {
  vorgangId: string;
  mails: MailZeile[];
  darfSchreiben: boolean;
}) {
  const [status, erneut] = useActionState<AktionsStatus, FormData>(
    mailErneutSenden,
    LEER,
  );

  return (
    <section className="rounded-[20px] bg-surface p-5 shadow-soft">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[15px] font-semibold">Postausgang</h2>
        <span className="text-[11.5px] text-faint">
          Versand alle zwei Minuten
        </span>
      </div>

      {mails.length === 0 ? (
        <p className="text-[12.5px] text-muted">
          An diesen Kunden ging noch keine Mail raus.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {mails.map((m) => {
            const z = ZUSTAND[m.status] ?? {
              label: m.status,
              tone: "neutral" as Tone,
            };
            return (
              <li key={m.id} className="rounded-input bg-panel px-4 py-3">
                <div className="flex flex-wrap items-baseline gap-2">
                  {m.art ? (
                    <span className="text-[11px] font-semibold tracking-[0.08em] text-faint uppercase">
                      {ART[m.art] ?? m.art}
                    </span>
                  ) : null}
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                    {m.betreff}
                  </span>
                  <Pill tone={z.tone}>{z.label}</Pill>
                </div>

                <div className="num mt-1 text-[11.5px] text-faint">
                  {m.an.join(", ")} ·{" "}
                  {zeit(m.gesendetAm ?? m.erstelltAm)}
                  {m.erneutZu ? " · Wiederholung" : ""}
                  {m.versuche > 1 ? ` · ${m.versuche} Versuche` : ""}
                </div>

                {m.fehler ? (
                  <p className="mt-1 text-[11.5px] text-s-crit">{m.fehler}</p>
                ) : null}

                {darfSchreiben ? (
                  <form action={erneut} className="mt-2">
                    <input type="hidden" name="vorgangId" value={vorgangId} />
                    <input type="hidden" name="mailId" value={m.id} />
                    <button
                      type="submit"
                      className="cursor-pointer rounded-pill border border-line bg-surface px-[13px] py-[5px] text-[11.5px] font-medium text-ink transition-colors hover:bg-sunk"
                    >
                      Erneut senden
                    </button>
                  </form>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <Meldung status={status} />
    </section>
  );
}

function zeit(iso: string): string {
  return new Date(iso).toLocaleString("de-AT", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
