"use client";

import { useState } from "react";
import type { Dachflaeche } from "@/lib/planer/flaeche";
import type { Plan } from "@/lib/planer/plan";
import { naechsteId } from "@/lib/planer/plan";
import {
  aktiveZellen,
  anzahlModule,
  autoBelegen,
  kwp,
  modulEcken,
  type Modulgruppe,
  nachfuehren,
  reihenabstandVorschlag,
  STANDARD_MODUL,
} from "@/lib/planer/module";

/*
 * Belegung einer Dachfläche (Briefing 4).
 *
 * Die automatische Belegung ist ein STARTVORSCHLAG, kein Ergebnis: was
 * sie hinlegt, ist eine ganz normale Gruppe und lässt sich danach
 * verschieben und in Teilen abschalten. Deshalb steht der Knopf auch
 * nicht allein da — daneben die Liste der Gruppen mit ihren Werten.
 */

const FELD =
  "h-11 w-full rounded-[10px] border border-line bg-surface px-3 text-[14px] text-ink " +
  "outline-none transition-colors focus:border-accent disabled:opacity-60";
const FELD_NUM = `${FELD} num tabular-nums`;
const KARTE = "rounded-[12px] border border-line bg-surface p-3.5";

export function BelegungsPanel({
  plan,
  flaeche,
  aktiveGruppe,
  onAktiveGruppe,
  onPlan,
  schreibrecht,
  breitengrad,
}: {
  plan: Plan;
  flaeche: Dachflaeche;
  aktiveGruppe: string | null;
  onAktiveGruppe: (id: string | null) => void;
  onPlan: (plan: Plan, schritt: boolean) => void;
  schreibrecht: boolean;
  /** Für den Reihenabstands-Vorschlag beim Flachdach. */
  breitengrad: number;
}) {
  const [laeuft, setLaeuft] = useState(false);
  const eigene = plan.gruppen.filter((g) => g.flaeche === flaeche.id);
  const gruppe = eigene.find((g) => g.id === aktiveGruppe) ?? null;
  const flachdach = flaeche.neigung === 0;

  const setzeGruppe = (id: string, wie: (g: Modulgruppe) => Modulgruppe) => {
    onPlan({ ...plan, gruppen: plan.gruppen.map((g) => (g.id === id ? wie(g) : g)) }, true);
  };

  /** Module der anderen Gruppen — die bleiben belegt. */
  const besetzt = (ausser?: string) =>
    plan.gruppen
      .filter((g) => g.flaeche === flaeche.id && g.id !== ausser)
      .flatMap((g) => aktiveZellen(g).map((z) => modulEcken(g, flaeche, z.reihe, z.spalte)));

  function belegen() {
    setLaeuft(true);
    try {
      const id = naechsteId(plan.gruppen.map((g) => g.id), "g");
      const neu = autoBelegen(flaeche, id, `Feld ${eigene.length + 1}`, {
        typ: STANDARD_MODUL,
        ausrichtung: "hoch",
        reihenabstand: flachdach ? reihenabstandVorschlag(STANDARD_MODUL.hoehe, 15, breitengrad) : 0.02,
        spaltenabstand: 0.02,
        winkel: 0,
        aufstaenderung: flachdach ? { art: "sued", winkel: 15 } : null,
        besetzt: besetzt(),
      });
      if (!neu) {
        window.alert(
          "Hier passt kein Modul mehr hinein. Randabstand, Hindernisse oder bereits belegte Flächen prüfen.",
        );
        return;
      }
      onPlan({ ...plan, gruppen: [...plan.gruppen, neu] }, true);
      onAktiveGruppe(neu.id);
    } finally {
      setLaeuft(false);
    }
  }

  const modulzahl = eigene.reduce((s, g) => s + anzahlModule(g), 0);
  const leistung = eigene.reduce((s, g) => s + kwp(g), 0);

  return (
    <section className={`${KARTE} flex flex-col gap-3`}>
      <div className="flex items-baseline justify-between">
        <h3 className="text-[13px] font-bold">Belegung</h3>
        {modulzahl > 0 ? (
          <span className="num text-[11.5px] tabular-nums text-muted">
            {modulzahl} Module · {leistung.toFixed(2).replace(".", ",")} kWp
          </span>
        ) : null}
      </div>

      {schreibrecht ? (
        <button
          type="button"
          disabled={laeuft}
          onClick={belegen}
          className="flex h-11 items-center justify-center rounded-[10px] bg-accent px-4 font-bold text-white transition-colors hover:bg-accent-to disabled:opacity-50"
        >
          {eigene.length === 0 ? "Fläche automatisch belegen" : "Restfläche belegen"}
        </button>
      ) : null}

      {eigene.length === 0 ? (
        <p className="text-[12px] leading-[1.45] text-muted">
          Der Vorschlag füllt die Fläche unter Randabstand und Hindernissen. Danach lassen sich
          einzelne Module wegtippen und die Gruppe verschieben.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {eigene.map((g) => (
            <li key={g.id}>
              <button
                type="button"
                onClick={() => onAktiveGruppe(g.id === aktiveGruppe ? null : g.id)}
                className={[
                  "flex w-full items-center justify-between rounded-[10px] px-2.5 py-2 text-left text-[13px]",
                  g.id === aktiveGruppe ? "bg-accent-sunk font-semibold" : "hover:bg-sunk",
                ].join(" ")}
              >
                <span className="truncate">{g.name}</span>
                <span className="num shrink-0 text-[11.5px] tabular-nums text-muted">
                  {anzahlModule(g)} · {kwp(g).toFixed(2).replace(".", ",")} kWp
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {gruppe ? (
        <div className="flex flex-col gap-3 border-t border-line pt-3">
          <div className="grid grid-cols-2 gap-2.5">
            <Feld label="Ausrichtung">
              <select
                value={gruppe.ausrichtung}
                disabled={!schreibrecht}
                onChange={(e) =>
                  setzeGruppe(gruppe.id, (g) =>
                    nachfuehren(
                      { ...g, ausrichtung: e.target.value as "hoch" | "quer" },
                      flaeche,
                      besetzt(g.id),
                    ),
                  )
                }
                className={FELD}
              >
                <option value="hoch">Hochformat</option>
                <option value="quer">Querformat</option>
              </select>
            </Feld>
            <Feld label="Drehung (°)">
              <input
                type="number"
                step={0.5}
                value={gruppe.winkel}
                disabled={!schreibrecht}
                onChange={(e) =>
                  setzeGruppe(gruppe.id, (g) =>
                    nachfuehren({ ...g, winkel: Number(e.target.value) || 0 }, flaeche, besetzt(g.id)),
                  )
                }
                className={FELD_NUM}
              />
            </Feld>
            <Feld label="Reihenabstand (m)">
              <input
                type="number"
                min={0}
                step={0.01}
                value={gruppe.reihenabstand}
                disabled={!schreibrecht}
                onChange={(e) =>
                  setzeGruppe(gruppe.id, (g) =>
                    nachfuehren(
                      { ...g, reihenabstand: Math.max(0, Number(e.target.value) || 0) },
                      flaeche,
                      besetzt(g.id),
                    ),
                  )
                }
                className={FELD_NUM}
              />
            </Feld>
            <Feld label="Spaltenabstand (m)">
              <input
                type="number"
                min={0}
                step={0.01}
                value={gruppe.spaltenabstand}
                disabled={!schreibrecht}
                onChange={(e) =>
                  setzeGruppe(gruppe.id, (g) =>
                    nachfuehren(
                      { ...g, spaltenabstand: Math.max(0, Number(e.target.value) || 0) },
                      flaeche,
                      besetzt(g.id),
                    ),
                  )
                }
                className={FELD_NUM}
              />
            </Feld>
          </div>

          {flachdach ? (
            <Aufstaenderung
              gruppe={gruppe}
              flaeche={flaeche}
              breitengrad={breitengrad}
              schreibrecht={schreibrecht}
              setzeGruppe={setzeGruppe}
              besetzt={besetzt}
            />
          ) : null}

          {schreibrecht ? (
            <button
              type="button"
              onClick={() => {
                onPlan({ ...plan, gruppen: plan.gruppen.filter((g) => g.id !== gruppe.id) }, true);
                onAktiveGruppe(null);
              }}
              className="self-start text-[12.5px] text-muted hover:text-s-crit"
            >
              Gruppe entfernen
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function Aufstaenderung({
  gruppe,
  flaeche,
  breitengrad,
  schreibrecht,
  setzeGruppe,
  besetzt,
}: {
  gruppe: Modulgruppe;
  flaeche: Dachflaeche;
  breitengrad: number;
  schreibrecht: boolean;
  setzeGruppe: (id: string, wie: (g: Modulgruppe) => Modulgruppe) => void;
  besetzt: (ausser?: string) => Array<Array<{ x: number; y: number }>>;
}) {
  const auf = gruppe.aufstaenderung;
  const vorschlag = auf
    ? reihenabstandVorschlag(gruppe.typ.hoehe, auf.winkel, breitengrad)
    : 0;

  return (
    <div className="rounded-[10px] bg-sunk p-2.5">
      <h4 className="text-[12px] font-bold">Aufständerung</h4>
      <div className="mt-2 grid grid-cols-2 gap-2.5">
        <Feld label="Art">
          <select
            value={auf?.art ?? ""}
            disabled={!schreibrecht}
            onChange={(e) =>
              setzeGruppe(gruppe.id, (g) =>
                nachfuehren(
                  {
                    ...g,
                    aufstaenderung: e.target.value
                      ? { art: e.target.value as "sued" | "ost-west", winkel: auf?.winkel ?? 15 }
                      : null,
                  },
                  flaeche,
                  besetzt(g.id),
                ),
              )
            }
            className={FELD}
          >
            <option value="">flach aufliegend</option>
            <option value="sued">Süd</option>
            <option value="ost-west">Ost-West</option>
          </select>
        </Feld>
        <Feld label="Winkel (°)">
          <input
            type="number"
            min={0}
            max={60}
            step={1}
            value={auf?.winkel ?? 0}
            disabled={!schreibrecht || !auf}
            onChange={(e) =>
              setzeGruppe(gruppe.id, (g) =>
                nachfuehren(
                  {
                    ...g,
                    aufstaenderung: g.aufstaenderung
                      ? { ...g.aufstaenderung, winkel: Math.max(0, Math.min(60, Number(e.target.value) || 0)) }
                      : null,
                  },
                  flaeche,
                  besetzt(g.id),
                ),
              )
            }
            className={FELD_NUM}
          />
        </Feld>
      </div>

      {auf && schreibrecht ? (
        <button
          type="button"
          onClick={() =>
            setzeGruppe(gruppe.id, (g) =>
              nachfuehren({ ...g, reihenabstand: vorschlag }, flaeche, besetzt(g.id)),
            )
          }
          className="mt-2 text-left text-[11.5px] text-accent-ink hover:underline"
          title={
            `Schattenlänge am 21. Dezember: Modullänge · sin(${auf.winkel}°) geteilt durch ` +
            `tan(Sonnenhöhe). Bei ${breitengrad.toFixed(1)}° Breite steht die Sonne dann ` +
            `${(90 - Math.abs(breitengrad) - 23.44).toFixed(1)}° hoch.`
          }
        >
          Reihenabstand gegen Winterverschattung vorschlagen:{" "}
          <span className="num">{vorschlag.toFixed(2).replace(".", ",")} m</span>
        </button>
      ) : null}
    </div>
  );
}

function Feld({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11.5px] font-semibold text-muted">{label}</span>
      {children}
    </label>
  );
}
