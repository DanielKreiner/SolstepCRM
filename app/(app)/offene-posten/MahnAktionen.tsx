"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { jetztMahnen, mahnlaufSetzen, type MahnStatus } from "./actions";

const LEER: MahnStatus = { error: null, ok: null };

/**
 * Mahnen und Aussetzen, direkt an der Zeile.
 *
 * Kein Dialog: beides ist ein Klick mit einer Rückmeldung, und ein Modal
 * dafür wäre genau die Reibung, wegen der am Ende niemand mahnt
 * (CLAUDE.md Abschnitt 10).
 */
export function MahnAktionen({
  dokumentId,
  mahnungAktiv,
  faellig,
}: {
  dokumentId: string;
  mahnungAktiv: boolean;
  /** Überfällig? Ist sie es nicht, gibt es nichts zu mahnen. */
  faellig: boolean;
}) {
  const [mahnStatus, mahnAction] = useActionState(jetztMahnen, LEER);
  const [setzStatus, setzAction] = useActionState(mahnlaufSetzen, LEER);

  const meldung =
    mahnStatus.error ?? setzStatus.error ?? mahnStatus.ok ?? setzStatus.ok;
  const fehler = Boolean(mahnStatus.error ?? setzStatus.error);

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
      {faellig && mahnungAktiv ? (
        <form action={mahnAction}>
          <input type="hidden" name="dokumentId" value={dokumentId} />
          <Knopf label="Jetzt mahnen" haupt />
        </form>
      ) : null}

      <form action={setzAction}>
        <input type="hidden" name="dokumentId" value={dokumentId} />
        <input type="hidden" name="aktiv" value={mahnungAktiv ? "nein" : "ja"} />
        <Knopf label={mahnungAktiv ? "Mahnlauf aussetzen" : "Mahnlauf aufnehmen"} />
      </form>

      {meldung ? (
        <span
          role={fehler ? "alert" : "status"}
          className={[
            "text-[11.5px] font-medium",
            fehler ? "text-s-crit" : "text-s-done",
          ].join(" ")}
        >
          {meldung}
        </span>
      ) : null}
    </div>
  );
}

function Knopf({ label, haupt = false }: { label: string; haupt?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={[
        "cursor-pointer rounded-pill px-[13px] py-[6px] text-[11.5px] font-medium disabled:opacity-50",
        haupt
          ? "border-0 bg-ink text-app"
          : "border border-line bg-surface text-ink hover:bg-sunk",
      ].join(" ")}
    >
      {pending ? "…" : label}
    </button>
  );
}
