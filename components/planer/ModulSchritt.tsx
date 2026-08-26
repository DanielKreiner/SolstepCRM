"use client";

import { useState } from "react";

import { num } from "@/lib/format";
import type { Dachflaeche } from "@/lib/planer/flaeche";
import {
  achsen,
  aktiveZellen,
  anzahlModule,
  abstandVorschlag,
  autoBelegen,
  ostWestWinkel,
  kwp,
  type Modulgruppe,
  modulEcken,
  nachfuehren,
  planMasse,
  STANDARD_MODUL,
} from "@/lib/planer/module";
import { naechsteId, type Plan } from "@/lib/planer/plan";
import { Frage, Knopf, Listenzeile, Mehr, Stand, Wahlkarte, Zahlfeld } from "./Bausteine";
import { ZeichenModul, ZeichenPlus } from "./Zeichen";
import { modulTyp, planMitModul } from "./modulwahl";
import type { GeraetModul } from "./TechnikPanel";
import type { Werkzeug } from "./Leinwand";
import type { Aufbauart } from "@/lib/planer/setzen";

/*
 * Schritt 2 — „Welche Module, und wie viele passen?"
 *
 * Die Modulwahl steht ZUERST, und das ist der Kern dieses Schritts:
 * Modulmasse bestimmen das Raster. Vorher lag die Wahl im
 * Technik-Schritt, also NACH der Belegung — geplant wurde mit einem
 * Standardmodul, und wer danach sein echtes Modul wählte, bekam eine
 * andere Spaltenzahl. Beim Kunden am Tisch änderte sich die Anlage,
 * während man über den Preis sprach.
 */

export interface ModulSchrittProps {
  plan: Plan;
  aktiv: string | null;
  onAktiv: (id: string | null) => void;
  aktiveGruppe: string | null;
  onAktiveGruppe: (id: string | null) => void;
  onPlan: (plan: Plan, schritt: boolean) => void;
  module: GeraetModul[];
  breitengrad: number;
  schreibrecht: boolean;
  /**
   * Die gewählte Aufständerung an den Planer melden.
   *
   * Sie muss bis zum einzeln gesetzten Modul durchkommen: Dort entsteht
   * die Gruppe in der Leinwand, nicht hier.
   */
  onAufbau: (art: Aufbauart) => void;
  werkzeug: Werkzeug;
  onWerkzeug: (w: Werkzeug) => void;
}

/**
 * Anzeigename eines Moduls ohne doppelten Hersteller.
 *
 * Im Materialstamm steht der Hersteller oft schon in der Bezeichnung
 * („AIKO Neostar 2P+"). Zusammengesetzt las sich das als „AIKO AIKO
 * Neostar 2P+" — und weil die Karte kürzt, blieb vom eigentlichen Typ
 * nichts übrig.
 */
export function modulname(m: { hersteller: string; bezeichnung: string }): string {
  const h = m.hersteller.trim();
  const b = m.bezeichnung.trim();
  return b.toLowerCase().startsWith(h.toLowerCase()) ? b : `${h} ${b}`;
}

/** Wie die Module auf einem Flachdach stehen. */


/*
 * Ost/West steht oben und ist die Vorgabe.
 *
 * Auf einem Flachdach ist es der Normalfall: quer liegende Module Rücken
 * an Rücken bringen rund die Hälfte mehr Leistung aufs selbe Dach als
 * die Südreihen, die einander Abstand lassen müssen. Wer Süd will,
 * wählt es — aber niemand soll sich die häufigste Bauform erst
 * heraussuchen müssen.
 */
const AUFBAUARTEN: Array<{ id: Aufbauart; label: string; hinweis: string }> = [
  {
    id: "ost-west",
    label: "Ost / West",
    hinweis: "Quer, Rücken an Rücken — mehr Module aufs Dach, gleichmässiger über den Tag",
  },
  {
    id: "sued",
    label: "Nach Süden aufgeständert",
    hinweis: "Höchster Ertrag je Modul, aber Reihenabstand gegen Verschattung",
  },
  {
    id: "flach",
    label: "Flach aufliegend",
    hinweis: "Ohne Gestell, wenig Ballast — dafür weniger Ertrag und Selbstreinigung",
  },
];

