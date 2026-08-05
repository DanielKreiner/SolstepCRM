"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  Absenden,
  AktionsKnopf,
  Auswahl,
  Eingabe,
  Formular,
  LEER,
  Textfeld,
} from "@/components/ui/Formular";
import {
  archiveCustomer,
  createCustomer,
  createPortalAccess,
  revokePortalAccess,
  deleteAnlage,
  restoreCustomer,
  saveAnlage,
  updateCustomer,
} from "./kunde-actions";

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
        titel="Kunde ändern"
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

/**
 * Portalzugang.
 *
 * Der erzeugte Link erscheint einmal in der Erfolgsmeldung und danach nie
 * wieder — gespeichert ist nur sein Hash. Deshalb steht hier ausdrücklich,
 * dass man ihn jetzt kopieren muss.
 */
export function PortalZugang({
  customerId,
  kundenName,
  bestehend,
}: {
  customerId: string;
  kundenName: string;
  bestehend: {
    gueltigBis: string;
    zuletztGesehen: string | null;
    link: string | null;
  } | null;
}) {
  const [status, formAction] = useActionState(createPortalAccess, LEER);
  /* Frisch erzeugter Link schlägt den gespeicherten — er ist der neue. */
  const link = status.ok?.startsWith("http") ? status.ok : (bestehend?.link ?? null);

  return (
    <div className="rounded-[20px] bg-surface p-5 shadow-soft">
      <h2 className="text-[15px] font-semibold">Kundenportal</h2>
      <p className="mt-1 mb-3 text-[12.5px] text-muted">
        Der Kunde sieht damit Fortschritt, Angebot und Dokumente und kann
        Anliegen melden — ohne Konto, nur über den Link.
      </p>

      {bestehend ? (
        <p className="num mb-3 rounded-input bg-panel px-4 py-3 text-[12px] text-muted">
          Zugang aktiv bis {bestehend.gueltigBis}
          {bestehend.zuletztGesehen
            ? ` · zuletzt gesehen ${bestehend.zuletztGesehen}`
            : " · noch nicht geöffnet"}
        </p>
      ) : (
        <p className="mb-3 text-[12.5px] text-faint">
          Für {kundenName} gibt es noch keinen Zugang.
        </p>
      )}

      {/*
        Linkkasten und Erzeugen-Knopf liegen in EINEM form: nur so weiss
        der Kasten, dass gerade ein neuer Link entsteht, und blendet den
        alten aus — der ist in dem Moment schon widerrufen, und wer ihn
        kopiert, schickt dem Kunden einen toten Link.

        Der Widerrufen-Knopf bringt sein eigenes form mit und steht
        deshalb daneben, nicht darin: verschachtelte Formulare wirft der
        Browser weg, und der innere Knopf löst dann den äusseren Vorgang
        aus — im Klartext: „Widerrufen" hätte einen neuen Link erzeugt.
      */}
      <form action={formAction}>
        <input type="hidden" name="customerId" value={customerId} />
        <Linkkasten link={link} />
        <Absenden
          label={bestehend ? "Neuen Link erzeugen" : "Zugang erzeugen"}
          busy="Wird erzeugt …"
        />
      </form>

      {bestehend ? (
        <div className="mt-2">
          <AktionsKnopf
            aktion={revokePortalAccess}
            label="Widerrufen"
            variante="gefahr"
            versteckt={{ customerId }}
            bestaetigung="Zugang widerrufen? Der Link öffnet danach nichts mehr."
          />
        </div>
      ) : null}

      {status.error ? (
        <p role="alert" className="mt-3 text-[12.5px] font-medium text-s-crit">
          {status.error}
        </p>
      ) : null}

      {bestehend ? (
        <p className="mt-3 text-[11px] text-faint">
          Ein neuer Link widerruft den alten — sonst sammeln sich über die
          Jahre gültige Zugänge an, die niemand mehr kennt.
        </p>
      ) : null}
    </div>
  );
}

/**
 * Der Linkkasten. Während ein neuer Link erzeugt wird, verschwindet der
 * alte: er ist in dem Moment schon widerrufen, und ein kopierter toter
 * Link fällt erst beim Kunden auf.
 */
function Linkkasten({ link }: { link: string | null }) {
  const { pending } = useFormStatus();

  if (pending) {
    return (
      <p className="mb-3 rounded-input bg-panel px-4 py-3 text-[12px] text-muted">
        Neuer Link wird erzeugt — der alte gilt ab jetzt nicht mehr.
      </p>
    );
  }

  if (!link) return null;

  return (
    <div className="mb-3 rounded-input bg-s-done/10 p-4">
      <p className="mb-2 text-[12.5px] font-semibold text-s-done">Portallink</p>
      <input
        readOnly
        value={link}
        aria-label="Portallink"
        onFocus={(e) => e.currentTarget.select()}
        className="num w-full rounded-input border border-transparent bg-surface px-[11px] py-[9px] text-[11.5px] outline-0"
      />
      <p className="mt-2 text-[11px] text-faint">
        Der Link gilt nur für diesen Kunden und lässt sich jederzeit
        widerrufen.
      </p>
    </div>
  );
}
