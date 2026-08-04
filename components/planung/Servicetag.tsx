"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  stoppAnlegen,
  stoppSchieben,
  stoppWeg,
  type StoppStatus,
} from "@/app/(app)/planung/stopp-actions";

const LEER: StoppStatus = { error: null, ok: null };

export type Stopp = {
  id: string;
  sort: number;
  name: string;
  adresse: string | null;
  uhrzeit: string | null;
  km: number | null;
  fahrzeitMin: number | null;
};

export type ServiceEinsatz = {
  id: string;
  titel: string;
  von: string;
  personen: string[];
  stopps: Stopp[];
};

/**
 * Der Servicetag mit mehreren Stopps.
 *
 * Reihenfolge von Hand, Fahrzeit nur angezeigt. Keine Routenoptimierung
 * und keine Kapazitätslogik — das ist ein eigenes Produkt und der falsche
 * Kampf (Briefing 4). Wer die Gegend kennt, sortiert besser als ein
 * Algorithmus ohne Kontext: er weiss, dass der Kunde in Stoob erst ab
 * neun aufmacht.
 *
 * Fahrzeiten stehen nur da, wenn sie jemand hinterlegt hat. Eine
 * geschätzte Minutenzahl ohne Quelle wäre schlimmer als keine — danach
 * plant jemand den Tag.
 */
export function Servicetag({
  einsaetze,
  darfPlanen,
}: {
  einsaetze: ServiceEinsatz[];
  darfPlanen: boolean;
}) {
  if (einsaetze.length === 0) return null;

  return (
    <section className="mt-4 rounded-panel bg-surface p-5 shadow-soft">
      <h2 className="text-[15px] font-semibold">Servicetag mit mehreren Stopps</h2>
      <p className="mt-1 mb-4 text-[12.5px] text-muted">
        Reihenfolge von Hand sortierbar. Fahrzeit wird nur angezeigt, nicht
        optimiert.
      </p>

      <div className="grid gap-4 lg:grid-cols-2">
        {einsaetze.map((e) => (
          <div key={e.id} className="rounded-card bg-panel p-4">
            <div className="mb-3 flex flex-wrap items-baseline gap-2">
              <span className="text-[14px] font-semibold">{e.titel}</span>
              <span className="num text-[11.5px] text-faint">
                {new Date(e.von).toLocaleDateString("de-AT", {
                  weekday: "short",
                  day: "2-digit",
                  month: "2-digit",
                })}
                {e.personen.length ? ` · ${e.personen.join(", ")}` : ""}
              </span>
            </div>

            <ol className="flex flex-col">
              {e.stopps.map((s, i) => (
                <li key={s.id}>
                  <div className="flex items-center gap-3 rounded-input bg-surface px-3 py-[10px]">
                    <span
                      aria-hidden
                      className="num grid h-[24px] w-[24px] shrink-0 place-items-center rounded-pill bg-s-done/15 text-[11px] font-bold text-s-done"
                    >
                      {i + 1}
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-semibold">
                        {s.name}
                      </span>
                      {s.adresse ? (
                        /*
                         * geo: öffnet am Telefon die installierte
                         * Navigation. Der Monteur tippt keine Adresse ab.
                         */
                        <a
                          href={`geo:0,0?q=${encodeURIComponent(s.adresse)}`}
                          className="block truncate text-[11.5px] text-muted underline"
                        >
                          {s.adresse}
                        </a>
                      ) : null}
                    </span>

                    {s.uhrzeit ? (
                      <span className="num shrink-0 text-[12.5px] font-semibold">
                        {s.uhrzeit.slice(0, 5)}
                      </span>
                    ) : null}

                    {darfPlanen ? (
                      <span className="flex shrink-0 items-center gap-1">
                        <Pfeil stoppId={s.id} richtung="hoch" label={`${s.name} nach oben`}>
                          ↑
                        </Pfeil>
                        <Pfeil
                          stoppId={s.id}
                          richtung="runter"
                          label={`${s.name} nach unten`}
                        >
                          ↓
                        </Pfeil>
                        <Weg stoppId={s.id} name={s.name} />
                      </span>
                    ) : null}
                  </div>

                  {/* Fahrzeit zum nächsten Stopp, wenn hinterlegt. */}
                  {i < e.stopps.length - 1 &&
                  (s.km !== null || s.fahrzeitMin !== null) ? (
                    <div className="num border-l-2 border-line py-[6px] pl-4 text-[11.5px] text-faint">
                      {s.km !== null ? `${s.km} km` : ""}
                      {s.km !== null && s.fahrzeitMin !== null ? " · " : ""}
                      {s.fahrzeitMin !== null ? `${s.fahrzeitMin} min Fahrzeit` : ""}
                    </div>
                  ) : i < e.stopps.length - 1 ? (
                    <div className="h-[8px] border-l-2 border-line" />
                  ) : null}
                </li>
              ))}
            </ol>

            {e.stopps.length === 0 ? (
              <p className="rounded-input bg-surface px-3 py-4 text-center text-[12.5px] text-muted">
                Noch keine Stopps.
              </p>
            ) : null}

            {darfPlanen ? <Neu einsatzId={e.id} /> : null}
          </div>
        ))}
      </div>
    </section>
  );
}

