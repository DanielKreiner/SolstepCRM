"use client";

import { useActionState, useState } from "react";
import { LEER, Meldung, type AktionsStatus } from "@/components/ui/Formular";
import { Suchauswahl, type Option } from "@/components/ui/Suchauswahl";
import {
  alsVorlageSpeichern,
  schnellZusammenbau,
  vorlageAnwenden,
} from "@/app/(app)/vorgaenge/vorlagen-actions";

export type VorlageOption = {
  id: string;
  name: string;
  beschreibung: string | null;
  zielKwp: number | null;
  istStandard: boolean;
};

/**
 * Der schnelle Weg zum Angebot.
 *
 * Zwei Wege stehen hier nebeneinander, weil es zwei Situationen gibt:
 * ein Standardpaket, das der Betrieb ohnehin immer anbietet — dafür die
 * Vorlage — und eine Anlage, die aus einer Dachfläche folgt: so viele
 * Module, Speicher ja oder nein, alles andere ergibt sich.
 *
 * Beides klappt auf und steht nicht dauerhaft offen: es ist der erste
 * Griff bei einem neuen Angebot und danach nie wieder.
 */
export function Schnellbau({
  vorgangId,
  module,
  vorlagen,
}: {
  vorgangId: string;
  /** PV-Module mit hinterlegter Nennleistung. */
  module: Option[];
  vorlagen: VorlageOption[];
}) {
  const [offen, setOffen] = useState<"bau" | "vorlage" | "sichern" | null>(null);

  return (
    <div className="mt-3 rounded-input bg-panel p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] font-semibold">Schneller Anfang</span>
        <span className="flex-1" />
        {(
          [
            ["bau", "Aus Modulanzahl"],
            ["vorlage", `Aus Vorlage${vorlagen.length ? ` · ${vorlagen.length}` : ""}`],
            ["sichern", "Als Vorlage sichern"],
          ] as const
        ).map(([wert, label]) => (
          <button
            key={wert}
            type="button"
            aria-expanded={offen === wert}
            onClick={() => setOffen(offen === wert ? null : wert)}
            className={[
              "cursor-pointer rounded-pill px-[13px] py-[6px] text-[11.5px] font-medium transition-colors",
              offen === wert
                ? "bg-ink text-app"
                : "border border-line bg-surface text-ink hover:bg-sunk",
            ].join(" ")}
          >
            {label}
          </button>
        ))}
      </div>

      {offen === "bau" ? (
        <BauForm vorgangId={vorgangId} module={module} />
      ) : null}
      {offen === "vorlage" ? (
        <AnwendenForm vorgangId={vorgangId} vorlagen={vorlagen} />
      ) : null}
      {offen === "sichern" ? <SichernForm vorgangId={vorgangId} /> : null}
    </div>
  );
}

function BauForm({
  vorgangId,
  module,
}: {
  vorgangId: string;
  module: Option[];
}) {
  const [status, formAction] = useActionState<AktionsStatus, FormData>(
    schnellZusammenbau,
    LEER,
  );

  if (module.length === 0) {
    return (
      <p className="mt-3 text-[11.5px] text-faint">
        Kein PV-Modul hat eine Nennleistung hinterlegt. Ohne sie lässt sich
        nichts auslegen — im Lager beim Artikel eintragen.
      </p>
    );
  }

  return (
    <form action={formAction} className="mt-3 grid gap-2 sm:grid-cols-4">
      <input type="hidden" name="vorgangId" value={vorgangId} />

      <div className="sm:col-span-4">
        <Suchauswahl
          name="modulArtikelId"
          label="PV-Modul"
          pflicht
          breit
          platzhalter="Modul suchen"
          optionen={module}
        />
      </div>

      <Zahl id="sb-anzahl" name="anzahl" label="Module" wert={20} schritt="1" />
      <Zahl
        id="sb-speicher"
        name="speicherKwh"
        label="Speicher kWh"
        wert={0}
        schritt="0.1"
      />
      <div className="sm:col-span-2">
        <label
          htmlFor="sb-gruppe"
          className="mb-[5px] block text-[11.5px] font-medium text-muted"
        >
          Name des Pakets
        </label>
        <input
          id="sb-gruppe"
          name="gruppeName"
          placeholder="leer = PV-Anlage <kWp> kWp"
          className="w-full rounded-input border border-transparent bg-sunk px-[11px] py-[9px] text-[13px] outline-0 focus:border-accent focus:bg-surface"
        />
      </div>

      <p className="text-[11px] text-faint sm:col-span-4">
        Wechselrichter, Speicher und alles mit Menge je Modul kommen
        automatisch dazu. Ausgelegt wird auf rund 90 % der Modulleistung.
      </p>

      <div className="sm:col-span-4">
        <Absenden label="Zusammenstellen" />
        <Meldung status={status} />
      </div>
    </form>
  );
}

