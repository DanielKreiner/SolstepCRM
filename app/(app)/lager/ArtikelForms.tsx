"use client";

import { useState } from "react";
import {
  AktionsKnopf,
  Auswahl,
  Eingabe,
  Formular,
} from "@/components/ui/Formular";
import {
  createArticle,
  deleteArticle,
  saveArticleSupplier,
  saveSupplier,
  toggleArticleActive,
  updateArticle,
} from "./stammdaten-actions";

export type ArtikelWerte = {
  id: string;
  sku: string;
  name: string;
  manufacturer: string | null;
  category: string | null;
  unit: string;
  minStock: number;
  locationCode: string | null;
  purchasePrice: number;
  salePrice: number;
  vatRate: number;
  active: boolean;
  stock: number;
  typ: string;
  seriennummernpflichtig: boolean;
  ean: string | null;
  istPaket: boolean;
};

/*
 * Der Typ entscheidet über den Materialfluss, damit der Monteur es nicht
 * muss. Die Texte sagen deshalb, was passiert, nicht wie es heisst.
 */
const TYPEN = [
  { wert: "stueckliste", text: "Stückliste — steht auf der Beladeliste" },
  { wert: "vanstock", text: "Van-Stock — liegt im Fahrzeug, wird gemeldet" },
  { wert: "nicht_bestandsgefuehrt", text: "Kleinmaterial — wird nie gebucht" },
];

const JA_NEIN = [
  { wert: "nein", text: "nein" },
  { wert: "ja", text: "ja" },
];

const EINHEITEN = [
  { wert: "Stk", text: "Stück" },
  { wert: "m", text: "Meter" },
  { wert: "lfm", text: "Laufmeter" },
  { wert: "kg", text: "Kilogramm" },
  { wert: "Pak", text: "Paket" },
  { wert: "Satz", text: "Satz" },
];

const STEUER = [
  { wert: "20", text: "20 % Normalsatz" },
  { wert: "10", text: "10 % ermäßigt" },
  { wert: "0", text: "0 % (Reverse Charge)" },
];

function Felder({ werte }: { werte?: ArtikelWerte | undefined }) {
  const p = werte ? "ea" : "na";
  return (
    <>
      <Eingabe
        id={`${p}-sku`}
        name="sku"
        label="Artikelnummer"
        pflicht
        mono
        platzhalter="MOD-JAS-440"
        wert={werte?.sku ?? ""}
      />
      <Auswahl
        id={`${p}-einheit`}
        name="unit"
        label="Einheit"
        pflicht
        wert={werte?.unit ?? "Stk"}
        optionen={EINHEITEN}
      />
      <Eingabe
        id={`${p}-name`}
        name="name"
        label="Bezeichnung"
        pflicht
        breit
        wert={werte?.name ?? ""}
      />
      <Eingabe
        id={`${p}-hersteller`}
        name="manufacturer"
        label="Hersteller"
        wert={werte?.manufacturer ?? ""}
      />
      <Eingabe
        id={`${p}-kategorie`}
        name="category"
        label="Kategorie"
        platzhalter="Module, Wechselrichter, Speicher …"
        wert={werte?.category ?? ""}
      />
      <Eingabe
        id={`${p}-ek`}
        name="purchasePrice"
        label="Einkaufspreis netto"
        typ="number"
        schritt="0.01"
        wert={werte?.purchasePrice ?? 0}
      />
      <Eingabe
        id={`${p}-vk`}
        name="salePrice"
        label="Verkaufspreis netto"
        typ="number"
        schritt="0.01"
        hinweis="0 lassen, wenn im Angebot kalkuliert wird"
        wert={werte?.salePrice ?? 0}
      />
      <Eingabe
        id={`${p}-mindest`}
        name="minStock"
        label="Mindestbestand"
        typ="number"
        schritt="0.001"
        hinweis="löst den Bestellvorschlag aus"
        wert={werte?.minStock ?? 0}
      />
      <Eingabe
        id={`${p}-ort`}
        name="locationCode"
        label="Lagerort"
        platzhalter="H1 · R3 · A"
        wert={werte?.locationCode ?? ""}
      />
      <Auswahl
        id={`${p}-ust`}
        name="vatRate"
        label="Steuersatz"
        wert={String(werte?.vatRate ?? 20)}
        optionen={STEUER}
      />
      <Auswahl
        id={`${p}-typ`}
        name="typ"
        label="Materialfluss"
        wert={werte?.typ ?? "stueckliste"}
        optionen={TYPEN}
        hinweis="Kleinmaterial läuft über die Pauschale, nicht über den Bestand"
      />
      <Eingabe
        id={`${p}-ean`}
        name="ean"
        label="EAN / Barcode"
        mono
        hinweis="ermöglicht den Scan beim Beladen"
        wert={werte?.ean ?? ""}
      />
      <Auswahl
        id={`${p}-serie`}
        name="seriennummernpflichtig"
        label="Seriennummer erfassen"
        wert={werte?.seriennummernpflichtig ? "ja" : "nein"}
        optionen={JA_NEIN}
        hinweis="Wechselrichter und Speicher: ja"
      />
      <Auswahl
        id={`${p}-paket`}
        name="istPaket"
        label="Paket mit Stückliste"
        wert={werte?.istPaket ? "ja" : "nein"}
        optionen={JA_NEIN}
        hinweis="eine Zeile im Angebot, viele Teile im Lager"
      />
    </>
  );
}

