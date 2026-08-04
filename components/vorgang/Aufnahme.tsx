"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { LEER, Meldung, type AktionsStatus } from "@/components/ui/Formular";
import { Pill } from "@/components/ui/Pill";
import {
  aufnahmeAbschliessen,
  aufnahmeStarten,
  punktBeantworten,
  punktErgaenzen,
  punktWeg,
} from "@/app/(app)/vorgaenge/checkliste-actions";
import { CHECKLISTE_TYPEN as TYPEN } from "@/lib/vorgang/checkliste";

/**
 * Die Aufnahme vor Ort.
 *
 * Der Vertriebler steht auf dem Dach und hat ein Telefon in der Hand.
 * Deshalb: ein Punkt je Zeile, grosse Flächen, und was er eintippt oder
 * fotografiert, geht sofort weg — kein Sammelformular, das man am Ende
 * abschickt und bei schlechtem Empfang verliert.
 */

export type AufnahmePunkt = {
  id: string;
  label: string;
  hinweis: string | null;
  typ: string;
  pflicht: boolean;
  eigen: boolean;
  sort: number;
  wertText: string | null;
  wertZahl: number | null;
  erledigtAm: string | null;
  anhaenge: { id: string; name: string; url: string | null; istBild: boolean }[];
};

export type Aufnahme = {
  id: string;
  name: string;
  abgeschlossenAm: string | null;
  punkte: AufnahmePunkt[];
};

export function AufnahmeBlock({
  vorgangId,
  aufnahme,
  darfSchreiben,
}: {
  vorgangId: string;
  aufnahme: Aufnahme | null;
  darfSchreiben: boolean;
}) {
  if (!aufnahme) {
    return <NochNicht vorgangId={vorgangId} darfSchreiben={darfSchreiben} />;
  }

  const erledigt = aufnahme.punkte.filter((p) => p.erledigtAm !== null).length;
  const offenePflicht = aufnahme.punkte.filter(
    (p) => p.pflicht && p.erledigtAm === null,
  ).length;

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-[20px] bg-surface p-5 shadow-soft">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="mr-auto text-[15px] font-semibold">{aufnahme.name}</h2>
          {aufnahme.abgeschlossenAm ? (
            <Pill tone="done">abgeschlossen</Pill>
          ) : offenePflicht > 0 ? (
            <Pill tone="warn">
              {offenePflicht} {offenePflicht === 1 ? "Pflicht offen" : "Pflichten offen"}
            </Pill>
          ) : (
            <Pill tone="doing">bereit zum Abschluss</Pill>
          )}
          <span className="num text-[12px] text-faint">
            {erledigt} von {aufnahme.punkte.length}
          </span>
        </div>

        {/* Fortschritt als Balken — auf dem Dach reicht ein Blick. */}
        <div className="mt-3 flex gap-1" aria-hidden>
          {aufnahme.punkte.map((p) => (
            <span
              key={p.id}
              className={[
                "h-[5px] flex-1 rounded-pill",
                p.erledigtAm
                  ? "bg-s-done"
                  : p.pflicht
                    ? "bg-s-warn/50"
                    : "bg-line",
              ].join(" ")}
            />
          ))}
        </div>

        {!aufnahme.abgeschlossenAm && darfSchreiben ? (
          <Abschluss vorgangId={vorgangId} checklisteId={aufnahme.id} />
        ) : null}
      </section>

      <ul className="flex flex-col gap-2">
        {aufnahme.punkte.map((p) => (
          <PunktZeile
            key={p.id}
            vorgangId={vorgangId}
            punkt={p}
            gesperrt={!darfSchreiben || aufnahme.abgeschlossenAm !== null}
          />
        ))}
      </ul>

      {darfSchreiben && !aufnahme.abgeschlossenAm ? (
        <ErgaenzenForm vorgangId={vorgangId} checklisteId={aufnahme.id} />
      ) : null}
    </div>
  );
}

function NochNicht({
  vorgangId,
  darfSchreiben,
}: {
  vorgangId: string;
  darfSchreiben: boolean;
}) {
  const [status, formAction] = useActionState<AktionsStatus, FormData>(
    aufnahmeStarten,
    LEER,
  );

  return (
    <section className="rounded-[20px] bg-surface p-6 shadow-soft">
      <h2 className="text-[16px] font-bold tracking-[-0.02em]">
        Aufnahme vor Ort
      </h2>
      <p className="mt-2 mb-4 max-w-[560px] text-[13.5px] text-muted">
        Zählerart, Ziegelform, Sparrenabstand, Verschattung — was hier nicht
        festgehalten wird, führt zur zweiten Anfahrt. Die Punkte kommen aus
        der Vorlage des Betriebs; eigene lassen sich jederzeit ergänzen.
      </p>

      {darfSchreiben ? (
        <form action={formAction}>
          <input type="hidden" name="vorgangId" value={vorgangId} />
          <Gross label="Aufnahme starten" />
          <Meldung status={status} />
        </form>
      ) : (
        <p className="text-[13px] text-faint">
          Für Vorgänge fehlt deiner Rolle das Schreibrecht.
        </p>
      )}
    </section>
  );
}

