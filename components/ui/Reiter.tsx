import Link from "next/link";

/*
 * Reiterleiste. In der Vorlage tragen Lager, Auftragsdetail und CRM je eine —
 * immer dieselbe Form: Pillenleiste auf heller Fläche, aktiver Reiter
 * eingesenkt und fett.
 *
 * Reiter sind Links mit eigenem Ziel, keine Client-Umschalter: der Reiter
 * "Bewegungen" soll verlinkbar sein, und nach einer Buchung soll man dort
 * wieder landen, wo man war.
 */

export type ReiterEintrag = {
  key: string;
  label: string;
  href: string;
  /** Zahl rechts neben der Beschriftung, z. B. offene Bestellungen. */
  anzahl?: number | undefined;
};

export function Reiter({
  eintraege,
  aktiv,
}: {
  eintraege: ReiterEintrag[];
  aktiv: string;
}) {
  return (
    <nav className="mb-4 flex flex-wrap gap-[3px] rounded-pill bg-surface p-1 shadow-soft">
      {eintraege.map((e) => {
        const an = e.key === aktiv;
        return (
          <Link
            key={e.key}
            href={e.href}
            aria-current={an ? "page" : undefined}
            className={[
              "flex items-center gap-[9px] rounded-pill px-[17px] py-[9px] text-[13.5px] transition-colors duration-200 ease-out-quint",
              an
                ? "bg-sunk font-semibold text-ink"
                : "font-normal text-muted hover:text-ink",
            ].join(" ")}
          >
            {e.label}
            {e.anzahl !== undefined && e.anzahl > 0 ? (
              <span className="num text-[11px] opacity-70">{e.anzahl}</span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
