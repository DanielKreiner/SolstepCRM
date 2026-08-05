"use client";

import { useActionState, useMemo, useState } from "react";
import { LEER, Meldung, type AktionsStatus } from "@/components/ui/Formular";
import { Pill } from "@/components/ui/Pill";
import { date, num } from "@/lib/format";
import { bestellungAnlegen } from "./actions";

export type OffenZeile = {
  id: string;
  vorgangNummer: string;
  kunde: string;
  montageAb: string | null;
  sku: string | null;
  bezeichnung: string;
  menge: number;
  einheit: string;
  bereitsBestellt: string[];
  inEntwurf: boolean;
};

/**
 * Der Bestellvorschlag über alle laufenden Vorgänge.
 *
 * Sammelbestellung ist kein Komfort, sondern Geld: der Grosshändler
 * liefert ab einer Mindestmenge frachtfrei, und wer für jeden Vorgang
 * einzeln bestellt, zahlt dreimal Fracht für dieselbe Palette. Jede
 * Position behält trotzdem ihren Vorgang — beim Wareneingang muss klar
 * sein, wofür die Ware gedacht war.
 */
export function Sammelbestellung({
  zeilen,
  lieferanten,
}: {
  zeilen: OffenZeile[];
  lieferanten: { id: string; name: string }[];
}) {
  const [status, anlegen] = useActionState<AktionsStatus, FormData>(
    bestellungAnlegen,
    LEER,
  );

  /*
   * Was schon in einer Bestellung steckt, ist nicht vorausgewählt.
   * Zweimal dieselbe Palette bestellen fällt erst auf, wenn sie zweimal
   * im Hof steht.
   */
  const [gewaehlt, setGewaehlt] = useState<Set<string>>(
    () => new Set(zeilen.filter((z) => !z.inEntwurf && z.bereitsBestellt.length === 0).map((z) => z.id)),
  );

  const anzahl = gewaehlt.size;
  const nachVorgang = useMemo(() => {
    const gruppen = new Map<string, OffenZeile[]>();
    for (const z of zeilen) {
      const liste = gruppen.get(z.vorgangNummer) ?? [];
      liste.push(z);
      gruppen.set(z.vorgangNummer, liste);
    }
    return [...gruppen.entries()];
  }, [zeilen]);

  /*
   * Auch ohne offenen Bedarf muss sich bestellen lassen: Lager
   * auffüllen, Van-Stock nachfüllen, Werkzeug. Ohne diesen Weg wäre der
   * einzige Zugang zu einer Bestellung ein Vorgang, der gerade etwas
   * braucht — und das Lager stünde vor verschlossener Tür.
   */
  const leereBestellung = (
    <form action={anlegen} className="flex flex-wrap items-center gap-2">
      <select
        name="lieferantId"
        data-testid="leer-lieferant"
        className="mr-2 cursor-pointer rounded-input border border-line bg-surface px-[11px] py-[8px] text-[13px] outline-0 focus:border-accent"
      >
        <option value="">Lieferant später</option>
        {lieferanten.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
          </option>
        ))}
      </select>
      <button
        type="submit"
        data-testid="leere-bestellung"
        className="min-h-[38px] cursor-pointer rounded-pill border border-line bg-surface px-[20px] text-[12.5px] font-semibold text-ink transition-colors hover:bg-sunk"
      >
        Bestellung für das Lager anlegen
      </button>
    </form>
  );

  if (zeilen.length === 0) {
    return (
      <section className="rounded-[20px] bg-surface p-5 shadow-soft">
        <h2 className="text-[15px] font-semibold">Nichts offen</h2>
        <p className="mt-1 mb-3 text-[12.5px] text-muted">
          Jede Bedarfsposition der laufenden Vorgänge ist gedeckt — im Lager,
          bestellt oder schon auf der Baustelle. Für Lagerauffüllung und
          Van-Stock geht es trotzdem weiter.
        </p>
        {leereBestellung}
        <Meldung status={status} />
      </section>
    );
  }

  return (
    <section className="rounded-[20px] bg-surface p-5 shadow-soft">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <h2 className="text-[15px] font-semibold">Ungedeckt</h2>
        <Pill tone="crit">{zeilen.length} Positionen</Pill>
      </div>
      <p className="mb-4 text-[12.5px] text-muted">
        Aus mehreren Vorgängen zu einer Bestellung zusammenfassen. Jede Zeile
        behält ihren Vorgang.
      </p>

      <form action={anlegen}>
        <div className="flex flex-col gap-4">
          {nachVorgang.map(([nummer, liste]) => (
            <div key={nummer}>
              <p className="mb-1 text-[12px] font-semibold text-muted">
                {nummer} · {liste[0]?.kunde}
                {liste[0]?.montageAb
                  ? ` · Montage ${date(liste[0].montageAb)}`
                  : " · noch kein Termin"}
              </p>
              <ul className="flex flex-col gap-[5px]">
                {liste.map((z) => (
                  <li key={z.id}>
                    <label className="flex cursor-pointer items-center gap-3 rounded-card border border-line bg-panel px-3 py-[9px]">
                      <input
                        type="checkbox"
                        name="bedarfId"
                        value={z.id}
                        checked={gewaehlt.has(z.id)}
                        onChange={(e) => {
                          const neu = new Set(gewaehlt);
                          if (e.target.checked) neu.add(z.id);
                          else neu.delete(z.id);
                          setGewaehlt(neu);
                        }}
                        className="h-4 w-4 accent-[var(--accent)]"
                      />
                      <span className="num w-[72px] shrink-0 text-right text-[13px] font-semibold">
                        {num(z.menge)}
                      </span>
                      <span className="w-[34px] shrink-0 text-[11.5px] text-faint">
                        {z.einheit}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13.5px]">
                          {z.bezeichnung}
                        </span>
                        <span className="num block text-[11px] text-faint">
                          {z.sku ?? "Freitext"}
                        </span>
                      </span>
                      {z.bereitsBestellt.length > 0 ? (
                        <Pill tone="warn">
                          bereits bestellt ({z.bereitsBestellt.join(", ")})
                        </Pill>
                      ) : z.inEntwurf ? (
                        <Pill tone="neutral">steht in einem Entwurf</Pill>
                      ) : null}
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-4">
          <label className="flex items-center gap-2 text-[12.5px] text-muted">
            Lieferant
            <select
              name="lieferantId"
              className="rounded-input border border-line bg-surface px-[11px] py-[8px] text-[13px] outline-0 focus:border-accent"
            >
              <option value="">später wählen</option>
              {lieferanten.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>

          <button
            type="submit"
            disabled={anzahl === 0}
            className={[
              "min-h-[38px] rounded-pill px-[20px] text-[12.5px] font-semibold",
              anzahl > 0
                ? "cursor-pointer border-0 bg-[linear-gradient(150deg,var(--accent-from),var(--accent-to))] text-white"
                : "cursor-not-allowed border border-line bg-sunk text-faint",
            ].join(" ")}
          >
            {anzahl} {anzahl === 1 ? "Position" : "Positionen"} als Entwurf
          </button>
        </div>

        <Meldung status={status} />
      </form>

      <div className="mt-4 border-t border-line pt-4">
        <p className="mb-2 text-[12.5px] text-muted">
          Nichts davon dabei? Lager auffüllen, Van-Stock, Werkzeug:
        </p>
        {leereBestellung}
      </div>
    </section>
  );
}
