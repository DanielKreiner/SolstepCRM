/*
 * Auslastung je Kalenderwoche. Balken als Pillen mit runden Kappen,
 * Kapazitaetslinie gestrichelt — Vorlage Abschnitt 9, "Keine dekorativen
 * Diagramme".
 *
 * Bewusst CSS statt einer Chartbibliothek: acht Balken mit einer Marke
 * rechtfertigen keine 40 kB Javascript, und die Balken sollen exakt die
 * Radien und Farbverlaeufe des restlichen Systems tragen.
 *
 * Ueber der Kapazitaet wird der Balken kritisch eingefaerbt und nicht nur
 * hoeher — die Ueberlast ist die Aussage, nicht die Hoehe.
 */

export type Balken = {
  /** Kurzlabel unter dem Balken, z. B. "KW 31". */
  label: string;
  /** Auslastung in Prozent der Kapazitaet. */
  prozent: number;
  /** Klartext fuer Screenreader und Titel, z. B. "134 % — 428 von 320 h". */
  titel?: string;
  /** Noch nicht geplante Woche: schraffiert statt gefuellt. */
  offen?: boolean;
};

export function Balkenchart({
  balken,
  kapazitaetLabel,
}: {
  balken: Balken[];
  kapazitaetLabel?: string;
}) {
  /*
   * Skala: die Kapazitaetslinie sitzt immer auf 100 %, der hoechste Balken
   * bestimmt den Rest. Mindestens 120 %, damit die Linie nicht am oberen
   * Rand klebt, wenn alle Wochen unter Kapazitaet liegen.
   */
  const hoechster = Math.max(120, ...balken.map((b) => b.prozent));
  const anteil = (p: number) => `${(p / hoechster) * 100}%`;

  return (
    <div>
      {kapazitaetLabel ? (
        <div className="mb-3 flex justify-end">
          <span className="num rounded-pill bg-sunk px-[9px] py-[3px] text-[10.5px] text-muted">
            {kapazitaetLabel}
          </span>
        </div>
      ) : null}

      <div className="relative h-[190px]">
        {/*
          Kapazitaetslinie. Die 26px sind die Beschriftungszeile unter den
          Balken — ohne den Versatz saesse die Linie um genau diese Zeile zu
          tief und behauptete eine Auslastung, die nicht stimmt.
        */}
        <div
          aria-hidden
          className="pointer-events-none absolute right-0 left-0 flex items-center gap-2"
          style={{ bottom: `calc(${anteil(100)} + 26px)` }}
        >
          <span className="h-0 flex-1 border-t border-dashed border-line-strong" />
          <span className="num text-[9.5px] text-faint">100 %</span>
        </div>

        <div className="flex h-full items-end gap-[6px]">
          {balken.map((b) => {
            const ueber = b.prozent > 100;
            return (
              <div
                key={b.label}
                className="flex h-full flex-1 flex-col items-center justify-end gap-[6px]"
                title={b.titel ?? `${b.label}: ${Math.round(b.prozent)} %`}
              >
                <span
                  className={[
                    "num text-[10.5px] font-semibold",
                    ueber ? "text-s-crit" : "text-muted",
                  ].join(" ")}
                >
                  {Math.round(b.prozent)}%
                </span>

                {/*
                  Schmal halten: ein Balken, der breiter als hoch ist, wird
                  durch den Pillenradius zur Ellipse und liest sich nicht
                  mehr als Saeule. Die Mindesthoehe haelt auch eine Woche mit
                  wenigen Stunden sichtbar — 2 % duerfen nicht wie 0 aussehen.
                */}
                <div
                  className={[
                    "w-full max-w-[26px] rounded-pill",
                    b.offen
                      ? "bg-[repeating-linear-gradient(135deg,var(--accent-sunk)_0_5px,transparent_5px_10px)] ring-1 ring-line ring-inset"
                      : ueber
                        ? "bg-[linear-gradient(180deg,var(--s-crit),#b8442f)]"
                        : "bg-[linear-gradient(180deg,var(--accent-from),var(--accent-to))]",
                  ].join(" ")}
                  style={{
                    height: b.prozent > 0 ? `max(6px, ${anteil(b.prozent)})` : 6,
                  }}
                />

                <span className="num text-[10px] text-faint">{b.label}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