function PunktZeile({
  vorgangId,
  punkt,
  gesperrt,
}: {
  vorgangId: string;
  punkt: AufnahmePunkt;
  gesperrt: boolean;
}) {
  const [status, formAction] = useActionState<AktionsStatus, FormData>(
    punktBeantworten,
    LEER,
  );
  const [wegStatus, wegAction] = useActionState<AktionsStatus, FormData>(
    punktWeg,
    LEER,
  );
  const fertig = punkt.erledigtAm !== null;

  return (
    <li
      className={[
        "rounded-input border bg-surface px-4 py-[13px] transition-colors",
        fertig ? "border-s-done/30 bg-s-done/5" : "border-line",
      ].join(" ")}
    >
      <div className="flex flex-wrap items-start gap-2">
        <span
          aria-hidden
          className={[
            "mt-[2px] grid h-[20px] w-[20px] shrink-0 place-items-center rounded-[6px] border-2 text-[11px] font-bold",
            fertig
              ? "border-s-done bg-s-done text-white"
              : punkt.pflicht
                ? "border-s-warn"
                : "border-line-strong",
          ].join(" ")}
        >
          {fertig ? "✓" : ""}
        </span>

        <span className="min-w-0 flex-1">
          <span className="block text-[13.5px] font-medium">
            {punkt.label}
            {punkt.pflicht ? (
              <span className="ml-2 text-[11px] font-semibold text-accent-ink">
                Pflicht
              </span>
            ) : null}
            {punkt.eigen ? (
              <span className="ml-2 rounded-pill bg-sunk px-[7px] py-px text-[10px] text-muted">
                eigener Punkt
              </span>
            ) : null}
          </span>
          {punkt.hinweis ? (
            <span className="block text-[12px] text-muted">{punkt.hinweis}</span>
          ) : null}
        </span>

        {punkt.eigen && !gesperrt ? (
          <form action={wegAction}>
            <input type="hidden" name="vorgangId" value={vorgangId} />
            <input type="hidden" name="punktId" value={punkt.id} />
            <button
              type="submit"
              aria-label={`${punkt.label} entfernen`}
              className="cursor-pointer rounded-pill border border-line bg-surface px-[9px] py-[3px] text-[11px] text-faint transition-colors hover:border-s-crit hover:text-s-crit"
            >
              ✕
            </button>
          </form>
        ) : null}
      </div>

      {/* Was schon dasteht. */}
      {punkt.wertText || punkt.wertZahl !== null ? (
        <p className="num mt-2 ml-[28px] text-[13px]">
          {punkt.wertText}
          {punkt.wertZahl !== null ? ` ${punkt.wertZahl}` : ""}
        </p>
      ) : null}

      {punkt.anhaenge.length > 0 ? (
        <ul className="mt-2 ml-[28px] flex flex-wrap gap-2">
          {punkt.anhaenge.map((a) =>
            a.istBild && a.url ? (
              <li key={a.id}>
                <a href={a.url} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={a.url}
                    alt={a.name}
                    loading="lazy"
                    className="h-[76px] w-[76px] rounded-card bg-panel object-cover"
                  />
                </a>
              </li>
            ) : (
              <li key={a.id}>
                <a
                  href={a.url ?? "#"}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-block rounded-input bg-panel px-3 py-2 text-[12px] font-medium text-accent-ink underline"
                >
                  {a.name}
                </a>
              </li>
            ),
          )}
        </ul>
      ) : null}

      {!gesperrt ? (
        <form action={formAction} className="mt-3 ml-[28px] flex flex-wrap items-end gap-2">
          <input type="hidden" name="vorgangId" value={vorgangId} />
          <input type="hidden" name="punktId" value={punkt.id} />

          {punkt.typ === "text" ? (
            <input
              name="wertText"
              defaultValue={punkt.wertText ?? ""}
              placeholder="Angabe"
              className="min-w-[180px] flex-1 rounded-input border border-line bg-surface px-[13px] py-[10px] text-[13.5px] outline-0 focus:border-accent"
            />
          ) : null}

          {punkt.typ === "zahl" ? (
            <input
              name="wertZahl"
              type="number"
              step="0.001"
              defaultValue={punkt.wertZahl ?? ""}
              placeholder="0"
              className="num w-[140px] rounded-input border border-line bg-surface px-[13px] py-[10px] text-[13.5px] outline-0 focus:border-accent"
            />
          ) : null}

          {punkt.typ === "foto" || punkt.typ === "datei" ? (
            <input
              type="file"
              name="anhang"
              multiple
              /*
               * capture nur beim Foto: das öffnet am Telefon direkt die
               * Kamera. Bei einem PDF wäre das genau falsch.
               */
              {...(punkt.typ === "foto"
                ? { accept: "image/*", capture: "environment" as const }
                : { accept: ".pdf,image/*" })}
              className="min-w-0 flex-1 text-[12.5px] file:mr-3 file:cursor-pointer file:rounded-pill file:border-0 file:bg-sunk file:px-4 file:py-[9px] file:text-[12.5px] file:font-medium"
            />
          ) : null}

          {punkt.typ === "haken" && fertig ? (
            <input type="hidden" name="erledigt" value="nein" />
          ) : (
            <input type="hidden" name="erledigt" value="ja" />
          )}

          <Klein
            label={
              punkt.typ === "haken"
                ? fertig
                  ? "Haken weg"
                  : "Erledigt"
                : "Speichern"
            }
            ton={punkt.typ === "haken" && fertig ? "leise" : "voll"}
          />
          <Meldung status={status} />
        </form>
      ) : null}

      <Meldung status={wegStatus} />
    </li>
  );
}

