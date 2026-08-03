"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  LEER,
  Meldung,
  type AktionsStatus,
} from "@/components/ui/Formular";
import {
  VERLOREN_GRUND_LABEL,
  type Phase,
  type VerlorenGrund,
} from "@/lib/vorgang/modell";
import {
  phaseWechseln,
  vorgangReaktivieren,
  vorgangVerloren,
} from "@/app/(app)/vorgaenge/actions";
import { angebotAngenommen } from "@/app/(app)/vorgaenge/kaskade-actions";

/**
 * Das Aktionspanel: genau eine primäre Aktion je Phase.
 *
 * Kein Menü mit zwölf Möglichkeiten. Wer einen Vorgang offen hat, hat
 * genau eine nächste Sache zu tun — und die steht als einziger grosser
 * Knopf da. Alles andere passiert über den Composer oder inline.
 */

type Aktion = {
  titel: string;
  hinweis: string;
  label: string;
  /** Zielphase des primären Knopfs. Fehlt bei Sonderaktionen. */
  nach?: Phase;
  notiz?: string;
};

const AKTION: Partial<Record<Phase, Aktion>> = {
  anfrage: {
    titel: "Aufnahme planen",
    hinweis: "Vor-Ort-Termin für Dachdaten und Machbarkeit.",
    label: "Aufnahme starten",
    nach: "aufnahme",
    notiz: "Aufnahme begonnen.",
  },
  aufnahme: {
    titel: "Angebot erstellen",
    hinweis: "Positionen inline im Vorgang, kein Seitenwechsel.",
    label: "Angebot erstellen",
    nach: "angebot",
  },
  angebot: {
    titel: "Rückmeldung des Kunden",
    hinweis: "Die Annahme löst Auftragsbestätigung, Anzahlung, Materialliste und Gates aus.",
    label: "Angebot angenommen",
  },
  beauftragt: {
    titel: "Montage terminieren",
    hinweis: "Erst wenn alle Pflicht-Gates durch sind.",
    label: "Montage terminieren",
    nach: "montage",
  },
  montage: {
    titel: "Ausführung läuft",
    hinweis: "Abnahme, Übergabeprotokoll und Fertigstellungsmeldung folgen.",
    label: "Montage abgeschlossen",
    nach: "abschluss",
    notiz: "Anlage in Betrieb.",
  },
  abschluss: {
    titel: "Abschluss",
    hinweis: "Schlussrechnung, Zahlung, fertig.",
    label: "Vorgang abschließen",
  },
};

export function Aktionspanel({
  vorgangId,
  phase,
  offeneGates,
  darfSchreiben,
  verlorenGrund,
  anzahlungProzent,
}: {
  vorgangId: string;
  phase: Phase;
  /** Labels der offenen Pflicht-Gates. Leer = Terminierung frei. */
  offeneGates: string[];
  darfSchreiben: boolean;
  verlorenGrund: string | null;
  anzahlungProzent: number;
}) {
  if (phase === "verloren") {
    return (
      <VerlorenPanel
        vorgangId={vorgangId}
        grund={verlorenGrund}
        darfSchreiben={darfSchreiben}
      />
    );
  }

  const a = AKTION[phase];
  if (!a) return null;

  const blockiert = phase === "beauftragt" && offeneGates.length > 0;

  /*
   * Die Annahme ist kein einfacher Phasenwechsel, sondern die Kaskade:
   * vier Antworten, und daraus entsteht alles Weitere. Deshalb ein
   * eigener Dialog statt eines Knopfs.
   */
  if (phase === "angebot") {
    return (
      <AnnahmePanel
        vorgangId={vorgangId}
        anzahlungProzent={anzahlungProzent}
        darfSchreiben={darfSchreiben}
      />
    );
  }

  return (
    <section className="rounded-[20px] bg-surface p-5 shadow-soft">
      <h2 className="text-[15px] font-semibold">{a.titel}</h2>
      <p className="mt-1 mb-4 text-[12.5px] text-muted">
        {blockiert
          ? "Terminierung ist blockiert, solange Pflicht-Gates offen sind."
          : a.hinweis}
      </p>

      {a.nach ? (
        <PrimaerKnopf
          vorgangId={vorgangId}
          nach={a.nach}
          label={a.label}
          notiz={a.notiz}
          blockiert={blockiert}
          offeneGates={offeneGates}
          darfSchreiben={darfSchreiben}
        />
      ) : (
        <p className="rounded-input bg-panel px-4 py-3 text-[12.5px] text-muted">
          Der Vorgang ist in der letzten Phase. Schlussrechnung und Zahlung
          laufen über die Dokumente.
        </p>
      )}

      {darfSchreiben ? (
        <VerlorenKnopf vorgangId={vorgangId} phase={phase} />
      ) : (
        <p className="mt-3 text-[11.5px] text-faint">
          Diese Rolle löst keine Phasenwechsel aus.
        </p>
      )}
    </section>
  );
}

