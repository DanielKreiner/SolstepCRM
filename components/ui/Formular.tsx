"use client";

import { useActionState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";

/*
 * Formularbausteine.
 *
 * Bisher schrieb jede Seite Label, Feld, Fehlermeldung und Absendeknopf neu
 * aus. Das ist die Stelle, an der Abstände, Radien und — schlimmer — das
 * Verhalten bei Fehlern auseinanderlaufen.
 *
 * `htmlFor`/`id` sind Pflicht und werden hier erzwungen: ein <label>, das
 * ein <select> umschließt, zieht die Optionstexte in den zugänglichen Namen
 * und macht das Feld für Screenreader unbrauchbar.
 */

export type AktionsStatus = { error: string | null; ok: string | null };
export const LEER: AktionsStatus = { error: null, ok: null };

const FELD =
  "w-full rounded-input border border-transparent bg-sunk px-[13px] py-[10px] text-[13.5px] text-ink outline-0 " +
  "focus:border-accent focus:bg-surface disabled:cursor-not-allowed disabled:opacity-60";

export function Meldung({ status }: { status: AktionsStatus }) {
  if (status.error) {
    return (
      <p
        role="alert"
        className="mt-3 rounded-input bg-s-crit/10 px-[13px] py-[10px] text-[12.5px] font-medium text-s-crit"
      >
        {status.error}
      </p>
    );
  }
  if (status.ok) {
    return (
      <p
        role="status"
        className="mt-3 rounded-input bg-s-done/10 px-[13px] py-[10px] text-[12.5px] font-medium text-s-done"
      >
        {status.ok}
      </p>
    );
  }
  return null;
}

export function Absenden({
  label,
  busy = "Wird gespeichert …",
  variante = "primary",
  block = false,
}: {
  label: string;
  busy?: string;
  variante?: "primary" | "quiet" | "gefahr";
  block?: boolean;
}) {
  const { pending } = useFormStatus();

  const stil =
    variante === "primary"
      ? "bg-[linear-gradient(150deg,var(--accent-from),var(--accent-to))] text-white shadow-[0_6px_18px_rgba(201,121,24,0.28)]"
      : variante === "gefahr"
        ? "bg-s-crit/12 text-s-crit hover:bg-s-crit/20"
        : "bg-sunk text-ink hover:bg-line";

  return (
    <button
      type="submit"
      disabled={pending}
      className={[
        "min-h-[44px] cursor-pointer rounded-pill border-0 px-[20px] text-[13.5px] font-semibold",
        "transition-[filter,background-color] duration-200 ease-out-quint",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        "disabled:cursor-not-allowed disabled:opacity-50",
        block ? "w-full" : "",
        stil,
      ].join(" ")}
    >
      {pending ? busy : label}
    </button>
  );
}

/** Label plus Feld plus optionaler Hinweis darunter. */
export function Feld({
  id,
  label,
  hinweis,
  pflicht = false,
  breit = false,
  children,
}: {
  id: string;
  label: string;
  hinweis?: string;
  pflicht?: boolean;
  /** Über die volle Breite des Rasters. */
  breit?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`flex flex-col gap-[5px] ${breit ? "sm:col-span-2" : ""}`}>
      {/*
        Der Pflichtstern steht NEBEN dem Label, nicht darin. Innerhalb des
        <label> gehört er zum Textinhalt — das Feld heisst dann "Name*" statt
        "Name", für Screenreader wie für jeden Test, der es über sein Label
        sucht. aria-hidden hilft dabei nicht, es entfernt den Text nicht.
        Die Pflicht selbst steht im required-Attribut und wird von
        Hilfsmitteln von dort angesagt.
      */}
      <span className="flex items-baseline gap-1">
        <label htmlFor={id} className="text-[12px] font-medium text-muted">
          {label}
        </label>
        {pflicht ? (
          <span aria-hidden className="text-[12px] text-s-crit">
            *
          </span>
        ) : null}
      </span>
      {children}
      {hinweis ? (
        <span className="text-[10.5px] text-faint">{hinweis}</span>
      ) : null}
    </div>
  );
}

type EingabeProps = {
  id: string;
  name: string;
  label: string;
  hinweis?: string;
  pflicht?: boolean;
  breit?: boolean;
  typ?: "text" | "email" | "tel" | "number" | "date" | "time" | "datetime-local";
  wert?: string | number | null;
  platzhalter?: string;
  schritt?: string;
  gesperrt?: boolean;
  mono?: boolean;
};

export function Eingabe({
  id,
  name,
  label,
  hinweis,
  pflicht = false,
  breit = false,
  typ = "text",
  wert,
  platzhalter,
  schritt,
  gesperrt = false,
  mono = false,
}: EingabeProps) {
  return (
    <Feld id={id} label={label} pflicht={pflicht} breit={breit} {...(hinweis ? { hinweis } : {})}>
      <input
        id={id}
        name={name}
        type={typ}
        required={pflicht}
        disabled={gesperrt}
        defaultValue={wert ?? ""}
        placeholder={platzhalter ?? ""}
        step={schritt ?? undefined}
        className={`${FELD} ${mono || typ === "number" ? "num" : ""}`}
      />
    </Feld>
  );
}

