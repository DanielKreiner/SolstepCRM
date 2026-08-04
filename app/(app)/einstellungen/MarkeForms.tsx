"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { logoEntfernen, markeSpeichern, type MarkeState } from "./marke-actions";
import {
  punktAendern,
  punktAnlegen,
  punktLoeschen,
  punktSchieben,
  type ChecklisteState,
} from "./checkliste-actions";
import { CHECKLISTE_TYPEN as TYPEN } from "@/lib/vorgang/checkliste";

const LEER = { error: null, ok: null };

function Meldung({ status }: { status: { error: string | null; ok: string | null } }) {
  if (!status.error && !status.ok) return null;
  return (
    <p
      role="status"
      className={[
        "mt-2 text-[12.5px]",
        status.error ? "text-s-crit" : "text-s-done",
      ].join(" ")}
    >
      {status.error ?? status.ok}
    </p>
  );
}

function Absenden({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="min-h-[40px] cursor-pointer rounded-pill border-0 bg-ink px-[20px] text-[13px] font-semibold text-app disabled:opacity-60"
    >
      {pending ? "…" : label}
    </button>
  );
}

/* ================================================== ERSCHEINUNGSBILD */

const FARBEN = [
  ["#E8952B", "Bernstein"],
  ["#2F7D4F", "Grün"],
  ["#2B6CB0", "Blau"],
  ["#B4453A", "Rot"],
  ["#5B4B8A", "Violett"],
  ["#1D1917", "Anthrazit"],
] as const;

/**
 * Logo, Farbe und Fusszeile des Betriebs.
 *
 * Für den Kunden ist eine Mail Post von seinem Elektriker und nicht von
 * dieser Software. Was hier steht, gilt für Mail und PDF gleichermassen
 * (CLAUDE.md 6.4) — eine Marke, eine Ablage.
 */
