"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/*
 * Suche über die Projektliste.
 *
 * Gedrosselt, damit nicht jeder Tastendruck eine Serveranfrage auslöst,
 * und über die Adresszeile geführt: Ein gefundenes Projekt lässt sich
 * so verlinken, und der Zurück-Knopf tut das Erwartete.
 */
export function Suche({ start }: { start: string }) {
  const router = useRouter();
  const [wert, setWert] = useState(start);

  useEffect(() => {
    if (wert === start) return;
    const uhr = setTimeout(() => {
      router.replace(wert.trim() ? `/planer?q=${encodeURIComponent(wert.trim())}` : "/planer");
    }, 350);
    return () => clearTimeout(uhr);
  }, [wert, start, router]);

  return (
    <div className="mb-3">
      <input
        type="search"
        value={wert}
        onChange={(e) => setWert(e.target.value)}
        placeholder="Projekt oder Adresse suchen"
        aria-label="Projekte durchsuchen"
        className="h-10 w-full max-w-sm rounded-[10px] border border-line bg-surface px-3 text-[13.5px] outline-none focus:border-line-strong"
      />
    </div>
  );
}
