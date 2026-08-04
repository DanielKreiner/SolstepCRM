"use client";

import { useActionState, useMemo, useState } from "react";
import { LEER, Meldung, type AktionsStatus } from "@/components/ui/Formular";
import { Pill, type Tone } from "@/components/ui/Pill";
import { date, num } from "@/lib/format";
import { DECKUNG_TEXT, type DeckungStatus } from "@/lib/material/deckung";
import {
  bedarfAusAngebot,
  bedarfHinzufuegen,
  bedarfMenge,
  bedarfStreichen,
} from "@/app/(app)/vorgaenge/material-actions";

export type BedarfZeileAnsicht = {
  id: string;
  sku: string | null;
  bezeichnung: string;
  menge: number;
  einheit: string;
  herkunft: string;
  status: DeckungStatus;
  aufVorgang: number;
  imLager: number;
  bestellt: number;
  bestellungen: string[];
  liefertermin: string | null;
  bereitgestellt: boolean;
};

export type ArtikelWahl = {
  id: string;
  sku: string;
  name: string;
  einheit: string;
};

const TON: Record<DeckungStatus, Tone> = {
  offen: "crit",
  bestellt: "doing",
  im_lager: "waiting",
  geladen: "done",
};

/**
 * Die Bedarfsliste — was auf die Baustelle muss.
 *
 * Sie steht neben dem Angebot, nicht darin. Das Angebot ist, was der
 * Kunde zahlt; die Bedarfsliste ist, was das Lager herausrücken muss.
 * Wer hier vierzig Meter Kabel ergänzt, ändert keinen Preis — und wer
 * mehr verrechnen will, schreibt einen Nachtrag.
 */
