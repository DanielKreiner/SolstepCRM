"use client";

import { useState } from "react";

import { num } from "@/lib/format";
import type { Dachflaeche } from "@/lib/planer/flaeche";
import {
  achsen,
  aktiveZellen,
  anzahlModule,
  autoBelegen,
  kwp,
  type Modulgruppe,
  modulEcken,
  nachfuehren,
  planMasse,
  reihenabstandVorschlag,
  STANDARD_MODUL,
} from "@/lib/planer/module";
import { naechsteId, type Plan } from "@/lib/planer/plan";
import { Frage, Knopf, Listenzeile, Mehr, Stand, Wahlkarte, Zahlfeld } from "./Bausteine";
import { ZeichenModul, ZeichenPlus } from "./Zeichen";
import { modulTyp, planMitModul } from "./modulwahl";
import type { GeraetModul } from "./TechnikPanel";
import type { Werkzeug } from "./Leinwand";

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

export function ModulSchritt(p: ModulSchrittProps) {
  const [hinweis, setHinweis] = useState<string | null>(null);
  const gewaehltesModul = p.module.find((m) => m.id === p.plan.technik.modul) ?? null;
  const flaeche = p.plan.flaechen.find((f) => f.id === p.aktiv) ?? p.plan.flaechen[0] ?? null;
  const gruppe = p.plan.gruppen.find((g) => g.id === p.aktiveGruppe) ?? null;
  const flaecheDerGruppe = gruppe
    ? (p.plan.flaechen.find((f) => f.id === gruppe.flaeche) ?? null)
    : null;
  // Nicht `module`: In Next.js ist der Name gesperrt.
  const modulzahl = p.plan.gruppen.reduce((s, g) => s + anzahlModule(g), 0);
  const leistung = p.plan.gruppen.reduce((s, g) => s + kwp(g), 0);

  /** Module der übrigen Gruppen — die bleiben besetzt. */
  const besetzt = (f: Dachflaeche, ausser?: string) =>
    p.plan.gruppen
      .filter((g) => g.flaeche === f.id && g.id !== ausser)
      .flatMap((g) => aktiveZellen(g).map((z) => modulEcken(g, f, z.reihe, z.spalte)));

  function belegen(f: Dachflaeche) {
    const flach = f.neigung === 0;
    const typ = gewaehltesModul ? modulTyp(gewaehltesModul) : STANDARD_MODUL;
    const neu = autoBelegen(f, naechsteId(p.plan.gruppen.map((g) => g.id), "g"), `Feld ${p.plan.gruppen.length + 1}`, {
      typ,
      ausrichtung: "hoch",
      reihenabstand: flach ? reihenabstandVorschlag(typ.hoehe, 15, p.breitengrad) : 0.02,
      spaltenabstand: 0.02,
      winkel: 0,
      aufstaenderung: flach ? { art: "sued", winkel: 15 } : null,
      besetzt: besetzt(f),
    });
    if (!neu) return;
    p.onPlan({ ...p.plan, gruppen: [...p.plan.gruppen, neu] }, true);
    p.onAktiveGruppe(neu.id);
    p.onAktiv(f.id);
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

      {/* ── Belegen ───────────────────────────────────────────────── */}
      {p.schreibrecht && flaeche ? (
        <Knopf
          art={p.werkzeug === "setzen" ? "haupt" : "zweit"}
          onClick={() => p.onWerkzeug(p.werkzeug === "setzen" ? "auswahl" : "setzen")}
          zeichen={<ZeichenPlus />}
          aus={p.module.length > 0 && !gewaehltesModul}
        >
          {p.werkzeug === "setzen" ? "Setzen beenden" : "Modul einzeln setzen"}
        </Knopf>
      ) : null}

      {p.schreibrecht && flaeche ? (
        <Knopf
          onClick={() => belegen(flaeche)}
          zeichen={p.plan.gruppen.length === 0 ? <ZeichenModul /> : <ZeichenPlus />}
          aus={p.module.length > 0 && !gewaehltesModul}
          titel={
            p.module.length > 0 && !gewaehltesModul ? "Zuerst oben ein Modul wählen" : undefined
          }
        >
          {p.plan.gruppen.length === 0 ? "Dach voll belegen" : "Restfläche belegen"}
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
                    setzeGruppe(gruppe.id, (g) =>
                      nachfuehren(
                        {
                          ...g,
                          aufstaenderung: e.target.value
                            ? {
                                art: e.target.value as "sued" | "ost-west",
                                winkel: g.aufstaenderung?.winkel ?? 15,
                              }
                            : null,
                        },
                        flaecheDerGruppe,
                        besetzt(flaecheDerGruppe, g.id),
                      ),
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
                      setzeGruppe(gruppe.id, (g) =>
                        nachfuehren(
                          {
                            ...g,
                            aufstaenderung: g.aufstaenderung
                              ? { ...g.aufstaenderung, winkel: v }
                              : null,
                          },
                          flaecheDerGruppe,
                          besetzt(flaecheDerGruppe, g.id),
                        ),
                      )
                    }
                  />
                  {p.schreibrecht ? (
                    <Knopf
                      art="zweit"
                      onClick={() =>
                        setzeGruppe(gruppe.id, (g) =>
                          nachfuehren(
                            {
                              ...g,
                              reihenabstand: reihenabstandVorschlag(
                                g.typ.hoehe,
                                g.aufstaenderung?.winkel ?? 15,
                                p.breitengrad,
                              ),
                            },
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
                      Reihenabstand vorschlagen:{" "}
                      {reihenabstandVorschlag(
                        gruppe.typ.hoehe,
                        gruppe.aufstaenderung.winkel,
                        p.breitengrad,
                      )
                        .toFixed(2)
                        .replace(".", ",")}{" "}
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