function AnwendenForm({
  vorgangId,
  vorlagen,
}: {
  vorgangId: string;
  vorlagen: VorlageOption[];
}) {
  const [status, formAction] = useActionState<AktionsStatus, FormData>(
    vorlageAnwenden,
    LEER,
  );

  if (vorlagen.length === 0) {
    return (
      <p className="mt-3 text-[11.5px] text-faint">
        Noch keine Vorlage. Stell ein Angebot zusammen und sichere es —
        beim nächsten Mal steht es hier.
      </p>
    );
  }

  const standard = vorlagen.find((v) => v.istStandard);

  return (
    <form action={formAction} className="mt-3 grid gap-2">
      <input type="hidden" name="vorgangId" value={vorgangId} />

      <label
        htmlFor="va-vorlage"
        className="text-[11.5px] font-medium text-muted"
      >
        Vorlage
      </label>
      <select
        id="va-vorlage"
        name="vorlageId"
        defaultValue={standard?.id ?? vorlagen[0]?.id}
        className="w-full rounded-input border border-transparent bg-sunk px-[11px] py-[9px] text-[13px] outline-0 focus:border-accent"
      >
        {vorlagen.map((v) => (
          <option key={v.id} value={v.id}>
            {v.name}
            {v.zielKwp ? ` — ${v.zielKwp} kWp` : ""}
            {v.istStandard ? " (Standard)" : ""}
          </option>
        ))}
      </select>

      {/*
        Ersetzend ist die Vorgabe: eine Vorlage ist ein vollständiges
        Paket und kein Baustein. Wer anhängen will, nimmt das Häkchen weg.
      */}
      <label className="flex items-center gap-2 text-[12px]">
        <input
          type="checkbox"
          name="ersetzen"
          value="ja"
          defaultChecked
          className="h-4 w-4 accent-[var(--accent)]"
        />
        Bestehende Positionen ersetzen
      </label>

      <p className="text-[11px] text-faint">
        Preise kommen frisch aus dem Artikelstamm — eine Vorlage von letztem
        Jahr schreibt nicht die Preise von damals ins Angebot.
      </p>

      <div>
        <Absenden label="Anwenden" />
        <Meldung status={status} />
      </div>
    </form>
  );
}

function SichernForm({ vorgangId }: { vorgangId: string }) {
  const [status, formAction] = useActionState<AktionsStatus, FormData>(
    alsVorlageSpeichern,
    LEER,
  );

  return (
    <form
      action={formAction}
      key={status.ok ?? "leer"}
      className="mt-3 grid gap-2"
    >
      <input type="hidden" name="vorgangId" value={vorgangId} />

      <label htmlFor="vs-name" className="text-[11.5px] font-medium text-muted">
        Name der Vorlage
      </label>
      <input
        id="vs-name"
        name="name"
        placeholder="z. B. Standardpaket 10 kWp mit Speicher"
        className="w-full rounded-input border border-transparent bg-sunk px-[11px] py-[9px] text-[13px] outline-0 focus:border-accent focus:bg-surface"
      />

      <label className="flex items-center gap-2 text-[12px]">
        <input
          type="checkbox"
          name="alsStandard"
          value="ja"
          className="h-4 w-4 accent-[var(--accent)]"
        />
        Als Standard — wird bei einem neuen Angebot vorgeschlagen
      </label>

      <div>
        <Absenden label="Sichern" />
        <Meldung status={status} />
      </div>
    </form>
  );
}

function Zahl({
  id,
  name,
  label,
  wert,
  schritt,
}: {
  id: string;
  name: string;
  label: string;
  wert: number;
  schritt: string;
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="mb-[5px] block text-[11.5px] font-medium text-muted"
      >
        {label}
      </label>
      <input
        id={id}
        name={name}
        type="number"
        step={schritt}
        defaultValue={wert}
        className="num w-full rounded-input border border-transparent bg-sunk px-[11px] py-[9px] text-[13px] outline-0 focus:border-accent focus:bg-surface"
      />
    </div>
  );
}

function Absenden({ label }: { label: string }) {
  return (
    <button
      type="submit"
      className="min-h-[36px] cursor-pointer rounded-pill border-0 bg-ink px-[18px] text-[12.5px] font-semibold text-app"
    >
      {label}
    </button>
  );
}
