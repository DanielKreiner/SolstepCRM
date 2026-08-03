"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { eur } from "@/lib/format";
import { angebotAusEntwurf } from "./positionen-actions";

/*
 * Angebotsentwurf im Browser.
 *
 * Zeilen hinzufügen, Mengen und Preise ändern, Summen laufen live mit —
 * und erst beim Abschicken entsteht ein Datensatz. Das ist der Unterschied
 * zum vorherigen Ablauf, bei dem jede Position sofort in der Datenbank
 * landete: wer ein Angebot zusammenstellt und es sich anders überlegt,
 * hinterlässt nichts.
 *
 * Preise werden beim Übernehmen aus dem Artikel KOPIERT. Ein Angebot von
 * heute darf sich nicht ändern, weil nächstes Jahr der Einkauf steigt.
 */

export type Artikel = {
  id: string;
  sku: string;
  name: string;
  unit: string;
  ek: number;
  vk: number;
  ust: number;
};

export type Kunde = {
  id: string;
  name: string;
  ort: string | null;
  email: string | null;
};

type Zeile = {
  key: string;
  articleId: string | null;
  text: string;
  qty: number;
  unit: string;
  ek: number;
  vk: number;
  ust: number;
};

let laufend = 0;
const neuerKey = () => `z${++laufend}`;