function PrimaerKnopf({
  vorgangId,
  nach,
  label,
  notiz,
  blockiert,
  offeneGates,
  darfSchreiben,
}: {
  vorgangId: string;
  nach: Phase;
  label: string;
  notiz?: string | undefined;
  blockiert: boolean;
  offeneGates: string[];
  darfSchreiben: boolean;
}) {
  const [status, formAction] = useActionState<AktionsStatus, FormData>(
    phaseWechseln,
    LEER,
  );

  return (
    <form action={formAction}>
      <input type="hidden" name="vorgangId" value={vorgangId} />
      <input type="hidden" name="nach" value={nach} />
      {notiz ? <input type="hidden" name="notiz" value={notiz} /> : null}

      <Gross
        label={label}
        gesperrt={!darfSchreiben || blockiert}
        /*
         * Der Grund steht am Knopf, nicht in einem Tooltip: wer nicht mit
         * der Maus arbeitet, sieht einen Tooltip nie, und die Frage
         * „warum geht das nicht" ist genau die, die hier beantwortet
         * gehört.
         */
        titel={
          blockiert
            ? `Offen: ${offeneGates.join(", ")}`
            : darfSchreiben
              ? ""
              : "Fehlendes Schreibrecht"
        }
      />

      {blockiert ? (
        <p className="mt-3 rounded-input bg-s-crit/8 px-4 py-3 text-[12.5px] text-s-crit">
          Offene Pflicht-Gates: {offeneGates.join(" · ")}
        </p>
      ) : null}

      <Meldung status={status} />
    </form>
  );
}

function Gross({
  label,
  gesperrt,
  titel,
}: {
  label: string;
  gesperrt: boolean;
  titel: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={gesperrt || pending}
      title={titel}
      className={[
        "min-h-[52px] w-full rounded-pill border-0 px-6 text-[14.5px] font-semibold transition-colors",
        gesperrt
          ? "cursor-not-allowed bg-sunk text-faint"
          : "cursor-pointer bg-[linear-gradient(150deg,var(--accent-from),var(--accent-to))] text-white shadow-[0_8px_22px_rgba(201,121,24,0.28)]",
      ].join(" ")}
    >
      {pending ? "Wird gespeichert …" : label}
    </button>
  );
}

const GRUENDE = Object.entries(VERLOREN_GRUND_LABEL) as [VerlorenGrund, string][];

