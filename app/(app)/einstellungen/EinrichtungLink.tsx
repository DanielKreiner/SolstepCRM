"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Pill } from "@/components/ui/Pill";
import {
  linkErzeugen,
  linkWiderrufen,
  type LinkErzeugtState,
  type UnterlagenState,
} from "./unterlagen-actions";

/*
 * Der Link, mit dem jemand ohne Konto die Einrichtungsliste ausfüllt.
 *
 * Der Token steht genau einmal auf dem Bildschirm — danach liegt in der
 * Datenbank nur sein Hash, und aus einem Hash lässt sich kein Link
 * zurückrechnen. Das ist kein Schikane, sondern der Grund, warum ein
 * Leck in der Datenbank keine offenen Links bedeutet. Deshalb steht es
 * auch so auf dem Bildschirm: wer ihn nicht kopiert, erzeugt einen
 * neuen.
 */

const INITIAL: LinkErzeugtState = { error: null, ok: null, token: null };
const INITIAL_WEG: UnterlagenState = { error: null, ok: null };

export type ZugangZeile = {
  id: string;
  zweck: string | null;
  erstellt: string;
  laeuftAb: string;
  letzterZugriff: string | null;
  zugriffe: number;
  widerrufen: boolean;
  abgelaufen: boolean;
};

function Submit({ label, voll = false }: { label: string; voll?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={
        voll
          ? "min-h-[38px] cursor-pointer rounded-pill bg-[linear-gradient(150deg,var(--accent-from),var(--accent-to))] px-[16px] text-[12.5px] font-semibold text-white disabled:opacity-50"
          : "cursor-pointer rounded-pill border border-line px-[12px] py-[6px] text-[12px] text-muted hover:border-line-strong disabled:opacity-50"
      }
    >
      {label}
    </button>
  );
}

function Kopieren({ url }: { url: string }) {
  const [kopiert, setKopiert] = useState(false);
  const [sichtbar, setSichtbar] = useState(false);

  async function kopieren() {
    try {
      await navigator.clipboard.writeText(url);
      setKopiert(true);
      setTimeout(() => setKopiert(false), 4000);
    } catch {
      /* Manche Browser verweigern das. Dann den Text zeigen, damit man
         ihn mit der Hand markieren kann. */
      setSichtbar(true);
    }
  }

  return (
    <div className="flex flex-col gap-[8px]">
      <div className="flex flex-wrap items-center gap-[10px]">
        <code className="num min-w-0 flex-1 truncate rounded-input bg-surface px-[11px] py-[8px] text-[12px]">
          {url}
        </code>
        <button
          type="button"
          onClick={() => void kopieren()}
          className="min-h-[36px] cursor-pointer rounded-pill border border-line bg-surface px-[14px] text-[12.5px] font-medium hover:border-line-strong"
        >
          {kopiert ? "kopiert" : "kopieren"}
        </button>
      </div>
      {sichtbar ? (
        <textarea
          readOnly
          value={url}
          rows={2}
          onFocus={(e) => e.currentTarget.select()}
          className="w-full rounded-input border border-line bg-surface px-[11px] py-[8px] text-[12px]"
        />
      ) : null}
    </div>
  );
}

export function EinrichtungLink({
  zeilen,
  basisUrl,
  gesperrt,
}: {
  zeilen: ZugangZeile[];
  basisUrl: string;
  gesperrt: boolean;
}) {
  const [state, formAction] = useActionState(linkErzeugen, INITIAL);
  const [wegState, wegAction] = useActionState(linkWiderrufen, INITIAL_WEG);

  const offeneLinks = zeilen.filter((z) => !z.widerrufen && !z.abgelaufen);

  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-[62ch] text-[13px] leading-[1.55] text-muted">
        Wer die Angaben hat, hat nicht immer einen Zugang — die Lohnverrechnung,
        die Steuerberatung, die EDV-Betreuung. Mit diesem Link füllt jemand die
        Liste ohne Anmeldung aus. Er zeigt nur diese Liste, nichts anderes aus
        dem Betrieb, und gilt 30 Tage.
      </p>

      {state.token ? (
        <div className="rounded-card border border-accent bg-accent-sunk p-4">
          <p className="mb-[10px] text-[13px] font-semibold">
            Jetzt kopieren — danach ist der Link nicht mehr anzeigbar.
          </p>
          <Kopieren url={`${basisUrl}/einrichtung/${state.token}`} />
        </div>
      ) : null}

      {gesperrt ? null : (
        <form action={formAction} className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-[200px] flex-1 flex-col gap-[6px]">
            <span className="text-[12px] font-semibold text-muted">
              Wofür ist der Link? (für die eigene Übersicht)
            </span>
            <input
              name="zweck"
              maxLength={80}
              placeholder="z. B. Lohnverrechnung"
              className="w-full rounded-input border border-transparent bg-sunk px-[11px] py-[7px] text-[13px] outline-0 focus:border-accent focus:bg-surface"
            />
          </label>
          <Submit label="Link erzeugen" voll />
        </form>
      )}

      {state.error ? (
        <p role="alert" className="rounded-input bg-s-crit/10 px-[11px] py-[8px] text-[12.5px] font-medium text-s-crit">
          {state.error}
        </p>
      ) : null}
      {wegState.error || wegState.ok ? (
        <p
          role={wegState.error ? "alert" : "status"}
          className={`rounded-input px-[11px] py-[8px] text-[12.5px] font-medium ${
            wegState.error ? "bg-s-crit/10 text-s-crit" : "bg-s-done/10 text-s-done"
          }`}
        >
          {wegState.error ?? wegState.ok}
        </p>
      ) : null}

      {zeilen.length > 0 ? (
        <ul className="flex flex-col gap-[6px]">
          {zeilen.map((z) => (
            <li
              key={z.id}
              data-testid={`zugang-${z.id}`}
              className="flex flex-wrap items-center gap-[10px] rounded-input bg-sunk px-[11px] py-[8px]"
            >
              <span className="min-w-0 flex-1 text-[13px] font-medium">
                {z.zweck ?? "ohne Vermerk"}
              </span>
              {z.widerrufen ? (
                <Pill tone="neutral">zurückgezogen</Pill>
              ) : z.abgelaufen ? (
                <Pill tone="neutral">abgelaufen</Pill>
              ) : (
                <Pill tone="done">gültig bis {z.laeuftAb}</Pill>
              )}
              <span className="num text-[11px] text-faint">
                {z.letzterZugriff
                  ? `zuletzt ${z.letzterZugriff}, ${z.zugriffe}×`
                  : "noch nicht benutzt"}
              </span>
              {!gesperrt && !z.widerrufen && !z.abgelaufen ? (
                <form action={wegAction}>
                  <input type="hidden" name="id" value={z.id} />
                  <Submit label="zurückziehen" />
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {offeneLinks.length > 1 ? (
        <p className="text-[12px] text-faint">
          Mehrere Links sind gültig. Jeder öffnet dieselbe Liste — wer einen nicht
          mehr braucht, zieht ihn besser zurück.
        </p>
      ) : null}
    </div>
  );
}
