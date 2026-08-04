"use client";

import { useEffect, useRef } from "react";

/*
 * Ein Fenster über der Seite.
 *
 * CLAUDE.md Abschnitt 9 sagt: keine Modals für Dinge, die inline gehen.
 * Hier gehen sie nicht inline — der Produktkatalog hat 469 Zeilen mit
 * Suche, und der Modulrechner mit seiner Vorschau ist ein eigener
 * kleiner Vorgang. Beides dauerhaft unter der Positionsliste zu zeigen
 * hiess: an vier Formularen vorbeiscrollen, um die Positionen zu sehen.
 *
 * Was ein Fenster können muss, damit es keines im schlechten Sinn ist:
 * Escape schliesst, ein Klick daneben schliesst, der Fokus bleibt darin
 * gefangen, und die Seite darunter scrollt nicht mit weg.
 */
export function Dialog({
  offen,
  titel,
  icon,
  breite = "normal",
  schliessen,
  children,
}: {
  offen: boolean;
  titel: string;
  icon?: React.ReactNode;
  /** „weit" für Listen mit Suche, sonst ein Formular in Lesebreite. */
  breite?: "normal" | "weit";
  schliessen: () => void;
  children: React.ReactNode;
}) {
  const kasten = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!offen) return;

    const vorher = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    /* Fokus hinein, sonst tippt man weiter in die Seite dahinter. */
    const zuerst = kasten.current?.querySelector<HTMLElement>(
      "input, select, textarea, button, [tabindex]:not([tabindex='-1'])",
    );
    zuerst?.focus();

    function taste(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        schliessen();
        return;
      }
      if (e.key !== "Tab" || !kasten.current) return;

      /*
       * Fokusfalle. Ohne sie wandert Tab hinter das Fenster, und der
       * nächste Tastendruck landet in einem Formular, das der Nutzer
       * gar nicht sieht.
       */
      const ziele = [
        ...kasten.current.querySelectorAll<HTMLElement>(
          "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
        ),
      ].filter((el) => el.offsetParent !== null);
      if (ziele.length === 0) return;

      const erster = ziele[0]!;
      const letzter = ziele[ziele.length - 1]!;
      if (e.shiftKey && document.activeElement === erster) {
        e.preventDefault();
        letzter.focus();
      } else if (!e.shiftKey && document.activeElement === letzter) {
        e.preventDefault();
        erster.focus();
      }
    }

    document.addEventListener("keydown", taste);
    return () => {
      document.removeEventListener("keydown", taste);
      document.body.style.overflow = vorher;
    };
  }, [offen, schliessen]);

  if (!offen) return null;

  return (
    <div
      onClick={schliessen}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/45 p-4 pt-[6vh] backdrop-blur-[2px]"
    >
      <div
        ref={kasten}
        role="dialog"
        aria-modal="true"
        aria-label={titel}
        onClick={(e) => e.stopPropagation()}
        className={[
          "w-full rounded-panel bg-surface shadow-soft",
          breite === "weit" ? "max-w-[680px]" : "max-w-[520px]",
        ].join(" ")}
      >
        <div className="flex items-center gap-[10px] border-b border-line px-5 py-4">
          {icon ? <span aria-hidden className="shrink-0">{icon}</span> : null}
          <h2 className="min-w-0 flex-1 truncate text-[16px] font-bold tracking-[-0.02em]">
            {titel}
          </h2>
          <button
            type="button"
            onClick={schliessen}
            aria-label="Schliessen"
            className="shrink-0 cursor-pointer rounded-icon border-0 bg-transparent px-2 py-1 text-[17px] leading-none text-faint transition-colors hover:text-ink"
          >
            ✕
          </button>
        </div>

        <div className="max-h-[74vh] overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

/** Fusszeile eines Dialogs — Abbrechen links, die Tat rechts. */
export function DialogFuss({
  abbrechen,
  children,
}: {
  abbrechen: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-5 flex flex-wrap items-center justify-end gap-3 border-t border-line pt-4">
      <button
        type="button"
        onClick={abbrechen}
        className="cursor-pointer border-0 bg-transparent text-[13px] text-muted transition-colors hover:text-ink"
      >
        Abbrechen
      </button>
      {children}
    </div>
  );
}