function Neu({ einsatzId }: { einsatzId: string }) {
  const [status, formAction] = useActionState<StoppStatus, FormData>(
    stoppAnlegen,
    LEER,
  );

  return (
    <form
      action={formAction}
      key={status.ok ?? "leer"}
      className="mt-3 grid gap-2 sm:grid-cols-6"
    >
      <input type="hidden" name="einsatzId" value={einsatzId} />
      <input
        name="name"
        required
        placeholder="Kunde oder Stopp"
        className="rounded-input border border-line bg-surface px-[11px] py-[8px] text-[12.5px] outline-0 focus:border-accent sm:col-span-2"
      />
      <input
        name="adresse"
        placeholder="Adresse"
        className="rounded-input border border-line bg-surface px-[11px] py-[8px] text-[12.5px] outline-0 focus:border-accent sm:col-span-2"
      />
      <input
        name="uhrzeit"
        type="time"
        className="num rounded-input border border-line bg-surface px-[11px] py-[8px] text-[12.5px] outline-0 focus:border-accent"
      />
      <Klein label="+" />
      {status.error ? (
        <p className="text-[11.5px] text-s-crit sm:col-span-6">{status.error}</p>
      ) : null}
    </form>
  );
}

function Pfeil({
  stoppId,
  richtung,
  label,
  children,
}: {
  stoppId: string;
  richtung: "hoch" | "runter";
  label: string;
  children: React.ReactNode;
}) {
  const [, formAction] = useActionState<StoppStatus, FormData>(stoppSchieben, LEER);
  return (
    <form action={formAction}>
      <input type="hidden" name="stoppId" value={stoppId} />
      <input type="hidden" name="richtung" value={richtung} />
      <button
        type="submit"
        aria-label={label}
        className="cursor-pointer rounded-pill border border-line bg-surface px-[8px] py-[3px] text-[11px] text-muted transition-colors hover:text-ink"
      >
        {children}
      </button>
    </form>
  );
}

function Weg({ stoppId, name }: { stoppId: string; name: string }) {
  const [, formAction] = useActionState<StoppStatus, FormData>(stoppWeg, LEER);
  return (
    <form action={formAction}>
      <input type="hidden" name="stoppId" value={stoppId} />
      <button
        type="submit"
        aria-label={`${name} entfernen`}
        className="cursor-pointer rounded-pill border border-line bg-surface px-[8px] py-[3px] text-[11px] text-faint transition-colors hover:border-s-crit hover:text-s-crit"
      >
        ✕
      </button>
    </form>
  );
}

function Klein({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="cursor-pointer rounded-input border-0 bg-ink px-[14px] py-[8px] text-[12.5px] font-semibold text-app disabled:opacity-60"
    >
      {pending ? "…" : label}
    </button>
  );
}