function ErgaenzenForm({
  vorgangId,
  checklisteId,
}: {
  vorgangId: string;
  checklisteId: string;
}) {
  const [status, formAction] = useActionState<AktionsStatus, FormData>(
    punktErgaenzen,
    LEER,
  );
  const [offen, setOffen] = useState(false);

  if (!offen) {
    return (
      <button
        type="button"
        onClick={() => setOffen(true)}
        className="cursor-pointer self-start rounded-pill border border-line bg-surface px-[18px] py-[10px] text-[13px] font-medium text-ink transition-colors hover:bg-sunk"
      >
        + Eigenen Punkt ergänzen
      </button>
    );
  }

  return (
    <form
      action={formAction}
      key={status.ok ?? "leer"}
      className="rounded-[20px] bg-surface p-5 shadow-soft"
    >
      <h3 className="mb-1 text-[14px] font-semibold">Eigener Punkt</h3>
      <p className="mb-3 text-[12px] text-muted">
        Nur für diesen Vorgang — „Nachbar hat Einwände“, „Kranstellplatz
        klären“. Wer ihn immer braucht, legt ihn in den Einstellungen an.
      </p>

      <input type="hidden" name="vorgangId" value={vorgangId} />
      <input type="hidden" name="checklisteId" value={checklisteId} />

      <div className="grid gap-2 sm:grid-cols-6">
        <div className="sm:col-span-4">
          <input
            name="label"
            required
            placeholder="Worum geht es?"
            className="w-full rounded-input border border-line bg-surface px-[13px] py-[10px] text-[13.5px] outline-0 focus:border-accent"
          />
        </div>
        <div className="sm:col-span-2">
          <select
            name="typ"
            defaultValue="haken"
            className="w-full rounded-input border border-line bg-surface px-[13px] py-[10px] text-[13.5px] outline-0 focus:border-accent"
          >
            {TYPEN.map(([wert, label]) => (
              <option key={wert} value={wert}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-6">
          <input
            name="hinweis"
            placeholder="Hinweis — optional"
            className="w-full rounded-input border border-line bg-surface px-[13px] py-[10px] text-[13.5px] outline-0 focus:border-accent"
          />
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Klein label="Ergänzen" ton="voll" />
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

function Abschluss({
  vorgangId,
  checklisteId,
}: {
  vorgangId: string;
  checklisteId: string;
}) {
  const [status, formAction] = useActionState<AktionsStatus, FormData>(
    aufnahmeAbschliessen,
    LEER,
  );

  return (
    <form action={formAction} className="mt-4 border-t border-line pt-4">
      <input type="hidden" name="vorgangId" value={vorgangId} />
      <input type="hidden" name="checklisteId" value={checklisteId} />
      <Klein label="Aufnahme abschliessen" ton="voll" />
      <Meldung status={status} />
    </form>
  );
}

function Klein({ label, ton }: { label: string; ton: "voll" | "leise" }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={[
        "min-h-[40px] cursor-pointer rounded-pill px-[18px] text-[13px] font-semibold disabled:opacity-60",
        ton === "voll"
          ? "border-0 bg-ink text-app"
          : "border border-line bg-surface text-muted",
      ].join(" ")}
    >
      {pending ? "…" : label}
    </button>
  );
}

function Gross({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="min-h-[48px] cursor-pointer rounded-pill border-0 bg-[linear-gradient(150deg,var(--accent-from),var(--accent-to))] px-7 text-[14px] font-semibold text-white shadow-[0_8px_22px_rgba(201,121,24,0.28)] disabled:opacity-60"
    >
      {pending ? "…" : label}
    </button>
  );
}
