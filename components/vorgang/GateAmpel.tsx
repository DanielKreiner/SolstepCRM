"use client";

import { useActionState } from "react";
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

/**
 * Gate-Ampel im Kopf: kompakt, ein Klick schaltet weiter.
 *
 * Die Reihenfolge ist offen → läuft → erledigt → nicht nötig. Kein
 * Auswahlmenü, weil ein Gate im Alltag genau einen Weg geht und jeder
 * Klick weniger ein Griff weniger mit dem Handschuh am Tablet ist.
 */
export function GateAmpel({
  vorgangId,
  gates,
  gesperrt,
}: {
  vorgangId: string;
  gates: GateAnzeige[];
  gesperrt: boolean;
}) {
  const [status, formAction] = useActionState<AktionsStatus, FormData>(
    gateSetzen,
    LEER,
  );

  if (gates.length === 0) return null;

  return (
    <div>
      <form action={formAction} className="flex flex-wrap gap-[6px]">
        <input type="hidden" name="vorgangId" value={vorgangId} />
        {gates.map((g) => {
          const t = TON[g.status];
          return (
            <button
              key={g.id}
              type="submit"
              name="gateId"
              value={g.id}
              disabled={gesperrt}
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
                {gesperrt ? "" : " — klicken schaltet weiter"}
              </span>
            </button>
          );
        })}
      </form>

      <Meldung status={status} />
    </div>
  );
}
