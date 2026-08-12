"use client";

import { type ReactNode, useState } from "react";
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
import { BelegungsPanel } from "./BelegungsPanel";

/*
 * Panel rechts — 344 px, heller Grund, Karten mit 12er-Radius.
 * Masse und Farben aus Planer-HTML.html.
 *
 * Jede Zahl hier ist eine Eingabe, keine Anzeige: Neigung und Azimut
 * bestimmen später den Ertrag, und das Luftbild verrät beides nicht.
 * Was sich ableiten lässt, wird vorbelegt — der Azimut folgt aus der
 * Traufkante, bleibt aber übersteuerbar.
 */

/* Eingabefeld nach Entwurf: 44 px hoch, Radius 10, heller Grund. */
const FELD =
  "h-11 w-full rounded-[10px] border border-line bg-surface px-3 text-[14px] text-ink " +
  "outline-none transition-colors focus:border-accent disabled:opacity-60";
const FELD_NUM = `${FELD} num tabular-nums`;
/* Karte nach Entwurf: 1 px Linie, Radius 12, 14 px Innenabstand. */
const KARTE = "rounded-[12px] border border-line bg-surface p-3.5";

export interface PanelProps {
  plan: Plan;
  aktiv: string | null;
  onAktiv: (id: string | null) => void;
  onPlan: (plan: Plan, schritt: boolean) => void;
  /** Bildmitte in Metern — dorthin setzt der Assistent das Dach. */
  mitte: Meter;
  schreibrecht: boolean;
  onSchliessen: () => void;
  /** Bildquelle (Drohnenfoto) — steckt oben im Panel. */
  foto?: ReactNode;
  aktiveGruppe: string | null;
  onAktiveGruppe: (id: string | null) => void;
  /** Für den Reihenabstands-Vorschlag beim Flachdach. */
  breitengrad: number;
  /**
   * Ob das Dach in diesem Schritt noch zu ändern ist. In der Belegung
   * wird es nur noch angezeigt — sonst stünde die Sperre auf der
   * Zeichenfläche, während daneben dieselben Werte weiter editierbar
   * wären.
   */
  dachAenderbar: boolean;
}

