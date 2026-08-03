"use client";

import { useState } from "react";
import {
  AktionsKnopf,
  Auswahl,
  Eingabe,
  Formular,
  Textfeld,
} from "@/components/ui/Formular";
import {
  archiveCustomer,
  createCustomer,
  deleteAnlage,
  restoreCustomer,
  saveAnlage,
  updateCustomer,
} from "./actions";

export type KundeWerte = {
  id: string;
  name: string;
  type: string;
  contactPerson: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  zip: string | null;
  city: string | null;
  source: string | null;
  notes: string | null;
  archiviert: boolean;
};

export type AnlageWerte = {
  id: string;
  kwp: number | null;
  storageKwh: number | null;
  modules: string | null;
  inverter: string | null;
  meterPoint: string | null;
  commissionedOn: string | null;
};

const TYPEN = [
  { wert: "lead", text: "Lead" },
  { wert: "customer", text: "Bestandskunde" },
];

/** Anlegen. Klappt auf, damit die Liste nicht dauerhaft ein Formular trägt. */
export function KundeAnlegen() {
  const [offen, setOffen] = useState(false);

  if (!offen) {
    return (
      <button
        type="button"
        onClick={() => setOffen(true)}
        className="min-h-[44px] cursor-pointer rounded-pill border-0 bg-[linear-gradient(150deg,var(--accent-from),var(--accent-to))] px-[22px] text-[13.5px] font-semibold text-white shadow-[0_6px_18px_rgba(201,121,24,0.28)]"
      >
        Kunde anlegen
      </button>
    );
  }

  return (
    <div className="w-full">
      <Formular
        aktion={createCustomer}
        titel="Neuer Kunde oder Lead"
        hinweis="Ein Lead wird zum Bestandskunden, sobald der erste Auftrag läuft."
        knopf="Anlegen"
        leerenNachErfolg
      >
        <Eingabe id="k-name" name="name" label="Name" pflicht breit />
        <Auswahl id="k-type" name="type" label="Art" wert="lead" optionen={TYPEN} />
        <Eingabe id="k-kontakt" name="contactPerson" label="Ansprechpartner" />
        <Eingabe id="k-mail" name="email" label="E-Mail" typ="email" />
        <Eingabe id="k-tel" name="phone" label="Telefon" typ="tel" />
        <Eingabe id="k-adresse" name="address" label="Adresse" breit />
        <Eingabe id="k-plz" name="zip" label="PLZ" />
        <Eingabe id="k-ort" name="city" label="Ort" />
        <Eingabe
          id="k-quelle"
          name="source"
          label="Herkunft"
          hinweis="z. B. Empfehlung, Website, Messe"
        />
        <Textfeld id="k-notiz" name="notes" label="Notiz" />
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

export function KundeBearbeiten({ kunde }: { kunde: KundeWerte }) {
  return (
    <div className="flex flex-col gap-3">
      <Formular
        aktion={updateCustomer}
        titel="Stammdaten"
        knopf="Speichern"
        versteckt={{ customerId: kunde.id }}
      >
        <Eingabe id="e-name" name="name" label="Name" pflicht breit wert={kunde.name} />
        <Auswahl id="e-type" name="type" label="Art" wert={kunde.type} optionen={TYPEN} />
        <Eingabe
          id="e-kontakt"
          name="contactPerson"
          label="Ansprechpartner"
          wert={kunde.contactPerson}
        />
        <Eingabe id="e-mail" name="email" label="E-Mail" typ="email" wert={kunde.email} />
        <Eingabe id="e-tel" name="phone" label="Telefon" typ="tel" wert={kunde.phone} />
        <Eingabe id="e-adresse" name="address" label="Adresse" breit wert={kunde.address} />
        <Eingabe id="e-plz" name="zip" label="PLZ" wert={kunde.zip} />
        <Eingabe id="e-ort" name="city" label="Ort" wert={kunde.city} />
        <Eingabe id="e-quelle" name="source" label="Herkunft" wert={kunde.source} />
        <Textfeld id="e-notiz" name="notes" label="Notiz" wert={kunde.notes} />
      </Formular>

      <div className="rounded-[20px] bg-surface p-5 shadow-soft">
        <h2 className="text-[15px] font-semibold">
          {kunde.archiviert ? "Archiviert" : "Archivieren"}
        </h2>
        <p className="mt-1 mb-3 text-[12.5px] text-muted">
          {kunde.archiviert
            ? "Der Kunde ist ausgeblendet. Seine Belege bleiben erhalten."
            : "Der Kunde verschwindet aus allen Listen, Rechnungen und Aufträge bleiben zuordenbar. Gelöscht wird nichts — die Aufbewahrungspflicht gilt sieben Jahre."}
        </p>
        {kunde.archiviert ? (
          <AktionsKnopf
            aktion={restoreCustomer}
            label="Wieder aktivieren"
            versteckt={{ customerId: kunde.id }}
          />
        ) : (
          <AktionsKnopf
            aktion={archiveCustomer}
            label="Archivieren"
            variante="gefahr"
            versteckt={{ customerId: kunde.id }}
            bestaetigung={`${kunde.name} archivieren?`}
          />
        )}
      </div>
    </div>
  );
}

export function AnlageForm({
  customerId,
  anlage,
}: {
  customerId: string;
  anlage?: AnlageWerte | undefined;
}) {
  return (
    <div className="flex flex-col gap-3">
      <Formular
        aktion={saveAnlage}
        titel={anlage ? "Anlage" : "Anlage anlegen"}
        hinweis="Leistung und Speicher erscheinen im Kundenportal und auf der Pipelinekarte."
        knopf={anlage ? "Speichern" : "Anlegen"}
        versteckt={
          anlage ? { customerId, plantId: anlage.id } : { customerId }
        }
      >
        <Eingabe
          id="a-kwp"
          name="kwp"
          label="Leistung in kWp"
          typ="number"
          schritt="0.01"
          wert={anlage?.kwp ?? ""}
        />
        <Eingabe
          id="a-speicher"
          name="storageKwh"
          label="Speicher in kWh"
          typ="number"
          schritt="0.01"
          wert={anlage?.storageKwh ?? ""}
        />
        <Eingabe
          id="a-module"
          name="modules"
          label="Module"
          platzhalter="24× JA Solar 445 W"
          wert={anlage?.modules ?? ""}
        />
        <Eingabe
          id="a-wr"
          name="inverter"
          label="Wechselrichter"
          wert={anlage?.inverter ?? ""}
        />
        <Eingabe
          id="a-zaehler"
          name="meterPoint"
          label="Zählpunkt"
          wert={anlage?.meterPoint ?? ""}
        />
        <Eingabe
          id="a-inbetrieb"
          name="commissionedOn"
          label="In Betrieb seit"
          typ="date"
          wert={anlage?.commissionedOn ?? ""}
        />
      </Formular>

      {anlage ? (
        <AktionsKnopf
          aktion={deleteAnlage}
          label="Anlage löschen"
          variante="gefahr"
          versteckt={{ plantId: anlage.id }}
          bestaetigung="Anlage wirklich löschen?"
        />
      ) : null}
    </div>
  );
}
