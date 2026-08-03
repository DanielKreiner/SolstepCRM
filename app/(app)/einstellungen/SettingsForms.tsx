"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  addPhase,
  deletePhase,
  renamePhase,
  saveLocation,
  saveTimeSettings,
  setPermission,
  type SettingsState,
} from "./actions";

const INITIAL: SettingsState = { error: null, ok: null };

function Meldung({ state }: { state: SettingsState }) {
  if (state.error) {
    return (
      <p role="alert" className="mt-2 text-[12.5px] font-medium text-s-crit">
        {state.error}
      </p>
    );
  }
  if (state.ok) {
    return (
      <p role="status" className="mt-2 text-[12.5px] font-medium text-s-done">
        {state.ok}
      </p>
    );
  }
  return null;
}

/** Eine Zelle der Rollenmatrix. Speichert bei Auswahl, ohne Speichern-Knopf. */
export function PermissionCell({
  role,
  area,
  level,
  gesperrt,
}: {
  role: string;
  area: string;
  level: string;
  gesperrt: boolean;
}) {
  const [state, formAction] = useActionState(setPermission, INITIAL);

  return (
    <form action={formAction} className="contents">
      <input type="hidden" name="role" value={role} />
      <input type="hidden" name="area" value={area} />
      <div className="px-[6px] py-2">
        <select
          name="level"
          defaultValue={level}
          disabled={gesperrt}
          aria-label={`${area} für ${role}`}
          onChange={(e) => e.currentTarget.form?.requestSubmit()}
          className={[
            "w-full cursor-pointer rounded-input border border-transparent px-2 py-[6px] text-[12.5px] outline-0 focus:border-accent",
            level === "write"
              ? "bg-s-done/12 text-s-done"
              : level === "read"
                ? "bg-s-doing/12 text-s-doing"
                : "bg-sunk text-muted",
            gesperrt ? "cursor-not-allowed opacity-60" : "",
          ].join(" ")}
        >
          <option value="none">kein Zugriff</option>
          <option value="read">lesen</option>
          <option value="write">schreiben</option>
        </select>
        <Meldung state={state} />
      </div>
    </form>
  );
}

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="min-h-[40px] cursor-pointer rounded-pill bg-[linear-gradient(150deg,var(--accent-from),var(--accent-to))] px-[18px] text-[13px] font-semibold text-white disabled:opacity-50"
    >
      {pending ? "…" : label}
    </button>
  );
}

export function AddPhaseForm({
  pipelineId,
  naechsteSortierung,
}: {
  pipelineId: string;
  naechsteSortierung: number;
}) {
  const [state, formAction] = useActionState(addPhase, INITIAL);

  return (
    <form action={formAction} className="mt-3 flex flex-wrap items-end gap-2">
      <input type="hidden" name="pipelineId" value={pipelineId} />

      <div className="flex flex-col gap-[4px]">
        <label htmlFor={`p-label-${pipelineId}`} className="text-[11px] text-muted">
          Bezeichnung
        </label>
        <input
          id={`p-label-${pipelineId}`}
          name="label"
          required
          minLength={2}
          placeholder="z. B. Gerüst bestellt"
          className={feld}
        />
      </div>

      <div className="flex flex-col gap-[4px]">
        <label htmlFor={`p-key-${pipelineId}`} className="text-[11px] text-muted">
          Schlüssel
        </label>
        <input
          id={`p-key-${pipelineId}`}
          name="key"
          required
          pattern="[a-z0-9_]+"
          placeholder="geruest"
          className={`${feld} num w-[140px]`}
        />
      </div>

      <div className="flex flex-col gap-[4px]">
        <label htmlFor={`p-sort-${pipelineId}`} className="text-[11px] text-muted">
          Position
        </label>
        <input
          id={`p-sort-${pipelineId}`}
          type="number"
          name="sort"
          min="1"
          max="99"
          defaultValue={naechsteSortierung}
          className={`${feld} num w-[80px]`}
        />
      </div>

      <Submit label="Phase anlegen" />
      <div className="w-full">
        <Meldung state={state} />
      </div>
    </form>
  );
}

