"use client";

import { useState } from "react";
import type { AktionsStatus } from "@/components/ui/Formular";
import {
  Auswahl,
  Eingabe,
  Formular,
  LEER,
  Meldung,
  Absenden,
  Textfeld,
} from "@/components/ui/Formular";
import { Suchauswahl } from "@/components/ui/Suchauswahl";
import { antwortSenden, ticketAnlegen, ticketSpeichern } from "./actions";
import { useActionState } from "react";

export type Wahl = { wert: string; text: string; zusatz?: string };

const KATEGORIEN = [
  { wert: "stoerung", text: "Störung" },
  { wert: "frage", text: "Frage" },
  { wert: "beschwerde", text: "Beschwerde" },
  { wert: "rechnung", text: "Rechnung" },
];

const QUELLEN = [
  { wert: "phone", text: "Telefon" },
  { wert: "mail", text: "E-Mail" },
  { wert: "portal", text: "Kundenportal" },
];

const DRINGLICHKEIT = [
  { wert: "1", text: "hoch — Anlage steht" },
  { wert: "2", text: "mittel" },
  { wert: "3", text: "normal" },
];

const STATUS = [
  { wert: "offen", text: "offen" },
  { wert: "diagnose", text: "in Prüfung" },
  { wert: "termin_geplant", text: "Termin geplant" },
  { wert: "behoben", text: "erledigt" },
];

/** Ticket von Hand anlegen — der Kunde ruft an. */
export function TicketAnlegen({ kunden }: { kunden: Wahl[] }) {
  const [offen, setOffen] = useState(false);

  if (!offen) {
    return (
      <button
        type="button"
        onClick={() => setOffen(true)}
        className="rounded-pill border-0 bg-[linear-gradient(150deg,var(--accent-from),var(--accent-to))] px-5 py-[13px] text-sm font-semibold text-white"
      >
        Anliegen erfassen
      </button>
    );
  }

  return (
    <div className="w-full">
      <Formular
        aktion={ticketAnlegen}
        titel="Anliegen erfassen"
        hinweis="Für Meldungen, die nicht über das Portal kommen — Telefon oder Mail."
        knopf="Anlegen"
        leerenNachErfolg
      >
        <Suchauswahl
          name="customerId"
          label="Kunde"
          pflicht
          breit
          platzhalter="Kunde suchen"
          optionen={kunden}
        />
        <Auswahl
          id="t-kategorie"
          name="category"
          label="Kategorie"
          wert="stoerung"
          optionen={KATEGORIEN}
        />
        <Auswahl
          id="t-quelle"
          name="source"
          label="Eingegangen über"
          wert="phone"
          optionen={QUELLEN}
        />
        <Auswahl
          id="t-dringlich"
          name="severity"
          label="Dringlichkeit"
          wert="2"
          optionen={DRINGLICHKEIT}
        />
        <Textfeld
          id="t-body"
          name="body"
          label="Anliegen"
          zeilen={4}
          platzhalter="Was hat der Kunde gemeldet?"
        />
      </Formular>
    </div>
  );
}

/** Bearbeitung eines bestehenden Tickets: Status, Dringlichkeit, Zuständigkeit. */
export function TicketBearbeiten({
  ticketId,
  status,
  severity,
  assigneeId,
  jobId,
  mitarbeiter,
  auftraege,
}: {
  ticketId: string;
  status: string;
  severity: number;
  assigneeId: string;
  jobId: string;
  mitarbeiter: Wahl[];
  auftraege: Wahl[];
}) {
  return (
    <Formular
      aktion={ticketSpeichern}
      titel="Bearbeitung"
      knopf="Speichern"
      versteckt={{ ticketId }}
    >
      <Auswahl
        id="b-status"
        name="status"
        label="Status"
        wert={status}
        optionen={STATUS}
      />
      <Auswahl
        id="b-dringlich"
        name="severity"
        label="Dringlichkeit"
        wert={String(severity)}
        optionen={DRINGLICHKEIT}
      />
      <Suchauswahl
        name="assigneeId"
        label="Zuständig"
        breit
        platzhalter="Mitarbeiter suchen"
        wert={assigneeId}
        optionen={mitarbeiter}
      />
      <Suchauswahl
        name="jobId"
        label="Auftrag"
        breit
        platzhalter="Auftrag suchen"
        wert={jobId}
        optionen={auftraege}
      />
    </Formular>
  );
}

/**
 * Antwortfeld unter dem Verlauf.
 *
 * Der Umschalter „interne Notiz" steht direkt daneben und nicht in einem
 * Untermenü — wer sich vertut, schreibt sonst eine interne Einschätzung
 * an den Kunden.
 */
export function AntwortFeld({ ticketId }: { ticketId: string }) {
  const [status, formAction] = useActionState<AktionsStatus, FormData>(
    antwortSenden,
    LEER,
  );
  const [intern, setIntern] = useState(false);

  return (
    <form
      action={formAction}
      key={status.ok ?? "leer"}
      className="mt-4 border-t border-line pt-4"
    >
      <input type="hidden" name="ticketId" value={ticketId} />
      <input type="hidden" name="intern" value={intern ? "ja" : "nein"} />

      <label htmlFor="antwort-body" className="mb-[5px] block text-[12px] font-medium text-muted">
        {intern ? "Interne Notiz — der Kunde sieht sie nicht" : "Antwort an den Kunden"}
      </label>
      <textarea
        id="antwort-body"
        name="body"
        rows={3}
        placeholder={
          intern
            ? "Nur für das Team, zum Beispiel was am Telefon besprochen wurde."
            : "Ihre Antwort erscheint sofort im Kundenportal."
        }
        className={[
          "w-full resize-y rounded-input border px-[13px] py-[11px] text-[13.5px] outline-0 focus:border-accent",
          intern ? "border-s-warn/40 bg-s-warn/8" : "border-transparent bg-sunk",
        ].join(" ")}
      />

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Absenden
          label={intern ? "Notiz speichern" : "Antwort senden"}
          busy="Wird gespeichert …"
          variante={intern ? "quiet" : "primary"}
        />
        <button
          type="button"
          role="switch"
          aria-checked={intern}
          onClick={() => setIntern((i) => !i)}
          className="flex items-center gap-2 rounded-pill border border-line px-4 py-[9px] text-[12.5px] font-medium"
        >
          <span
            className={[
              "grid h-[16px] w-[16px] place-items-center rounded-[5px] border-2",
              intern ? "border-s-warn bg-s-warn text-white" : "border-line-strong",
            ].join(" ")}
            aria-hidden
          >
            {intern ? "✓" : ""}
          </span>
          Interne Notiz
        </button>
      </div>

      <Meldung status={status} />
    </form>
  );
}

export { Eingabe };
