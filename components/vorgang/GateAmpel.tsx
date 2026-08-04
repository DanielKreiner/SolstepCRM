"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Dialog } from "@/components/ui/Dialog";
import { GATE_STATUS_LABEL, type GateStatus } from "@/lib/vorgang/modell";
import { LEER, Meldung, type AktionsStatus } from "@/components/ui/Formular";
import { gateSetzen } from "@/app/(app)/vorgaenge/actions";

export type GateAnzeige = {
  id: string;
  key: string;
  label: string;
  meta: string | null;
  status: GateStatus;
  blocking: boolean;
  zustaendigName: string | null;
  faelligAm: string | null;
};

/** Farbe und Zeichen je Zustand — einmal, damit Kopf und Panel gleich aussehen. */
const TON: Record<GateStatus, { klasse: string; zeichen: string }> = {
  offen: { klasse: "bg-sunk text-muted", zeichen: "" },
  laeuft: { klasse: "bg-s-warn/14 text-accent-ink", zeichen: "·" },
  erledigt: { klasse: "bg-s-done/14 text-s-done", zeichen: "✓" },
  nicht_noetig: { klasse: "bg-sunk text-faint", zeichen: "–" },
};

const ERKLAERUNG: Record<GateStatus, string> = {
  offen: "Noch nichts passiert.",
  laeuft: "Ist angestossen, aber noch nicht bestätigt.",
  erledigt: "Fertig und bestätigt. Gibt die Terminierung frei.",
  nicht_noetig: "Fällt bei diesem Auftrag weg — zählt wie erledigt.",
};

/**
 * Die Gates eines Vorgangs.
 *
 * Vorher schaltete ein Klick zum nächsten Zustand weiter. Von „offen" auf
 * „erledigt" waren das zwei Klicks über „läuft" hinweg — und ein Klick zu
 * viel setzte ein Gate ungewollt weiter, ohne dass jemand gefragt wurde.
 * Ein Gate hält die Montage auf; das ist keine Sache für einen
 * Streifklick.
 *
 * Jetzt öffnet ein Klick ein Fenster mit den vier Zuständen. Ein Griff
 * für den, der weiss was er will, und eine Rückfrage für alle anderen.
 */
