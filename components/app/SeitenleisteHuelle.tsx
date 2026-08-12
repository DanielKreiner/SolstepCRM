"use client";

import { useEffect, useState } from "react";

/*
 * Die Seitenleiste einklappbar machen.
 *
 * Gedacht ist das für den Planer: Dort ist die Zeichenfläche der
 * Arbeitsgegenstand, und 260 px Navigation daneben sind auf einem
 * Notebook ein Fünftel des Bildschirms. Der Schalter gilt aber überall —
 * wer Tabellen breit haben will, hat dasselbe Bedürfnis.
 *
 * Der Zustand liegt im localStorage und nicht in der Datenbank: Er
 * gehört zum Gerät, nicht zum Benutzer. Wer am grossen Monitor die
 * Navigation offen haben will und am Notebook nicht, bekommt sonst
 * ständig die Einstellung des anderen Geräts.
 */

const SCHLUESSEL = "solstep.seitenleiste";

export function SeitenleisteHuelle({ children }: { children: React.ReactNode }) {
  /*
   * Startwert `true`, damit Server und erster Client-Render
   * übereinstimmen — der gemerkte Wert kommt erst im Effekt dazu. Ohne
   * das flackert die Leiste bei jedem Seitenaufruf.
   */
  const [offen, setOffen] = useState(true);
  const [geladen, setGeladen] = useState(false);

  useEffect(() => {
    setOffen(window.localStorage.getItem(SCHLUESSEL) !== "zu");
    setGeladen(true);
  }, []);

  const umschalten = () => {
    setOffen((v) => {
      window.localStorage.setItem(SCHLUESSEL, v ? "zu" : "auf");
      return !v;
    });
  };

  return (
    <>
      {offen ? <div className="hidden md:flex">{children}</div> : null}

      <button
        type="button"
        onClick={umschalten}
        aria-pressed={!offen}
        aria-label={offen ? "Seitenleiste einklappen" : "Seitenleiste ausklappen"}
        title={offen ? "Seitenleiste einklappen" : "Seitenleiste ausklappen"}
        className={[
          "hidden shrink-0 items-center justify-center rounded-[10px] text-[15px] text-muted",
          "transition-colors hover:bg-sunk hover:text-ink md:flex",
          /*
           * Eingeklappt bekommt der Knopf eine eigene schmale Spalte und
           * wird zur einzigen Möglichkeit, die Navigation
           * zurückzuholen — deshalb ist er dann etwas höher und
           * sichtbarer.
           */
          offen ? "h-9 w-6 self-start" : "h-14 w-8 self-center bg-panel shadow-soft",
          // Vor dem Lesen des gemerkten Werts nicht anzeigen: sonst
          // springt der Knopf beim ersten Rendern.
          geladen ? "" : "invisible",
        ].join(" ")}
      >
        {offen ? "‹" : "›"}
      </button>
    </>
  );
}
