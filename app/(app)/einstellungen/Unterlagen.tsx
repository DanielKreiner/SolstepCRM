"use client";

import { useActionState, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import { Pill } from "@/components/ui/Pill";
import { MAX_BYTES } from "@/lib/bilder/exif";
import { BUCKET_UNTERLAGEN, pruefeUnterlage } from "@/lib/dateien/unterlagen";
import { createClient } from "@/lib/supabase/client";
import type { UnterlagenState } from "./unterlagen-actions";

/*
 * Was der Betrieb beim Start beisteuern muss — Dateien, Angaben,
 * Entscheidungen.
 *
 * Die Liste daneben (Einrichtung.tsx) zeigt, was der Betrieb selbst
 * einstellen kann. Hier steht das Gegenstück: die Punkte, bei denen wir
 * auf ihn warten. Beides auf einem Bildschirm, damit es nur einen Ort
 * gibt, an dem „was fehlt noch" beantwortet wird.
 *
 * Jeder Punkt trägt seinen Grund mit. Ohne ihn ist „Kundenstamm" eine
 * Aufgabe; mit ihm ist es eine, die man versteht.
 */

const INITIAL: UnterlagenState = { error: null, ok: null };

/*
 * Die Aktionen kommen als Eigenschaften herein und werden nicht
 * importiert.
 *
 * Denselben Bildschirm gibt es zweimal: in den Einstellungen für den
 * angemeldeten Betrieb, und hinter einem signierten Link für jemanden
 * ohne Konto. Die Datenwege dahinter sind völlig verschieden — einmal
 * unter RLS, einmal über den Service-Role-Client mit festem Mandanten —,
 * das Formular ist dasselbe. Zwei Abschriften davon wären zwei Formulare,
 * die nach der ersten Änderung auseinanderlaufen.
 */
export type UnterlagenAktionen = {
  speichern: (prev: UnterlagenState, formData: FormData) => Promise<UnterlagenState>;
  entfaellt: (prev: UnterlagenState, formData: FormData) => Promise<UnterlagenState>;
  dateiZiel: (
    punktId: string,
    dateiname: string,
    mime: string,
    groesse: number,
  ) => Promise<{ pfad: string; token: string } | { fehler: string }>;
  dateiVermerken: (daten: {
    punktId: string;
    pfad: string;
    dateiname: string;
    mime: string;
    groesse: number;
  }) => Promise<UnterlagenState>;
  dateiEntfernen: (
    prev: UnterlagenState,
    formData: FormData,
  ) => Promise<UnterlagenState>;
};

const feld =
  "w-full rounded-input border border-transparent bg-sunk px-[11px] py-[8px] text-[13.5px] text-ink outline-0 focus:border-accent focus:bg-surface";

export type UnterlagenDatei = {
  id: string;
  dateiname: string;
  groesseBytes: number | null;
  link: string | null;
};

export type UnterlagenPunkt = {
  id: string;
  schluessel: string;
  bereich: string;
  titel: string;
  grund: string | null;
  art: "text" | "lang" | "wahl" | "mehrwahl" | "datei";
  optionen: string[];
  dringend: boolean;
  wert: string | null;
  anmerkung: string | null;
  status: "offen" | "beantwortet" | "entfaellt";
  beantwortetVon: string | null;
  beantwortetAm: string | null;
  dateien: UnterlagenDatei[];
};

function mb(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}

function Submit({ label, klein = false }: { label: string; klein?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={
        klein
          ? "cursor-pointer rounded-pill border border-line px-[12px] py-[6px] text-[12px] text-muted hover:border-line-strong disabled:opacity-50"
          : "min-h-[36px] cursor-pointer rounded-pill bg-[linear-gradient(150deg,var(--accent-from),var(--accent-to))] px-[16px] text-[12.5px] font-semibold text-white disabled:opacity-50"
      }
    >
      {label}
    </button>
  );
}

function Meldung({ state }: { state: UnterlagenState }) {
  if (!state.error && !state.ok) return null;
  return (
    <p
      role={state.error ? "alert" : "status"}
      className={`mt-[8px] rounded-input px-[11px] py-[7px] text-[12.5px] font-medium ${
        state.error ? "bg-s-crit/10 text-s-crit" : "bg-s-done/10 text-s-done"
      }`}
    >
      {state.error ?? state.ok}
    </p>
  );
}

function StatusPille({ punkt }: { punkt: UnterlagenPunkt }) {
  if (punkt.status === "beantwortet") return <Pill tone="done">erledigt</Pill>;
  if (punkt.status === "entfaellt") return <Pill tone="neutral">betrifft uns nicht</Pill>;
  if (punkt.dringend) return <Pill tone="crit">zum Start nötig</Pill>;
  return <Pill tone="new">offen</Pill>;
}

/* ------------------------------------------------------------ Dateien */

function DateiFeld({
  punkt,
  gesperrt,
  aktionen,
}: {
  punkt: UnterlagenPunkt;
  gesperrt: boolean;
  aktionen: UnterlagenAktionen;
}) {
  const router = useRouter();
  const feldRef = useRef<HTMLInputElement>(null);
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [wegState, wegAction] = useActionState(aktionen.dateiEntfernen, INITIAL);

  async function hochladen(dateien: FileList | null) {
    if (!dateien || dateien.length === 0) return;
    setFehler(null);
    setLaeuft(true);

    const db = createClient();
    try {
      for (const datei of Array.from(dateien)) {
        /*
         * Erst im Browser prüfen, dann erst eine Adresse holen. Sonst
         * wartet jemand den ganzen Upload ab, um am Ende zu erfahren,
         * dass das Format nicht geht.
         */
        const vorab = pruefeUnterlage(datei.type, datei.size, datei.name);
        if (!vorab.ok) {
          setFehler(`${datei.name}: ${vorab.grund}`);
          continue;
        }

        const ziel = await aktionen.dateiZiel(punkt.id, datei.name, datei.type, datei.size);
        if ("fehler" in ziel) {
          setFehler(`${datei.name}: ${ziel.fehler}`);
          continue;
        }

        const { error } = await db.storage
          .from(BUCKET_UNTERLAGEN)
          .uploadToSignedUrl(ziel.pfad, ziel.token, datei);
        if (error) {
          setFehler(`${datei.name}: Hochladen fehlgeschlagen — ${error.message}`);
          continue;
        }

        const stand = await aktionen.dateiVermerken({
          punktId: punkt.id,
          pfad: ziel.pfad,
          dateiname: datei.name,
          mime: datei.type,
          groesse: datei.size,
        });
        if (stand.error) setFehler(`${datei.name}: ${stand.error}`);
      }
    } finally {
      setLaeuft(false);
      if (feldRef.current) feldRef.current.value = "";
      /*
       * Neu laden: Die Leseadresse der Datei wird serverseitig
       * signiert, ohne Aktualisierung bliebe die Liste stehen.
       */
      router.refresh();
    }
  }

  return (
    <div className="flex flex-col gap-[10px]">
      {punkt.dateien.length > 0 ? (
        <ul className="flex flex-col gap-[6px]">
          {punkt.dateien.map((d) => (
            <li
              key={d.id}
              className="flex flex-wrap items-center gap-[10px] rounded-input bg-sunk px-[11px] py-[7px]"
            >
              {d.link ? (
                <a
                  href={d.link}
                  target="_blank"
                  rel="noreferrer"
                  className="min-w-0 flex-1 truncate text-[13px] font-medium text-accent-ink hover:underline"
                >
                  {d.dateiname}
                </a>
              ) : (
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                  {d.dateiname}
                </span>
              )}
              {d.groesseBytes ? (
                <span className="num text-[11px] text-faint">{mb(d.groesseBytes)}</span>
              ) : null}
              {gesperrt ? null : (
                <form action={wegAction}>
                  <input type="hidden" name="id" value={d.id} />
                  <Submit label="entfernen" klein />
                </form>
              )}
            </li>
          ))}
        </ul>
      ) : null}

      {gesperrt ? null : (
        <div className="flex flex-wrap items-center gap-[10px]">
          <label className="cursor-pointer rounded-pill border border-line bg-surface px-[14px] py-[7px] text-[12.5px] font-medium hover:border-line-strong">
            {punkt.dateien.length > 0 ? "Weitere Datei" : "Datei wählen"}
            <input
              ref={feldRef}
              type="file"
              name={`datei-${punkt.schluessel}`}
              multiple
              className="hidden"
              onChange={(e) => void hochladen(e.target.files)}
            />
          </label>
          <span className="text-[12px] text-faint">
            {laeuft
              ? "wird hochgeladen …"
              : `PDF, Bild, CSV oder Excel, höchstens ${Math.floor(MAX_BYTES / 1024 / 1024)} MB`}
          </span>
        </div>
      )}

      {fehler ? (
        <p role="alert" className="rounded-input bg-s-crit/10 px-[11px] py-[7px] text-[12.5px] font-medium text-s-crit">
          {fehler}
        </p>
      ) : null}
      <Meldung state={wegState} />
    </div>
  );
}

/* -------------------------------------------------------------- Punkt */

function PunktZeile({
  punkt,
  gesperrt,
  aktionen,
}: {
  punkt: UnterlagenPunkt;
  gesperrt: boolean;
  aktionen: UnterlagenAktionen;
}) {
  const [state, formAction] = useActionState(aktionen.speichern, INITIAL);
  const [entfState, entfAction] = useActionState(aktionen.entfaellt, INITIAL);

  const gewaehlt = (punkt.wert ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return (
    <li
      data-testid={`punkt-${punkt.schluessel}`}
      className="border-t border-line py-[14px] first:border-t-0 first:pt-0"
    >
      <div className="mb-[3px] flex flex-wrap items-center gap-[10px]">
        <span className="text-[14px] font-semibold">{punkt.titel}</span>
        <StatusPille punkt={punkt} />
      </div>

      {punkt.grund ? (
        <p className="mb-[10px] max-w-[62ch] text-[12.5px] leading-[1.5] text-muted">
          {punkt.grund}
        </p>
      ) : null}

      {punkt.status === "entfaellt" ? (
        <form action={entfAction} className="flex items-center gap-[10px]">
          <input type="hidden" name="id" value={punkt.id} />
          <input type="hidden" name="zurueck" value="ja" />
          {gesperrt ? null : <Submit label="doch wieder offen" klein />}
          <Meldung state={entfState} />
        </form>
      ) : (
        <>
          {punkt.art === "datei" ? (
            <DateiFeld punkt={punkt} gesperrt={gesperrt} aktionen={aktionen} />
          ) : null}

          <form action={formAction} className="mt-[2px] flex flex-col gap-[8px]">
            <input type="hidden" name="id" value={punkt.id} />

            {punkt.art === "text" ? (
              <input
                name="wert"
                defaultValue={punkt.wert ?? ""}
                disabled={gesperrt}
                maxLength={4000}
                className={feld}
              />
            ) : null}

            {punkt.art === "lang" ? (
              <textarea
                name="wert"
                defaultValue={punkt.wert ?? ""}
                disabled={gesperrt}
                maxLength={4000}
                rows={3}
                className={`${feld} resize-y leading-[1.5]`}
              />
            ) : null}

            {punkt.art === "wahl" || punkt.art === "mehrwahl" ? (
              <fieldset className="flex flex-wrap gap-[8px] border-0 p-0">
                {punkt.optionen.map((o) => (
                  <label
                    key={o}
                    className="flex cursor-pointer items-center gap-[7px] rounded-pill border border-line bg-surface px-[13px] py-[6px] text-[12.5px] text-muted has-checked:border-accent has-checked:bg-accent-sunk has-checked:font-semibold has-checked:text-ink"
                  >
                    <input
                      type={punkt.art === "mehrwahl" ? "checkbox" : "radio"}
                      name="wahl"
                      value={o}
                      defaultChecked={gewaehlt.includes(o)}
                      disabled={gesperrt}
                      className="accent-[var(--accent)]"
                    />
                    {o}
                  </label>
                ))}
              </fieldset>
            ) : null}

            <input
              name="anmerkung"
              defaultValue={punkt.anmerkung ?? ""}
              disabled={gesperrt}
              maxLength={1000}
              placeholder={punkt.art === "datei" ? "Anmerkung zur Datei" : "Anmerkung"}
              className={`${feld} text-[13px]`}
            />

            {gesperrt ? null : (
              <div className="flex flex-wrap items-center gap-[10px]">
                <Submit label="Speichern" />
                <button
                  type="submit"
                  formAction={entfAction}
                  className="cursor-pointer rounded-pill border border-line px-[12px] py-[6px] text-[12px] text-muted hover:border-line-strong"
                >
                  betrifft uns nicht
                </button>
                {punkt.beantwortetVon && punkt.status === "beantwortet" ? (
                  <span className="text-[11.5px] text-faint">
                    von {punkt.beantwortetVon}
                    {punkt.beantwortetAm ? `, ${punkt.beantwortetAm}` : ""}
                  </span>
                ) : null}
              </div>
            )}

            <Meldung state={state} />
            <Meldung state={entfState} />
          </form>
        </>
      )}
    </li>
  );
}

/* ------------------------------------------------------------- Ganzes */

export function Unterlagen({
  punkte,
  gesperrt,
  aktionen,
}: {
  punkte: UnterlagenPunkt[];
  gesperrt: boolean;
  aktionen: UnterlagenAktionen;
}) {
  if (punkte.length === 0) return null;

  const offen = punkte.filter((p) => p.status === "offen");
  const dringendOffen = offen.filter((p) => p.dringend).length;
  const erledigt = punkte.length - offen.length;

  /* Reihenfolge der Bereiche wie sie hereinkommt — sortiert ist serverseitig. */
  const bereiche: string[] = [];
  for (const p of punkte) if (!bereiche.includes(p.bereich)) bereiche.push(p.bereich);

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-card bg-sunk p-5">
        <p className="text-[13.5px] leading-[1.55] text-muted">
          {offen.length === 0 ? (
            <>Hier ist alles beisammen. Danke.</>
          ) : (
            <>
              <span className="num font-semibold text-ink">{erledigt}</span> von{" "}
              <span className="num font-semibold text-ink">{punkte.length}</span> Punkten
              sind erledigt.
              {dringendOffen > 0 ? (
                <>
                  {" "}
                  <span className="font-semibold text-s-crit">
                    {dringendOffen} davon {dringendOffen === 1 ? "ist" : "sind"} zum Start
                    nötig.
                  </span>
                </>
              ) : null}{" "}
              Reihenfolge ist egal, Lücken sind kein Problem — was fehlt, bleibt sichtbar.
            </>
          )}
        </p>
      </div>

      {bereiche.map((b) => {
        const drin = punkte.filter((p) => p.bereich === b);
        const fertig = drin.filter((p) => p.status !== "offen").length;
        return (
          <div key={b} className="rounded-card border border-line bg-surface p-5">
            <div className="mb-[12px] flex flex-wrap items-baseline gap-[10px]">
              <h3 className="text-[15px] font-semibold">{b}</h3>
              <span className="num ml-auto text-[11.5px] text-faint">
                {fertig} / {drin.length}
              </span>
            </div>
            <ul className="flex flex-col">
              {drin.map((p) => (
                <PunktZeile key={p.id} punkt={p} gesperrt={gesperrt} aktionen={aktionen} />
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