export function GateAmpel({
  vorgangId,
  gates,
  gesperrt,
  berechnet = [],
}: {
  vorgangId: string;
  gates: GateAnzeige[];
  gesperrt: boolean;
  /**
   * Gates, die sich aus Daten ergeben und deshalb nicht von Hand gesetzt
   * werden. „Material" ist grün, wenn die Bedarfsliste gedeckt ist —
   * ein Häkchen liesse sich setzen, ohne dass ein Dachhaken bestellt
   * wäre, und dann steht das Team am Montag vor einem leeren Bus.
   */
  berechnet?: string[];
}) {
  const [offen, setOffen] = useState<GateAnzeige | null>(null);
  const [status, formAction] = useActionState<AktionsStatus, FormData>(
    gateSetzen,
    LEER,
  );

  if (gates.length === 0) return null;

  /* Nach dem Speichern schliesst sich das Fenster von selbst. */
  if (status.ok && offen) setOffen(null);

  return (
    <div>
      <div className="flex flex-wrap gap-[6px]">
        {gates.map((g) => {
          const t = TON[g.status];
          return (
            <button
              key={g.id}
              type="button"
              disabled={gesperrt}
              onClick={() => setOffen(g)}
              title={
                gesperrt
                  ? "Gates ändert nur, wer Vorgänge schreiben darf."
                  : `${g.label}: ${GATE_STATUS_LABEL[g.status]}${
                      g.meta ? ` — ${g.meta}` : ""
                    }`
              }
              className={[
                "flex items-center gap-[6px] rounded-pill px-[11px] py-[6px] text-[12px] font-medium transition-colors",
                t.klasse,
                gesperrt ? "cursor-not-allowed opacity-70" : "cursor-pointer",
              ].join(" ")}
            >
              <span aria-hidden className="w-[9px] text-center">
                {t.zeichen}
              </span>
              {g.label}
              {g.blocking ? (
                <span
                  className="rounded-pill bg-s-crit/10 px-[6px] py-px text-[9.5px] font-semibold text-s-crit"
                  title="Pflicht — hält die Terminierung auf"
                >
                  Pflicht
                </span>
              ) : null}
              <span className="sr-only">
                {GATE_STATUS_LABEL[g.status]}
                {gesperrt ? "" : " — klicken öffnet die Auswahl"}
              </span>
            </button>
          );
        })}
      </div>

      <Meldung status={status} />

      {offen ? (
        <Dialog offen titel={offen.label} schliessen={() => setOffen(null)}>
          <p className="mb-1 text-[13px] text-muted">
            Steht auf{" "}
            <strong className="font-semibold text-ink">
              {GATE_STATUS_LABEL[offen.status]}
            </strong>
            .{offen.meta ? ` ${offen.meta}` : ""}
          </p>
          {offen.blocking ? (
            <p className="mb-4 text-[12.5px] text-accent-ink">
              Pflicht-Gate — die Montage lässt sich erst terminieren, wenn es
              durch ist.
            </p>
          ) : (
            <p className="mb-4 text-[12.5px] text-faint">
              Kein Pflicht-Gate. Hält die Terminierung nicht auf.
            </p>
          )}

          {berechnet.includes(offen.key) ? (
            <div className="rounded-input bg-sunk px-4 py-3 text-[12.5px] text-muted">
              <p className="mb-2">
                Dieses Gate wird gerechnet, nicht abgehakt: es steht auf grün,
                sobald jede Position der Bedarfsliste gedeckt ist.
              </p>
              <a
                href={`/vorgaenge/${vorgangId}?tab=material`}
                className="font-semibold text-accent-ink hover:underline"
              >
                Zur Bedarfsliste
              </a>
            </div>
          ) : (
            <form action={formAction} className="flex flex-col gap-2">
              <input type="hidden" name="vorgangId" value={vorgangId} />
              <input type="hidden" name="gateId" value={offen.id} />

              {(["erledigt", "laeuft", "nicht_noetig", "offen"] as GateStatus[]).map(
                (s) => (
                  <Wahl
                    key={s}
                    wert={s}
                    aktiv={offen.status === s}
                    label={GATE_STATUS_LABEL[s]}
                    hinweis={ERKLAERUNG[s]}
                  />
                ),
              )}
            </form>
          )}

          {offen.zustaendigName || offen.faelligAm ? (
            <p className="mt-4 border-t border-line pt-3 text-[11.5px] text-faint">
              {offen.zustaendigName ? `Zuständig ${offen.zustaendigName}` : ""}
              {offen.zustaendigName && offen.faelligAm ? " · " : ""}
              {offen.faelligAm ? `fällig ${offen.faelligAm}` : ""}
            </p>
          ) : null}
        </Dialog>
      ) : null}
    </div>
  );
}

/**
 * Ein Zustand als ganze Zeile.
 *
 * Ein Knopf und kein Auswahlfeld mit Bestätigen: der Griff soll einer
 * bleiben. Die Erklärung steht daneben, damit „nicht nötig" nicht mit
 * „offen" verwechselt wird — der Unterschied entscheidet, ob die Montage
 * losgeht.
 */
function Wahl({
  wert,
  aktiv,
  label,
  hinweis,
}: {
  wert: GateStatus;
  aktiv: boolean;
  label: string;
  hinweis: string;
}) {
  const { pending } = useFormStatus();
  const t = TON[wert];

  return (
    <button
      type="submit"
      name="status"
      value={wert}
      disabled={pending || aktiv}
      aria-current={aktiv ? "true" : undefined}
      className={[
        "flex w-full items-start gap-3 rounded-card border px-4 py-3 text-left transition-colors",
        aktiv
          ? "cursor-default border-line bg-panel"
          : "cursor-pointer border-line bg-surface hover:border-accent hover:bg-accent/6",
      ].join(" ")}
    >
      <span
        aria-hidden
        className={[
          "mt-[1px] grid h-[22px] w-[22px] shrink-0 place-items-center rounded-pill text-[12px] font-bold",
          t.klasse,
        ].join(" ")}
      >
        {t.zeichen || "○"}
      </span>
      <span className="min-w-0">
        <span className="block text-[13.5px] font-semibold">
          {label}
          {aktiv ? (
            <span className="ml-2 text-[11px] font-normal text-faint">
              steht schon so
            </span>
          ) : null}
        </span>
        <span className="block text-[12px] text-muted">{hinweis}</span>
      </span>
    </button>
  );
}
