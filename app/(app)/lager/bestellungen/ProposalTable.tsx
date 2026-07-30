"use client";

import { useActionState, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/Button";
import { Pill } from "@/components/ui/Pill";
import { eur, num } from "@/lib/format";
import { createPurchaseOrder, type OrderState } from "./actions";

const INITIAL: OrderState = { error: null, ok: null };

export type Line = {
  articleId: string;
  sku: string;
  name: string;
  unit: string;
  bestand: number;
  reserviert: number;
  bestellt: number;
  mindestbestand: number;
  fehlmenge: number;
  grund: "auftrag" | "mindestbestand" | "beides";
  supplierId: string | null;
  supplierName: string | null;
  preis: number;
  lieferTage: number;
  auftraege: string[];
};

const GRUND_LABEL: Record<Line["grund"], string> = {
  auftrag: "Auftrag",
  mindestbestand: "Mindestbestand",
  beides: "Auftrag + Mindest",
};

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Legt an …" : "Bestellung anlegen"}
    </Button>
  );
}

export function ProposalTable({
  lines,
  suppliers,
}: {
  lines: Line[];
  suppliers: { id: string; name: string }[];
}) {
  const [state, formAction] = useActionState(createPurchaseOrder, INITIAL);
  const [mengen, setMengen] = useState<Record<string, number>>(() =>
    Object.fromEntries(lines.map((l) => [l.articleId, l.fehlmenge])),
  );
  const [gewaehlt, setGewaehlt] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(lines.map((l) => [l.articleId, true])),
  );
  const [supplierId, setSupplierId] = useState<string>(
    lines.find((l) => l.supplierId)?.supplierId ?? suppliers[0]?.id ?? "",
  );

  const auswahl = useMemo(
    () =>
      lines
        .filter((l) => gewaehlt[l.articleId])
        .map((l) => ({
          articleId: l.articleId,
          qty: mengen[l.articleId] ?? l.fehlmenge,
        }))
        .filter((l) => l.qty > 0),
    [lines, gewaehlt, mengen],
  );

  const summe = lines
    .filter((l) => gewaehlt[l.articleId])
    .reduce((s, l) => s + (mengen[l.articleId] ?? 0) * l.preis, 0);

  if (lines.length === 0) {
    return (
      <div className="rounded-[20px] bg-surface p-6 shadow-soft">
        <p className="text-[13.5px] text-muted">
          Kein Bedarf. Bestand und offene Bestellungen decken die terminierten
          Aufträge und den Mindestbestand.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="lines" value={JSON.stringify(auswahl)} />

      <div className="overflow-x-auto rounded-[20px] bg-surface shadow-soft">
        <div className="min-w-[900px]">
          <div className="grid grid-cols-[42px_1.6fr_130px_110px_110px_150px_120px] border-b border-line px-5 text-[11px] tracking-[0.07em] text-faint uppercase">
            <div className="px-[6px] py-[14px]" />
            <div className="px-[6px] py-[14px]">Artikel</div>
            <div className="px-[6px] py-[14px]">Grund</div>
            <div className="px-[6px] py-[14px] text-right">Bestand</div>
            <div className="px-[6px] py-[14px] text-right">Bedarf</div>
            <div className="px-[6px] py-[14px] text-right">Bestellmenge</div>
            <div className="px-[6px] py-[14px] text-right">Wert</div>
          </div>

          {lines.map((l) => (
            <div
              key={l.articleId}
              className="grid grid-cols-[42px_1.6fr_130px_110px_110px_150px_120px] items-center border-b border-line px-5 last:border-b-0"
            >
              <div className="px-[6px] py-2">
                <input
                  type="checkbox"
                  aria-label={`${l.sku} bestellen`}
                  checked={gewaehlt[l.articleId] ?? false}
                  onChange={(e) =>
                    setGewaehlt((g) => ({ ...g, [l.articleId]: e.target.checked }))
                  }
                  className="h-4 w-4 accent-[var(--accent)]"
                />
              </div>
              <div className="px-[6px] py-2">
                <div className="text-sm font-medium">{l.name}</div>
                <div className="num text-[11.5px] text-muted">
                  {l.sku}
                  {l.supplierName ? ` · ${l.supplierName}` : " · kein Lieferant"}
                </div>
              </div>
              <div className="px-[6px] py-2">
                <Pill tone={l.grund === "mindestbestand" ? "warn" : "crit"}>
                  {GRUND_LABEL[l.grund]}
                </Pill>
                {l.auftraege.length > 0 ? (
                  <div className="num mt-1 text-[10.5px] text-faint">
                    {l.auftraege.join(", ")}
                  </div>
                ) : null}
              </div>
              <div className="num px-[6px] py-2 text-right text-[12.5px]">
                {num(l.bestand)}
              </div>
              <div className="num px-[6px] py-2 text-right text-[12.5px] text-muted">
                {num(l.reserviert)}
                {l.bestellt > 0 ? ` (${num(l.bestellt)} unterwegs)` : ""}
              </div>
              <div className="px-[6px] py-2 text-right">
                <input
                  type="number"
                  min="0"
                  step="1"
                  aria-label={`Bestellmenge ${l.sku}`}
                  value={mengen[l.articleId] ?? 0}
                  onChange={(e) =>
                    setMengen((m) => ({
                      ...m,
                      [l.articleId]: Number(e.target.value),
                    }))
                  }
                  className="num w-[92px] rounded-input border border-transparent bg-sunk px-2 py-[7px] text-right text-[13px] outline-0 focus:border-accent focus:bg-surface"
                />
              </div>
              <div className="num px-[6px] py-2 text-right text-[13px] font-semibold">
                {eur((mengen[l.articleId] ?? 0) * l.preis)}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-4 rounded-[20px] bg-surface p-5 shadow-soft">
        <div className="flex min-w-[240px] flex-col gap-[6px]">
          <label
            htmlFor="po-supplier"
            className="text-[12.5px] font-semibold text-muted"
          >
            Lieferant
          </label>
          <select
            id="po-supplier"
            name="supplierId"
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
            className="w-full cursor-pointer rounded-input border border-transparent bg-sunk px-[13px] py-[10px] text-sm text-ink outline-0 focus:border-accent focus:bg-surface"
          >
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex-1">
          <div className="text-[12.5px] text-muted">
            {auswahl.length} Positionen · Warenwert
          </div>
          <div className="num text-[18px] font-semibold">{eur(summe)}</div>
        </div>

        <Submit />
      </div>

      {state.error ? (
        <p
          role="alert"
          className="rounded-input bg-s-crit/10 px-[13px] py-[10px] text-[13px] font-medium text-s-crit"
        >
          {state.error}
        </p>
      ) : null}
      {state.ok ? (
        <p
          role="status"
          className="rounded-input bg-s-done/10 px-[13px] py-[10px] text-[13px] font-medium text-s-done"
        >
          {state.ok}
        </p>
      ) : null}
    </form>
  );
}
