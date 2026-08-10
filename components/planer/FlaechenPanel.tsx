"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  azimutAusTraufe,
  type Dachflaeche,
  dachflaeche,
  grundflaeche,
  kanten,
  laenge,
} from "@/lib/planer/flaeche";
import { DACHFORMEN, type Dachform, dachformFlaechen, type Plan } from "@/lib/planer/plan";
import type { Meter } from "@/lib/planer/geo";

/* Eingabefeld wie in components/ui/Field.tsx — dort steckt der Stil in der
   Komponente, hier brauchen wir ihn auch für select und number. */
const FELD =
  "rounded-input border border-transparent bg-sunk px-2.5 py-1.5 text-[13px] text-ink " +
  "outline-0 transition-colors focus:border-accent focus:bg-surface disabled:opacity-60";

/*
 * Panel rechts (Prototyp): Flächenliste und die Eigenschaften der
 * gewählten Fläche.
 *
 * Jede Zahl hier ist eine Eingabe, keine Anzeige — Neigung und Azimut
 * bestimmen später den Ertrag, und das Luftbild verrät beides nicht.
 * Was sich ableiten lässt, wird vorbelegt: der Azimut folgt aus der
 * Traufkante, bleibt aber übersteuerbar.
 */

export interface PanelProps {
  plan: Plan;
  aktiv: string | null;
  onAktiv: (id: string | null) => void;
  onPlan: (plan: Plan, schritt: boolean) => void;
  /** Bildmitte in Metern — dorthin setzt der Assistent das Dach. */
  mitte: Meter;
  schreibrecht: boolean;
  /** Nur in der überlagerten Fassung unter lg. */
  onSchliessen?: () => void;
}

