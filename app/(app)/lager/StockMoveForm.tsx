"use client";

import { useActionState } from "react";
import { Suchauswahl } from "@/components/ui/Suchauswahl";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/Button";
import { bookStockMove, type StockState } from "./actions";

const INITIAL: StockState = { error: null, ok: null };

const KINDS = [
  ["out", "Entnahme"],
  ["return", "Rückgabe"],
  ["goods_in", "Wareneingang"],
  ["correction", "Korrektur"],
] as const;

type Option = { id: string; label: string };

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} block>
      {pending ? "Bucht …" : "Buchen"}
    </Button>
  );
}

export function StockMoveForm({
  articles,
  jobs,
  fixedArticleId,
  fixedJobId,
  unit,
}: {
  articles: Option[];
  jobs: Option[];
  fixedArticleId?: string;
  fixedJobId?: string;
  unit?: string;
}) {
  const [state, formAction] = useActionState(bookStockMove, INITIAL);

  return (
    <form
      action={formAction}
      className="rounded-[20px] bg-surface p-[22px] shadow-soft"
    >
      <h2 className="text-[15px] font-semibold">Material buchen</h2>
      <p className="mt-1 mb-4 text-[12.5px] text-muted">
        Der Bestand ändert sich mit der Buchung.
      </p>

      <div className="flex flex-col gap-3">
        {fixedArticleId ? (
          <input type="hidden" name="articleId" value={fixedArticleId} />
        ) : (
          /*
            Suche statt Klappliste. Ein Lager mit 3000 Artikeln ist in
            einem <select> nicht bedienbar — schon gar nicht am Telefon
            oder mit dem Handschuh am Tablet.
          */
          <Suchauswahl
            name="articleId"
            label="Artikel"
            pflicht
            platzhalter="Artikel suchen — Bezeichnung oder Nummer"
            optionen={articles.map((a) => ({ wert: a.id, text: a.label }))}
          />
        )}

        <Wrap label="Art" htmlFor="sm-kind">
          <select
            id="sm-kind"
            name="kind"
            defaultValue="out"
            className={selectClass}
          >
            {KINDS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </Wrap>

        <Wrap label={unit ? `Menge (${unit})` : "Menge"} htmlFor="sm-qty">
          <input
            id="sm-qty"
            type="number"
            name="qty"
            min="0.001"
            step="0.001"
            required
            defaultValue="1"
            className={`${inputClass} num`}
          />
        </Wrap>

        {fixedJobId ? (
          <input type="hidden" name="jobId" value={fixedJobId} />
        ) : (
          <Suchauswahl
            name="jobId"
            label="Vorgang"
            platzhalter="Auftrag suchen — Nummer oder Kunde"
            leerLabel="— ohne Vorgang —"
            optionen={jobs.map((j) => ({ wert: j.id, text: j.label }))}
          />
        )}

        <Wrap label="Notiz" htmlFor="sm-note">
          <input
            id="sm-note"
            type="text"
            name="note"
            maxLength={300}
            placeholder="optional"
            className={inputClass}
          />
        </Wrap>
      </div>

      {state.error ? (
        <p
          role="alert"
          className="mt-3 rounded-input bg-s-crit/10 px-[13px] py-[10px] text-[13px] font-medium text-s-crit"
        >
          {state.error}
        </p>
      ) : null}
      {state.ok ? (
        <p
          role="status"
          className="mt-3 rounded-input bg-s-done/10 px-[13px] py-[10px] text-[13px] font-medium text-s-done"
        >
          {state.ok}
        </p>
      ) : null}

      <div className="mt-4">
        <Submit />
      </div>
    </form>
  );
}

const inputClass =
  "w-full rounded-input border border-transparent bg-sunk px-[13px] py-[10px] text-sm text-ink outline-0 transition-colors duration-200 focus:border-accent focus:bg-surface";
const selectClass = `${inputClass} cursor-pointer`;

/*
 * htmlFor/id statt umschließendem <label>: umschließt das Label ein <select>,
 * zählt dessen Optionstext zum zugänglichen Namen. Das Feld hieße dann
 * "ArtEntnahmeRückgabeWareneingangKorrektur" — für Screenreader wie für Tests.
 */
function Wrap({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-[6px]">
      <label
        htmlFor={htmlFor}
        className="text-[12.5px] font-semibold text-muted"
      >
        {label}
      </label>
      {children}
    </div>
  );
}
