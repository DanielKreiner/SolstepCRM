"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { eur, num } from "@/lib/format";
import { vorgangAnnehmen, type PortalVorgangState } from "./actions";

const LEER: PortalVorgangState = { error: null, ok: null };

export type PortalPositionAnzeige = {
  id: string;
  bezeichnung: string;
  menge: number;
  einheit: string;
  epNetto: number;
  bildUrl: string | null;
  beschreibung: string | null;
};

/**
 * Die Positionen als Produktkarten.
 *
 * Bild, Bezeichnung, Menge, Preis und die Beschreibung aus dem
 * Artikelstamm. Ein Kunde entscheidet über 25.000 € — dafür reicht eine
 * Tabellenzeile nicht.
 */
export function PositionListe({
  positionen,
}: {
  positionen: PortalPositionAnzeige[];
}) {
  return (
    <ul className="flex flex-col gap-3">
      {positionen.map((p) => (
        <li key={p.id}>
          <article className="rounded-panel bg-surface p-6 shadow-soft">
            <div className="flex flex-wrap items-start gap-4">
              {p.bildUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={p.bildUrl}
                  alt=""
                  loading="lazy"
                  className="h-[68px] w-[68px] shrink-0 rounded-card bg-panel object-contain"
                />
              ) : null}

              <div className="min-w-0 flex-1">
                <h3 className="text-[16.5px] leading-snug font-semibold tracking-[-0.015em]">
                  {p.bezeichnung}
                </h3>
                <p className="num mt-[2px] text-[12px] text-muted">
                  {num(p.menge, p.einheit)} × {eur(p.epNetto)}
                </p>
              </div>

              <div className="num shrink-0 text-right text-[17px] font-semibold">
                {eur(p.menge * p.epNetto)}
              </div>
            </div>

            {p.beschreibung ? (
              <p className="mt-4 text-[13px] leading-relaxed text-muted">
                {p.beschreibung}
              </p>
            ) : null}
          </article>
        </li>
      ))}
    </ul>
  );
}

/**
 * Feste Leiste am unteren Rand: Summe links, Zusage rechts.
 *
 * Die Annahme ist rechtsverbindlich, deshalb der Name — und deshalb steht
 * ausdrücklich da, dass Name, Zeitpunkt und IP festgehalten werden.
 */
export function AngebotAktionen({
  token,
  vorgangId,
  gesamt,
}: {
  token: string;
  vorgangId: string;
  gesamt: string;
}) {
  const [offen, setOffen] = useState(false);
  const [status, formAction] = useActionState(vorgangAnnehmen, LEER);

  /* Nach der Zusage wird die Seite neu geladen — die Leiste verschwindet. */
  if (status.ok) {
    return (
      <div className="fixed right-0 bottom-0 left-0 z-30 border-t border-line bg-surface/97 backdrop-blur">
        <p
          role="status"
          className="mx-auto w-full max-w-[860px] px-4 py-4 text-[13.5px] font-medium text-s-done"
        >
          {status.ok}
        </p>
      </div>
    );
  }

  return (
    <div className="fixed right-0 bottom-0 left-0 z-30 border-t border-line bg-surface/97 backdrop-blur">
      <div className="mx-auto flex w-full max-w-[860px] flex-wrap items-center gap-3 px-4 py-3">
        <span className="min-w-0">
          <span className="block text-[11px] text-muted">Gesamt brutto</span>
          <span className="num block text-[19px] leading-tight font-bold tracking-[-0.02em]">
            {gesamt}
          </span>
        </span>

        <span className="ml-auto flex flex-wrap items-center gap-2">
          <a
            href={`/portal/${token}#anliegen`}
            className="rounded-pill border border-line px-[15px] py-[10px] text-[13px] font-medium text-ink hover:bg-sunk hover:text-ink"
          >
            Frage stellen
          </a>
          <button
            type="button"
            onClick={() => setOffen((o) => !o)}
            className="rounded-pill border-0 bg-[linear-gradient(150deg,var(--accent-from),var(--accent-to))] px-[20px] py-[11px] text-[13.5px] font-semibold text-white shadow-[0_6px_18px_rgba(201,121,24,0.28)]"
          >
            Angebot annehmen
          </button>
        </span>
      </div>

      {offen ? (
        <div className="border-t border-line bg-panel">
          {/*
            Die id ist der Anker: die Angebotsansicht spiegelt die
            angekreuzten Optionen und Upgrades über das form-Attribut
            hierher, ohne dass beide Komponenten denselben Zustand
            teilen müssen.
          */}
          <form
            id="annahme-formular"
            action={formAction}
            className="mx-auto flex w-full max-w-[860px] flex-wrap items-end gap-3 px-4 py-4"
          >
            <input type="hidden" name="token" value={token} />
            <input type="hidden" name="vorgangId" value={vorgangId} />

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

            <Absenden />

            <p className="w-full text-[11px] text-faint">
              Name, Zeitpunkt und IP-Adresse werden zum Nachweis gespeichert.
              Wir melden uns danach wegen des Montagetermins.
            </p>

            {status.error ? (
              <p role="alert" className="w-full text-[12.5px] font-medium text-s-crit">
                {status.error}
              </p>
            ) : null}
          </form>
        </div>
      ) : null}
    </div>
  );
}

function Absenden() {
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