export function FlaechenPanel({
  plan,
  aktiv,
  onAktiv,
  onPlan,
  mitte,
  schreibrecht,
  onSchliessen,
}: PanelProps) {
  const flaeche = plan.flaechen.find((f) => f.id === aktiv) ?? null;

  const aendere = (wie: (f: Dachflaeche) => Dachflaeche) => {
    if (!flaeche) return;
    onPlan(
      { ...plan, flaechen: plan.flaechen.map((f) => (f.id === flaeche.id ? wie(f) : f)) },
      true,
    );
  };

  return (
    <aside className="flex w-full shrink-0 flex-col gap-4 overflow-y-auto border-l border-line bg-panel p-3.5 lg:w-[300px]">
      {onSchliessen ? (
        <button
          type="button"
          onClick={onSchliessen}
          className="self-end text-[12.5px] text-muted hover:text-ink lg:hidden"
        >
          schliessen ✕
        </button>
      ) : null}

      {schreibrecht ? <Assistent plan={plan} onPlan={onPlan} onAktiv={onAktiv} mitte={mitte} /> : null}

      <section>
        <h3 className="text-[11px] font-bold uppercase tracking-wide text-muted">
          Dachflächen ({plan.flaechen.length})
        </h3>
        {plan.flaechen.length === 0 ? (
          <p className="mt-2 text-[12.5px] text-muted">
            Noch keine Fläche. Mit dem Zeichenwerkzeug den Dachumriss abfahren oder oben eine
            Standardform setzen.
          </p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1">
            {plan.flaechen.map((f) => (
              <li key={f.id}>
                <button
                  type="button"
                  onClick={() => onAktiv(f.id)}
                  className={[
                    "flex w-full items-center justify-between rounded-input px-2.5 py-2 text-left text-[13px]",
                    f.id === aktiv ? "bg-accent-sunk font-semibold" : "hover:bg-sunk",
                  ].join(" ")}
                >
                  <span className="truncate">{f.name}</span>
                  <span className="num shrink-0 text-[11.5px] tabular-nums text-muted">
                    {dachflaeche(f.punkte, f.neigung).toFixed(1).replace(".", ",")} m²
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {flaeche ? (
        <Eigenschaften
          flaeche={flaeche}
          aendere={aendere}
          schreibrecht={schreibrecht}
          onLoeschen={() => {
            onPlan({ ...plan, flaechen: plan.flaechen.filter((f) => f.id !== flaeche.id) }, true);
            onAktiv(null);
          }}
        />
      ) : null}
    </aside>
  );
}

function Eigenschaften({
  flaeche,
  aendere,
  schreibrecht,
  onLoeschen,
}: {
  flaeche: Dachflaeche;
  aendere: (wie: (f: Dachflaeche) => Dachflaeche) => void;
  schreibrecht: boolean;
  onLoeschen: () => void;
}) {
  const grund = grundflaeche(flaeche.punkte);
  const wahr = dachflaeche(flaeche.punkte, flaeche.neigung);

  return (
    <section className="flex flex-col gap-3 border-t border-line pt-4">
      <h3 className="text-[11px] font-bold uppercase tracking-wide text-muted">
        {flaeche.name}
      </h3>

      <Feld label="Bezeichnung">
        <input
          value={flaeche.name}
          disabled={!schreibrecht}
          onChange={(e) => aendere((f) => ({ ...f, name: e.target.value }))}
          className={`${FELD} w-full`}
        />
      </Feld>

      <div className="grid grid-cols-2 gap-2.5">
        <Feld label="Neigung (°)">
          <input
            type="number"
            min={0}
            max={75}
            step={1}
            value={flaeche.neigung}
            disabled={!schreibrecht}
            onChange={(e) =>
              aendere((f) => ({
                ...f,
                neigung: Math.max(0, Math.min(75, Number(e.target.value) || 0)),
              }))
            }
            className={`${FELD} num w-full`}
          />
        </Feld>
        <Feld label="Azimut (°)">
          <input
            type="number"
            min={0}
            max={359}
            step={1}
            value={Math.round(flaeche.azimut)}
            disabled={!schreibrecht}
            onChange={(e) =>
              aendere((f) => ({ ...f, azimut: ((Number(e.target.value) || 0) + 360) % 360 }))
            }
            className={`${FELD} num w-full`}
          />
        </Feld>
      </div>
      <p className="-mt-1.5 text-[11px] text-muted">
        {himmelsrichtung(flaeche.azimut)} · 180° ist Süd
      </p>

      <Feld label="Traufkante">
        <select
          value={flaeche.traufe ?? ""}
          disabled={!schreibrecht}
          onChange={(e) => {
            const wert = e.target.value === "" ? null : Number(e.target.value);
            aendere((f) => {
              const neu = { ...f, traufe: wert };
              // Azimut folgt der Traufe — das ist der Sinn der Angabe.
              const abgeleitet = azimutAusTraufe(neu);
              return abgeleitet === null ? neu : { ...neu, azimut: abgeleitet };
            });
          }}
          className={`${FELD} w-full`}
        >
          <option value="">keine (Flachdach)</option>
          {kanten(flaeche.punkte).map((k) => (
            <option key={k.i} value={k.i}>
              Kante {k.i + 1} · {laenge(k.a, k.b).toFixed(2).replace(".", ",")} m
            </option>
          ))}
        </select>
      </Feld>

      <Feld label="Randabstand (m)">
        <input
          type="number"
          min={0}
          max={5}
          step={0.05}
          value={flaeche.randabstand}
          disabled={!schreibrecht}
          onChange={(e) =>
            aendere((f) => ({
              ...f,
              randabstand: Math.max(0, Math.min(5, Number(e.target.value) || 0)),
            }))
          }
          className={`${FELD} num w-full`}
        />
      </Feld>
      {flaeche.neigung === 0 && flaeche.randabstand < 1 ? (
        <p className="-mt-1.5 text-[11px] text-s-warn">
          Flachdächer haben eine Windlast-Randzone; üblich ist 1,00 m. Entscheidet der Betrieb.
        </p>
      ) : null}

      <dl className="rounded-card bg-sunk p-2.5 text-[12px]">
        <Zeile label="Grundfläche" wert={`${grund.toFixed(1).replace(".", ",")} m²`} />
        <Zeile label="Dachfläche" wert={`${wahr.toFixed(1).replace(".", ",")} m²`} />
        <Zeile label="Ecken" wert={String(flaeche.punkte.length)} />
      </dl>

      {flaeche.hindernisse.length > 0 ? (
        <section>
          <h4 className="text-[11px] font-bold uppercase tracking-wide text-muted">
            Hindernisse ({flaeche.hindernisse.length})
          </h4>
          <ul className="mt-1.5 flex flex-col gap-1">
            {flaeche.hindernisse.map((h) => (
              <li key={h.id} className="flex items-center gap-2 text-[12.5px]">
                <span className="min-w-0 flex-1 truncate">{h.name}</span>
                <input
                  type="number"
                  min={0}
                  max={5}
                  step={0.05}
                  value={h.abstand}
                  disabled={!schreibrecht}
                  aria-label={`Abstand ${h.name}`}
                  onChange={(e) =>
                    aendere((f) => ({
                      ...f,
                      hindernisse: f.hindernisse.map((x) =>
                        x.id === h.id
                          ? { ...x, abstand: Math.max(0, Math.min(5, Number(e.target.value) || 0)) }
                          : x,
                      ),
                    }))
                  }
                  className={`${FELD} num w-[68px] shrink-0`}
                />
                {schreibrecht ? (
                  <button
                    type="button"
                    onClick={() =>
                      aendere((f) => ({
                        ...f,
                        hindernisse: f.hindernisse.filter((x) => x.id !== h.id),
                      }))
                    }
                    className="shrink-0 text-[11.5px] text-muted hover:text-s-crit"
                  >
                    entfernen
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {schreibrecht ? (
        <button
          type="button"
          onClick={onLoeschen}
          className="self-start text-[12.5px] text-muted hover:text-s-crit"
        >
          Fläche löschen
        </button>
      ) : null}
    </section>
  );
}

function Assistent({
  plan,
  onPlan,
  onAktiv,
  mitte,
}: {
  plan: Plan;
  onPlan: (plan: Plan, schritt: boolean) => void;
  onAktiv: (id: string) => void;
  mitte: Meter;
}) {
  const [offen, setOffen] = useState(false);
  const [form, setForm] = useState<Dachform>("sattel");
  const [breite, setBreite] = useState(12);
  const [tiefe, setTiefe] = useState(8);
  const [drehung, setDrehung] = useState(0);
  const [neigung, setNeigung] = useState(30);

  return (
    <section>
      <button
        type="button"
        onClick={() => setOffen((o) => !o)}
        className="flex w-full items-center justify-between text-[11px] font-bold uppercase tracking-wide text-muted"
      >
        Standardform setzen
        <span aria-hidden>{offen ? "−" : "+"}</span>
      </button>

      {offen ? (
        <div className="mt-2 flex flex-col gap-2.5 rounded-card bg-sunk p-2.5">
          <Feld label="Form">
            <select value={form} onChange={(e) => setForm(e.target.value as Dachform)} className={`${FELD} w-full`}>
              {DACHFORMEN.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label} — {d.hinweis}
                </option>
              ))}
            </select>
          </Feld>
          <div className="grid grid-cols-2 gap-2.5">
            <Feld label="Länge (m)">
              <input type="number" min={1} step={0.5} value={breite}
                onChange={(e) => setBreite(Number(e.target.value) || 1)} className={`${FELD} num w-full`} />
            </Feld>
            <Feld label="Tiefe (m)">
              <input type="number" min={1} step={0.5} value={tiefe}
                onChange={(e) => setTiefe(Number(e.target.value) || 1)} className={`${FELD} num w-full`} />
            </Feld>
            <Feld label="Drehung (°)">
              <input type="number" step={1} value={drehung}
                onChange={(e) => setDrehung(Number(e.target.value) || 0)} className={`${FELD} num w-full`} />
            </Feld>
            <Feld label="Neigung (°)">
              <input type="number" min={0} max={75} step={1} value={neigung}
                onChange={(e) => setNeigung(Number(e.target.value) || 0)} className={`${FELD} num w-full`} />
            </Feld>
          </div>
          <Button
            type="button"
            className="self-start"
            onClick={() => {
              const neue = dachformFlaechen(
                { form, breite, tiefe, mitte, drehung, neigung },
                plan.flaechen,
              );
              onPlan({ ...plan, flaechen: [...plan.flaechen, ...neue] }, true);
              if (neue[0]) onAktiv(neue[0].id);
              setOffen(false);
            }}
          >
            In die Bildmitte setzen
          </Button>
          <p className="text-[11px] text-muted">
            Es entstehen normale Flächen — danach frei verschiebbar und editierbar wie
            handgezeichnete.
          </p>
        </div>
      ) : null}
    </section>
  );
}

function himmelsrichtung(azimut: number): string {
  const namen = ["Nord", "Nordost", "Ost", "Südost", "Süd", "Südwest", "West", "Nordwest"];
  return namen[Math.round((((azimut % 360) + 360) % 360) / 45) % 8]!;
}

function Feld({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-semibold text-muted">{label}</span>
      {children}
    </label>
  );
}

function Zeile({ label, wert }: { label: string; wert: string }) {
  return (
    <div className="flex justify-between py-0.5">
      <dt className="text-muted">{label}</dt>
      <dd className="num tabular-nums">{wert}</dd>
    </div>
  );
}
