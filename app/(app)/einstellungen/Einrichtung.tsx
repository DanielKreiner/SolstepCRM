import Link from "next/link";

/*
 * Der Einrichtungsstand eines Betriebs.
 *
 * CLAUDE.md 12.a nennt als Onboarding-Schritt eine Setup-Checkliste mit
 * Fortschritt, bis `company.onboarded_at` gesetzt ist. Das ist nicht
 * Zierrat: Ein Betrieb, der eine Software neu bekommt, weiss nicht, was
 * er zuerst tun soll, und was er nicht einrichtet, faellt ihm erst beim
 * ersten echten Auftrag auf die Fuesse — ein Angebot ohne UID-Nummer,
 * ein Dienstplan ohne Arbeitszeitregeln, eine Rechnung ohne IBAN.
 *
 * Jeder Punkt sagt deshalb nicht nur, ob er erledigt ist, sondern wozu
 * er gut ist. "Firmendaten" ist eine Aufgabe, "ohne UID-Nummer ist Ihre
 * Rechnung nicht vorsteuerabzugsfaehig" ist ein Grund.
 */

export type Punkt = {
  titel: string;
  /** Wozu der Punkt gut ist — ein Satz, kein Hilfetext. */
  grund: string;
  erledigt: boolean;
  href: string;
  /** Was dort zu sehen ist, wenn der Punkt erledigt ist. */
  stand?: string | undefined;
};

export function Einrichtung({
  punkte,
  abgeschlossen,
}: {
  punkte: Punkt[];
  abgeschlossen: boolean;
}) {
  const fertig = punkte.filter((p) => p.erledigt).length;
  const anteil = punkte.length === 0 ? 0 : fertig / punkte.length;
  const grad = Math.round(anteil * 360);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-5 rounded-card bg-sunk p-5">
        {/*
          Der Ring als conic-gradient und nicht als Diagrammbibliothek —
          CLAUDE.md 1: Ringe kommen aus CSS.
        */}
        <div
          aria-hidden
          className="relative h-[86px] w-[86px] shrink-0 rounded-full"
          style={{
            background: `conic-gradient(var(--accent) ${grad}deg, var(--line) ${grad}deg)`,
          }}
        >
          <div className="absolute inset-[9px] flex flex-col items-center justify-center rounded-full bg-surface">
            <span className="num text-[19px] leading-none font-bold">
              {fertig}
              <span className="text-[13px] text-faint">/{punkte.length}</span>
            </span>
          </div>
        </div>

        <div>
          <h2 className="text-[16px] font-bold tracking-[-0.015em]">
            {abgeschlossen
              ? "Einrichtung abgeschlossen"
              : fertig === punkte.length
                ? "Alles eingerichtet"
                : "Einrichtung"}
          </h2>
          <p className="mt-[3px] max-w-[52ch] text-[13px] leading-[1.5] text-muted">
            {abgeschlossen
              ? "Der Betrieb arbeitet produktiv. Die Liste bleibt stehen, damit jederzeit nachvollziehbar ist, was eingestellt wurde."
              : "Diese Punkte entscheiden, ob Angebot, Dienstplan und Rechnung auf Anhieb stimmen. Keiner davon ist Pflicht — aber jeder fehlt irgendwann."}
          </p>
        </div>
      </div>

      <ul className="flex flex-col gap-2">
        {punkte.map((p) => (
          <li key={p.titel}>
            <Link
              href={p.href}
              className="flex items-start gap-3 rounded-input bg-panel p-4 transition-colors duration-200 ease-out-quint hover:bg-sunk"
            >
              {/*
                Haken mit Flaeche UND Text, nie Farbe allein — Abschnitt 9.
              */}
              <span
                aria-hidden
                className={[
                  "mt-[1px] flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-[12px] font-bold",
                  p.erledigt
                    ? "bg-s-done/15 text-s-done"
                    : "bg-line text-text-3",
                ].join(" ")}
              >
                {p.erledigt ? "✓" : "–"}
              </span>

              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-baseline gap-x-2 gap-y-[2px]">
                  <span className="text-[14px] font-semibold">{p.titel}</span>
                  <span
                    className={[
                      "text-[11.5px] font-medium",
                      p.erledigt ? "text-s-done" : "text-s-warn",
                    ].join(" ")}
                  >
                    {p.erledigt ? "erledigt" : "offen"}
                  </span>
                </span>
                <span className="mt-[2px] block text-[12.5px] leading-[1.5] text-muted">
                  {p.grund}
                </span>
                {p.stand ? (
                  <span className="num mt-[3px] block text-[11.5px] text-faint">
                    {p.stand}
                  </span>
                ) : null}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
