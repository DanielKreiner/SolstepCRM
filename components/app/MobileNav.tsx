"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { Sidebar } from "./Sidebar";

/**
 * Navigation am Telefon.
 *
 * Die Sidebar ist unter md ausgeblendet — und es kam nichts nach. Wer das
 * Backoffice am Handy öffnete, sah genau den Bildschirm, auf dem er
 * gelandet war, und kam von dort nirgends hin.
 *
 * Kein zweiter Navigationsbaum: dieselbe Sidebar, nur als Schublade. Ein
 * eigener Satz mobiler Menüpunkte wäre eine zweite Stelle, an der ein
 * neuer Bereich vergessen wird.
 */
export function MobileNav(props: {
  companyName: string;
  locationName: string;
  visibleAreas: string[];
  badges?: Record<string, number>;
}) {
  const [offen, setOffen] = useState(false);
  const pathname = usePathname();

  /* Nach jedem Sprung zu. Sonst verdeckt die Schublade das Ziel. */
  useEffect(() => {
    setOffen(false);
  }, [pathname]);

  useEffect(() => {
    if (!offen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOffen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [offen]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOffen(true)}
        aria-label="Menü öffnen"
        aria-expanded={offen}
        className="flex h-[42px] w-[42px] shrink-0 cursor-pointer items-center justify-center rounded-pill border-0 bg-panel text-muted transition-colors hover:text-ink md:hidden"
      >
        <Icon name="menue" size={18} />
      </button>

      {offen ? (
        <div className="fixed inset-0 z-50 flex md:hidden">
          <button
            type="button"
            aria-label="Menü schliessen"
            onClick={() => setOffen(false)}
            className="absolute inset-0 cursor-default border-0 bg-ink/40 p-0"
          />
          <div className="relative flex h-full max-w-[86vw] p-[10px]">
            <Sidebar {...props} />
          </div>
        </div>
      ) : null}
    </>
  );
}