export function ArtikelAnlegen() {
  const [offen, setOffen] = useState(false);

  if (!offen) {
    return (
      <button
        type="button"
        onClick={() => setOffen(true)}
        className="min-h-[44px] cursor-pointer rounded-pill border-0 bg-[linear-gradient(150deg,var(--accent-from),var(--accent-to))] px-[22px] text-[13.5px] font-semibold text-white shadow-[0_6px_18px_rgba(201,121,24,0.28)]"
      >
        Artikel anlegen
      </button>
    );
  }

  return (
    <div className="w-full">
      <Formular
        aktion={createArticle}
        titel="Neuer Artikel"
        hinweis="Der Bestand entsteht nicht hier, sondern über einen Wareneingang — sonst gäbe es Bestand, den keine Bewegung erklärt."
        knopf="Artikel anlegen"
        leerenNachErfolg
      >
        <Felder />
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

export function ArtikelBearbeiten({ artikel }: { artikel: ArtikelWerte }) {
  return (
    <div className="flex flex-col gap-3">
      <Formular
        aktion={updateArticle}
        titel="Stammdaten"
        knopf="Speichern"
        versteckt={{ articleId: artikel.id }}
      >
        <Felder werte={artikel} />
      </Formular>

      <div className="rounded-[20px] bg-surface p-5 shadow-soft">
        <h2 className="text-[15px] font-semibold">
          {artikel.active ? "Stilllegen" : "Wieder aktivieren"}
        </h2>
        <p className="mt-1 mb-3 text-[12.5px] text-muted">
          {artikel.active
            ? "Der Artikel verschwindet aus den Auswahllisten, seine Bewegungen bleiben lesbar. Geht nur bei Bestand null."
            : "Der Artikel taucht wieder in den Auswahllisten auf."}
        </p>
        <div className="flex flex-wrap gap-2">
          <AktionsKnopf
            aktion={toggleArticleActive}
            label={artikel.active ? "Stilllegen" : "Aktivieren"}
            variante={artikel.active ? "gefahr" : "quiet"}
            versteckt={{
              articleId: artikel.id,
              aktiv: artikel.active ? "0" : "1",
            }}
          />
          <AktionsKnopf
            aktion={deleteArticle}
            label="Endgültig löschen"
            variante="gefahr"
            versteckt={{ articleId: artikel.id }}
            bestaetigung={`${artikel.sku} wirklich löschen? Geht nur ohne Bewegungen.`}
          />
        </div>
      </div>
    </div>
  );
}

export function LieferantForm({
  lieferant,
}: {
  lieferant?:
    | {
        id: string;
        name: string;
        email: string | null;
        phone: string | null;
        customerNumber: string | null;
        frameworkContract: boolean;
      }
    | undefined;
}) {
  return (
    <Formular
      aktion={saveSupplier}
      titel={lieferant ? "Lieferant" : "Lieferant anlegen"}
      hinweis="Bestellungen gehen als PDF und CSV an diese Adresse."
      knopf={lieferant ? "Speichern" : "Anlegen"}
      versteckt={lieferant ? { supplierId: lieferant.id } : {}}
      leerenNachErfolg={!lieferant}
    >
      <Eingabe
        id="l-name"
        name="name"
        label="Name"
        pflicht
        breit
        wert={lieferant?.name ?? ""}
      />
      <Eingabe
        id="l-mail"
        name="email"
        label="E-Mail"
        typ="email"
        wert={lieferant?.email ?? ""}
      />
      <Eingabe
        id="l-tel"
        name="phone"
        label="Telefon"
        typ="tel"
        wert={lieferant?.phone ?? ""}
      />
      <Eingabe
        id="l-kdnr"
        name="customerNumber"
        label="Unsere Kundennummer"
        mono
        wert={lieferant?.customerNumber ?? ""}
      />
      <div className="flex items-center gap-2 pt-6">
        <input
          id="l-rahmen"
          name="frameworkContract"
          type="checkbox"
          defaultChecked={lieferant?.frameworkContract ?? false}
          className="h-4 w-4 cursor-pointer accent-[var(--accent)]"
        />
        <label htmlFor="l-rahmen" className="cursor-pointer text-[13px]">
          Rahmenvertrag vorhanden
        </label>
      </div>
    </Formular>
  );
}

/** Preis eines Lieferanten für einen Artikel — speist den Bestellvorschlag. */
export function LieferantenpreisForm({
  articleId,
  lieferanten,
}: {
  articleId: string;
  lieferanten: { wert: string; text: string }[];
}) {
  return (
    <Formular
      aktion={saveArticleSupplier}
      titel="Lieferantenpreis"
      hinweis="Je Lieferant und Artikel ein Preis. Ein zweiter Eintrag ersetzt den ersten."
      knopf="Preis speichern"
      versteckt={{ articleId }}
    >
      <Auswahl
        id="lp-lieferant"
        name="supplierId"
        label="Lieferant"
        pflicht
        leerText="— wählen —"
        optionen={lieferanten}
      />
      <Eingabe
        id="lp-preis"
        name="price"
        label="Preis netto"
        typ="number"
        schritt="0.01"
        pflicht
      />
      <Eingabe
        id="lp-lieferzeit"
        name="leadDays"
        label="Lieferzeit in Tagen"
        typ="number"
        wert={7}
      />
    </Formular>
  );
}