/**
 * Wie die Module bei dieser Aufständerung liegen.
 *
 * Ost/West wird quer gebaut: Das Gestell trägt die lange Kante, die
 * Reihe wird niedriger, und auf dieselbe Dachtiefe passen mehr Paare.
 * Süd und flach liegen hoch.
 */
function lageFuer(art: "sued" | "ost-west" | null): "hoch" | "quer" {
  return art === "ost-west" ? "quer" : "hoch";
}

export function ModulSchritt(p: ModulSchrittProps) {
  const [hinweis, setHinweis] = useState<string | null>(null);
  /*
   * Welche Fläche gerade auf die Frage nach der Aufständerung wartet —
   * und wofür.
   *
   * Auf dem Flachdach entscheidet sie alles: Reihenabstand,
   * Ausrichtung, Ertrag und Ballast. Deshalb wird sie gefragt, bevor
   * das erste Modul liegt, und zwar auf BEIDEN Wegen. Vorher kam die
   * Frage nur beim Vollbelegen; wer mit einem einzelnen Modul anfing,
   * bekam stillschweigend Ost/West.
   */
  const [fragt, setFragt] = useState<{
    flaeche: Dachflaeche;
    fuer: "voll" | "einzeln";
  } | null>(null);
  const gewaehltesModul = p.module.find((m) => m.id === p.plan.technik.modul) ?? null;
  /*
   * KEIN Rückfall auf die erste Fläche.
   *
   * Vorher belegte „Restfläche belegen" bei mehreren Dächern
   * irgendeines — nämlich das erste in der Liste. Wer zwei Dachflächen
   * hat, findet die Module dann dort, wo er sie nicht wollte. Ist keine
   * gewählt, wird gefragt.
   */
  const mehrereFlaechen = p.plan.flaechen.length > 1;
  const gruppe = p.plan.gruppen.find((g) => g.id === p.aktiveGruppe) ?? null;
  const flaecheDerGruppe = gruppe
    ? (p.plan.flaechen.find((f) => f.id === gruppe.flaeche) ?? null)
    : null;
  /*
   * Wohl aber auf die Fläche des Feldes, an dem gerade gearbeitet wird:
   * Wer ein Feld mit einem einzelnen Modul beginnt, will es dort
   * weiterbauen. Vorher fragte das Panel danach noch einmal „welche
   * Fläche soll belegt werden?", obwohl das erste Modul schon lag.
   */
  const flaeche =
    p.plan.flaechen.find((f) => f.id === p.aktiv) ?? flaecheDerGruppe;
  // Nicht `module`: In Next.js ist der Name gesperrt.
  const modulzahl = p.plan.gruppen.reduce((s, g) => s + anzahlModule(g), 0);
  const leistung = p.plan.gruppen.reduce((s, g) => s + kwp(g), 0);

  /**
   * Muss vor dem ersten Modul gefragt werden?
   *
   * Nur beim Flachdach, und nur solange dort noch nichts liegt: Bei
   * einem geneigten Dach gibt es nichts zu entscheiden, und ein zweites
   * Feld erbt die Bauart des ersten.
   */
  const fragenNoetig = (f: Dachflaeche) =>
    f.neigung === 0 && !p.plan.gruppen.some((g) => g.flaeche === f.id);

  /** Module der übrigen Gruppen — die bleiben besetzt. */
  const besetzt = (f: Dachflaeche, ausser?: string) =>
    p.plan.gruppen
      .filter((g) => g.flaeche === f.id && g.id !== ausser)
      .flatMap((g) => aktiveZellen(g).map((z) => modulEcken(g, f, z.reihe, z.spalte)));

  function belegen(f: Dachflaeche, art: Aufbauart = "ost-west") {
    const flach = f.neigung === 0;
    const typ = gewaehltesModul ? modulTyp(gewaehltesModul) : STANDARD_MODUL;
    /*
     * Ost/West kippt nach Osten und Westen, und die Reihen laufen dabei
     * parallel zur passendsten Dachkante. Ein fester Winkel ging schief,
     * sobald die Fläche eine Traufe trug: Das Raster hängt an ihren
     * Achsen, und die Paare schauten dann nach Süden.
     */
    const drehung = art === "ost-west" && flach ? ostWestWinkel(f) : 0;
    /*
     * Auf dem Flachdach entscheidet die Aufständerung alles: Reihenabstand,
     * Ausrichtung, Ertrag und Ballast. Deshalb wird sie GEFRAGT, bevor
     * das erste Modul liegt — vorher stand hier stillschweigend Süd,
     * und wer Ost/West wollte, musste die fertige Belegung umstellen
     * und sich dabei die halbe Reihe wegrechnen lassen.
     */
    const aufstaenderung =
      flach && art !== "flach" ? { art, winkel: 15 } : null;
    /*
     * Der Reihenabstand kommt aus dem Winkel, nicht aus einer festen
     * Zahl — bei Süd die Schattenlänge im Dezember, bei Ost/West der
     * Gang zwischen den Paaren.
     */
    const vorlage = {
      typ,
      ausrichtung: lageFuer(aufstaenderung?.art ?? null),
      spaltenabstand: 0.02,
      winkel: drehung,
      aufstaenderung,
      reihenabstand: 0.02,
    };
    const reihenabstand = abstandVorschlag(vorlage, p.breitengrad);
    const neu = autoBelegen(f, naechsteId(p.plan.gruppen.map((g) => g.id), "g"), `Feld ${p.plan.gruppen.length + 1}`, {
      ...vorlage,
      reihenabstand,
      besetzt: besetzt(f),
    });
    if (!neu) return;
    p.onPlan({ ...p.plan, gruppen: [...p.plan.gruppen, neu] }, true);
    p.onAktiveGruppe(neu.id);
    p.onAktiv(f.id);
  }

  /**
   * Eine bestehende Gruppe auf eine andere Aufständerung umstellen.
   *
   * Art, Ausrichtung, Drehung und Reihenabstand hängen zusammen — wer
   * nur eines davon ändert, bekommt Ost/West-Module im Hochformat, die
   * nach Norden schauen. Deshalb an einer Stelle, für die Knopfreihe
   * unter dem Feld und für das Auswahlfeld in der Feineinstellung.
   */
  function aufbauUmstellen(gruppeId: string, art: Aufbauart, f: Dachflaeche) {
    setzeGruppe(gruppeId, (g) => {
      const aufstaenderung =
        art === "flach" ? null : { art, winkel: g.aufstaenderung?.winkel ?? 15 };
      const umgestellt = {
        ...g,
        aufstaenderung,
        winkel: aufstaenderung?.art === "ost-west" ? ostWestWinkel(f) : 0,
        ausrichtung: lageFuer(aufstaenderung?.art ?? null),
      };
      return nachfuehren(
        { ...umgestellt, reihenabstand: abstandVorschlag(umgestellt, p.breitengrad) },
        f,
        besetzt(f, g.id),
      );
    });
  }

  const setzeGruppe = (id: string, wie: (g: Modulgruppe) => Modulgruppe) =>
    p.onPlan({ ...p.plan, gruppen: p.plan.gruppen.map((g) => (g.id === id ? wie(g) : g)) }, true);

  return (
    <div className="flex flex-col gap-3.5">
      <Frage
        text={gewaehltesModul ? "Module aufs Dach" : "Welches Modul wird verbaut?"}
        hinweis={
          gewaehltesModul
            ? "Ein Modul antippen nimmt es weg. Auf ein + tippen legt eines dazu."
            : "Die Modulgrösse bestimmt das Raster — deshalb kommt sie vor der Belegung."
        }
      />

      {/* ── Modulwahl ─────────────────────────────────────────────── */}
      {p.module.length === 0 ? (
        <p className="rounded-[14px] border border-line bg-surface p-3.5 text-[13.5px] leading-[1.5] text-muted">
          Im Materialstamm liegt noch kein Modul. Unter Material ein Solarmodul anlegen — Breite,
          Höhe und Wattzahl genügen.
        </p>
      ) : (
        <div className="flex max-h-[280px] flex-col gap-2 overflow-auto pr-0.5">
          {p.module.map((m) => (
            <Wahlkarte
              key={m.id}
              titel={modulname(m)}
              zeile={`${num(m.wp)} Wp · ${Number(m.breite).toFixed(3).replace(".", ",")} × ${Number(m.hoehe).toFixed(3).replace(".", ",")} m`}
              gewaehlt={m.id === p.plan.technik.modul}
              kennung="modul-karte"
              aus={!p.schreibrecht}
              onClick={() => p.onPlan(planMitModul(p.plan, m.id, p.module), true)}
            />
          ))}
        </div>
      )}

      {/* ── Welche Fläche? ────────────────────────────────────────── */}
      {p.schreibrecht && !flaeche && p.plan.flaechen.length > 0 ? (
        <div className="flex flex-col gap-2 rounded-[14px] border border-line bg-surface p-3.5">
          <h3 className="text-[13.5px] font-bold">Welche Fläche soll belegt werden?</h3>
          {p.plan.flaechen.map((f) => (
            <Knopf key={f.id} art="zweit" onClick={() => p.onAktiv(f.id)}>
              {f.name}
            </Knopf>
          ))}
        </div>
      ) : null}

      {/* ── Belegen ───────────────────────────────────────────────── */}
      {p.schreibrecht && flaeche ? (
        <Knopf
          art={p.werkzeug === "setzen" ? "haupt" : "zweit"}
          onClick={() => {
            if (p.werkzeug === "setzen") {
              p.onWerkzeug("auswahl");
              return;
            }
            if (fragenNoetig(flaeche)) {
              setFragt({ flaeche, fuer: "einzeln" });
              return;
            }
            p.onWerkzeug("setzen");
          }}
          zeichen={<ZeichenPlus />}
          aus={p.module.length > 0 && !gewaehltesModul}
        >
          {p.werkzeug === "setzen" ? "Setzen beenden" : "Modul einzeln setzen"}
        </Knopf>
      ) : null}

      {/*
        Die Frage vor dem ersten Modul — auf beiden Wegen dieselbe.
      */}
      {p.schreibrecht && fragt ? (
        <section className="flex flex-col gap-2 rounded-[14px] border border-accent bg-accent-sunk p-3.5">
          <h3 className="text-[14px] font-bold">Wie sollen die Module stehen?</h3>
          <p className="text-[12.5px] leading-[1.45] text-muted">
            {fragt.flaeche.name} ist ein Flachdach. Die Aufständerung bestimmt Reihenabstand,
            Ausrichtung und Ertrag — deshalb kommt sie vor dem ersten Modul.
          </p>
          {AUFBAUARTEN.map((a, i) => (
            <button
              key={a.id}
              type="button"
              onClick={() => {
                const ziel = fragt;
                setFragt(null);
                p.onAufbau(a.id);
                if (ziel.fuer === "voll") belegen(ziel.flaeche, a.id);
                else p.onWerkzeug("setzen");
              }}
              className="flex flex-col items-start gap-0.5 rounded-[12px] border border-line bg-surface px-3.5 py-2.5 text-left transition-colors hover:border-accent"
            >
              <span className="text-[14px] font-bold">
                {a.label}
                {i === 0 ? " · Vorgabe" : ""}
              </span>
              <span className="text-[11.5px] leading-[1.4] text-muted">{a.hinweis}</span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => setFragt(null)}
            className="h-9 text-[12.5px] font-semibold text-muted hover:text-ink"
          >
            Abbrechen
          </button>
        </section>
      ) : null}

      {/*
        Wie die Module stehen — nach der Belegung, nicht davor.

        Vorher kam auf dem Flachdach erst eine Frage und dann die
        Belegung. Das war ein Klick zu viel für den Normalfall: Ost/West
        ist auf einem Flachdach die übliche Bauform. Jetzt liegt sie
        gleich, und die drei Arten stehen sichtbar daneben — umstellen
        ist ein Tipp, und man sieht sofort, was sich am Dach ändert.
      */}
      {p.schreibrecht && gruppe && flaecheDerGruppe && flaecheDerGruppe.neigung === 0 ? (
        <section className="flex flex-col gap-2 rounded-[14px] border border-line bg-surface p-3.5">
          <h3 className="text-[13.5px] font-bold">Wie die Module stehen</h3>
          {AUFBAUARTEN.map((a) => {
            const jetzt = (gruppe.aufstaenderung?.art ?? "flach") as Aufbauart;
            return (
              <button
                key={a.id}
                type="button"
                aria-pressed={jetzt === a.id}
                onClick={() => aufbauUmstellen(gruppe.id, a.id, flaecheDerGruppe)}
                className={[
                  "flex flex-col items-start gap-0.5 rounded-[12px] border px-3.5 py-2.5 text-left transition-colors",
                  jetzt === a.id
                    ? "border-accent bg-accent-sunk"
                    : "border-line bg-surface hover:border-accent",
                ].join(" ")}
              >
                <span className="text-[14px] font-bold">{a.label}</span>
                <span className="text-[11.5px] leading-[1.4] text-muted">{a.hinweis}</span>
              </button>
            );
          })}
        </section>
      ) : null}

      {p.schreibrecht && flaeche ? (
        <Knopf
          onClick={() => {
            if (fragenNoetig(flaeche)) {
              setFragt({ flaeche, fuer: "voll" });
              return;
            }
            belegen(flaeche);
          }}
          zeichen={p.plan.gruppen.length === 0 ? <ZeichenModul /> : <ZeichenPlus />}
          aus={p.module.length > 0 && !gewaehltesModul}
          titel={
            p.module.length > 0 && !gewaehltesModul ? "Zuerst oben ein Modul wählen" : undefined
          }
        >
          {p.plan.gruppen.some((g) => g.flaeche === flaeche.id)
            ? `Restfläche belegen${mehrereFlaechen ? ` (${flaeche.name})` : ""}`
            : `Dach voll belegen${mehrereFlaechen ? ` (${flaeche.name})` : ""}`}
        </Knopf>
      ) : null}

      {modulzahl > 0 ? (
        <Stand
          eintraege={[
            { label: "Module", wert: String(modulzahl) },
            { label: "Leistung", wert: `${leistung.toFixed(2).replace(".", ",")} kWp` },
          ]}
        />
      ) : null}

      {/* ── Felder ────────────────────────────────────────────────── */}
      {p.plan.gruppen.length > 0 ? (
        <div className="flex flex-col gap-2">
          {p.plan.gruppen.map((g) => (
            <Listenzeile
              key={g.id}
              titel={g.name}
              wert={`${anzahlModule(g)} Stk`}
              gewaehlt={g.id === p.aktiveGruppe}
              onClick={() => {
                // Auswählen, nicht umschalten — sonst leert sich das Panel.
                p.onAktiveGruppe(g.id);
                p.onAktiv(g.flaeche);
              }}
              {...(p.schreibrecht
                ? {
                    onWeg: () => {
                      p.onPlan(
                        { ...p.plan, gruppen: p.plan.gruppen.filter((x) => x.id !== g.id) },
                        true,
                      );
                      if (p.aktiveGruppe === g.id) p.onAktiveGruppe(null);
                    },
                  }
                : {})}
            />
          ))}
        </div>
      ) : null}

      {/*
        * ── Feineinstellung ──────────────────────────────────────────
        *
        * „Feineinstellung" und nicht „Feld 1 einstellen": Sonst heisst
        * dieser Knopf fast wie die Zeile des Feldes darüber, und wer
        * nach dem Feld sucht — im Test wie mit der Tastatur — findet
        * zwei Ziele.
        */}
      {gruppe ? (
        <Mehr titel="Feineinstellung">
          <div className="grid grid-cols-2 gap-2">
            <Knopf
              art={gruppe.ausrichtung === "hoch" ? "haupt" : "zweit"}
              onClick={() =>
                setzeGruppe(gruppe.id, (g) => {
                  const f = p.plan.flaechen.find((x) => x.id === g.flaeche);
                  const neu = { ...g, ausrichtung: "hoch" as const };
                  return f ? nachfuehren(neu, f, besetzt(f, g.id)) : neu;
                })
              }
            >
              Hochkant
            </Knopf>
            <Knopf
              art={gruppe.ausrichtung === "quer" ? "haupt" : "zweit"}
              onClick={() =>
                setzeGruppe(gruppe.id, (g) => {
                  const f = p.plan.flaechen.find((x) => x.id === g.flaeche);
                  const neu = { ...g, ausrichtung: "quer" as const };
                  return f ? nachfuehren(neu, f, besetzt(f, g.id)) : neu;
                })
              }
            >
              Quer
            </Knopf>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <Zahlfeld
              label="Drehung"
              einheit="°"
              wert={Math.round(gruppe.winkel)}
              min={-89}
              max={89}
              aus={!p.schreibrecht}
              onWert={(v) =>
                setzeGruppe(gruppe.id, (g) => {
                  const f = p.plan.flaechen.find((x) => x.id === g.flaeche);
                  const neu = { ...g, winkel: v };
                  return f ? nachfuehren(neu, f, besetzt(f, g.id)) : neu;
                })
              }
            />
            <Zahlfeld
              label="Reihenabstand"
              einheit="m"
              schritt={0.01}
              wert={gruppe.reihenabstand}
              min={0}
              max={5}
              aus={!p.schreibrecht}
              onWert={(v) =>
                setzeGruppe(gruppe.id, (g) => {
                  const f = p.plan.flaechen.find((x) => x.id === g.flaeche);
                  const neu = { ...g, reihenabstand: v };
                  return f ? nachfuehren(neu, f, besetzt(f, g.id)) : neu;
                })
              }
            />
          </div>

          {/* Flachdach: Aufständerung und Reihenabstand gegen Winterschatten. */}
          {flaecheDerGruppe && flaecheDerGruppe.neigung === 0 ? (
            <div className="flex flex-col gap-2.5 rounded-[12px] bg-sunk p-3">
              <label className="flex flex-col gap-1.5">
                <span className="text-[12.5px] font-semibold text-muted">Aufständerung</span>
                <select
                  aria-label="Aufständerung"
                  value={gruppe.aufstaenderung?.art ?? ""}
                  disabled={!p.schreibrecht}
                  onChange={(e) =>
                    aufbauUmstellen(
                      gruppe.id,
                      (e.target.value || "flach") as Aufbauart,
                      flaecheDerGruppe,
                    )
                  }
                  className="h-[52px] rounded-[14px] border border-line bg-surface px-3 text-[15px] outline-none focus:border-accent"
                >
                  <option value="">flach aufliegend</option>
                  <option value="sued">Süd</option>
                  <option value="ost-west">Ost-West</option>
                </select>
              </label>

              {gruppe.aufstaenderung ? (
                <>
                  <Zahlfeld
                    label="Winkel"
                    einheit="°"
                    wert={gruppe.aufstaenderung.winkel}
                    min={0}
                    max={60}
                    aus={!p.schreibrecht}
                    onWert={(v) =>
                      setzeGruppe(gruppe.id, (g) => {
                        const gedreht = {
                          ...g,
                          aufstaenderung: g.aufstaenderung
                            ? { ...g.aufstaenderung, winkel: v }
                            : null,
                        };
                        return nachfuehren(
                          {
                            ...gedreht,
                            reihenabstand: abstandVorschlag(gedreht, p.breitengrad),
                          },
                          flaecheDerGruppe,
                          besetzt(flaecheDerGruppe, g.id),
                        );
                      })
                    }
                  />
                  {p.schreibrecht ? (
                    <Knopf
                      art="zweit"
                      onClick={() =>
                        setzeGruppe(gruppe.id, (g) =>
                          nachfuehren(
                            { ...g, reihenabstand: abstandVorschlag(g, p.breitengrad) },
                            flaecheDerGruppe,
                            besetzt(flaecheDerGruppe, g.id),
                          ),
                        )
                      }
                      titel={
                        `Schattenlänge am 21. Dezember: Modullänge · sin(Winkel) geteilt durch ` +
                        `tan(Sonnenhöhe). Bei ${p.breitengrad.toFixed(1)}° Breite steht die Sonne dann ` +
                        `${(90 - Math.abs(p.breitengrad) - 23.44).toFixed(1)}° hoch.`
                      }
                    >
                      Reihenabstand zurücksetzen:{" "}
                      {abstandVorschlag(gruppe, p.breitengrad).toFixed(2).replace(".", ",")}{" "}
                      m
                    </Knopf>
                  ) : null}
                </>
              ) : null}
            </div>
          ) : null}

          {p.schreibrecht ? (
            <Knopf
              art="zweit"
              onClick={() => {
                /*
                 * Die Kopie liegt um ihre eigene Breite versetzt daneben,
                 * nicht deckungsgleich darüber: Sonst sieht es aus, als
                 * wäre nichts passiert, und beim Verschieben nimmt man
                 * aus Versehen das Original.
                 *
                 * Probiert werden vier Richtungen. Der erste Anlauf
                 * verschob immer nach rechts — lag dort die Dachkante,
                 * entstand ein Feld mit null Modulen, das man erst
                 * wieder suchen und löschen musste.
                 */
                const f = p.plan.flaechen.find((x) => x.id === gruppe.flaeche);
                if (!f) return;
                const a = achsen(gruppe, f);
                const m = planMasse(gruppe, f);
                const quer = (m.quer + gruppe.spaltenabstand) * gruppe.spalten;
                const laengs = (m.laengs + gruppe.reihenabstand) * gruppe.reihen;
                const richtungen = [
                  { x: a.quer.x * quer, y: a.quer.y * quer },
                  { x: -a.quer.x * quer, y: -a.quer.y * quer },
                  { x: a.laengs.x * laengs, y: a.laengs.y * laengs },
                  { x: -a.laengs.x * laengs, y: -a.laengs.y * laengs },
                ];

                let beste: Modulgruppe | null = null;
                for (const um of richtungen) {
                  const versuch = nachfuehren(
                    {
                      ...gruppe,
                      id: naechsteId(p.plan.gruppen.map((x) => x.id), "g"),
                      name: `${gruppe.name} Kopie`,
                      anker: { x: gruppe.anker.x + um.x, y: gruppe.anker.y + um.y },
                    },
                    f,
                    besetzt(f, gruppe.id),
                  );
                  if (anzahlModule(versuch) > 0) {
                    beste = versuch;
                    break;
                  }
                }

                if (!beste) {
                  setHinweis("Daneben ist kein Platz mehr für eine Kopie.");
                  return;
                }
                setHinweis(null);
                p.onPlan({ ...p.plan, gruppen: [...p.plan.gruppen, beste] }, true);
                p.onAktiveGruppe(beste.id);
              }}
            >
              Feld duplizieren
            </Knopf>
          ) : null}

          {hinweis ? (
            <p className="rounded-[12px] bg-pl-hinweis px-3 py-2 text-[12.5px] leading-[1.45] text-pl-hinweis-text">
              {hinweis}
            </p>
          ) : null}
        </Mehr>
      ) : null}
    </div>
  );
}
