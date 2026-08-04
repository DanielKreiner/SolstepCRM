import Link from "next/link";
import { Icon, type IconName } from "@/components/ui/Icon";
import { BRAND, BRAND_MARK } from "@/lib/brand";
import { initials } from "@/lib/format";
import { PHASEN, phaseIndex, type Phase } from "@/lib/vorgang/modell";

/**
 * Der Rahmen des Kundenportals.
 *
 * Bisher war das Portal eine lange Seite: der Kunde scrollte an seinem
 * Angebot vorbei, um zu den Dokumenten zu kommen, und wusste nie, ob
 * noch etwas darunter liegt. Jetzt sind es Bereiche mit einer
 * Navigation — dieselbe Form, die er aus jedem anderen Konto kennt.
 *
 * Der aktive Bereich steht in der URL (CLAUDE.md Abschnitt 10): ein Link
 * auf „Ihr Angebot" ist teilbar, und der Zurück-Knopf des Browsers tut,
 * was er soll.
 *
 * Kein Login: die ganze Berechtigung hängt am Token im Pfad.
 */

export type PortalBereich =
  | "fortschritt"
  | "angebot"
  | "dokumente"
  | "anliegen"
  | "ertrag";

export type PortalNavEintrag = {
  bereich: PortalBereich;
  label: string;
  icon: IconName;
  /** Zahl neben dem Eintrag. 0 wird nicht gezeigt — sie ist keine Meldung. */
  anzahl?: number;
};

/**
 * Der Rahmen ohne Vorgangsnavigation.
 *
 * Für die Einstiegsseite: dort gibt es noch kein Projekt, also auch
 * keine Bereiche, zwischen denen man wechseln könnte. Gleicher Hinter-
 * grund, gleiche Kopfleiste, gleiche Flächen — damit der Kunde nicht
 * den Eindruck bekommt, zwei verschiedene Sachen vor sich zu haben.
 */
export function PortalRahmen({
  kundeName,
  firmaName,
  titel,
  unter,
  children,
}: {
  kundeName: string;
  firmaName: string;
  titel: string;
  unter: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col gap-[14px] bg-app p-[10px] sm:p-[14px]">
      <header className="flex shrink-0 flex-wrap items-center gap-3 rounded-[22px] bg-surface px-4 py-3 shadow-soft">
        <span
          aria-hidden
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[11px] bg-[linear-gradient(150deg,var(--accent-from),var(--accent-to))] text-[15px] font-bold text-white"
        >
          {BRAND_MARK}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-semibold tracking-[-0.01em]">
            {kundeName}
          </span>
          <span className="block truncate text-[12px] text-muted">{firmaName}</span>
        </span>
        <span
          aria-hidden
          className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-pill bg-s-done text-[12px] font-semibold text-white"
        >
          {initials(kundeName)}
        </span>
      </header>

      <main className="flex-1 rounded-panel bg-panel px-4 pt-[26px] pb-8 shadow-soft sm:px-[26px]">
        <div className="mx-auto w-full max-w-[1100px]">
          <h1 className="text-[25px] leading-[1.1] font-bold tracking-[-0.03em] sm:text-[30px]">
            {titel}
          </h1>
          <p className="mt-[5px] mb-5 text-[13.5px] text-muted">{unter}</p>
          {children}
        </div>
      </main>
    </div>
  );
}