export function MarkeForm({
  logoUrl,
  akzent,
  fusszeile,
  firma,
}: {
  logoUrl: string | null;
  akzent: string;
  fusszeile: string;
  firma: string;
}) {
  const [status, formAction] = useActionState<MarkeState, FormData>(
    markeSpeichern,
    LEER,
  );
  const [wegStatus, wegAction] = useActionState<MarkeState, FormData>(
    logoEntfernen,
    LEER,
  );
  const [farbe, setFarbe] = useState(akzent || "#E8952B");
  const [fuss, setFuss] = useState(fusszeile);

  return (
    <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr] lg:items-start">
      <form action={formAction}>
        <p className="mb-1 text-[11px] font-semibold tracking-[0.08em] text-muted uppercase">
          Logo
        </p>
        <p className="mb-3 text-[12.5px] text-muted">
          PNG, JPG oder WEBP, höchstens 2 MB. Kein SVG — Outlook zeigt es
          nicht an. Das Logo liegt öffentlich, weil Mailprogramme Bilder
          ohne Anmeldung laden; im Ablageort steht nichts anderes.
        </p>

        <div className="mb-4 flex flex-wrap items-center gap-3">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logoUrl}
              alt={`Logo ${firma}`}
              className="h-[46px] w-auto rounded-input bg-panel px-3 py-1"
            />
          ) : (
            <span className="rounded-input bg-panel px-4 py-3 text-[13px] text-faint">
              Noch kein Logo — Mails tragen den Firmennamen als Schrift.
            </span>
          )}
        </div>

        <input
          type="file"
          name="logo"
          accept="image/png,image/jpeg,image/webp"
          className="mb-4 block w-full text-[12.5px] file:mr-3 file:cursor-pointer file:rounded-pill file:border-0 file:bg-sunk file:px-4 file:py-2 file:text-[12.5px] file:font-medium"
        />

        <p className="mb-1 text-[11px] font-semibold tracking-[0.08em] text-muted uppercase">
          Akzentfarbe
        </p>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          {FARBEN.map(([wert, name]) => (
            <button
              key={wert}
              type="button"
              onClick={() => setFarbe(wert)}
              aria-label={name}
              aria-pressed={farbe.toLowerCase() === wert.toLowerCase()}
              title={name}
              style={{ background: wert }}
              className={[
                "h-[30px] w-[30px] cursor-pointer rounded-pill border-2 transition-transform",
                farbe.toLowerCase() === wert.toLowerCase()
                  ? "scale-110 border-ink"
                  : "border-transparent",
              ].join(" ")}
            />
          ))}
          <input
            name="akzent"
            value={farbe}
            onChange={(e) => setFarbe(e.target.value)}
            className="num w-[110px] rounded-input border border-line bg-surface px-[11px] py-[7px] text-[12.5px] outline-0 focus:border-accent"
          />
        </div>

        <p className="mt-4 mb-1 text-[11px] font-semibold tracking-[0.08em] text-muted uppercase">
          Fusszeile
        </p>
        <input
          name="fusszeile"
          value={fuss}
          onChange={(e) => setFuss(e.target.value)}
          placeholder={`${firma} · Adresse · Telefon`}
          className="w-full rounded-input border border-line bg-surface px-[13px] py-[10px] text-[13px] outline-0 focus:border-accent"
        />
        <p className="mt-1 text-[11.5px] text-faint">
          Steht klein unter jeder Mail. Leer lassen heisst: Firmenname und Ort.
        </p>

        <div className="mt-4">
          <Absenden label="Speichern" />
        </div>
        <Meldung status={status} />
      </form>

      {/* --------------------------------------------------- VORSCHAU */}
      <div>
        <p className="mb-2 text-[11px] font-semibold tracking-[0.08em] text-muted uppercase">
          So sieht eine Mail aus
        </p>
        <div className="rounded-panel bg-app p-4">
          <div className="rounded-card bg-white p-5">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt="" className="h-[34px] w-auto" />
            ) : (
              <span className="text-[16px] font-bold tracking-[-0.02em] text-[#151210]">
                {firma}
              </span>
            )}
            <div
              className="mt-3 h-[3px] w-[40px] rounded-pill"
              style={{ background: farbe }}
            />
            <p className="mt-4 text-[13px] leading-[1.55] text-[#151210]">
              Guten Tag Frau Brandstätter,
            </p>
            <p className="mt-2 text-[13px] leading-[1.55] text-[#151210]">
              Ihr Angebot ist fertig. Sie können es in Ihrem Kundenportal
              ansehen und dort auch direkt annehmen.
            </p>
            <span
              className="mt-4 inline-block rounded-pill px-[20px] py-[10px] text-[13px] font-semibold text-white"
              style={{ background: farbe }}
            >
              Angebot ansehen
            </span>
            <p className="mt-4 text-[12px] text-[#6A625A]">
              Freundliche Grüße
              <br />
              {firma}
            </p>
            {fuss ? (
              <p className="mt-3 border-t border-[#EAE4DC] pt-3 text-[10.5px] text-[#9C9289]">
                {fuss}
              </p>
            ) : null}
          </div>
        </div>

        {logoUrl ? (
          <form action={wegAction} className="mt-3">
            <button
              type="submit"
              className="cursor-pointer border-0 bg-transparent text-[12px] text-s-crit underline"
            >
              Logo entfernen
            </button>
            <Meldung status={wegStatus} />
          </form>
        ) : null}
      </div>
    </div>
  );
}

/* ====================================================== CHECKLISTEN */

export type PunktZeile = {
  id: string;
  label: string;
  hinweis: string | null;
  typ: string;
  pflicht: boolean;
  sort: number;
};

/**
 * Die Punkte der Aufnahme vor Ort.
 *
 * Jeder Betrieb schaut auf etwas anderes: der eine baut nur auf Ziegel,
 * der nächste hat Blechdächer und braucht die Falzbreite. Eine feste
 * Liste im Code wäre für die Hälfte der Betriebe falsch.
 */