export function PhaseRowForm({
  phaseId,
  label,
  systemKey,
  belegt,
}: {
  phaseId: string;
  label: string;
  systemKey: string | null;
  belegt: number;
}) {
  const [renameState, renameAction] = useActionState(renamePhase, INITIAL);
  const [deleteState, deleteAction] = useActionState(deletePhase, INITIAL);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <form action={renameAction} className="flex items-center gap-2">
        <input type="hidden" name="phaseId" value={phaseId} />
        <input
          name="label"
          defaultValue={label}
          aria-label={`Bezeichnung von ${label}`}
          className={`${feld} w-[200px]`}
        />
        <button
          type="submit"
          className="cursor-pointer rounded-pill bg-sunk px-[13px] py-[6px] text-[12px] font-medium text-ink hover:bg-line"
        >
          umbenennen
        </button>
      </form>

      {systemKey ? (
        <span className="num rounded-pill bg-s-warn/12 px-[9px] py-[3px] text-[11px] text-accent-ink">
          {systemKey}
        </span>
      ) : null}

      <span className="num text-[11.5px] text-faint">
        {belegt} {belegt === 1 ? "Eintrag" : "Einträge"}
      </span>

      {!systemKey ? (
        <form action={deleteAction}>
          <input type="hidden" name="phaseId" value={phaseId} />
          <button
            type="submit"
            className="cursor-pointer rounded-pill bg-transparent px-[11px] py-[6px] text-[12px] text-muted hover:text-s-crit"
          >
            löschen
          </button>
        </form>
      ) : null}

      <div className="w-full">
        <Meldung state={renameState} />
        <Meldung state={deleteState} />
      </div>
    </div>
  );
}

const feld =
  "rounded-input border border-transparent bg-sunk px-[11px] py-[7px] text-[13px] text-ink outline-0 focus:border-accent focus:bg-surface";

export type StandortWerte = {
  id: string;
  name: string;
  holidayRegion: string;
  minStaffing: number;
  restHours: number;
  maxDaily: number;
  maxWeekly: number;
  breakAfterMin: number;
  breakMin: number;
  mitarbeiter: number;
};

/* Feiertagsregionen Oesterreich. Die Kennungen folgen ISO 3166-2:AT. */
const REGIONEN: [string, string][] = [
  ["AT-1", "Burgenland"],
  ["AT-2", "Kärnten"],
  ["AT-3", "Niederösterreich"],
  ["AT-4", "Oberösterreich"],
  ["AT-5", "Salzburg"],
  ["AT-6", "Steiermark"],
  ["AT-7", "Tirol"],
  ["AT-8", "Vorarlberg"],
  ["AT-9", "Wien"],
  ["DE", "Deutschland"],
];

/**
 * Arbeitszeitregeln je Standort.
 *
 * Die Zahlen hier steuern die Konfliktpruefung in der Einsatzplanung. Neben
 * jedem Feld steht der gesetzliche Wert — wer bewusst darunter geht, soll
 * das sehen, und wer es versehentlich tut, soll stutzig werden.
 */
