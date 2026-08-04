"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { DunkleKarte } from "@/components/ui/Abschnitt";

/*
 * "Zeit laeuft" — die dunkle Karte aus dem Cockpit der Vorlage.
 *
 * Der Server liefert nur den Startzeitpunkt, die Sekunden zaehlt der Client.
 * Andersherum muesste die Seite jede Sekunde neu rendern, und ein Cockpit,
 * das sekuendlich vom Server nachlaedt, ist ein Cockpit, das man zumacht.
 *
 * Die Uhr startet bewusst erst nach dem ersten Client-Render (jetzt = null):
 * Server und Client wuerden sonst unterschiedliche Sekunden rendern und React
 * meldet eine Hydration-Abweichung.
 */

export function LaufendeZeit({
  seit,
  auftragNummer,
  auftragId,
  personen,
  eigene,
}: {
  seit: string;
  auftragNummer: string | null;
  auftragId: string | null;
  personen: string[];
  /** Laeuft die Buchung auf den angemeldeten Nutzer selbst? */
  eigene: boolean;
}) {
  const [jetzt, setJetzt] = useState<number | null>(null);

  useEffect(() => {
    setJetzt(Date.now());
    const t = window.setInterval(() => setJetzt(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const ms = jetzt === null ? 0 : Math.max(0, jetzt - new Date(seit).getTime());

  return (
    <DunkleKarte>
      <div className="text-[12.5px] text-white/70">Zeit läuft</div>
      <div className="num mt-[2px] truncate text-[11.5px] text-white/55">
        {[auftragNummer, personen.join(", ")].filter(Boolean).join(" · ") ||
          "ohne Auftrag"}
      </div>

      <div
        className="num mt-4 text-[38px] leading-none font-semibold tracking-[-0.03em] tabular-nums"
        suppressHydrationWarning
      >
        {jetzt === null ? "—:—:—" : dauer(ms)}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Link
          href="/zeiterfassung"
          className="rounded-pill bg-white/12 px-[15px] py-[9px] text-[12.5px] font-semibold text-white hover:bg-white/20 hover:text-white"
        >
          Zeiten prüfen
        </Link>
        {eigene ? (
          <Link
            href="/m/zeiten"
            className="rounded-pill bg-[linear-gradient(150deg,var(--accent-from),var(--accent-to))] px-[15px] py-[9px] text-[12.5px] font-semibold text-white hover:text-white"
          >
            Meine Zeiten
          </Link>
        ) : auftragId ? (
          <Link
            href={`/vorgaenge/${auftragId}`}
            className="rounded-pill bg-[linear-gradient(150deg,var(--accent-from),var(--accent-to))] px-[15px] py-[9px] text-[12.5px] font-semibold text-white hover:text-white"
          >
            Zum Auftrag
          </Link>
        ) : null}
      </div>
    </DunkleKarte>
  );
}

function dauer(ms: number): string {
  const s = Math.floor(ms / 1000);
  return [
    Math.floor(s / 3600),
    String(Math.floor((s % 3600) / 60)).padStart(2, "0"),
    String(s % 60).padStart(2, "0"),
  ].join(":");
}