export function ChecklisteForm({
  vorlageId,
  punkte,
}: {
  vorlageId: string | null;
  punkte: PunktZeile[];
}) {
  const [status, formAction] = useActionState<ChecklisteState, FormData>(
    punktAnlegen,
    LEER,
  );
  const [schiebStatus, schiebAction] = useActionState<ChecklisteState, FormData>(
    punktSchieben,
    LEER,
  );
  const [wegStatus, wegAction] = useActionState<ChecklisteState, FormData>(
    punktLoeschen,
    LEER,
  );
  const [bearbeitet, setBearbeitet] = useState<string | null>(null);

  if (!vorlageId) {
    return (
      <p className="rounded-input bg-panel px-4 py-3 text-[13px] text-muted">
        Für diesen Mandanten ist noch keine Checkliste angelegt.
      </p>
    );
  }

  return (
    <>
      <p className="-mt-1 mb-4 text-[12.5px] text-muted">
        Diese Punkte bekommt der Vertrieb bei jeder neuen Aufnahme vorgelegt.
        Am einzelnen Vorgang kann er weitere ergänzen. Änderungen hier gelten
        ab der nächsten Aufnahme — laufende bleiben, wie sie sind.
      </p>

      <ul className="mb-4 flex flex-col gap-2">
        {punkte.map((p, i) => (
          <li key={p.id} className="rounded-input bg-panel">
            <div className="flex flex-wrap items-center gap-2 px-3 py-[10px]">
              <span className="num w-[26px] shrink-0 text-[11px] text-faint">
                {i + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-medium">
                  {p.label}
                  {p.pflicht ? (
                    <span className="ml-2 rounded-pill bg-s-warn/14 px-[7px] py-px text-[10px] font-semibold text-accent-ink">
                      Pflicht
                    </span>
                  ) : null}
                </span>
                {p.hinweis ? (
                  <span className="block truncate text-[11.5px] text-faint">
                    {p.hinweis}
                  </span>
                ) : null}
              </span>

              <span className="shrink-0 rounded-pill bg-sunk px-[9px] py-[3px] text-[10.5px] font-medium text-muted">
                {TYPEN.find(([w]) => w === p.typ)?.[1] ?? p.typ}
              </span>

              <form action={schiebAction} className="shrink-0">
                <input type="hidden" name="punktId" value={p.id} />
                <input type="hidden" name="richtung" value="hoch" />
                <Pfeil label={`${p.label} nach oben`}>↑</Pfeil>
              </form>
              <form action={schiebAction} className="shrink-0">
                <input type="hidden" name="punktId" value={p.id} />
                <input type="hidden" name="richtung" value="runter" />
                <Pfeil label={`${p.label} nach unten`}>↓</Pfeil>
              </form>

              <button
                type="button"
                onClick={() => setBearbeitet(bearbeitet === p.id ? null : p.id)}
                className="shrink-0 cursor-pointer rounded-pill border border-line bg-surface px-[11px] py-[4px] text-[11.5px] font-medium"
              >
                {bearbeitet === p.id ? "Fertig" : "Ändern"}
              </button>

              <form action={wegAction} className="shrink-0">
                <input type="hidden" name="punktId" value={p.id} />
                <button
                  type="submit"
                  aria-label={`${p.label} entfernen`}
                  className="cursor-pointer rounded-pill border border-line bg-surface px-[9px] py-[4px] text-[11px] text-faint transition-colors hover:border-s-crit hover:text-s-crit"
                >
                  ✕
                </button>
              </form>
            </div>

            {bearbeitet === p.id ? (
              <PunktAendern punkt={p} schliessen={() => setBearbeitet(null)} />
            ) : null}
          </li>
        ))}
      </ul>

      <Meldung status={schiebStatus} />
      <Meldung status={wegStatus} />

      <form
        action={formAction}
        key={status.ok ?? "leer"}
        className="rounded-input bg-panel p-4"
      >
        <h3 className="mb-3 text-[13px] font-semibold">Punkt hinzufügen</h3>
        <input type="hidden" name="vorlageId" value={vorlageId} />

        <div className="grid gap-2 sm:grid-cols-6">
          <Feld name="label" label="Punkt" spalten="sm:col-span-3" pflicht />
          <div className="sm:col-span-2">
            <Klein>Art</Klein>
            <select
              name="typ"
              defaultValue="haken"
              className="w-full rounded-input border border-line bg-surface px-[11px] py-[9px] text-[13px] outline-0 focus:border-accent"
            >
              {TYPEN.map(([wert, label]) => (
                <option key={wert} value={wert}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <label className="flex items-end gap-2 pb-2 text-[12px] sm:col-span-1">
            <input
              type="checkbox"
              name="pflicht"
              value="ja"
              className="h-4 w-4 accent-[var(--accent)]"
            />
            Pflicht
          </label>
          <Feld name="hinweis" label="Hinweis — optional" spalten="sm:col-span-6" />
        </div>

        <div className="mt-3">
          <Absenden label="Hinzufügen" />
        </div>
        <Meldung status={status} />
      </form>
    </>
  );
}

function PunktAendern({
  punkt,
  schliessen,
}: {
  punkt: PunktZeile;
  schliessen: () => void;
}) {
  const [status, formAction] = useActionState<ChecklisteState, FormData>(
    punktAendern,
    LEER,
  );

  return (
    <form action={formAction} className="border-t border-line px-3 py-3">
      <input type="hidden" name="punktId" value={punkt.id} />
      <div className="grid gap-2 sm:grid-cols-6">
        <Feld
          name="label"
          label="Punkt"
          wert={punkt.label}
          spalten="sm:col-span-3"
          pflicht
        />
        <div className="sm:col-span-2">
          <Klein>Art</Klein>
          <select
            name="typ"
            defaultValue={punkt.typ}
            className="w-full rounded-input border border-line bg-surface px-[11px] py-[9px] text-[13px] outline-0 focus:border-accent"
          >
            {TYPEN.map(([wert, label]) => (
              <option key={wert} value={wert}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <label className="flex items-end gap-2 pb-2 text-[12px] sm:col-span-1">
          <input
            type="checkbox"
            name="pflicht"
            value="ja"
            defaultChecked={punkt.pflicht}
            className="h-4 w-4 accent-[var(--accent)]"
          />
          Pflicht
        </label>
        <Feld
          name="hinweis"
          label="Hinweis"
          wert={punkt.hinweis ?? ""}
          spalten="sm:col-span-6"
        />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Absenden label="Speichern" />
        <button
          type="button"
          onClick={schliessen}
          className="cursor-pointer border-0 bg-transparent text-[12px] text-muted underline"
        >
          Schliessen
        </button>
      </div>
      <Meldung status={status} />
    </form>
  );
}

function Pfeil({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <button
      type="submit"
      aria-label={label}
      className="cursor-pointer rounded-pill border border-line bg-surface px-[9px] py-[4px] text-[11px] text-muted transition-colors hover:text-ink"
    >
      {children}
    </button>
  );
}

function Klein({ children }: { children: React.ReactNode }) {
  return (
    <span className="mb-[5px] block text-[11.5px] font-medium text-muted">
      {children}
    </span>
  );
}

function Feld({
  name,
  label,
  wert = "",
  spalten = "",
  pflicht = false,
}: {
  name: string;
  label: string;
  wert?: string;
  spalten?: string;
  pflicht?: boolean;
}) {
  return (
    <div className={spalten}>
      <Klein>{label}</Klein>
      <input
        name={name}
        defaultValue={wert}
        required={pflicht}
        className="w-full rounded-input border border-line bg-surface px-[11px] py-[9px] text-[13px] outline-0 focus:border-accent"
      />
    </div>
  );
}
