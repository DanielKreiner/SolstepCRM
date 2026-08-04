"use client";

import { useCallback, useEffect, useState } from "react";
import { flush, list, type QueueItem } from "@/lib/offline/queue";

const LABEL: Record<QueueItem["kind"], string> = {
  time_start: "Einstempeln",
  time_stop: "Ausstempeln",
  stock_move: "Material",
  material: "Material",
};

/*
 * Banner "Offline — 3 Buchungen werden nachgesendet" plus einsehbare
 * Warteschlange mit Typ und Zeit (CLAUDE.md Abschnitt 8). Ein Monteur muss
 * sehen können, was noch offen ist — sonst bucht er aus Unsicherheit doppelt.
 */
export function OfflineBanner() {
  const [online, setOnline] = useState(true);
  const [items, setItems] = useState<QueueItem[]>([]);
  const [offen, setOffen] = useState(false);
  const [meldung, setMeldung] = useState<string | null>(null);

  const aktualisieren = useCallback(async () => {
    setItems(await list());
  }, []);

  const senden = useCallback(async () => {
    const ergebnis = await flush();
    await aktualisieren();
    if (ergebnis.fehler.length > 0) setMeldung(ergebnis.fehler[0] ?? null);
    else if (ergebnis.gesendet > 0) setMeldung(null);
  }, [aktualisieren]);

  useEffect(() => {
    setOnline(navigator.onLine);
    void aktualisieren();

    function aufOnline() {
      setOnline(true);
      void senden();
    }
    function aufOffline() {
      setOnline(false);
    }

    window.addEventListener("online", aufOnline);
    window.addEventListener("offline", aufOffline);
    window.addEventListener("betrieb:queue", aktualisieren);

    // Fallback zum online-Event: manche Geräte melden es unzuverlässig.
    const timer = window.setInterval(() => {
      if (navigator.onLine) void senden();
    }, 20_000);

    if (navigator.onLine) void senden();

    return () => {
      window.removeEventListener("online", aufOnline);
      window.removeEventListener("offline", aufOffline);
      window.removeEventListener("betrieb:queue", aktualisieren);
      window.clearInterval(timer);
    };
  }, [aktualisieren, senden]);

  if (online && items.length === 0 && !meldung) return null;

  return (
    <div className="px-4 pb-2">
      <div
        data-testid="offline-banner"
        className={[
          "rounded-input px-4 py-3",
          online ? "bg-accent-sunk" : "bg-s-warn/15",
        ].join(" ")}
      >
        <button
          type="button"
          onClick={() => setOffen((v) => !v)}
          className="flex w-full items-center gap-2 text-left"
        >
          <span
            aria-hidden
            className={[
              "h-[9px] w-[9px] shrink-0 rounded-pill",
              online ? "bg-s-done" : "bg-s-warn",
            ].join(" ")}
          />
          <span className="flex-1 text-[13px] font-medium">
            {online ? "Verbunden" : "Offline"}
            {items.length > 0
              ? ` — ${items.length} ${items.length === 1 ? "Buchung wird" : "Buchungen werden"} nachgesendet`
              : ""}
          </span>
          {items.length > 0 ? (
            <span className="text-[11px] text-muted">
              {offen ? "schließen" : "ansehen"}
            </span>
          ) : null}
        </button>

        {offen && items.length > 0 ? (
          <ul className="mt-3 flex flex-col gap-2 border-t border-line pt-3">
            {items.map((i) => (
              <li
                key={i.id}
                className="flex items-center gap-3 text-[12.5px]"
              >
                <span className="num w-[52px] shrink-0 text-muted">
                  {new Date(i.clientTs).toLocaleTimeString("de-AT", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
                <span className="flex-1">{LABEL[i.kind]}</span>
                {i.attempts > 0 ? (
                  <span className="num text-[11px] text-s-crit">
                    {i.attempts} Versuche
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}

        {meldung ? (
          <p role="alert" className="mt-2 text-[12px] font-medium text-s-crit">
            {meldung}
          </p>
        ) : null}
      </div>
    </div>
  );
}
