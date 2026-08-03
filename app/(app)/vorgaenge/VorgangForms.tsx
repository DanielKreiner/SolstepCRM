"use client";

import { useState } from "react";
import {
  Auswahl,
  Eingabe,
  Formular,
  Textfeld,
} from "@/components/ui/Formular";
import { Suchauswahl, type Option } from "@/components/ui/Suchauswahl";
import { stammdatenSpeichern, vorgangAnlegen } from "./actions";

/** Stammdaten des Vorgangs — inline, kein eigener Screen. */
export function StammdatenForm({
  werte,
  team,
}: {
  werte: {
    vorgangId: string;
    kwp: number | null;
    speicherKwh: number | null;
    adresse: string;
    plz: string;
    ort: string;
    zaehlpunkt: string;
    zustaendigId: string;
    anzahlungProzent: number;
    wiedervorlageAm: string;
  };
  team: Option[];
}) {
  return (
    <Formular
      aktion={stammdatenSpeichern}
      titel="Stammdaten"
      hinweis="Adresse und Anlage gehören zum Vorgang, nicht zum Kunden — eine spätere Adressänderung verschiebt keine terminierte Baustelle."
      knopf="Speichern"
      versteckt={{ vorgangId: werte.vorgangId }}
    >
      <Eingabe
        id="vs-kwp"
        name="kwp"
        label="Leistung in kWp"
        typ="number"
        schritt="0.01"
        wert={werte.kwp ?? ""}
      />
      <Eingabe
        id="vs-speicher"
        name="speicherKwh"
        label="Speicher in kWh"
        typ="number"
        schritt="0.01"
        wert={werte.speicherKwh ?? ""}
      />
      <Eingabe id="vs-adresse" name="adresse" label="Adresse" breit wert={werte.adresse} />
      <Eingabe id="vs-plz" name="plz" label="PLZ" wert={werte.plz} />
      <Eingabe id="vs-ort" name="ort" label="Ort" wert={werte.ort} />
      <Eingabe
        id="vs-zaehlpunkt"
        name="zaehlpunkt"
        label="Zählpunkt"
        breit
        hinweis="Zählpunktnummer des Netzbetreibers, 33 Stellen"
        wert={werte.zaehlpunkt}
      />
      <Suchauswahl
        name="zustaendigId"
        label="Zuständig"
        breit
        platzhalter="Mitarbeiter suchen"
        leerLabel="— offen —"
        wert={werte.zustaendigId}
        optionen={team}
      />
      <Eingabe
        id="vs-anzahlung"
        name="anzahlungProzent"
        label="Anzahlung in Prozent"
        typ="number"
        schritt="1"
        wert={werte.anzahlungProzent}
      />
      <Eingabe
        id="vs-wv"
        name="wiedervorlageAm"
        label="Wiedervorlage"
        typ="date"
        wert={werte.wiedervorlageAm}
      />
    </Formular>
  );
}

const QUELLEN = [
  { wert: "", text: "— keine Angabe —" },
  { wert: "empfehlung", text: "Empfehlung" },
  { wert: "webformular", text: "Webformular" },
  { wert: "messe", text: "Messe" },
  { wert: "anruf", text: "Anruf" },
];

/**
 * Vorgang anlegen.
 *
 * Nur das Nötigste: Kunde und ein paar Eckdaten. Alles Weitere entsteht
 * im Vorgang selbst — ein Anlegeformular mit zwanzig Feldern füllt
 * niemand aus, während der Kunde am Telefon ist.
 */
export function VorgangAnlegen({ kunden }: { kunden: Option[] }) {
  const [offen, setOffen] = useState(false);

  if (!offen) {
    return (
      <button
        type="button"
        onClick={() => setOffen(true)}
        className="min-h-[44px] cursor-pointer rounded-pill border-0 bg-[linear-gradient(150deg,var(--accent-from),var(--accent-to))] px-[22px] text-[13.5px] font-semibold text-white shadow-[0_6px_18px_rgba(201,121,24,0.28)]"
      >
        Vorgang anlegen
      </button>
    );
  }

  return (
    <div className="w-full">
      <Formular
        aktion={vorgangAnlegen}
        titel="Neuer Vorgang"
        hinweis="Die Nummer bleibt bis zur Schlussrechnung dieselbe."
        knopf="Anlegen"
        leerenNachErfolg
      >
        <Suchauswahl
          name="customerId"
          label="Kunde"
          pflicht
          breit
          platzhalter="Kunde suchen — Name oder Ort"
          optionen={kunden}
        />
        <Eingabe id="vn-kwp" name="kwp" label="Leistung in kWp" typ="number" schritt="0.01" />
        <Eingabe
          id="vn-speicher"
          name="speicherKwh"
          label="Speicher in kWh"
          typ="number"
          schritt="0.01"
        />
        <Eingabe
          id="vn-adresse"
          name="adresse"
          label="Baustellenadresse"
          breit
          hinweis="leer lassen übernimmt die Kundenadresse"
        />
        <Eingabe id="vn-plz" name="plz" label="PLZ" />
        <Eingabe id="vn-ort" name="ort" label="Ort" />
        <Auswahl id="vn-quelle" name="quelle" label="Herkunft" optionen={QUELLEN} />
        <Textfeld
          id="vn-notiz"
          name="notiz"
          label="Erste Notiz"
          zeilen={3}
          platzhalter="Was der Kunde will, Budget, Besonderheiten."
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
