"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { LEER, Meldung, type AktionsStatus } from "@/components/ui/Formular";
import { GATE_STATUS_LABEL, type GateStatus } from "@/lib/vorgang/modell";
import { gateSetzen } from "@/app/(app)/vorgaenge/actions";

const SCHRITTE: { wert: GateStatus; label: string }[] = [
  { wert: "laeuft", label: "bestellt" },
  { wert: "erledigt", label: "Liefertermin bestätigt" },
  { wert: "nicht_noetig", label: "kein Material nötig" },
];

/**
 * Das Material-Gate direkt aus der Lagerliste setzen.
 *
 * Drei benannte Schritte statt eines Durchklickens: das Lager arbeitet
 * hier eine Liste ab und soll den Zielzustand wählen, nicht dreimal
 * tippen, bis der richtige kommt.
 */
export function MaterialGate({
  vorgangId,
  gateId,
  status,
}: {
  vorgangId: string;
  gateId: string;
  status: GateStatus;
}) {
  const [meldung, formAction] = useActionState<AktionsStatus, FormData>(
    gateSetzen,
    LEER,
  );

  return (
    <form action={formAction}>
      <input type="hidden" name="vorgangId" value={vorgangId} />
      <input type="hidden" name="gateId" value={gateId} />

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11.5px] text-muted">
          Jetzt: {GATE_STATUS_LABEL[status]}
        </span>
        {SCHRITTE.filter((s) => s.wert !== status).map((s) => (
          <Knopf key={s.wert} wert={s.wert} label={s.label} />
        ))}
      </div>

      <Meldung status={meldung} />
    </form>
  );
}

function Knopf({ wert, label }: { wert: GateStatus; label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name="status"
      value={wert}
      disabled={pending}
      className="cursor-pointer rounded-pill border border-line bg-panel px-[13px] py-[7px] text-[12px] font-medium text-ink hover:bg-sunk disabled:opacity-50"
    >
      {label}
    </button>
  );
}
