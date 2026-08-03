"use client";

import { useState } from "react";
import {
  AktionsKnopf,
  Auswahl,
  Eingabe,
  Formular,
  Textfeld,
} from "@/components/ui/Formular";
import { Suchauswahl } from "@/components/ui/Suchauswahl";
import { eur, num } from "@/lib/format";
import {
  addQuoteItem,
  addQuoteItemFromArticle,
  createQuote,
  deleteQuote,
  deleteQuoteItem,
  updateQuote,
  updateQuoteItem,
} from "./positionen-actions";

export type Position = {
  id: string;
  pos: number;
  text: string;
  qty: number;
  unit: string;
  purchasePrice: number;
  salePrice: number;
  vatRate: number;
  kind: string;
  groupKey: string | null;
  category: string | null;
  manufacturer: string | null;
  description: string | null;
  /*
   * Artikelnummer der verknüpften Ware. Sie steht bewusst nicht im
   * Positionstext: der Kunde liest auf der Angebotsseite „Fronius Symo
   * GEN24" und nicht „WR-FRO-10 · Fronius Symo GEN24". Intern braucht man
   * sie trotzdem, deshalb steht sie hier neben der Bezeichnung.
   */
  sku: string | null;
};

export type Option = { wert: string; text: string };

const EINHEITEN = [
  { wert: "Stk", text: "Stück" },
  { wert: "m", text: "Meter" },
  { wert: "lfm", text: "Laufmeter" },
  { wert: "kg", text: "Kilogramm" },
  { wert: "h", text: "Stunde" },
  { wert: "pauschal", text: "pauschal" },
];

const STEUER = [
  { wert: "20", text: "20 %" },
  { wert: "10", text: "10 %" },
  { wert: "0", text: "0 %" },
];

/* Die fünf Rollen, die eine Position auf der Angebotsseite spielen kann. */
const ARTEN = [
  { wert: "position", text: "Normale Position" },
  { wert: "paket", text: "Komplettpaket (mit Paketpreis)" },
  { wert: "paket_inhalt", text: "Im Paket enthalten (ohne Preis)" },
  { wert: "option", text: "Optional — Kunde kann ankreuzen" },
  { wert: "leistung", text: "Inklusive, kostenlos" },
];

const ART_LABEL: Record<string, string> = {
  position: "Position",
  paket: "Paket",
  paket_inhalt: "im Paket",
  option: "optional",
  leistung: "inklusive",
};

const ART_TON: Record<string, string> = {
  position: "bg-sunk text-muted",
  paket: "bg-accent/14 text-accent-ink",
  paket_inhalt: "bg-panel text-faint",
  option: "bg-s-doing/12 text-s-doing",
  leistung: "bg-s-done/12 text-s-done",
};

/** Neues Angebot. Nur Kunde und Gültigkeit — Positionen kommen danach. */
export function AngebotAnlegen({ kunden }: { kunden: Option[] }) {
  const [offen, setOffen] = useState(false);

  if (!offen) {
    return (
      <button
        type="button"
        onClick={() => setOffen(true)}
        className="min-h-[44px] cursor-pointer rounded-pill border-0 bg-[linear-gradient(150deg,var(--accent-from),var(--accent-to))] px-[22px] text-[13.5px] font-semibold text-white shadow-[0_6px_18px_rgba(201,121,24,0.28)]"
      >
        Angebot erstellen
      </button>
    );
  }

  return (
    <div className="w-full">
      <Formular
        aktion={createQuote}
        titel="Neues Angebot"
        hinweis="Die Nummer vergibt die Datenbank. Positionen trägst du danach im Angebot ein."
        knopf="Angebot anlegen"
        leerenNachErfolg
      >
        <Auswahl
          id="q-kunde"
          name="customerId"
          label="Kunde"
          pflicht
          breit
          leerText="— wählen —"
          optionen={kunden}
        />
        <Eingabe
          id="q-gueltig"
          name="validUntil"
          label="Gültig bis"
          typ="date"
          hinweis="leer lassen für 30 Tage"
        />
      </Formular>

      <button
        type="button"
        onClick={() => setOffen(false)}
        className="mt-2 cursor-pointer border-0 bg-transparent text-[12.5px] text-muted underline"
      >
        Abbrechen
      </button>
    </div>
  );
}

