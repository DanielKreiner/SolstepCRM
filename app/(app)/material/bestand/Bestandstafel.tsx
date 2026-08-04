"use client";

import { useActionState, useMemo, useState } from "react";
import { LEER, Meldung, type AktionsStatus } from "@/components/ui/Formular";
import { num } from "@/lib/format";
import { umbuchenAufFahrzeug } from "@/app/(app)/material/actions";

export type Ort = { id: string; name: string; art: string };
export type Bestandszeile = {
  id: string;
  sku: string;
  name: string;
  einheit: string;
  typ: string;
  mengen: Record<string, number>;
};

/**
 * Artikel mal Lagerorte.
 *
 * Eine Zeile je Artikel, eine Spalte je Ort — so sieht man auf einen
 * Blick, dass die zweihundert Meter Kabel nicht weg sind, sondern auf
 * Bus 1 liegen. Genau diese Frage stellt das Lager täglich.
 */
export function Bestandstafel({
  orte,
  artikel,
  alleArtikel,
  darfBuchen,
}: {
  orte: Ort[];
  artikel: Bestandszeile[];
  alleArtikel: { id: string; sku: string; name: string }[];
  darfBuchen: boolean;
}) {
  const [status, umbuchen] = useActionState<AktionsStatus, FormData>(
    umbuchenAufFahrzeug,
    LEER,
  );
  const [suche, setSuche] = useState("");
  const [umbuchsuche, setUmbuchsuche] = useState("");
  const [ziel, setZiel] = useState<{ id: string; name: string } | null>(null);

  const gefiltert = useMemo(() => {
    const q = suche.trim().toLowerCase();
    if (!q) return artikel.slice(0, 200);
    return artikel
      .filter((a) => `${a.sku} ${a.name}`.toLowerCase().includes(q))
      .slice(0, 200);
  }, [artikel, suche]);

  const treffer = useMemo(() => {
    const q = umbuchsuche.trim().toLowerCase();
    if (q.length < 2) return [];
    return alleArtikel
      .filter((a) => `${a.sku} ${a.name}`.toLowerCase().includes(q))
      .slice(0, 6);
  }, [alleArtikel, umbuchsuche]);

  const hauptlager = orte.find((o) => o.art === "hauptlager");
  const fahrzeuge = orte.filter((o) => o.art === "fahrzeug");

  return (
    <div className="grid gap-4 xl:grid-cols-[1.7fr_1fr] xl:items-start">
      <section className="min-w-0 rounded-[20px] bg-surface p-5 shadow-soft">
        <input
          type="search"
          value={suche}
          onChange={(e) => setSuche(e.target.value)}
          placeholder="Artikel suchen"
          aria-label="Artikel suchen"
          className="mb-3 w-full rounded-pill border border-line bg-surface px-[16px] py-[10px] text-[13.5px] outline-0 focus:border-accent"
        />

        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-line text-left">
                <th className="pb-2 text-[11px] font-semibold tracking-wide text-faint uppercase">
                  Artikel
                </th>
                {orte.map((o) => (
                  <th
                    key={o.id}
                    className="pb-2 text-right text-[11px] font-semibold tracking-wide text-faint uppercase"
                  >
                    {o.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {gefiltert.map((a) => (
                <tr key={a.id} className="border-b border-line/60">
                  <td className="py-[9px] pr-3">
                    <span className="block truncate">{a.name}</span>
                    <span className="num block text-[11px] text-faint">
                      {a.sku} · {a.einheit}
                    </span>
                  </td>
                  {orte.map((o) => {
                    const menge = a.mengen[o.id] ?? 0;
                    return (
                      <td
                        key={o.id}
                        className={`num py-[9px] text-right ${
                          menge === 0 ? "text-faint" : "font-semibold"
                        }`}
                      >
                        {menge === 0 ? "—" : num(menge)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {gefiltert.length === 0 ? (
          <p className="mt-3 text-[12.5px] text-muted">Kein Treffer.</p>
        ) : null}
      </section>

      {darfBuchen && hauptlager && fahrzeuge.length > 0 ? (
        <section className="rounded-[20px] bg-surface p-5 shadow-soft">
          <h2 className="text-[15px] font-semibold">Nachschub aufs Fahrzeug</h2>
          <p className="mt-1 mb-3 text-[12.5px] text-muted">
            Umbuchung, kein Verbrauch: die Ware wechselt den Ort und kostet
            keinen Vorgang etwas.
          </p>

          <form action={umbuchen} className="flex flex-col gap-3">
            <input type="hidden" name="vonLagerortId" value={hauptlager.id} />

            <label className="flex flex-col gap-[5px]">
              <span className="text-[12px] font-medium text-muted">Ziel</span>
              <select
                name="nachLagerortId"
                required
                className="w-full cursor-pointer rounded-input border border-line bg-surface px-[13px] py-[10px] text-[13.5px] outline-0 focus:border-accent"
              >
                {fahrzeuge.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </label>

            {ziel ? (
              <div className="flex items-center gap-2 rounded-card border border-line bg-panel px-3 py-[9px]">
                <input type="hidden" name="artikelId" value={ziel.id} />
                <span className="min-w-0 flex-1 truncate text-[13.5px]">
                  {ziel.name}
                </span>
                <button
                  type="button"
                  onClick={() => setZiel(null)}
                  className="cursor-pointer border-0 bg-transparent text-[12px] text-muted underline"
                >
                  ändern
                </button>
              </div>
            ) : (
              <>
                <input
                  type="search"
                  value={umbuchsuche}
                  onChange={(e) => setUmbuchsuche(e.target.value)}
                  placeholder="Artikel wählen"
                  aria-label="Artikel für die Umbuchung"
                  className="w-full rounded-pill border border-line bg-surface px-[16px] py-[10px] text-[13.5px] outline-0 focus:border-accent"
                />
                {treffer.length > 0 ? (
                  <ul className="flex flex-col gap-[5px]">
                    {treffer.map((a) => (
                      <li key={a.id}>
                        <button
                          type="button"
                          onClick={() => setZiel({ id: a.id, name: a.name })}
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

            <button
              type="submit"
              disabled={!ziel}
              className={[
                "min-h-[40px] rounded-pill px-[20px] text-[12.5px] font-semibold",
                ziel
                  ? "cursor-pointer border-0 bg-[linear-gradient(150deg,var(--accent-from),var(--accent-to))] text-white"
                  : "cursor-not-allowed border border-line bg-sunk text-faint",
              ].join(" ")}
            >
              Umbuchen
            </button>

            <Meldung status={status} />
          </form>
        </section>
      ) : null}
    </div>
  );
}
