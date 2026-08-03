"use client";

import { useState } from "react";

/**
 * Der Portallink des Kunden, direkt am Vorgang.
 *
 * Bisher stand er nur im CRM. Wer einem Kunden am Telefon den Link
 * durchgeben wollte, musste den Vorgang verlassen, den Kunden suchen und
 * dort nachsehen — auf halbem Weg weiss man dann nicht mehr, welcher der
 * drei Vorgänge gemeint war.
 *
 * Nur anzeigen und kopieren. Erzeugt und widerrufen wird der Zugang
 * weiter im CRM: er gehört dem Kunden, nicht dem einzelnen Vorgang, und
 * zwei Stellen zum Widerrufen sind eine zu viel.
 */
export function Portallink({
  link,
  vorgangId,
}: {
  link: string | null;
  vorgangId: string;
}) {
  const [kopiert, setKopiert] = useState(false);

  if (!link) {
    return (
      <p className="text-[11.5px] text-faint">
        Für diesen Kunden gibt es noch keinen Portalzugang. Im CRM unter
        „Kundenportal“ anlegen.
      </p>
    );
  }

  /* Direkt auf den Vorgang, nicht auf die Übersicht — der Kunde soll den
     sehen, über den gerade gesprochen wird. */
  const ziel = `${link}/vorgang/${vorgangId}`;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        readOnly
        value={ziel}
        aria-label="Portallink zu diesem Vorgang"
        onFocus={(e) => e.currentTarget.select()}
        className="num min-w-0 flex-1 rounded-input border border-transparent bg-sunk px-[11px] py-[8px] text-[11px] outline-0 focus:border-accent focus:bg-surface"
      />
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard.writeText(ziel).then(() => {
            setKopiert(true);
            setTimeout(() => setKopiert(false), 2000);
          });
        }}
        className="cursor-pointer rounded-pill border border-line bg-surface px-[13px] py-[7px] text-[11.5px] font-medium text-ink hover:bg-sunk"
      >
        {kopiert ? "Kopiert" : "Kopieren"}
      </button>
      <a
        href={ziel}
        target="_blank"
        rel="noreferrer"
        className="text-[11.5px] font-medium text-accent-ink underline"
      >
        Öffnen
      </a>
    </div>
  );
}