export function AngebotEntwurf({
  kunden,
  artikel,
}: {
  kunden: Kunde[];
  artikel: Artikel[];
}) {
  const router = useRouter();
  const [zeilen, setZeilen] = useState<Zeile[]>([]);
  const [kundeId, setKundeId] = useState("");
  const [gueltig, setGueltig] = useState("");
  const [suche, setSuche] = useState("");
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, starte] = useTransition();

  const treffer = useMemo(() => {
    const q = suche.trim().toLowerCase();
    if (q.length < 2) return [];
    return artikel
      .filter(
        (a) =>
          a.name.toLowerCase().includes(q) || a.sku.toLowerCase().includes(q),
      )
      .slice(0, 6);
  }, [suche, artikel]);

  const summe = useMemo(() => {
    const netto = zeilen.reduce((s, z) => s + z.qty * z.vk, 0);
    const kosten = zeilen.reduce((s, z) => s + z.qty * z.ek, 0);
    const ust = zeilen.reduce((s, z) => s + (z.qty * z.vk * z.ust) / 100, 0);
    return {
      netto,
      kosten,
      ust,
      brutto: netto + ust,
      marge: netto > 0 ? ((netto - kosten) / netto) * 100 : 0,
    };
  }, [zeilen]);

  const kunde = kunden.find((k) => k.id === kundeId) ?? null;

  function artikelHinzu(a: Artikel) {
    setZeilen((z) => [
      ...z,
      {
        key: neuerKey(),
        articleId: a.id,
        text: `${a.name} (${a.sku})`,
        qty: 1,
        unit: a.unit,
        ek: a.ek,
        vk: a.vk,
        ust: a.ust,
      },
    ]);
    setSuche("");
  }

  function freieZeile() {
    setZeilen((z) => [
      ...z,
      {
        key: neuerKey(),
        articleId: null,
        text: "",
        qty: 1,
        unit: "Stk",
        ek: 0,
        vk: 0,
        ust: 20,
      },
    ]);
  }

  function aendere(key: string, teil: Partial<Zeile>) {
    setZeilen((z) => z.map((r) => (r.key === key ? { ...r, ...teil } : r)));
  }

  function entferne(key: string) {
    setZeilen((z) => z.filter((r) => r.key !== key));
  }

  function abschicken() {
    setFehler(null);

    if (!kundeId) {
      setFehler("Ohne Kunde kein Angebot.");
      return;
    }
    const leer = zeilen.find((z) => z.text.trim().length < 2);
    if (leer) {
      setFehler("Jede Position braucht eine Bezeichnung.");
      return;
    }
    if (zeilen.length === 0) {
      setFehler("Ein Angebot ohne Positionen ist keins.");
      return;
    }

    starte(async () => {
      const ergebnis = await angebotAusEntwurf({
        customerId: kundeId,
        validUntil: gueltig || null,
        positionen: zeilen.map((z) => ({
          articleId: z.articleId,
          text: z.text.trim(),
          qty: z.qty,
          unit: z.unit,
          purchasePrice: z.ek,
          salePrice: z.vk,
          vatRate: z.ust,
        })),
      });

      if (ergebnis.error) {
        setFehler(ergebnis.error);
        return;
      }
      router.push(`/angebote/${ergebnis.quoteId}`);
    });
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[1.7fr_1fr] xl:items-start">
      {/* ---------- Positionen ---------- */}
      <div className="flex flex-col gap-4">
        <section className="rounded-[20px] bg-surface p-5 shadow-soft">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-[15px] font-semibold">Positionen</h2>
            <button
              type="button"
              onClick={freieZeile}
              className="flex cursor-pointer items-center gap-[7px] rounded-pill border-0 bg-sunk px-[15px] py-[9px] text-[12.5px] font-medium text-ink hover:bg-line"
            >
              <Icon name="plus" size={14} />
              Freie Position
            </button>
          </div>

          {/* Artikelsuche wie der Produktwähler im Shop */}
          <div className="relative mb-4">
            <label htmlFor="artikelsuche" className="sr-only">
              Artikel suchen
            </label>
            <input
              id="artikelsuche"
              value={suche}
              onChange={(e) => setSuche(e.target.value)}
              placeholder="Artikel suchen — Bezeichnung oder Nummer"
              className="w-full rounded-input border border-transparent bg-sunk px-[13px] py-[11px] text-[13.5px] outline-0 focus:border-accent focus:bg-surface"
            />

            {treffer.length > 0 ? (
              <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-input bg-surface shadow-[0_8px_30px_rgba(21,18,16,0.14)]">
                {treffer.map((a) => (
                  <li key={a.id}>
                    <button
                      type="button"
                      onClick={() => artikelHinzu(a)}
                      className="flex w-full cursor-pointer items-center gap-3 border-0 bg-transparent px-4 py-3 text-left hover:bg-panel"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13.5px] font-medium">
                          {a.name}
                        </span>
                        <span className="num block text-[11px] text-faint">
                          {a.sku} · EK {eur(a.ek)}
                        </span>
                      </span>
                      <span className="num text-[13px] font-semibold">
                        {eur(a.vk)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          {zeilen.length === 0 ? (
            <p className="rounded-input bg-panel px-4 py-6 text-center text-[13px] text-muted">
              Noch nichts drin. Artikel suchen oder eine freie Position
              anlegen — für Montage, Anfahrt, Gerüst.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {zeilen.map((z, i) => (
                <li key={z.key} className="rounded-input bg-panel p-3">
                  <div className="flex items-start gap-3">
                    <span className="num w-[26px] shrink-0 pt-[10px] text-[11px] text-faint">
                      {(i + 1) * 10}
                    </span>

                    <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-[1fr_80px_90px_100px_100px_70px]">
                      <input
                        value={z.text}
                        onChange={(e) => aendere(z.key, { text: e.target.value })}
                        placeholder="Bezeichnung"
                        aria-label={`Bezeichnung Position ${i + 1}`}
                        className="rounded-input border border-transparent bg-surface px-[11px] py-[9px] text-[13px] outline-0 focus:border-accent sm:col-span-1"
                      />
                      <input
                        type="number"
                        step="0.001"
                        min="0"
                        value={z.qty}
                        onChange={(e) =>
                          aendere(z.key, { qty: Number(e.target.value) })
                        }
                        aria-label={`Menge Position ${i + 1}`}
                        className="num rounded-input border border-transparent bg-surface px-[11px] py-[9px] text-right text-[13px] outline-0 focus:border-accent"
                      />
                      <input
                        value={z.unit}
                        onChange={(e) => aendere(z.key, { unit: e.target.value })}
                        aria-label={`Einheit Position ${i + 1}`}
                        className="num rounded-input border border-transparent bg-surface px-[11px] py-[9px] text-[13px] outline-0 focus:border-accent"
                      />
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={z.ek}
                        onChange={(e) =>
                          aendere(z.key, { ek: Number(e.target.value) })
                        }
                        aria-label={`Einkauf Position ${i + 1}`}
                        className="num rounded-input border border-transparent bg-surface px-[11px] py-[9px] text-right text-[13px] outline-0 focus:border-accent"
                      />
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={z.vk}
                        onChange={(e) =>
                          aendere(z.key, { vk: Number(e.target.value) })
                        }
                        aria-label={`Verkauf Position ${i + 1}`}
                        className="num rounded-input border border-transparent bg-surface px-[11px] py-[9px] text-right text-[13px] font-semibold outline-0 focus:border-accent"
                      />
                      <select
                        value={z.ust}
                        onChange={(e) =>
                          aendere(z.key, { ust: Number(e.target.value) })
                        }
                        aria-label={`Steuersatz Position ${i + 1}`}
                        className="num cursor-pointer rounded-input border border-transparent bg-surface px-[8px] py-[9px] text-[12.5px] outline-0 focus:border-accent"
                      >
                        <option value={20}>20 %</option>
                        <option value={10}>10 %</option>
                        <option value={0}>0 %</option>
                      </select>
                    </div>

                    <button
                      type="button"
                      onClick={() => entferne(z.key)}
                      aria-label={`Position ${i + 1} entfernen`}
                      className="mt-[6px] cursor-pointer rounded-icon border-0 bg-transparent p-2 text-faint hover:text-s-crit"
                    >
                      <Icon name="kreuz" size={14} />
                    </button>
                  </div>

                  <div className="num mt-2 pl-[38px] text-[11px] text-faint">
                    Zeilensumme {eur(z.qty * z.vk)}
                    {z.vk > 0 ? (
                      <>
                        {" · DB "}
                        <span
                          className={
                            (z.vk - z.ek) / z.vk < 0.1 ? "text-s-crit" : ""
                          }
                        >
                          {Math.round(((z.vk - z.ek) / z.vk) * 100)} %
                        </span>
                      </>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ---------- Summen ---------- */}
        <section className="rounded-[20px] bg-surface p-5 shadow-soft">
          <h2 className="mb-3 text-[15px] font-semibold">Summe</h2>
          <dl className="flex flex-col gap-2 text-[13px]">
            <Zeilenwert
              label={`Zwischensumme · ${zeilen.length} ${zeilen.length === 1 ? "Position" : "Positionen"}`}
              wert={eur(summe.netto)}
            />
            <Zeilenwert label="Umsatzsteuer" wert={eur(summe.ust)} leise />
            <Zeilenwert
              label="Kalkulierte Kosten"
              wert={eur(summe.kosten)}
              leise
            />
            <div className="mt-1 flex items-baseline justify-between border-t border-line pt-3">
              <dt className="text-[14px] font-semibold">Gesamt brutto</dt>
              <dd className="num text-[19px] font-semibold">
                {eur(summe.brutto)}
              </dd>
            </div>
            <div className="flex items-baseline justify-between">
              <dt className="text-[12px] text-muted">Deckungsbeitrag</dt>
              <dd
                className={`num text-[12.5px] font-medium ${summe.marge < 15 ? "text-s-crit" : "text-s-done"}`}
              >
                {Math.round(summe.marge)} %
              </dd>
            </div>
          </dl>
        </section>
      </div>

      {/* ---------- Kunde und Aktionen ---------- */}
      <div className="flex flex-col gap-4">
        <section className="rounded-[20px] bg-surface p-5 shadow-soft">
          <h2 className="mb-3 text-[15px] font-semibold">Kunde</h2>

          <label htmlFor="entwurf-kunde" className="sr-only">
            Kunde
          </label>
          <select
            id="entwurf-kunde"
            value={kundeId}
            onChange={(e) => setKundeId(e.target.value)}
            className="w-full cursor-pointer rounded-input border border-transparent bg-sunk px-[13px] py-[10px] text-[13.5px] outline-0 focus:border-accent focus:bg-surface"
          >
            <option value="">— Kunde wählen —</option>
            {kunden.map((k) => (
              <option key={k.id} value={k.id}>
                {[k.name, k.ort].filter(Boolean).join(" · ")}
              </option>
            ))}
          </select>

          {kunde ? (
            <p className="num mt-2 text-[11.5px] text-faint">
              {kunde.email ?? "keine Mailadresse hinterlegt — Versand nicht möglich"}
            </p>
          ) : null}
        </section>

        <section className="rounded-[20px] bg-surface p-5 shadow-soft">
          <h2 className="mb-3 text-[15px] font-semibold">Gültigkeit</h2>
          <label htmlFor="entwurf-gueltig" className="sr-only">
            Gültig bis
          </label>
          <input
            id="entwurf-gueltig"
            type="date"
            value={gueltig}
            onChange={(e) => setGueltig(e.target.value)}
            className="num w-full rounded-input border border-transparent bg-sunk px-[13px] py-[10px] text-[13.5px] outline-0 focus:border-accent focus:bg-surface"
          />
          <p className="mt-2 text-[11.5px] text-faint">
            Leer lassen für 30 Tage.
          </p>
        </section>

        <section className="rounded-[20px] bg-surface p-5 shadow-soft">
          <button
            type="button"
            onClick={abschicken}
            disabled={laeuft}
            className="min-h-[48px] w-full cursor-pointer rounded-pill border-0 bg-[linear-gradient(150deg,var(--accent-from),var(--accent-to))] text-[14px] font-semibold text-white shadow-[0_6px_18px_rgba(201,121,24,0.28)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {laeuft ? "Wird angelegt …" : "Angebot anlegen"}
          </button>

          <p className="mt-3 text-[11.5px] text-faint">
            Der Entwurf steht bis dahin nur im Browser. Erst beim Anlegen
            entsteht ein Angebot mit Nummer.
          </p>

          {fehler ? (
            <p
              role="alert"
              className="mt-3 rounded-input bg-s-crit/10 px-[13px] py-[10px] text-[12.5px] font-medium text-s-crit"
            >
              {fehler}
            </p>
          ) : null}
        </section>
      </div>
    </div>
  );
}

function Zeilenwert({
  label,
  wert,
  leise = false,
}: {
  label: string;
  wert: string;
  leise?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className={leise ? "text-[12.5px] text-muted" : ""}>{label}</dt>
      <dd className={`num ${leise ? "text-[12.5px] text-muted" : "font-medium"}`}>
        {wert}
      </dd>
    </div>
  );
}
