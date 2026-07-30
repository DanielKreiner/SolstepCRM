"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/ui/Icon";

const KEY = "theme";

/*
 * Der Nutzer entscheidet, nicht das Betriebssystem — ein Monteur steht in der
 * Sonne, während sein Telefon auf Dunkelmodus steht. Gespeichert wird lokal,
 * gesetzt wird data-theme auf <html>.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    const stored = window.localStorage.getItem(KEY);
    const initial = stored === "dark" ? "dark" : "light";
    setTheme(initial);
    document.documentElement.dataset.theme = initial;
  }, []);

  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    window.localStorage.setItem(KEY, next);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={theme === "dark" ? "Helle Darstellung" : "Dunkle Darstellung"}
      className="flex h-[42px] w-[42px] cursor-pointer items-center justify-center rounded-pill border-0 bg-panel text-muted transition-colors duration-200 hover:text-ink"
    >
      <Icon name={theme === "dark" ? "sonne" : "mond"} size={18} />
    </button>
  );
}
