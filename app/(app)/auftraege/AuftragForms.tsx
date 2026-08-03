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
import { createJob, deleteJob, updateJob } from "./actions";

export type Option = { wert: string; text: string };

export type AuftragWerte = {
  id: string;
  customerId: string;
  phaseId: string;
  plantId: string | null;
  locationId: string | null;
  siteManagerId: string | null;
  plannedHours: number;
  valueNet: number;
  materialPlanned: number;
  scheduledFrom: string | null;
  scheduledTo: string | null;
  address: string | null;
  zip: string | null;
  city: string | null;
  nextStep: string | null;
};

type Listen = {
  kunden: Option[];
  phasen: Option[];
  anlagen: Option[];
  standorte: Option[];
  bauleiter: Option[];
};

/** Termin als Wert für <input type="datetime-local">. */
function alsEingabe(iso: string | null): string {
  return iso ? iso.slice(0, 16) : "";
}

function Felder({
  listen,
  werte,
}: {
  listen: Listen;
  werte?: AuftragWerte | undefined;
}) {
  const p = werte ? "e" : "n";
  return (
    <>
      <Suchauswahl
        name="customerId"
        label="Kunde"
        pflicht
        platzhalter="Kunde suchen — Name oder Ort"
        wert={werte?.customerId ?? null}
        optionen={listen.kunden}
      />
      <Auswahl
        id={`${p}-phase`}
        name="phaseId"
        label="Phase"
        pflicht
        wert={werte?.phaseId ?? null}
        leerText="— wählen —"
        optionen={listen.phasen}
      />
      <Suchauswahl
        name="plantId"
        label="Anlage"
        hinweis="optional — verbindet den Auftrag mit der Anlage des Kunden"
        platzhalter="Anlage suchen"
        leerLabel="— keine —"
        wert={werte?.plantId ?? null}
        optionen={listen.anlagen}
      />
      <Suchauswahl
        name="locationId"
        label="Standort"
        platzhalter="Standort suchen"
        leerLabel="— keiner —"
        wert={werte?.locationId ?? null}
        optionen={listen.standorte}
      />
      <Suchauswahl
        name="siteManagerId"
        label="Bauleitung"
        platzhalter="Mitarbeiter suchen"
        leerLabel="— offen —"
        wert={werte?.siteManagerId ?? null}
        optionen={listen.bauleiter}
      />
      <Eingabe
        id={`${p}-stunden`}
        name="plannedHours"
        label="Geplante Stunden"
        typ="number"
        schritt="0.5"
        wert={werte?.plannedHours ?? 0}
      />
      <Eingabe
        id={`${p}-wert`}
        name="valueNet"
        label="Auftragswert netto"
        typ="number"
        schritt="0.01"
        wert={werte?.valueNet ?? 0}
      />
      <Eingabe
        id={`${p}-material`}
        name="materialPlanned"
        label="Material kalkuliert"
        typ="number"
        schritt="0.01"
        hinweis="Grundlage der Deckungsbeitrag-Ampel"
        wert={werte?.materialPlanned ?? 0}
      />
      <Eingabe
        id={`${p}-von`}
        name="scheduledFrom"
        label="Termin von"
        typ="datetime-local"
        wert={alsEingabe(werte?.scheduledFrom ?? null)}
      />
      <Eingabe
        id={`${p}-bis`}
        name="scheduledTo"
        label="Termin bis"
        typ="datetime-local"
        wert={alsEingabe(werte?.scheduledTo ?? null)}
      />
      <Eingabe
        id={`${p}-adresse`}
        name="address"
        label="Baustellenadresse"
        breit
        wert={werte?.address ?? ""}
      />
      <Eingabe id={`${p}-plz`} name="zip" label="PLZ" wert={werte?.zip ?? ""} />
      <Eingabe id={`${p}-ort`} name="city" label="Ort" wert={werte?.city ?? ""} />
      <Textfeld
        id={`${p}-schritt`}
        name="nextStep"
        label="Nächster Schritt"
        zeilen={2}
        platzhalter="Zählertausch mit Netzbetreiber abstimmen"
        wert={werte?.nextStep ?? ""}
      />
    </>
  );
}

export function AuftragAnlegen({ listen }: { listen: Listen }) {
  const [offen, setOffen] = useState(false);

  if (!offen) {
    return (
      <button
        type="button"
        onClick={() => setOffen(true)}
        className="min-h-[44px] cursor-pointer rounded-pill border-0 bg-[linear-gradient(150deg,var(--accent-from),var(--accent-to))] px-[22px] text-[13.5px] font-semibold text-white shadow-[0_6px_18px_rgba(201,121,24,0.28)]"
      >
        Auftrag anlegen
      </button>
    );
  }

  return (
    <div className="w-full">
      <Formular
        aktion={createJob}
        titel="Neuer Auftrag"
        hinweis="Der Regelweg führt über ein angenommenes Angebot. Direkt anlegen ist für Serviceeinsätze, Nachbesserungen und Altbestand gedacht. Die Nummer vergibt die Datenbank."
        knopf="Auftrag anlegen"
        leerenNachErfolg
      >
        <Felder listen={listen} />
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

export function AuftragBearbeiten({
  auftrag,
  listen,
  nummer,
}: {
  auftrag: AuftragWerte;
  listen: Listen;
  nummer: string;
}) {
  return (
    <div className="flex flex-col gap-3">
      <Formular
        aktion={updateJob}
        titel="Auftrag bearbeiten"
        knopf="Speichern"
        versteckt={{ jobId: auftrag.id }}
      >
        <Felder listen={listen} werte={auftrag} />
      </Formular>

      <div className="rounded-[20px] bg-surface p-5 shadow-soft">
        <h2 className="text-[15px] font-semibold">Löschen</h2>
        <p className="mt-1 mb-3 text-[12.5px] text-muted">
          Geht nur, solange keine Zeit, kein Material und keine Rechnung daran
          hängt. Sobald gebucht wurde, ist der Auftrag revisionspflichtig —
          dann bleibt nur der Abschluss.
        </p>
        <AktionsKnopf
          aktion={deleteJob}
          label="Auftrag löschen"
          variante="gefahr"
          versteckt={{ jobId: auftrag.id }}
          bestaetigung={`${nummer} wirklich löschen?`}
        />
      </div>
    </div>
  );
}