export function StandortForm({
  standort,
  gesperrt,
}: {
  standort: StandortWerte;
  gesperrt: boolean;
}) {
  const [state, formAction] = useActionState(saveLocation, INITIAL);
  const id = (f: string) => `st-${standort.id}-${f}`;

  return (
    <form action={formAction} className="rounded-input bg-panel p-4">
      <input type="hidden" name="locationId" value={standort.id} />

      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[14px] font-semibold">{standort.name}</h3>
        <span className="num text-[11.5px] text-faint">
          {standort.mitarbeiter}{" "}
          {standort.mitarbeiter === 1 ? "Mitarbeiter" : "Mitarbeiter"}
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Feld id={id("region")} label="Feiertagsregion" hinweis="steuert den Jahresplaner">
          <select
            id={id("region")}
            name="holidayRegion"
            defaultValue={standort.holidayRegion}
            disabled={gesperrt}
            className={`${feld} w-full`}
          >
            {REGIONEN.map(([wert, text]) => (
              <option key={wert} value={wert}>
                {text}
              </option>
            ))}
          </select>
        </Feld>

        <Zahl
          id={id("min")}
          name="minStaffing"
          label="Mindestbesetzung"
          hinweis="Monteure je Woche"
          value={standort.minStaffing}
          gesperrt={gesperrt}
        />
        <Zahl
          id={id("rest")}
          name="restHours"
          label="Ruhezeit"
          hinweis="gesetzlich 11 h"
          value={standort.restHours}
          step={0.5}
          gesperrt={gesperrt}
        />
        <Zahl
          id={id("daily")}
          name="maxDaily"
          label="Höchstarbeitszeit Tag"
          hinweis="gesetzlich 12 h"
          value={standort.maxDaily}
          step={0.5}
          gesperrt={gesperrt}
        />
        <Zahl
          id={id("weekly")}
          name="maxWeekly"
          label="Höchstarbeitszeit Woche"
          hinweis="gesetzlich 60 h"
          value={standort.maxWeekly}
          step={0.5}
          gesperrt={gesperrt}
        />
        <Zahl
          id={id("bafter")}
          name="breakAfterMin"
          label="Pause fällig nach"
          hinweis="Minuten, gesetzlich 360"
          value={standort.breakAfterMin}
          gesperrt={gesperrt}
        />
        <Zahl
          id={id("bmin")}
          name="breakMin"
          label="Pausendauer"
          hinweis="Minuten, gesetzlich 30"
          value={standort.breakMin}
          gesperrt={gesperrt}
        />
      </div>

      {!gesperrt ? (
        <div className="mt-4">
          <Submit label="Standort speichern" />
        </div>
      ) : null}
      <Meldung state={state} />
    </form>
  );
}

function Feld({
  id,
  label,
  hinweis,
  children,
}: {
  id: string;
  label: string;
  hinweis: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-[4px]">
      <label htmlFor={id} className="text-[11.5px] font-medium text-muted">
        {label}
      </label>
      {children}
      <span className="text-[10.5px] text-faint">{hinweis}</span>
    </div>
  );
}

function Zahl({
  id,
  name,
  label,
  hinweis,
  value,
  step = 1,
  gesperrt,
}: {
  id: string;
  name: string;
  label: string;
  hinweis: string;
  value: number;
  step?: number;
  gesperrt: boolean;
}) {
  return (
    <Feld id={id} label={label} hinweis={hinweis}>
      <input
        id={id}
        name={name}
        type="number"
        step={step}
        min={0}
        defaultValue={value}
        disabled={gesperrt}
        className={`${feld} num w-full`}
      />
    </Feld>
  );
}

export type ZeitWerte = {
  rundungMin: number;
  pauseAbMin: number;
  pauseAbzugMin: number;
  abendAb: string;
  nachtAb: string;
  nachtBis: string;
  zuschlagAbendPct: number;
  zuschlagNachtPct: number;
  zuschlagSamstagPct: number;
  zuschlagSonntagPct: number;
  zuschlagFeiertagPct: number;
};

/**
 * Zeiterfassungsregeln des Betriebs.
 *
 * Bewusst mit ausgeschriebenen Erklärungen: das sind die Stellschrauben,
 * an denen ein Betrieb sich vertut, und die Folge steht am Monatsende auf
 * dem Lohnzettel.
 */