export function FlaechenPanel({
  plan,
  aktiv,
  onAktiv,
  onPlan,
  mitte,
  schreibrecht,
  onSchliessen,
  foto,
  aktiveGruppe,
  onAktiveGruppe,
  breitengrad,
  dachAenderbar,
}: PanelProps) {
  const flaeche = plan.flaechen.find((f) => f.id === aktiv) ?? null;

  const aendere = (wie: (f: Dachflaeche) => Dachflaeche) => {
    if (!flaeche) return;
    onPlan({ ...plan, flaechen: plan.flaechen.map((f) => (f.id === flaeche.id ? wie(f) : f)) }, true);
  };

  return (
    <aside className="flex w-full flex-col border-l border-line bg-panel">
      <div className="flex items-center px-4 pb-2.5 pt-3.5">
        <h2 className="text-[15px] font-extrabold">
          {flaeche ? flaeche.name : "Dach erfassen"}
        </h2>
        <button
          type="button"
          onClick={onSchliessen}
          aria-label="Seitenleiste schliessen"
          className="ml-auto flex h-[30px] w-[30px] items-center justify-center rounded-[8px] text-[15px] text-muted hover:bg-sunk"
        >
          ›
        </button>
      </div>

      <div className="flex flex-1 flex-col gap-3 overflow-auto px-4 pb-4">
        {foto}

        {schreibrecht && dachAenderbar ? (
          <Assistent plan={plan} onPlan={onPlan} onAktiv={onAktiv} mitte={mitte} />
        ) : null}

        {schreibrecht && dachAenderbar && plan.flaechen.length > 0 ? (
          <Gebaeude plan={plan} onPlan={onPlan} />
        ) : null}

        <section className={KARTE}>
          <h3 className="text-[13px] font-bold">Dachflächen ({plan.flaechen.length})</h3>
          {plan.flaechen.length === 0 ? (
            <p className="mt-1.5 text-[12.5px] leading-[1.45] text-muted">
              Noch keine Fläche. Links das Werkzeug „Fläche“ wählen und den Dachumriss abfahren —
              oder oben eine Standardform setzen.
            </p>
          ) : (
            <ul className="mt-2 flex flex-col gap-1">
              {plan.flaechen.map((f) => (
                <li key={f.id}>
                  <button
                    type="button"
                    onClick={() => onAktiv(f.id)}
                    className={[
                      "flex w-full items-center justify-between rounded-[10px] px-2.5 py-2 text-left text-[13px]",
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
          <BelegungsPanel
            plan={plan}
            flaeche={flaeche}
            aktiveGruppe={aktiveGruppe}
            onAktiveGruppe={onAktiveGruppe}
            onPlan={onPlan}
            schreibrecht={schreibrecht}
            breitengrad={breitengrad}
          />
        ) : null}

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
        ) : plan.flaechen.length > 0 ? (
          <p className="px-0.5 text-[12.5px] leading-[1.5] text-muted">
            Eine Fläche antippen, um Neigung, Ausrichtung und Randabstand zu setzen.
          </p>
        ) : null}
      </div>
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
    <section className={`${KARTE} flex flex-col gap-3`}>
      <Feld label="Bezeichnung">
        <input
          value={flaeche.name}
          disabled={!schreibrecht}
          onChange={(e) => aendere((f) => ({ ...f, name: e.target.value }))}
          className={FELD}
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
              aendere((f) => ({ ...f, neigung: Math.max(0, Math.min(75, Number(e.target.value) || 0)) }))
            }
            className={FELD_NUM}
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
            onChange={(e) => aendere((f) => ({ ...f, azimut: ((Number(e.target.value) || 0) + 360) % 360 }))}
            className={FELD_NUM}
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
              // Der Azimut folgt der Traufe — das ist der Sinn der Angabe.
              const abgeleitet = azimutAusTraufe(neu);
              return abgeleitet === null ? neu : { ...neu, azimut: abgeleitet };
            });
          }}
          className={FELD}
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
            aendere((f) => ({ ...f, randabstand: Math.max(0, Math.min(5, Number(e.target.value) || 0)) }))
          }
          className={FELD_NUM}
        />
      </Feld>
      {flaeche.neigung === 0 && flaeche.randabstand < 1 ? (
        <p className="-mt-1.5 rounded-[10px] bg-pl-hinweis px-2.5 py-1.5 text-[11px] leading-[1.4] text-pl-hinweis-text">
          Flachdächer haben eine Windlast-Randzone; üblich ist 1,00 m. Entscheidet der Betrieb.
        </p>
      ) : null}

      <dl className="rounded-[10px] bg-sunk p-2.5 text-[12px]">
        <Zeile label="Grundfläche" wert={`${grund.toFixed(1).replace(".", ",")} m²`} />
        <Zeile label="Dachfläche" wert={`${wahr.toFixed(1).replace(".", ",")} m²`} />
        <Zeile label="Ecken" wert={String(flaeche.punkte.length)} />
      </dl>

      {flaeche.hindernisse.length > 0 ? (
        <section>
          <h4 className="text-[12px] font-bold">Hindernisse ({flaeche.hindernisse.length})</h4>
          <ul className="mt-1.5 flex flex-col gap-1.5">
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
                  className={`${FELD_NUM} h-9 w-[72px] shrink-0 px-2 text-center`}
                />
                {schreibrecht ? (
                  <button
                    type="button"
                    onClick={() =>
                      aendere((f) => ({ ...f, hindernisse: f.hindernisse.filter((x) => x.id !== h.id) }))
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
    <section className={KARTE}>
      <button
        type="button"
        onClick={() => setOffen((o) => !o)}
        className="flex w-full items-center justify-between text-[13px] font-bold"
      >
        Standardform setzen
        <span className="text-muted" aria-hidden>
          {offen ? "−" : "+"}
        </span>
      </button>

      {offen ? (
        <div className="mt-3 flex flex-col gap-2.5">
          <Feld label="Form">
            <select value={form} onChange={(e) => setForm(e.target.value as Dachform)} className={FELD}>
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
                onChange={(e) => setBreite(Number(e.target.value) || 1)} className={FELD_NUM} />
            </Feld>
            <Feld label="Tiefe (m)">
              <input type="number" min={1} step={0.5} value={tiefe}
                onChange={(e) => setTiefe(Number(e.target.value) || 1)} className={FELD_NUM} />
            </Feld>
            <Feld label="Drehung (°)">
              <input type="number" step={1} value={drehung}
                onChange={(e) => setDrehung(Number(e.target.value) || 0)} className={FELD_NUM} />
            </Feld>
            <Feld label="Neigung (°)">
              <input type="number" min={0} max={75} step={1} value={neigung}
                onChange={(e) => setNeigung(Number(e.target.value) || 0)} className={FELD_NUM} />
            </Feld>
          </div>
          <button
            type="button"
            className="flex h-11 items-center justify-center rounded-[10px] bg-accent px-4 font-bold text-white transition-colors hover:bg-accent-to"
            onClick={() => {
              const neue = dachformFlaechen({ form, breite, tiefe, mitte, drehung, neigung }, plan.flaechen);
              onPlan({ ...plan, flaechen: [...plan.flaechen, ...neue] }, true);
              if (neue[0]) onAktiv(neue[0].id);
              setOffen(false);
            }}
          >
            In die Bildmitte setzen
          </button>
          <p className="text-[11px] leading-[1.45] text-muted">
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

function Feld({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11.5px] font-semibold text-muted">{label}</span>
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

/* ── Gebäude ───────────────────────────────────────────────────── */

/**
 * Wandhöhe und Dachüberstand für die räumliche Ansicht.
 *
 * Sie ändern nichts an der Rechnung — die Belegung, der Ertrag und die
 * Prüfung kennen nur die Draufsicht und die Neigung. Was sie ändern,
 * ist das Bild, das der Kunde sieht: Ein Haus mit 3 m Wandhöhe und
 * einem Dach ohne Überstand sieht aus wie ein Schuhkarton.
 */
function Gebaeude({ plan, onPlan }: { plan: Plan; onPlan: (p: Plan, schritt: boolean) => void }) {
  const g = plan.gebaeude;
  const setze = (teil: Partial<typeof g>) =>
    onPlan({ ...plan, gebaeude: { ...g, ...teil } }, true);

  return (
    <section className={KARTE}>
      <h3 className="text-[13px] font-bold">Gebäude</h3>
      <p className="mt-0.5 text-[11.5px] leading-[1.4] text-muted">
        Nur für die räumliche Ansicht — auf Ertrag und Prüfung ohne Wirkung.
      </p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <Feld label="Wandhöhe (m)">
          <input
            type="number"
            min={0}
            max={50}
            step={0.5}
            value={g.wandhoehe}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v) && v >= 0 && v <= 50) setze({ wandhoehe: v });
            }}
            className={FELD}
          />
        </Feld>
        <Feld label="Dachüberstand (m)">
          <input
            type="number"
            min={0}
            max={3}
            step={0.05}
            value={g.ueberstand}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v) && v >= 0 && v <= 3) setze({ ueberstand: v });
            }}
            className={FELD}
          />
        </Feld>
      </div>
    </section>
  );
}
