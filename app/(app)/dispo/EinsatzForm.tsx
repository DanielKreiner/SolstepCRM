"use client";

import { useActionState, useState } from "react";
import {
  Absenden,
  AktionsKnopf,
  Eingabe,
  Feld,
  Formular,
  LEER,
  Meldung,
  type AktionsStatus,
} from "@/components/ui/Formular";
import { Suchauswahl, type Option } from "@/components/ui/Suchauswahl";
import { einsatzAnlegen, einsatzLoeschen, einsatzSpeichern } from "./actions";

/**
 * Einen Einsatz in den Wochenplan setzen.
 *
 * Bis hierher konnte die Einsatzplanung Einsätze anzeigen, zuordnen und
 * freigeben — nur nicht anlegen. Ein Auftrag im Pool "Nicht terminiert"
 * war von diesem Screen aus nicht in den Plan zu bekommen.
 */
export function EinsatzAnlegen({
  auftraege,
  team,
  vorschlagDatum,
}: {
  auftraege: Option[];
  team: Option[];
  /** Montag der angezeigten Woche — sonst landet man immer im Heute. */
  vorschlagDatum: string;
}) {
  const [offen, setOffen] = useState(false);
  const [trotzdem, setTrotzdem] = useState(false);
  const [status, formAction] = useActionState<AktionsStatus, FormData>(
    einsatzAnlegen,
    LEER,
  );

  /*
   * Tag, Zeiten und Bezeichnung liegen im Zustand, nicht als
   * defaultValue im DOM.
   *
   * Grund: nach einer abgelehnten Eingabe rendert die Server Action den
   * Baum neu, und uneingefasste Felder fallen dabei auf ihre Vorgabe
   * zurück. Der Auftrag und die Person blieben stehen (die halten
   * eigenen Zustand), Datum und Uhrzeit sprangen zurück auf Montag
   * 07:00 — und "Trotzdem eintragen" buchte dann einen anderen Einsatz
   * als den, der auf dem Bildschirm stand. Im Betrieb heisst das: der
   * Monteur steht am falschen Tag auf der Baustelle.
   */
  const [datum, setDatum] = useState(vorschlagDatum);
  const [von, setVon] = useState("07:00");
  const [bis, setBis] = useState("16:00");
  const [titel, setTitel] = useState("");

  if (!offen) {
    return (
      <button
        type="button"
        onClick={() => setOffen(true)}
        className="min-h-[44px] cursor-pointer rounded-pill border-0 bg-[linear-gradient(150deg,var(--accent-from),var(--accent-to))] px-[22px] text-[13.5px] font-semibold text-white shadow-[0_6px_18px_rgba(201,121,24,0.28)]"
      >
        Einsatz eintragen
      </button>
    );
  }

  /*
   * Kein <Formular>, weil der Schalter „Trotzdem eintragen" erst nach der
   * ersten Rückmeldung erscheint und dafür der Status gebraucht wird.
   */
  return (
    <form
      action={formAction}
      key={status.ok ?? "leer"}
      className="w-full rounded-[20px] bg-surface p-5 shadow-soft"
    >
      <h2 className="text-[15px] font-semibold">Einsatz eintragen</h2>
      <p className="mt-1 mb-4 text-[12.5px] text-muted">
        Ruhezeit und Höchstarbeitszeit werden sofort geprüft — nicht erst
        beim Veröffentlichen.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <Suchauswahl
          name="jobId"
          label="Auftrag"
          pflicht
          breit
          platzhalter="Auftrag suchen — Nummer oder Kunde"
          optionen={auftraege}
        />
        <Suchauswahl
          name="userId"
          label="Wer"
          breit
          platzhalter="Mitarbeiter suchen"
          leerLabel="— noch offen —"
          hinweis="Ohne Namen bleibt der Einsatz im Plan und wartet auf Zuordnung."
          optionen={team}
        />
        <Gehalten
          id="ez-datum"
          name="datum"
          label="Tag"
          typ="date"
          pflicht
          wert={datum}
          setzen={setDatum}
        />
        <Gehalten
          id="ez-titel"
          name="titel"
          label="Bezeichnung"
          platzhalter="Montage"
          wert={titel}
          setzen={setTitel}
        />
        <Gehalten
          id="ez-von"
          name="von"
          label="Von"
          typ="time"
          pflicht
          wert={von}
          setzen={setVon}
        />
        <Gehalten
          id="ez-bis"
          name="bis"
          label="Bis"
          typ="time"
          pflicht
          wert={bis}
          setzen={setBis}
        />
      </div>

      {/*
        Der Schalter erscheint erst, wenn die Prüfung tatsächlich etwas
        gefunden hat. Stünde er immer da, wäre er in drei Wochen
        durchgeklickt und die Prüfung wertlos.
      */}
      {status.error && status.error.includes("Trotzdem eintragen") ? (
        <label className="mt-4 flex items-start gap-2 text-[13px]">
          <input
            type="checkbox"
            name="trotzdem"
            value="ja"
            checked={trotzdem}
            onChange={(e) => setTrotzdem(e.target.checked)}
            className="mt-[2px] h-4 w-4 accent-[var(--accent)]"
          />
          <span>Trotzdem eintragen — ich kenne den Verstoß.</span>
        </label>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Absenden label="Eintragen" busy="Wird eingetragen …" />
        <button
          type="button"
          onClick={() => setOffen(false)}
          className="cursor-pointer border-0 bg-transparent text-[12.5px] text-muted underline"
        >
          Schliessen
        </button>
      </div>

      <Meldung status={status} />
    </form>
  );
}

/** Einen bestehenden Einsatz verschieben, umbesetzen oder entfernen. */
export function EinsatzBearbeiten({
  appointmentId,
  datum,
  von,
  bis,
  userId,
  team,
}: {
  appointmentId: string;
  datum: string;
  von: string;
  bis: string;
  userId: string;
  team: Option[];
}) {
  return (
    <div className="flex flex-col gap-3">
      <Formular
        aktion={einsatzSpeichern}
        titel="Einsatz"
        hinweis="Ein verschobener Termin gilt beim Kunden als unbestätigt — er muss neu zusagen."
        knopf="Speichern"
        versteckt={{ appointmentId }}
      >
        <Suchauswahl
          name="userId"
          label="Wer"
          breit
          platzhalter="Mitarbeiter suchen"
          leerLabel="— noch offen —"
          wert={userId}
          optionen={team}
        />
        <Eingabe id="eb-datum" name="datum" label="Tag" typ="date" pflicht wert={datum} />
        <span />
        <Eingabe id="eb-von" name="von" label="Von" typ="time" pflicht wert={von} />
        <Eingabe id="eb-bis" name="bis" label="Bis" typ="time" pflicht wert={bis} />
      </Formular>

      <AktionsKnopf
        aktion={einsatzLoeschen}
        label="Einsatz entfernen"
        variante="gefahr"
        versteckt={{ appointmentId }}
        bestaetigung="Einsatz entfernen? Der Auftrag landet wieder im Pool."
      />
    </div>
  );
}


/**
 * Eingabefeld, dessen Wert im Zustand der Elternkomponente liegt.
 *
 * `Eingabe` aus dem Formularkit arbeitet mit defaultValue — richtig für
 * Formulare, die nach dem Absenden verschwinden. Dieses hier bleibt nach
 * einer Ablehnung stehen und muss den Inhalt behalten.
 */
function Gehalten({
  id,
  name,
  label,
  wert,
  setzen,
  typ = "text",
  pflicht = false,
  platzhalter,
}: {
  id: string;
  name: string;
  label: string;
  wert: string;
  setzen: (v: string) => void;
  typ?: "text" | "date" | "time";
  pflicht?: boolean;
  platzhalter?: string;
}) {
  return (
    <Feld id={id} label={label} pflicht={pflicht}>
      <input
        id={id}
        name={name}
        type={typ}
        required={pflicht}
        value={wert}
        placeholder={platzhalter ?? ""}
        onChange={(e) => setzen(e.target.value)}
        className={
          "w-full rounded-input border border-transparent bg-sunk px-[13px] py-[10px] text-[13.5px] text-ink outline-0 " +
          "focus:border-accent focus:bg-surface"
        }
      />
    </Feld>
  );
}