export function ZeitregelnForm({
  werte,
  gesperrt,
}: {
  werte: ZeitWerte;
  gesperrt: boolean;
}) {
  const [state, formAction] = useActionState(saveTimeSettings, INITIAL);

  return (
    <form action={formAction} className="rounded-input bg-panel p-4">
      <h3 className="mb-1 text-[14px] font-semibold">Erfassen und Runden</h3>
      <p className="mb-3 text-[12px] text-muted">
        Gerundet wird kaufmännisch, nicht abwärts — sieben Minuten fallen
        weg, acht werden zur vollen Viertelstunde. Eine Rundung, die immer
        zulasten des Mitarbeiters geht, ist angreifbar.
      </p>

      <div className="grid gap-3 sm:grid-cols-3">
        <Zahl
          id="zr-rundung"
          name="rundungMin"
          label="Rundung je Buchung"
          hinweis="Minuten, 0 = nicht runden"
          value={werte.rundungMin}
          step={5}
          gesperrt={gesperrt}
        />
        <Zahl
          id="zr-pause-ab"
          name="pauseAbMin"
          label="Pause ab"
          hinweis="Minuten Arbeit, 0 = keine Automatik"
          value={werte.pauseAbMin}
          step={30}
          gesperrt={gesperrt}
        />
        <Zahl
          id="zr-pause-abzug"
          name="pauseAbzugMin"
          label="Pausenabzug"
          hinweis="Minuten, selbst gebuchte Pausen zählen an"
          value={werte.pauseAbzugMin}
          step={5}
          gesperrt={gesperrt}
        />
      </div>

      <h3 className="mt-5 mb-1 text-[14px] font-semibold">Zuschläge</h3>
      <p className="mb-3 text-[12px] text-muted">
        Werden ausgewiesen, nicht ausbezahlt — was daraus wird, entscheidet
        der Kollektivvertrag. Der Tagestyp schlägt die Uhrzeit: ein
        Sonntagabend zählt als Sonntag, nicht doppelt.
      </p>

      <div className="grid gap-3 sm:grid-cols-3">
        <Uhrzeit
          id="zr-abend-ab"
          name="abendAb"
          label="Abend ab"
          wert={werte.abendAb}
          gesperrt={gesperrt}
        />
        <Uhrzeit
          id="zr-nacht-ab"
          name="nachtAb"
          label="Nacht ab"
          wert={werte.nachtAb}
          gesperrt={gesperrt}
        />
        <Uhrzeit
          id="zr-nacht-bis"
          name="nachtBis"
          label="Nacht bis"
          wert={werte.nachtBis}
          gesperrt={gesperrt}
        />
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-3 xl:grid-cols-5">
        <Zahl
          id="zr-z-abend"
          name="zuschlagAbendPct"
          label="Abend"
          hinweis="Prozent"
          value={werte.zuschlagAbendPct}
          step={5}
          gesperrt={gesperrt}
        />
        <Zahl
          id="zr-z-nacht"
          name="zuschlagNachtPct"
          label="Nacht"
          hinweis="Prozent"
          value={werte.zuschlagNachtPct}
          step={5}
          gesperrt={gesperrt}
        />
        <Zahl
          id="zr-z-samstag"
          name="zuschlagSamstagPct"
          label="Samstag"
          hinweis="Prozent"
          value={werte.zuschlagSamstagPct}
          step={5}
          gesperrt={gesperrt}
        />
        <Zahl
          id="zr-z-sonntag"
          name="zuschlagSonntagPct"
          label="Sonntag"
          hinweis="Prozent"
          value={werte.zuschlagSonntagPct}
          step={5}
          gesperrt={gesperrt}
        />
        <Zahl
          id="zr-z-feiertag"
          name="zuschlagFeiertagPct"
          label="Feiertag"
          hinweis="Prozent"
          value={werte.zuschlagFeiertagPct}
          step={5}
          gesperrt={gesperrt}
        />
      </div>

      {gesperrt ? null : (
        <div className="mt-4">
          <Submit label="Zeitregeln speichern" />
        </div>
      )}
      <Meldung state={state} />
    </form>
  );
}

function Uhrzeit({
  id,
  name,
  label,
  wert,
  gesperrt,
}: {
  id: string;
  name: string;
  label: string;
  wert: string;
  gesperrt: boolean;
}) {
  return (
    <Feld id={id} label={label} hinweis="Ortszeit">
      <input
        id={id}
        name={name}
        type="time"
        defaultValue={wert}
        disabled={gesperrt}
        className={`${feld} num w-full`}
      />
    </Feld>
  );
}
