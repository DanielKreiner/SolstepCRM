"use client";

import { useActionState, useMemo, useState } from "react";
import { LEER, Meldung, type AktionsStatus } from "@/components/ui/Formular";
import { abholungErfassen } from "@/app/(app)/bestellungen/actions";

/**
 * Abholung beim Grosshändler.
 *
 * Ohne diesen Weg müsste jemand, der spontan etwas holt, erst eine
 * Bestellung anlegen, sie abschicken und dann den Eingang buchen — drei
 * Schritte für einen Handgriff. Und dann würde die Bestellpflicht am
 * ersten Tag umgangen. Hier entsteht beides in einem Zug: Bestellung mit
 * Kennzeichen Abholung, Beleg-PDF und Wareneingang.
 */
export function Abholung({
  lieferanten,
  artikel,
}: {
  lieferanten: { id: string; name: string }[];
  artikel: { id: string; sku: string; name: string }[];
}) {
  const [status, erfassen] = useActionState<AktionsStatus, FormData>(
    abholungErfassen,
    LEER,
  );
  const [offen, setOffen] = useState(false);
  const [suche, setSuche] = useState("");
  const [gewaehlt, setGewaehlt] = useState<{ id: string; name: string } | null>(null);

  const treffer = useMemo(() => {
    const q = suche.trim().toLowerCase();
    if (q.length < 2) return [];
    return artikel
      .filter((a) => `${a.sku} ${a.name}`.toLowerCase().includes(q))
      .slice(0, 6);
  }, [artikel, suche]);

  if (!offen) {
    return (
      <section className="rounded-[20px] bg-surface p-5 shadow-soft">
        <h2 className="text-[15px] font-semibold">Abholung erfassen</h2>
        <p className="mt-1 mb-3 text-[12.5px] text-muted">
          Beim Grosshändler mitgenommen — Bestellung, Beleg und Eingang in
          einem Schritt.
        </p>
        <button
          type="button"
          onClick={() => setOffen(true)}
          className="min-h-[38px] cursor-pointer rounded-pill border border-line bg-surface px-[20px] text-[12.5px] font-semibold text-ink transition-colors hover:bg-sunk"
        >
          Erfassen
        </button>
      </section>
    );
  }

  return (
    <section className="rounded-[20px] bg-surface p-5 shadow-soft">
      <h2 className="mb-3 text-[15px] font-semibold">Abholung erfassen</h2>

      <form action={erfassen} className="flex flex-col gap-3">
        <label className="flex flex-col gap-[5px]">
          <span className="text-[12px] font-medium text-muted">Lieferant</span>
          <select
            name="lieferantId"
            required
            className="w-full cursor-pointer rounded-input border border-line bg-surface px-[13px] py-[10px] text-[13.5px] outline-0 focus:border-accent"
          >
            <option value="">— wählen —</option>
            {lieferanten.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>

        {gewaehlt ? (
          <div className="flex items-center gap-2 rounded-card border border-line bg-panel px-3 py-[9px]">
            <input type="hidden" name="artikelId" value={gewaehlt.id} />
            <span className="min-w-0 flex-1 truncate text-[13.5px]">
              {gewaehlt.name}
            </span>
            <button
              type="button"
              onClick={() => setGewaehlt(null)}
              className="cursor-pointer border-0 bg-transparent text-[12px] text-muted underline"
            >
              ändern
            </button>
          </div>
        ) : (
          <>
            <input
              type="search"
              value={suche}
              onChange={(e) => setSuche(e.target.value)}
              placeholder="Artikel suchen"
              aria-label="Artikel suchen"
              className="w-full rounded-pill border border-line bg-surface px-[16px] py-[10px] text-[13.5px] outline-0 focus:border-accent"
            />
            {treffer.length > 0 ? (
              <ul className="flex flex-col gap-[5px]">
                {treffer.map((a) => (
                  <li key={a.id}>
                    <button
                      type="button"
                      onClick={() => setGewaehlt({ id: a.id, name: a.name })}
                      className="flex w-full cursor-pointer items-center gap-3 rounded-card border border-line bg-surface px-3 py-[9px] text-left transition-colors hover:border-accent"
                    >
                      <span className="min-w-0 flex-1 truncate text-[13.5px]">
                        {a.name}
                      </span>
                      <span className="num shrink-0 text-[11.5px] text-faint">
                        {a.sku}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        )}

        <label className="flex flex-col gap-[5px]">
          <span className="text-[12px] font-medium text-muted">Menge</span>
          <input
            name="menge"
            type="number"
            step="0.001"
            min="0.001"
            defaultValue="1"
            required
            className="num w-full rounded-input border border-line bg-surface px-[13px] py-[10px] text-[13.5px] outline-0 focus:border-accent"
          />
        </label>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="submit"
            disabled={!gewaehlt}
            className={[
              "min-h-[40px] rounded-pill px-[20px] text-[12.5px] font-semibold",
              gewaehlt
                ? "cursor-pointer border-0 bg-[linear-gradient(150deg,var(--accent-from),var(--accent-to))] text-white"
                : "cursor-not-allowed border border-line bg-sunk text-faint",
            ].join(" ")}
          >
            Abgeholt und eingebucht
          </button>
          <button
            type="button"
            onClick={() => setOffen(false)}
            className="cursor-pointer border-0 bg-transparent text-[12.5px] text-muted underline"
          >
            Abbrechen
          </button>
        </div>

        <Meldung status={status} />
      </form>
    </section>
  );
}