export function Auswahl({
  id,
  name,
  label,
  hinweis,
  pflicht = false,
  breit = false,
  wert,
  gesperrt = false,
  leerText,
  optionen,
}: {
  id: string;
  name: string;
  label: string;
  hinweis?: string;
  pflicht?: boolean;
  breit?: boolean;
  wert?: string | null;
  gesperrt?: boolean;
  /** Erster Eintrag ohne Wert. Fehlt er, ist die Auswahl zwingend. */
  leerText?: string;
  optionen: { wert: string; text: string }[];
}) {
  return (
    <Feld id={id} label={label} pflicht={pflicht} breit={breit} {...(hinweis ? { hinweis } : {})}>
      <select
        id={id}
        name={name}
        required={pflicht}
        disabled={gesperrt}
        defaultValue={wert ?? ""}
        className={`${FELD} cursor-pointer`}
      >
        {leerText ? <option value="">{leerText}</option> : null}
        {optionen.map((o) => (
          <option key={o.wert} value={o.wert}>
            {o.text}
          </option>
        ))}
      </select>
    </Feld>
  );
}

export function Textfeld({
  id,
  name,
  label,
  hinweis,
  wert,
  zeilen = 3,
  platzhalter,
  gesperrt = false,
}: {
  id: string;
  name: string;
  label: string;
  hinweis?: string;
  wert?: string | null;
  zeilen?: number;
  platzhalter?: string;
  gesperrt?: boolean;
}) {
  return (
    <Feld id={id} label={label} breit {...(hinweis ? { hinweis } : {})}>
      <textarea
        id={id}
        name={name}
        rows={zeilen}
        disabled={gesperrt}
        defaultValue={wert ?? ""}
        placeholder={platzhalter ?? ""}
        className={FELD}
      />
    </Feld>
  );
}

/**
 * Formular mit Server Action, Statusmeldung und Absendeknopf.
 *
 * Der Aufrufer gibt nur die Felder — Rahmen, Raster und Fehlerbehandlung
 * kommen von hier.
 */
export function Formular({
  aktion,
  titel,
  hinweis,
  knopf,
  variante = "primary",
  versteckt,
  children,
  /* Nach Erfolg leeren — richtig beim Anlegen, falsch beim Bearbeiten. */
  leerenNachErfolg = false,
}: {
  aktion: (
    prev: AktionsStatus,
    formData: FormData,
  ) => Promise<AktionsStatus>;
  titel?: string;
  hinweis?: string;
  knopf: string;
  variante?: "primary" | "quiet" | "gefahr";
  versteckt?: Record<string, string>;
  children: ReactNode;
  leerenNachErfolg?: boolean;
}) {
  const [status, formAction] = useActionState(aktion, LEER);

  return (
    <form
      action={formAction}
      /*
       * key erzwingt nach Erfolg ein frisches Formular. Ohne das bleibt beim
       * Anlegen der letzte Datensatz in den Feldern stehen und der nächste
       * Eintrag entsteht als versehentliche Kopie.
       */
      key={leerenNachErfolg && status.ok ? status.ok : undefined}
      className="rounded-[20px] bg-surface p-5 shadow-soft"
    >
      {titel ? (
        <h2 className="text-[15px] font-semibold">{titel}</h2>
      ) : null}
      {hinweis ? (
        <p className="mt-1 mb-4 text-[12.5px] text-muted">{hinweis}</p>
      ) : (
        <div className="mb-4" />
      )}

      {Object.entries(versteckt ?? {}).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}

      <div className="grid gap-3 sm:grid-cols-2">{children}</div>

      <div className="mt-4">
        <Absenden label={knopf} variante={variante} />
      </div>

      <Meldung status={status} />
    </form>
  );
}

/**
 * Knopf, der eine Aktion ohne Eingabefelder auslöst — löschen, freigeben,
 * abschließen. Braucht einen Bestätigungstext, wenn er etwas zerstört.
 */
export function AktionsKnopf({
  aktion,
  label,
  versteckt,
  variante = "quiet",
  bestaetigung,
}: {
  aktion: (
    prev: AktionsStatus,
    formData: FormData,
  ) => Promise<AktionsStatus>;
  label: string;
  versteckt: Record<string, string>;
  variante?: "primary" | "quiet" | "gefahr";
  bestaetigung?: string;
}) {
  const [status, formAction] = useActionState(aktion, LEER);

  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (bestaetigung && !window.confirm(bestaetigung)) e.preventDefault();
      }}
    >
      {Object.entries(versteckt).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <Absenden label={label} variante={variante} busy="…" />
      <Meldung status={status} />
    </form>
  );
}
