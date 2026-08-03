"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import { acceptFromPortal, type PortalState } from "../../actions";
import { optionUmschalten } from "./actions";

const LEER: PortalState = { error: null, ok: null };

/**
 * Häkchen an einer optionalen Erweiterung.
 *
 * Nach dem Umschalten wird die Seite neu geladen, statt die Summe im
 * Browser zu rechnen. Das ist einen Wimpernschlag langsamer und dafür
 * gibt es nur eine Wahrheit über den Preis — die vom Server.
 */
export function OptionHaken({
  token,
  itemId,
  gewaehlt,
  gesperrt,
  titel,
  hersteller,
  beschreibung,
  preis,
  menge,
}: {
  token: string;
  itemId: string;
  gewaehlt: boolean;
  gesperrt: boolean;
  titel: string;
  hersteller: string | null;
  beschreibung: string | null;
  preis: string;
  menge: string;
}) {
  const router = useRouter();
  const [laeuft, starte] = useTransition();
  const [fehler, setFehler] = useState<string | null>(null);

  function umschalten() {
    if (gesperrt) return;
    setFehler(null);
    starte(async () => {
      const ergebnis = await optionUmschalten(token, itemId, !gewaehlt);
      if (!ergebnis.ok) {
        setFehler(ergebnis.grund ?? "Das hat nicht geklappt.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <div
      className={[
        "rounded-card border p-4 transition-colors duration-200",
        gewaehlt ? "border-accent bg-accent-sunk" : "border-line bg-panel",
      ].join(" ")}
    >
      <div className="flex items-start gap-3">
        <button
          type="button"
          role="checkbox"
          aria-checked={gewaehlt}
          aria-label={`${titel} dazubuchen`}
          disabled={gesperrt || laeuft}
          onClick={umschalten}
          className={[
            "mt-[2px] grid h-[22px] w-[22px] shrink-0 place-items-center rounded-[7px] border-2 transition-colors",
            gewaehlt
              ? "border-accent bg-accent text-white"
              : "border-line-strong bg-surface",
            gesperrt ? "cursor-not-allowed opacity-60" : "cursor-pointer",
          ].join(" ")}
        >
          {gewaehlt ? (
            <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden>
              <path
                d="M5 12.5 10 17.5 19 7"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          ) : null}
        </button>

        <div className="min-w-0 flex-1">
          <h3 className="text-[14.5px] leading-snug font-semibold">{titel}</h3>
          {hersteller ? (
            <p className="text-[12px] text-muted">{hersteller}</p>
          ) : null}
          {beschreibung ? (
            <p className="mt-2 text-[12.5px] leading-relaxed text-muted">
              {beschreibung}
            </p>
          ) : null}
        </div>

        <div className="shrink-0 text-right">
          <div className="text-[10px] font-semibold tracking-[0.08em] text-faint uppercase">
            {gewaehlt ? "dazugebucht" : "falls gewählt"}
          </div>
          <div className="num mt-[2px] text-[15px] font-semibold">{preis}</div>
          <div className="num text-[11px] text-faint">{menge}</div>
        </div>
      </div>

      {fehler ? (
        <p role="alert" className="mt-2 text-[12px] font-medium text-s-crit">
          {fehler}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Feste Leiste am unteren Rand: Gesamtpreis links, Aktionen rechts.
 *
 * Die Annahme fragt den Namen ab — sie ist rechtsverbindlich, und Name,
 * Zeitpunkt und IP werden festgehalten (CLAUDE.md Meilenstein 8).
 */
export function AngebotAktionen({
  token,
  quoteId,
  gesamt,
  angenommen,
  angenommenVon,
  abgelaufen,
}: {
  token: string;
  quoteId: string;
  gesamt: string;
  angenommen: boolean;
  angenommenVon: string | null;
  abgelaufen: boolean;
}) {
  const [offen, setOffen] = useState(false);

  return (
    <div className="fixed right-0 bottom-0 left-0 z-30 border-t border-line bg-surface/97 backdrop-blur">
      <div className="mx-auto flex w-full max-w-[980px] flex-wrap items-center gap-3 px-4 py-3">
        <span className="min-w-0">
          <span className="block text-[11px] text-muted">Gesamt brutto</span>
          <span className="num block text-[19px] leading-tight font-bold tracking-[-0.02em]">
            {gesamt}
          </span>
        </span>

        <span className="ml-auto flex flex-wrap items-center gap-2">
          {angenommen ? (
            <span className="rounded-pill bg-s-done/12 px-[15px] py-[10px] text-[13px] font-semibold text-s-done">
              Angenommen{angenommenVon ? ` von ${angenommenVon}` : ""}
            </span>
          ) : abgelaufen ? (
            <span className="rounded-pill bg-s-crit/12 px-[15px] py-[10px] text-[13px] font-medium text-s-crit">
              Die Gültigkeit ist abgelaufen — bitte melden Sie sich bei uns.
            </span>
          ) : (
            <>
              <a
                href={`/portal/${token}#anliegen`}
                className="rounded-pill border border-line px-[15px] py-[10px] text-[13px] font-medium text-ink hover:bg-sunk hover:text-ink"
              >
                Änderung wünschen
              </a>
              <button
                type="button"
                onClick={() => setOffen((o) => !o)}
                className="rounded-pill border-0 bg-[linear-gradient(150deg,var(--accent-from),var(--accent-to))] px-[20px] py-[11px] text-[13.5px] font-semibold text-white shadow-[0_6px_18px_rgba(201,121,24,0.28)]"
              >
                Angebot annehmen
              </button>
            </>
          )}
        </span>
      </div>

      {offen && !angenommen && !abgelaufen ? (
        <div className="border-t border-line bg-panel">
          <div className="mx-auto w-full max-w-[980px] px-4 py-4">
            <AnnahmeFormular token={token} quoteId={quoteId} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function AnnahmeFormular({
  token,
  quoteId,
}: {
  token: string;
  quoteId: string;
}) {
  const [status, formAction] = useActionState(acceptFromPortal, LEER);

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="quoteId" value={quoteId} />

      <div className="min-w-[220px] flex-1">
        <label
          htmlFor="annahme-name"
          className="mb-[5px] block text-[12px] font-medium text-muted"
        >
          Ihr Name — damit nehmen Sie das Angebot verbindlich an
        </label>
        <input
          id="annahme-name"
          name="name"
          required
          minLength={2}
          placeholder="Vor- und Nachname"
          className="w-full rounded-input border border-transparent bg-surface px-[13px] py-[11px] text-[14px] outline-0 focus:border-accent"
        />
      </div>

      <AnnahmeKnopf />

      <p className="w-full text-[11px] text-faint">
        Name, Zeitpunkt und IP-Adresse werden zum Nachweis gespeichert.
      </p>

      {status.error ? (
        <p role="alert" className="w-full text-[12.5px] font-medium text-s-crit">
          {status.error}
        </p>
      ) : null}
      {status.ok ? (
        <p role="status" className="w-full text-[12.5px] font-medium text-s-done">
          {status.ok}
        </p>
      ) : null}
    </form>
  );
}

function AnnahmeKnopf() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="min-h-[44px] cursor-pointer rounded-pill border-0 bg-[linear-gradient(150deg,var(--accent-from),var(--accent-to))] px-[22px] text-[13.5px] font-semibold text-white shadow-[0_6px_18px_rgba(201,121,24,0.28)] disabled:opacity-50"
    >
      {pending ? "Wird erfasst …" : "Verbindlich annehmen"}
    </button>
  );
}