function VerlorenKnopf({
  vorgangId,
  phase,
}: {
  vorgangId: string;
  phase: Phase;
}) {
  const [offen, setOffen] = useState(false);
  const [status, formAction] = useActionState<AktionsStatus, FormData>(
    vorgangVerloren,
    LEER,
  );

  // Was abgeschlossen ist, geht nicht mehr verloren.
  if (phase === "abschluss") return null;

  if (!offen) {
    return (
      <button
        type="button"
        onClick={() => setOffen(true)}
        className="mt-3 cursor-pointer border-0 bg-transparent text-[12.5px] font-medium text-s-crit underline"
      >
        Als verloren markieren
      </button>
    );
  }

  return (
    <form action={formAction} className="mt-4 border-t border-line pt-4">
      <input type="hidden" name="vorgangId" value={vorgangId} />

      <h3 className="text-[13.5px] font-semibold">Vorgang verloren</h3>
      <p className="mt-1 mb-3 text-[12px] text-muted">
        Der Grund ist Pflicht. Der Vorgang verschwindet aus dem Board und
        bleibt im Verloren-Filter auswertbar.
      </p>

      <label htmlFor="vl-grund" className="mb-[5px] block text-[12px] font-medium text-muted">
        Grund
      </label>
      <select
        id="vl-grund"
        name="grund"
        defaultValue="preis"
        className="w-full cursor-pointer rounded-input border border-transparent bg-sunk px-[13px] py-[10px] text-[13.5px] outline-0 focus:border-accent focus:bg-surface"
      >
        {GRUENDE.map(([wert, text]) => (
          <option key={wert} value={wert}>
            {text}
          </option>
        ))}
      </select>

      <label htmlFor="vl-notiz" className="mt-3 mb-[5px] block text-[12px] font-medium text-muted">
        Notiz
      </label>
      <textarea
        id="vl-notiz"
        name="notiz"
        rows={2}
        placeholder="Was war ausschlaggebend?"
        className="w-full resize-y rounded-input border border-transparent bg-sunk px-[13px] py-[10px] text-[13px] outline-0 focus:border-accent focus:bg-surface"
      />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <VerlorenAbsenden />
        <button
          type="button"
          onClick={() => setOffen(false)}
          className="cursor-pointer border-0 bg-transparent text-[12.5px] text-muted underline"
        >
          Abbrechen
        </button>
      </div>

      <Meldung status={status} />
    </form>
  );
}

function VerlorenAbsenden() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="min-h-[44px] cursor-pointer rounded-pill border-0 bg-s-crit px-[20px] text-[13.5px] font-semibold text-white disabled:opacity-50"
    >
      {pending ? "Wird vermerkt …" : "Als verloren markieren"}
    </button>
  );
}

function VerlorenPanel({
  vorgangId,
  grund,
  darfSchreiben,
}: {
  vorgangId: string;
  grund: string | null;
  darfSchreiben: boolean;
}) {
  const [status, formAction] = useActionState<AktionsStatus, FormData>(
    vorgangReaktivieren,
    LEER,
  );

  return (
    <section className="rounded-[20px] bg-surface p-5 shadow-soft">
      <h2 className="text-[15px] font-semibold">Vorgang verloren</h2>
      <p className="mt-1 mb-4 text-[12.5px] text-muted">
        Grund: {grund ? (VERLOREN_GRUND_LABEL[grund as VerlorenGrund] ?? grund) : "—"}.
        Der Vorgang bleibt auswertbar und lässt sich wieder aufnehmen.
      </p>

      {darfSchreiben ? (
        <form action={formAction}>
          <input type="hidden" name="vorgangId" value={vorgangId} />
          <button
            type="submit"
            className="min-h-[48px] w-full cursor-pointer rounded-pill border border-line bg-panel px-6 text-[14px] font-semibold text-ink"
          >
            Wieder aufnehmen
          </button>
          <Meldung status={status} />
        </form>
      ) : null}
    </section>
  );
}


/**
 * Die Annahme-Kaskade.
 *
 * Vier Felder, Rest vorbelegt. Beim Bestätigen entstehen
 * Auftragsbestätigung, Anzahlungsrechnung, Materialbedarfsliste, die
 * Gates und die Soll-Werte — ohne dass jemand eine einzige Position neu
 * eintippt. Genau das war bisher die Doppelarbeit.
 */
