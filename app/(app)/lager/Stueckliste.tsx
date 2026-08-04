"use client";

import { useActionState, useMemo, useState } from "react";
import { LEER, Meldung, type AktionsStatus } from "@/components/ui/Formular";
import { num } from "@/lib/format";
import {
  stuecklisteEntfernen,
  stuecklisteHinzufuegen,
} from "./stammdaten-actions";

export type StuecklistenZeile = {
  id: string;
  artikelId: string;
  sku: string;
  name: string;
  menge: number;
  einheit: string;
};

export type Kandidat = {
  id: string;
  sku: string;
  name: string;
  einheit: string;
};

/**
 * Die Stückliste eines Pakets.
 *
 * Ein Paket ist eine Verkaufszeile — der Kunde liest „PV-Anlage 10 kWp
 * komplett" und nicht fünfundzwanzig Module. Das Lager braucht das
 * Gegenteil: beim Annehmen des Angebots entsteht aus dieser Liste der
 * Bedarf, Stück für Stück.
 */
export function Stueckliste({
  paketId,
  zeilen,
  kandidaten,
  darfSchreiben,
}: {
  paketId: string;
  zeilen: StuecklistenZeile[];
  kandidaten: Kandidat[];
  darfSchreiben: boolean;
}) {
  const [hinzuStatus, hinzufuegen] = useActionState<AktionsStatus, FormData>(
    stuecklisteHinzufuegen,
    LEER,
  );
  const [wegStatus, entfernen] = useActionState<AktionsStatus, FormData>(
    stuecklisteEntfernen,
    LEER,
  );
  const [suche, setSuche] = useState("");
  const [menge, setMenge] = useState("1");

  const drin = useMemo(
    () => new Set(zeilen.map((z) => z.artikelId)),
    [zeilen],
  );

  const treffer = useMemo(() => {
    const q = suche.trim().toLowerCase();
    if (q.length < 2) return [];
    return kandidaten
      .filter((k) => !drin.has(k.id) && k.id !== paketId)
      .filter((k) => `${k.sku} ${k.name}`.toLowerCase().includes(q))
      .slice(0, 8);
  }, [kandidaten, drin, suche, paketId]);

  return (
    <section className="rounded-[20px] bg-surface p-5 shadow-soft">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[15px] font-semibold">Stückliste</h2>
        <span className="num text-[12px] text-muted">
          {zeilen.length} {zeilen.length === 1 ? "Teil" : "Teile"}
        </span>
      </div>
      <p className="mb-3 text-[12.5px] text-muted">
        Aus dieser Liste entsteht beim Annehmen des Angebots der Materialbedarf.
        Ohne sie wandert das Paket als eine Zeile in die Bedarfsliste.
      </p>

      {zeilen.length > 0 ? (
        <ul className="mb-3 flex flex-col gap-[6px]">
          {zeilen.map((z) => (
            <li
              key={z.id}
              className="flex items-center gap-3 rounded-card border border-line bg-panel px-3 py-[9px]"
            >
              <span className="num w-[70px] shrink-0 text-right text-[13px] font-semibold">
                {num(z.menge)}
              </span>
              <span className="w-[38px] shrink-0 text-[11.5px] text-faint">
                {z.einheit}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px]">{z.name}</span>
                <span className="num block text-[11px] text-faint">{z.sku}</span>
              </span>
              {darfSchreiben ? (
                <form action={entfernen}>
                  <input type="hidden" name="id" value={z.id} />
                  <input type="hidden" name="paketId" value={paketId} />
                  <button
                    type="submit"
                    aria-label={`${z.name} entfernen`}
                    className="cursor-pointer rounded-pill border border-line bg-surface px-[11px] py-[5px] text-[12px] text-muted transition-colors hover:border-s-crit hover:text-s-crit"
                  >
                    Entfernen
                  </button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-3 rounded-input bg-sunk px-4 py-3 text-[12.5px] text-muted">
          Noch kein Teil hinterlegt.
        </p>
      )}

      {darfSchreiben ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="search"
              value={suche}
              onChange={(e) => setSuche(e.target.value)}
              placeholder="Artikel suchen — Nummer oder Bezeichnung"
              className="min-w-[220px] flex-1 rounded-pill border border-line bg-surface px-[16px] py-[10px] text-[13.5px] outline-0 focus:border-accent"
            />
            <label className="flex items-center gap-2 text-[12.5px] text-muted">
              Menge
              <input
                type="number"
                step="0.001"
                min="0.001"
                value={menge}
                onChange={(e) => setMenge(e.target.value)}
                className="num w-[92px] rounded-input border border-line bg-surface px-[11px] py-[7px] text-[13px] outline-0 focus:border-accent"
              />
            </label>
          </div>

          {treffer.length > 0 ? (
            <ul className="mt-2 flex flex-col gap-[5px]">
              {treffer.map((k) => (
                <li key={k.id}>
                  <form action={hinzufuegen}>
                    <input type="hidden" name="paketId" value={paketId} />
                    <input type="hidden" name="artikelId" value={k.id} />
                    <input type="hidden" name="menge" value={menge} />
                    <button
                      type="submit"
                      className="flex w-full cursor-pointer items-center gap-3 rounded-card border border-line bg-surface px-3 py-[9px] text-left transition-colors hover:border-accent hover:bg-accent/6"
                    >
                      <span className="min-w-0 flex-1 truncate text-[13.5px]">
                        {k.name}
                      </span>
                      <span className="num shrink-0 text-[11.5px] text-faint">
                        {k.sku}
                      </span>
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          ) : suche.trim().length >= 2 ? (
            <p className="mt-2 text-[12px] text-faint">Kein Treffer.</p>
          ) : null}

          <Meldung status={hinzuStatus} />
          <Meldung status={wegStatus} />
        </>
      ) : null}
    </section>
  );
}