/**
 * Positionsliste mit Inline-Bearbeitung.
 *
 * Jede Zeile ist ein eigenes Formular. Das ist mehr Markup als eine
 * gemeinsame Tabelle, hat aber den Vorteil, dass ein Fehler in Zeile 3
 * die Eingaben in Zeile 4 nicht verwirft — und dass jede Zeile für sich
 * speichert, ohne dass man am Ende einen Sammelknopf sucht.
 */
export function PositionenEditor({
  quoteId,
  positionen,
  artikel,
  gesperrt,
}: {
  quoteId: string;
  positionen: Position[];
  artikel: Option[];
  /** Angenommenes Angebot: nur noch lesen. */
  gesperrt: boolean;
}) {
  const [offeneZeile, setOffeneZeile] = useState<string | null>(null);

  const netto = positionen.reduce((s, p) => s + p.qty * p.salePrice, 0);
  const kosten = positionen.reduce((s, p) => s + p.qty * p.purchasePrice, 0);
  const marge = netto > 0 ? ((netto - kosten) / netto) * 100 : 0;

  return (
    <div className="flex flex-col gap-4">
      <section className="overflow-x-auto rounded-[20px] bg-surface shadow-soft">
        <div className="min-w-[820px]">
          <div className="grid grid-cols-[46px_1.8fr_100px_90px_120px_120px_110px] border-b border-line px-4 text-[11px] tracking-[0.07em] text-faint uppercase">
            {[
              ["Pos", false],
              ["Bezeichnung", false],
              ["Menge", true],
              ["Einheit", false],
              ["EK", true],
              ["VK", true],
              ["Summe", true],
            ].map(([h, rechts]) => (
              <div
                key={h as string}
                className={`px-2 py-[14px] ${rechts ? "text-right" : ""}`}
              >
                {h as string}
              </div>
            ))}
          </div>

          {positionen.length === 0 ? (
            <p className="px-6 py-8 text-[13.5px] text-muted">
              Noch keine Position. Unten eine freie Zeile eintragen oder einen
              Artikel übernehmen.
            </p>
          ) : (
            positionen.map((p, i) => {
              const zeilenNetto = p.qty * p.salePrice;
              const zeilenMarge =
                zeilenNetto > 0
                  ? ((zeilenNetto - p.qty * p.purchasePrice) / zeilenNetto) * 100
                  : 0;

              return (
                <div key={p.id} className="border-b border-line last:border-b-0">
                  <button
                    type="button"
                    disabled={gesperrt}
                    onClick={() =>
                      setOffeneZeile(offeneZeile === p.id ? null : p.id)
                    }
                    className="grid w-full cursor-pointer grid-cols-[46px_1.8fr_100px_90px_120px_120px_110px] items-center border-0 bg-transparent px-4 text-left transition-colors hover:bg-panel disabled:cursor-default"
                  >
                    <span className="num px-2 py-3 text-[12px] text-faint">
                      {(i + 1) * 10}
                    </span>
                    <span className="min-w-0 px-2 py-3">
                      <span className="flex items-center gap-2">
                        <span className="min-w-0 truncate text-[13.5px] font-medium">
                          {p.text}
                        </span>
                        {p.sku ? (
                          <span className="num shrink-0 rounded-pill bg-sunk px-[7px] py-[2px] text-[10px] text-muted">
                            {p.sku}
                          </span>
                        ) : null}
                        <span
                          className={`shrink-0 rounded-pill px-[7px] py-[2px] text-[10px] font-medium ${ART_TON[p.kind] ?? "bg-sunk text-muted"}`}
                        >
                          {ART_LABEL[p.kind] ?? p.kind}
                        </span>
                      </span>
                      <span
                        className={`num block text-[11px] ${zeilenMarge < 10 ? "text-s-crit" : "text-faint"}`}
                      >
                        DB {Math.round(zeilenMarge)} % · {p.vatRate} % USt.
                      </span>
                    </span>
                    <span className="num px-2 py-3 text-right text-[12.5px]">
                      {num(p.qty)}
                    </span>
                    <span className="num px-2 py-3 text-[12px] text-muted">
                      {p.unit}
                    </span>
                    <span className="num px-2 py-3 text-right text-[12.5px] text-muted">
                      {eur(p.purchasePrice)}
                    </span>
                    <span className="num px-2 py-3 text-right text-[12.5px]">
                      {eur(p.salePrice)}
                    </span>
                    <span className="num px-2 py-3 text-right text-[13px] font-semibold">
                      {eur(zeilenNetto)}
                    </span>
                  </button>

                  {offeneZeile === p.id && !gesperrt ? (
                    <div className="border-t border-line bg-panel px-4 py-4">
                      <Formular
                        aktion={updateQuoteItem}
                        knopf="Position speichern"
                        versteckt={{ quoteId, itemId: p.id }}
                      >
                        <Eingabe
                          id={`p-${p.id}-text`}
                          name="text"
                          label="Bezeichnung"
                          pflicht
                          breit
                          wert={p.text}
                        />
                        <Eingabe
                          id={`p-${p.id}-qty`}
                          name="qty"
                          label="Menge"
                          typ="number"
                          schritt="0.001"
                          pflicht
                          wert={p.qty}
                        />
                        <Auswahl
                          id={`p-${p.id}-unit`}
                          name="unit"
                          label="Einheit"
                          wert={p.unit}
                          optionen={EINHEITEN}
                        />
                        <Eingabe
                          id={`p-${p.id}-ek`}
                          name="purchasePrice"
                          label="Einkauf netto"
                          typ="number"
                          schritt="0.01"
                          wert={p.purchasePrice}
                        />
                        <Eingabe
                          id={`p-${p.id}-vk`}
                          name="salePrice"
                          label="Verkauf netto"
                          typ="number"
                          schritt="0.01"
                          wert={p.salePrice}
                        />
                        <Auswahl
                          id={`p-${p.id}-ust`}
                          name="vatRate"
                          label="Steuersatz"
                          wert={String(p.vatRate)}
                          optionen={STEUER}
                        />
                        <Auswahl
                          id={`p-${p.id}-art`}
                          name="kind"
                          label="Art auf der Angebotsseite"
                          wert={p.kind}
                          optionen={ARTEN}
                        />
                        <Eingabe
                          id={`p-${p.id}-gruppe`}
                          name="groupKey"
                          label="Paketschlüssel"
                          hinweis="verbindet Inhalt mit seinem Paket"
                          wert={p.groupKey ?? ""}
                        />
                        <Eingabe
                          id={`p-${p.id}-kategorie`}
                          name="category"
                          label="Kategorie"
                          hinweis="Beschriftung über dem Namen"
                          wert={p.category ?? ""}
                        />
                        <Eingabe
                          id={`p-${p.id}-hersteller`}
                          name="manufacturer"
                          label="Hersteller"
                          wert={p.manufacturer ?? ""}
                        />
                        <Textfeld
                          id={`p-${p.id}-beschreibung`}
                          name="description"
                          label="Beschreibung für den Kunden"
                          zeilen={3}
                          wert={p.description ?? ""}
                        />
                      </Formular>

                      <div className="mt-2">
                        <AktionsKnopf
                          aktion={deleteQuoteItem}
                          label="Position löschen"
                          variante="gefahr"
                          versteckt={{ quoteId, itemId: p.id }}
                        />
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })
          )}

          {/* Summenzeile */}
          <div className="grid grid-cols-[46px_1.8fr_100px_90px_120px_120px_110px] items-center border-t-2 border-line bg-panel px-4">
            <span />
            <span className="px-2 py-3 text-[13px] font-semibold">
              Summe netto
            </span>
            <span />
            <span />
            <span className="num px-2 py-3 text-right text-[12px] text-muted">
              {eur(kosten)}
            </span>
            <span
              className={`num px-2 py-3 text-right text-[12px] ${marge < 15 ? "text-s-crit" : "text-muted"}`}
            >
              DB {Math.round(marge)} %
            </span>
            <span className="num px-2 py-3 text-right text-[15px] font-semibold">
              {eur(netto)}
            </span>
          </div>
        </div>
      </section>

      {gesperrt ? (
        <p className="rounded-input bg-surface px-4 py-3 text-[12.5px] text-muted shadow-soft">
          Das Angebot ist angenommen und damit die Grundlage des Auftrags.
          Positionen lassen sich nicht mehr ändern — sonst würde ein Vertrag
          rückwirkend verschoben.
        </p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
          <Formular
            aktion={addQuoteItemFromArticle}
            titel="Artikel übernehmen"
            hinweis="Preise werden kopiert, nicht verknüpft — ein späterer Artikelpreis ändert dieses Angebot nicht."
            knopf="Übernehmen"
            versteckt={{ quoteId }}
          >
            <Suchauswahl
              name="articleId"
              label="Artikel"
              pflicht
              breit
              platzhalter="Artikel suchen — Bezeichnung oder Nummer"
              optionen={artikel}
            />
            <Eingabe
              id="pa-menge"
              name="qty"
              label="Menge"
              typ="number"
              schritt="0.001"
              pflicht
              wert={1}
            />
          </Formular>

          <Formular
            aktion={addQuoteItem}
            titel="Freie Position"
            hinweis="Für Leistungen ohne Artikel — Montage, Anfahrt, Gerüst."
            knopf="Hinzufügen"
            versteckt={{ quoteId }}
            leerenNachErfolg
          >
            <Eingabe
              id="pf-text"
              name="text"
              label="Bezeichnung"
              pflicht
              breit
              platzhalter="Montage Unterkonstruktion"
            />
            <Eingabe
              id="pf-menge"
              name="qty"
              label="Menge"
              typ="number"
              schritt="0.001"
              pflicht
              wert={1}
            />
            <Auswahl
              id="pf-einheit"
              name="unit"
              label="Einheit"
              wert="Stk"
              optionen={EINHEITEN}
            />
            <Eingabe
              id="pf-ek"
              name="purchasePrice"
              label="Einkauf netto"
              typ="number"
              schritt="0.01"
              wert={0}
            />
            <Eingabe
              id="pf-vk"
              name="salePrice"
              label="Verkauf netto"
              typ="number"
              schritt="0.01"
              wert={0}
            />
            <Auswahl
              id="pf-ust"
              name="vatRate"
              label="Steuersatz"
              wert="20"
              optionen={STEUER}
            />
            <Auswahl
              id="pf-art"
              name="kind"
              label="Art auf der Angebotsseite"
              wert="position"
              optionen={ARTEN}
            />
            <Eingabe
              id="pf-gruppe"
              name="groupKey"
              label="Paketschlüssel"
              hinweis="nur bei Paketen und deren Inhalt"
            />
            <Textfeld
              id="pf-beschreibung"
              name="description"
              label="Beschreibung für den Kunden"
              zeilen={2}
            />
          </Formular>
        </div>
      )}
    </div>
  );
}

/** Kopfdaten des Angebots ändern und das Angebot verwerfen. */
export function AngebotKopf({
  quoteId,
  nummer,
  customerId,
  validUntil,
  introText,
  priceDisplay,
  deliveryNet,
  kunden,
  gesperrt,
}: {
  quoteId: string;
  nummer: string;
  customerId: string;
  validUntil: string | null;
  introText: string | null;
  priceDisplay: string;
  deliveryNet: number;
  kunden: Option[];
  gesperrt: boolean;
}) {
  if (gesperrt) return null;

  return (
    <div className="flex flex-col gap-3">
      <Formular
        aktion={updateQuote}
        titel="Kopfdaten"
        knopf="Speichern"
        versteckt={{ quoteId }}
      >
        <Suchauswahl
          name="customerId"
          label="Kunde"
          pflicht
          platzhalter="Kunde suchen — Name oder Ort"
          wert={customerId}
          optionen={kunden}
        />
        <Eingabe
          id="qk-gueltig"
          name="validUntil"
          label="Gültig bis"
          typ="date"
          wert={validUntil ?? ""}
        />
        <Auswahl
          id="qk-darstellung"
          name="priceDisplay"
          label="Preise im Kundenportal"
          hinweis="Einzelpreise je Position oder nur die Gesamtsumme"
          wert={priceDisplay}
          optionen={[
            { wert: "positionen", text: "Einzelpreise zeigen" },
            { wert: "gesamt", text: "Nur Gesamtpreis zeigen" },
          ]}
        />
        <Eingabe
          id="qk-lieferung"
          name="deliveryNet"
          label="Lieferung netto"
          typ="number"
          schritt="0.01"
          wert={deliveryNet}
        />
        <Textfeld
          id="qk-intro"
          name="introText"
          label="Einleitung für den Kunden"
          hinweis="steht oben auf der Angebotsseite"
          zeilen={3}
          wert={introText ?? ""}
        />
      </Formular>

      <AktionsKnopf
        aktion={deleteQuote}
        label="Angebot löschen"
        variante="gefahr"
        versteckt={{ quoteId }}
        bestaetigung={`${nummer} wirklich löschen?`}
      />
    </div>
  );
}