export function PortalShell({
  token,
  vorgangId,
  bereich,
  nav,
  kundeName,
  nummer,
  adresse,
  phase,
  ansprechpartner,
  titel,
  unter,
  aktion,
  children,
}: {
  token: string;
  vorgangId: string;
  bereich: PortalBereich;
  nav: PortalNavEintrag[];
  kundeName: string;
  nummer: string;
  adresse: string | null;
  phase: Phase;
  ansprechpartner: { name: string; rolle: string | null; telefon: string | null } | null;
  titel: string;
  unter: string;
  aktion?: React.ReactNode;
  children: React.ReactNode;
}) {
  const idx = phaseIndex(phase);
  const phaseInfo = PHASEN[idx];

  return (
    <div className="flex min-h-dvh gap-[14px] bg-app p-[10px] sm:p-[14px]">
      {/* ------------------------------------------------------ SIDEBAR */}
      <aside className="hidden w-[246px] shrink-0 flex-col gap-3 md:flex">
        <div className="flex flex-1 flex-col rounded-panel bg-surface shadow-soft">
          <div className="flex items-center gap-[11px] px-5 pt-[22px] pb-5">
            <span
              aria-hidden
              className="flex h-8 w-8 items-center justify-center rounded-[11px] bg-[linear-gradient(150deg,var(--accent-from),var(--accent-to))] text-[15px] font-bold text-white"
            >
              {BRAND_MARK}
            </span>
            <span>
              <span className="block text-[17px] leading-tight font-bold tracking-[-0.025em]">
                {BRAND.name}
              </span>
              <span className="block text-[11.5px] text-muted">Kundenportal</span>
            </span>
          </div>

          <nav className="flex flex-col gap-[3px] px-[10px]">
            {nav.map((e) => {
              const aktiv = e.bereich === bereich;
              return (
                <Link
                  key={e.bereich}
                  href={`/portal/${token}/vorgang/${vorgangId}?bereich=${e.bereich}`}
                  aria-current={aktiv ? "page" : undefined}
                  className={[
                    "flex items-center gap-3 rounded-input px-3 py-[10px] text-[13.5px] transition-colors",
                    aktiv
                      ? "bg-sunk font-semibold text-ink hover:text-ink"
                      : "text-ink hover:bg-panel hover:text-ink",
                  ].join(" ")}
                >
                  <span
                    aria-hidden
                    className={[
                      "grid h-[30px] w-[30px] shrink-0 place-items-center rounded-icon",
                      aktiv ? "bg-accent text-white" : "bg-panel text-muted",
                    ].join(" ")}
                  >
                    <Icon name={e.icon} size={16} />
                  </span>
                  <span className="min-w-0 flex-1 truncate">{e.label}</span>
                  {e.anzahl && e.anzahl > 0 ? (
                    <span className="num text-[11.5px] text-faint">{e.anzahl}</span>
                  ) : null}
                </Link>
              );
            })}
          </nav>

          <span className="flex-1" />

          {/*
            Der Ansprechpartner steht unten und nicht in einer Fusszeile:
            wer im Portal etwas nicht versteht, sucht keine Kontaktseite,
            sondern eine Telefonnummer.
          */}
          {ansprechpartner ? (
            <div className="m-[10px] rounded-card bg-ink p-4 text-app">
              <p className="text-[11.5px] font-semibold opacity-70">
                Ihr Ansprechpartner
              </p>
              <div className="mt-3 flex items-center gap-3">
                <span
                  aria-hidden
                  className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-pill bg-s-doing text-[12px] font-semibold text-white"
                >
                  {initials(ansprechpartner.name)}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[13.5px] font-semibold">
                    {ansprechpartner.name}
                  </span>
                  {ansprechpartner.rolle ? (
                    <span className="block truncate text-[11.5px] opacity-70">
                      {ansprechpartner.rolle}
                    </span>
                  ) : null}
                </span>
              </div>
              {ansprechpartner.telefon ? (
                <a
                  href={`tel:${ansprechpartner.telefon}`}
                  className="mt-3 flex min-h-[40px] items-center justify-center gap-2 rounded-pill bg-[linear-gradient(150deg,var(--accent-from),var(--accent-to))] text-[13px] font-semibold text-white hover:text-white"
                >
                  <Icon name="telefon" size={15} />
                  Anrufen
                </a>
              ) : null}
            </div>
          ) : null}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col gap-[14px]">
        {/* ------------------------------------------------------ KOPF */}
        <header className="flex shrink-0 flex-wrap items-center gap-3 rounded-[22px] bg-surface px-4 py-3 shadow-soft">
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[15px] font-semibold tracking-[-0.01em]">
              {kundeName}
            </span>
            <span className="num block truncate text-[12px] text-muted">
              {nummer}
              {adresse ? ` · ${adresse}` : ""}
            </span>
          </span>

          <span className="shrink-0 rounded-pill bg-s-doing/12 px-[13px] py-[6px] text-[12px] font-medium text-s-doing">
            {idx >= 0 ? `Phase ${idx + 1} von ${PHASEN.length} · ` : ""}
            {phaseInfo?.label ?? "—"}
          </span>

          <span
            aria-hidden
            className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-pill bg-s-done text-[12px] font-semibold text-white"
          >
            {initials(kundeName)}
          </span>
        </header>

        <main className="flex-1 rounded-panel bg-panel px-4 pt-[26px] pb-8 shadow-soft sm:px-[26px]">
          <div className="mx-auto w-full max-w-[1100px]">
            <div className="mb-5 flex flex-wrap items-start gap-4">
              <div className="min-w-0 flex-1">
                <h1 className="text-[25px] leading-[1.1] font-bold tracking-[-0.03em] sm:text-[30px]">
                  {titel}
                </h1>
                <p className="mt-[5px] text-[13.5px] text-muted">{unter}</p>
              </div>
              {aktion}
            </div>

            {/* Am Telefon steht die Navigation über dem Inhalt. */}
            <nav className="mb-4 flex flex-wrap gap-[3px] rounded-pill bg-surface p-1 shadow-soft md:hidden">
              {nav.map((e) => (
                <Link
                  key={e.bereich}
                  href={`/portal/${token}/vorgang/${vorgangId}?bereich=${e.bereich}`}
                  aria-current={e.bereich === bereich ? "page" : undefined}
                  className={[
                    "rounded-pill px-[13px] py-[7px] text-[12.5px] transition-colors",
                    e.bereich === bereich
                      ? "bg-sunk font-semibold text-ink hover:text-ink"
                      : "text-muted hover:text-ink",
                  ].join(" ")}
                >
                  {e.label}
                </Link>
              ))}
            </nav>

            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