function AnnahmePanel({
  vorgangId,
  anzahlungProzent,
  darfSchreiben,
}: {
  vorgangId: string;
  anzahlungProzent: number;
  darfSchreiben: boolean;
}) {
  const [offen, setOffen] = useState(false);
  const [status, formAction] = useActionState<AktionsStatus, FormData>(
    angebotAngenommen,
    LEER,
  );

  return (
    <section className="rounded-[20px] bg-surface p-5 shadow-soft">
      <h2 className="text-[15px] font-semibold">Rückmeldung des Kunden</h2>
      <p className="mt-1 mb-4 text-[12.5px] text-muted">
        Die Annahme löst Auftragsbestätigung, Anzahlung, Materialliste und
        Gates aus — in einem Zug, ohne Positionen neu zu erfassen.
      </p>

      {!offen ? (
        <>
          <button
            type="button"
            disabled={!darfSchreiben}
            onClick={() => setOffen(true)}
            className={[
              "min-h-[52px] w-full rounded-pill border-0 px-6 text-[14.5px] font-semibold",
              darfSchreiben
                ? "cursor-pointer bg-[linear-gradient(150deg,var(--accent-from),var(--accent-to))] text-white shadow-[0_8px_22px_rgba(201,121,24,0.28)]"
                : "cursor-not-allowed bg-sunk text-faint",
            ].join(" ")}
          >
            Angebot angenommen
          </button>
          {darfSchreiben ? (
            <VerlorenKnopf vorgangId={vorgangId} phase="angebot" />
          ) : null}
        </>
      ) : (
        <form action={formAction}>
          <input type="hidden" name="vorgangId" value={vorgangId} />

          <div className="grid gap-3">
            <Zahl
              id="an-prozent"
              name="anzahlungProzent"
              label="Anzahlung in Prozent"
              wert={anzahlungProzent}
            />
            <Text
              id="an-zeitraum"
              name="wunschZeitraum"
              label="Wunsch-Zeitraum Montage"
              platzhalter="KW 33 oder September"
            />
            <JaNein
              id="an-geruest"
              name="geruest"
              label="Gerüst oder Hebebühne nötig?"
              vorgabe="ja"
              hinweis={"Nein setzt das Gate „Gerüst“ gleich auf nicht nötig."}
            />
            <JaNein
              id="an-sub"
              name="sub"
              label="Sub nötig?"
              vorgabe="nein"
              hinweis={"Ja lässt das Gate „Team“ offen laufen."}
            />
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <AnnahmeAbsenden />
            <button
              type="button"
              onClick={() => setOffen(false)}
              className="cursor-pointer border-0 bg-transparent text-[12.5px] text-muted underline"
            >
              Abbrechen
            </button>
          </div>

          <Meldung status={status} />
        </form>
      )}
    </section>
  );
}

function AnnahmeAbsenden() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="min-h-[48px] flex-1 cursor-pointer rounded-pill border-0 bg-[linear-gradient(150deg,var(--accent-from),var(--accent-to))] px-6 text-[14px] font-semibold text-white shadow-[0_8px_22px_rgba(201,121,24,0.28)] disabled:opacity-60"
    >
      {pending ? "Auftrag wird ausgelöst …" : "Auftrag auslösen"}
    </button>
  );
}

function Zahl({
  id,
  name,
  label,
  wert,
}: {
  id: string;
  name: string;
  label: string;
  wert: number;
}) {
  return (
    <span className="flex flex-col gap-[5px]">
      <label htmlFor={id} className="text-[12px] font-medium text-muted">
        {label}
      </label>
      <input
        id={id}
        name={name}
        type="number"
        min={0}
        max={100}
        step={1}
        defaultValue={wert}
        className="num w-full rounded-input border border-transparent bg-sunk px-[13px] py-[10px] text-[13.5px] outline-0 focus:border-accent focus:bg-surface"
      />
    </span>
  );
}

function Text({
  id,
  name,
  label,
  platzhalter,
}: {
  id: string;
  name: string;
  label: string;
  platzhalter: string;
}) {
  return (
    <span className="flex flex-col gap-[5px]">
      <label htmlFor={id} className="text-[12px] font-medium text-muted">
        {label}
      </label>
      <input
        id={id}
        name={name}
        placeholder={platzhalter}
        className="w-full rounded-input border border-transparent bg-sunk px-[13px] py-[10px] text-[13.5px] outline-0 focus:border-accent focus:bg-surface"
      />
    </span>
  );
}

function JaNein({
  id,
  name,
  label,
  vorgabe,
  hinweis,
}: {
  id: string;
  name: string;
  label: string;
  vorgabe: "ja" | "nein";
  hinweis: string;
}) {
  return (
    <span className="flex flex-col gap-[5px]">
      <label htmlFor={id} className="text-[12px] font-medium text-muted">
        {label}
      </label>
      <select
        id={id}
        name={name}
        defaultValue={vorgabe}
        className="w-full cursor-pointer rounded-input border border-transparent bg-sunk px-[13px] py-[10px] text-[13.5px] outline-0 focus:border-accent focus:bg-surface"
      >
        <option value="ja">ja</option>
        <option value="nein">nein</option>
      </select>
      <span className="text-[10.5px] text-faint">{hinweis}</span>
    </span>
  );
}