export function Bedarf({
  vorgangId,
  zeilen,
  artikel,
  streng,
  montageAb,
  darfSchreiben,
}: {
  vorgangId: string;
  zeilen: BedarfZeileAnsicht[];
  artikel: ArtikelWahl[];
  streng: boolean;
  montageAb: string | null;
  darfSchreiben: boolean;
}) {
  const [neuStatus, neu] = useActionState<AktionsStatus, FormData>(
    bedarfHinzufuegen,
    LEER,
  );
  const [mengeStatus, mengeAendern] = useActionState<AktionsStatus, FormData>(
    bedarfMenge,
    LEER,
  );
  const [wegStatus, streichen] = useActionState<AktionsStatus, FormData>(
    bedarfStreichen,
    LEER,
  );
  const [fuellStatus, fuellen] = useActionState<AktionsStatus, FormData>(
    bedarfAusAngebot,
    LEER,
  );

  const [suche, setSuche] = useState("");
  const [menge, setMenge] = useState("1");

  const treffer = useMemo(() => {
    const q = suche.trim().toLowerCase();
    if (q.length < 2) return [];
    return artikel
      .filter((a) => `${a.sku} ${a.name}`.toLowerCase().includes(q))
      .slice(0, 8);
  }, [artikel, suche]);

  const offen = zeilen.filter((z) => z.status === "offen").length;

  if (zeilen.length === 0) {
    return (
      <section className="rounded-[20px] bg-surface p-5 shadow-soft">
        <h2 className="text-[15px] font-semibold">Bedarfsliste</h2>
        <p className="mt-1 mb-3 text-[12.5px] text-muted">
          Noch keine Liste. Sie entsteht beim Annehmen des Angebots — Pakete
          aufgelöst, Pauschalen aussen vor. Für ältere Vorgänge lässt sie sich
          nachträglich erzeugen.
        </p>
        {darfSchreiben ? (
          <form action={fuellen}>
            <input type="hidden" name="vorgangId" value={vorgangId} />
            <button
              type="submit"
              className="min-h-[38px] cursor-pointer rounded-pill border-0 bg-[linear-gradient(150deg,var(--accent-from),var(--accent-to))] px-[20px] text-[12.5px] font-semibold text-white"
            >
              Aus dem Angebot erzeugen
            </button>
          </form>
        ) : null}
        <Meldung status={fuellStatus} />
      </section>
    );
  }

  return (
    <section className="rounded-[20px] bg-surface p-5 shadow-soft">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <h2 className="text-[15px] font-semibold">Bedarfsliste</h2>
        <span className="num text-[12px] text-muted">{zeilen.length} Positionen</span>
        {offen > 0 ? (
          <Pill tone="crit">{offen} ungedeckt</Pill>
        ) : (
          <Pill tone="done">alles gedeckt</Pill>
        )}
      </div>
      <p className="mb-4 text-[12.5px] text-muted">
        {montageAb
          ? `Montage ab ${date(montageAb)}. `
          : "Noch kein Montagetermin. "}
        {streng
          ? "Gedeckt heisst hier: im Haus."
          : "Bestellt mit bestätigtem Termin zählt als gedeckt."}
      </p>

      <ul className="flex flex-col gap-[6px]">
        {zeilen.map((z) => (
          <li
            key={z.id}
            className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-card border border-line bg-panel px-3 py-[10px]"
          >
            <span className="min-w-[180px] flex-1">
              <span className="block truncate text-[13.5px] font-medium">
                {z.bezeichnung}
              </span>
              <span className="num block text-[11px] text-faint">
                {z.sku ?? "Freitext"}
                {z.herkunft === "paket" ? " · aus Paket" : ""}
                {z.bereitgestellt ? " · bereitgestellt" : ""}
              </span>
            </span>

            <span className="flex items-center gap-2">
              {darfSchreiben ? (
                <form action={mengeAendern} className="flex items-center gap-1">
                  <input type="hidden" name="vorgangId" value={vorgangId} />
                  <input type="hidden" name="id" value={z.id} />
                  <input
                    name="menge"
                    type="number"
                    step="0.001"
                    min="0.001"
                    defaultValue={z.menge}
                    aria-label={`Menge ${z.bezeichnung}`}
                    className="num w-[86px] rounded-input border border-line bg-surface px-[9px] py-[6px] text-right text-[13px] outline-0 focus:border-accent"
                  />
                  <button
                    type="submit"
                    className="cursor-pointer rounded-pill border border-line bg-surface px-[10px] py-[5px] text-[11.5px] text-muted transition-colors hover:border-accent hover:text-accent-ink"
                  >
                    Setzen
                  </button>
                </form>
              ) : (
                <span className="num text-[13px] font-semibold">{num(z.menge)}</span>
              )}
              <span className="w-[34px] text-[11.5px] text-faint">{z.einheit}</span>
            </span>

            <span className="flex items-center gap-2">
              <Pill tone={TON[z.status]}>{DECKUNG_TEXT[z.status]}</Pill>
              <span className="text-[11px] text-faint">{herkunftText(z)}</span>
            </span>

            {darfSchreiben ? (
              <form action={streichen}>
                <input type="hidden" name="vorgangId" value={vorgangId} />
                <input type="hidden" name="id" value={z.id} />
                <button
                  type="submit"
                  aria-label={`${z.bezeichnung} streichen`}
                  className="cursor-pointer rounded-pill border border-line bg-surface px-[11px] py-[5px] text-[11.5px] text-muted transition-colors hover:border-s-crit hover:text-s-crit"
                >
                  Streichen
                </button>
              </form>
            ) : null}
          </li>
        ))}
      </ul>

      <Meldung status={mengeStatus} />
      <Meldung status={wegStatus} />

      {darfSchreiben ? (
        <div className="mt-4 border-t border-line pt-4">
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="search"
              value={suche}
              onChange={(e) => setSuche(e.target.value)}
              placeholder="Artikel ergänzen — Nummer oder Bezeichnung"
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
              {treffer.map((a) => (
                <li key={a.id}>
                  <form action={neu}>
                    <input type="hidden" name="vorgangId" value={vorgangId} />
                    <input type="hidden" name="artikelId" value={a.id} />
                    <input type="hidden" name="menge" value={menge} />
                    <button
                      type="submit"
                      className="flex w-full cursor-pointer items-center gap-3 rounded-card border border-line bg-surface px-3 py-[9px] text-left transition-colors hover:border-accent hover:bg-accent/6"
                    >
                      <span className="min-w-0 flex-1 truncate text-[13.5px]">
                        {a.name}
                      </span>
                      <span className="num shrink-0 text-[11.5px] text-faint">
                        {a.sku}
                      </span>
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          ) : suche.trim().length >= 2 ? (
            <form action={neu} className="mt-2 flex flex-wrap items-center gap-2">
              <input type="hidden" name="vorgangId" value={vorgangId} />
              <input type="hidden" name="bezeichnung" value={suche} />
              <input type="hidden" name="menge" value={menge} />
              <span className="text-[12.5px] text-muted">
                Kein Stammartikel gefunden.
              </span>
              <button
                type="submit"
                className="cursor-pointer rounded-pill border border-line bg-surface px-[14px] py-[7px] text-[12.5px] font-medium text-ink transition-colors hover:bg-sunk"
              >
                {`„${suche}“ als Freitext aufnehmen`}
              </button>
            </form>
          ) : null}

          <Meldung status={neuStatus} />
        </div>
      ) : null}
    </section>
  );
}

function herkunftText(z: BedarfZeileAnsicht): string {
  if (z.status === "geladen") return `${num(z.aufVorgang)} gebucht`;
  if (z.status === "im_lager") return `${num(z.imLager)} im Lager`;
  if (z.status === "bestellt") {
    const nr = z.bestellungen.join(", ");
    return `${nr}${z.liefertermin ? ` · ${date(z.liefertermin)}` : ""}`;
  }
  if (z.bestellt > 0 && !z.liefertermin) return "bestellt, Termin fehlt";
  return "nichts angestossen";
}
