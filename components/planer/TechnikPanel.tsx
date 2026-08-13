"use client";

import { useState } from "react";

import { num } from "@/lib/format";
import { Frage } from "./Bausteine";
import { modulname } from "./ModulSchritt";
import {
  maxModuleProString,
  minModuleProString,
  type ModulElektrik,
  pruefe,
  type String as PvString,
  type Wechselrichter as WrElektrik,
} from "@/lib/planer/elektrik";
import { anzahlModule, aktiveZellen, type Modulgruppe, nachfuehren } from "@/lib/planer/module";
import { modulSchluessel, naechsteId, type Plan, strangFarbe } from "@/lib/planer/plan";
import { verlegeStrings } from "@/lib/planer/strings";

/*
 * Anmerkung zu den Beschriftungen: die Auswahlfelder tragen zusätzlich
 * ein aria-label. Das umschliessende <label> nimmt sonst auch den Text
 * der gewählten Option in den zugänglichen Namen auf — „Modul— wählen —"
 * statt „Modul". Für Vorleseprogramme wie für Tests ist das unbrauchbar.
 */

/*
 * Technik: Geräte wählen, Strings bilden, Auslegung prüfen
 * (Briefing 5.2 bis 5.4).
 *
 * Die Befunde stehen ganz oben, nicht am Ende: wer hier ist, will
 * wissen, ob die Auslegung hält — nicht erst nach dem Scrollen.
 */

/*
 * Dieselben Masse wie in den neuen Schritten: 52 px hoch, Radius 14,
 * 15-px-Schrift. Vorher waren es 44 px und 14 px — am iPad traf man mit
 * dem Daumen zwischen zwei Felder.
 */
const FELD =
  "h-[52px] w-full rounded-[14px] border border-line bg-surface px-3.5 text-[15px] text-ink " +
  "outline-none transition-colors focus:border-accent disabled:opacity-60";
const KARTE = "rounded-[14px] border border-line bg-surface p-3.5";

export interface GeraetModul {
  id: string;
  hersteller: string;
  bezeichnung: string;
  wp: number;
  uoc: number;
  umpp: number;
  isc: number;
  impp: number;
  tk_uoc: number;
  breite: number;
  hoehe: number;
}

export interface GeraetWr {
  id: string;
  hersteller: string;
  bezeichnung: string;
  max_dc: number;
  ac_nenn: number;
  hybrid: boolean;
  mppt: Array<{ uMin: number; uMax: number; iMax: number; maxStrings: number }>;
}

export interface GeraetSpeicher {
  id: string;
  hersteller: string;
  bezeichnung: string;
  nutzbar_kwh: number;
  kompatibel: string[];
}

export function TechnikPanel({
  plan,
  onPlan,
  module,
  wechselrichter,
  speicher,
  aktiverStrang,
  onAktiverStrang,
  schreibrecht,
}: {
  plan: Plan;
  onPlan: (plan: Plan, schritt: boolean) => void;
  module: GeraetModul[];
  wechselrichter: GeraetWr[];
  speicher: GeraetSpeicher[];
  aktiverStrang: string | null;
  onAktiverStrang: (id: string | null) => void;
  schreibrecht: boolean;
}) {
  /** Rückmeldung der letzten automatischen Verlegung. */
  const [verlegt, setVerlegt] = useState<string | null>(null);
  const gewaehlterWr = wechselrichter.find((w) => w.id === plan.technik.wechselrichter) ?? null;
  const gewaehltesModul = module.find((m) => m.id === plan.technik.modul) ?? null;

  /*
   * Speicher nur anbieten, wenn er zum Wechselrichter passt
   * (Briefing 5.4) — filtern statt hinterher bemängeln.
   */
  const passendeSpeicher = gewaehlterWr
    ? speicher.filter((s) => s.kompatibel.includes(gewaehlterWr.id))
    : [];

  const alleModule = plan.gruppen.flatMap((g) =>
    aktiveZellen(g).map((z) => modulSchluessel(g.id, z.reihe, z.spalte)),
  );
  const zugeordnet = new Set(plan.strings.flatMap((s) => s.module));
  const ohneString = alleModule.filter((k) => !zugeordnet.has(k)).length;

  const ergebnis =
    gewaehlterWr && gewaehltesModul
      ? pruefe({
          strings: plan.strings.map<PvString>((s) => ({
            id: s.id,
            name: s.name,
            mppt: s.mppt,
            module: s.module,
            typen: [alsElektrik(gewaehltesModul)],
          })),
          wechselrichter: alsWr(gewaehlterWr),
          ohneString,
        })
      : null;

  const setzeTechnik = (teil: Partial<Plan["technik"]>) =>
    onPlan({ ...plan, technik: { ...plan.technik, ...teil } }, true);

  /**
   * Modul wechseln — und die belegten Gruppen mitziehen.
   *
   * Ohne das gäbe es zwei Wahrheiten über dieselbe Anlage: die Prüfung
   * rechnet mit dem gewählten Stammsatz, die Belegung behält Maße,
   * Leistung und Namen des alten Moduls. Die kWp-Anzeige stimmte dann
   * nicht mehr, und in der Bedarfsliste stünde das falsche Modul.
   *
   * Andere Maße heissen andere Belegung: `nachfuehren` prüft jede Zelle
   * neu gegen Fläche und Hindernisse. Module, die mit dem grösseren Typ
   * nicht mehr passen, fallen dabei heraus — sichtbar, statt über den
   * Rand zu ragen.
   */
  const setzeModul = (id: string | null) => {
    const gewaehlt = module.find((m) => m.id === id);
    if (!gewaehlt) {
      setzeTechnik({ modul: null });
      return;
    }
    const typ = {
      breite: Number(gewaehlt.breite),
      hoehe: Number(gewaehlt.hoehe),
      wp: Number(gewaehlt.wp),
      bezeichnung: `${gewaehlt.hersteller} ${gewaehlt.bezeichnung}`,
    };
    const gruppen = plan.gruppen.map((g) => {
      const flaeche = plan.flaechen.find((f) => f.id === g.flaeche);
      const mitTyp = { ...g, typ };
      return flaeche ? nachfuehren(mitTyp, flaeche) : mitTyp;
    });
    onPlan({ ...plan, gruppen, technik: { ...plan.technik, modul: id } }, true);
  };

  return (
    <div className="flex flex-col gap-3.5">
      <Frage
        text={gewaehlterWr ? "Technik" : "Welcher Wechselrichter?"}
        hinweis={
          gewaehlterWr
            ? undefined
            : "Danach werden die Module auf die Eingänge verteilt — der Planer prüft Spannung und Strom."
        }
      />

      {/* ── Befunde ──────────────────────────────────────────────── */}
      {ergebnis ? (
        <section
          className={[
            "rounded-[12px] border p-3.5",
            ergebnis.geprueft ? "border-s-done bg-s-done/8" : "border-line bg-surface",
          ].join(" ")}
        >
          <div className="flex items-baseline justify-between">
            <h3 className="text-[13px] font-bold">
              {ergebnis.geprueft ? "Elektrisch geprüft" : "Elektrische Prüfung"}
            </h3>
            {ergebnis.dcAc !== null ? (
              <span className="num text-[11.5px] tabular-nums text-muted">
                DC/AC {ergebnis.dcAc.toFixed(2).replace(".", ",")}
              </span>
            ) : null}
          </div>

          {ergebnis.befunde.length === 0 ? (
            <p className="mt-1.5 text-[12.5px] text-muted">
              Alle Strings liegen innerhalb der Grenzen des Wechselrichters.
            </p>
          ) : (
            <ul className="mt-2 flex flex-col gap-1.5">
              {ergebnis.befunde.map((b, i) => (
                <li
                  key={i}
                  className={[
                    "rounded-[10px] px-2.5 py-2 text-[12.5px] leading-[1.45]",
                    b.schwere === "fehler"
                      ? "bg-s-crit/10 text-s-crit"
                      : b.schwere === "warnung"
                        ? "bg-pl-hinweis text-pl-hinweis-text"
                        : "bg-sunk text-muted",
                  ].join(" ")}
                >
                  {b.text}
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : (
        <p className="rounded-[12px] border border-dashed border-line-strong/40 p-3.5 text-[13px] leading-[1.5] text-muted">
          {/*
            * Einzahl und Mehrzahl auseinanderhalten: „Für die Prüfung
            * fehlen noch der Wechselrichter" stand vorher da, wenn nur
            * eines fehlte.
            */}
          {!gewaehltesModul && !gewaehlterWr
            ? "Für die Prüfung fehlen noch das Modul und der Wechselrichter."
            : !gewaehltesModul
              ? "Für die Prüfung fehlt noch das Modul."
              : "Für die Prüfung fehlt noch der Wechselrichter."}{" "}
          Beides kommt aus den Stammdaten unter Einstellungen.
        </p>
      )}

      {/* ── Geräte ───────────────────────────────────────────────── */}
      <section className={`${KARTE} flex flex-col gap-2.5`}>
        <h3 className="text-[14px] font-bold">Geräte</h3>

        <Feld label="Modul">
          <select
            aria-label="Modul"
            value={plan.technik.modul ?? ""}
            disabled={!schreibrecht}
            onChange={(e) => setzeModul(e.target.value || null)}
            className={FELD}
          >
            <option value="">— wählen —</option>
            {module.map((m) => (
              <option key={m.id} value={m.id}>
                {modulname(m)} · {num(m.wp)} Wp
              </option>
            ))}
          </select>
        </Feld>

        <Feld label="Wechselrichter">
          <select
            aria-label="Wechselrichter"
            value={plan.technik.wechselrichter ?? ""}
            disabled={!schreibrecht}
            onChange={(e) =>
              setzeTechnik({
                wechselrichter: e.target.value || null,
                // Ein Speicher am alten Wechselrichter passt womöglich
                // nicht mehr — lieber leeren als still falsch lassen.
                speicher: null,
              })
            }
            className={FELD}
          >
            <option value="">— wählen —</option>
            {wechselrichter.map((w) => (
              <option key={w.id} value={w.id}>
                {w.hersteller} {w.bezeichnung} · {num(w.ac_nenn)} kW · {w.mppt.length} MPPT
              </option>
            ))}
          </select>
        </Feld>

        {gewaehlterWr?.hybrid ? (
          <Feld label="Speicher">
            <select
              aria-label="Speicher"
              value={plan.technik.speicher ?? ""}
              disabled={!schreibrecht}
              onChange={(e) => setzeTechnik({ speicher: e.target.value || null })}
              className={FELD}
            >
              <option value="">kein Speicher</option>
              {passendeSpeicher.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.hersteller} {s.bezeichnung} · {num(s.nutzbar_kwh)} kWh
                </option>
              ))}
            </select>
          </Feld>
        ) : null}

        {gewaehlterWr && !gewaehlterWr.hybrid ? (
          <p className="text-[11.5px] text-muted">
            {gewaehlterWr.bezeichnung} ist kein Hybridgerät — ein Speicher braucht einen eigenen
            Laderegler.
          </p>
        ) : null}
        {gewaehlterWr?.hybrid && passendeSpeicher.length === 0 ? (
          <p className="text-[11.5px] text-muted">
            Kein Speicher für dieses Gerät hinterlegt. In den Stammdaten die passenden
            Wechselrichter am Speicher ankreuzen.
          </p>
        ) : null}
      </section>

      {/* ── Strings ──────────────────────────────────────────────── */}
      <section className={`${KARTE} flex flex-col gap-2.5`}>
        <div className="flex items-baseline justify-between">
          <h3 className="text-[14px] font-bold">Strings ({plan.strings.length})</h3>
          <span className="num text-[11.5px] tabular-nums text-muted">
            {alleModule.length - ohneString} von {alleModule.length} Modulen
          </span>
        </div>

        {ohneString > 0 ? (
          <p className="rounded-[10px] bg-pl-hinweis px-2.5 py-1.5 text-[11.5px] text-pl-hinweis-text">
            {ohneString} {ohneString === 1 ? "Modul" : "Module"} ohne String — solange das so ist,
            gilt die Auslegung als ungeprüft.
          </p>
        ) : null}

        {plan.strings.length > 0 ? (
          <ul className="flex flex-col gap-1.5">
            {plan.strings.map((s, i) => (
              <li
                key={s.id}
                className={[
                  "flex flex-wrap items-center gap-2 rounded-[10px] px-2.5 py-2",
                  s.id === aktiverStrang ? "bg-accent-sunk" : "bg-sunk",
                ].join(" ")}
              >
                <button
                  type="button"
                  onClick={() => onAktiverStrang(s.id === aktiverStrang ? null : s.id)}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                  <span
                    className="h-3 w-3 shrink-0 rounded-[3px]"
                    style={{ background: strangFarbe(i) }}
                    aria-hidden
                  />
                  <span className="truncate text-[13px] font-semibold">{s.name}</span>
                  <span className="num shrink-0 text-[11.5px] tabular-nums text-muted">
                    {s.module.length} Module
                  </span>
                </button>

                {gewaehlterWr && gewaehlterWr.mppt.length > 1 ? (
                  <select
                    value={s.mppt}
                    disabled={!schreibrecht}
                    aria-label={`MPPT für ${s.name}`}
                    onChange={(e) =>
                      onPlan(
                        {
                          ...plan,
                          strings: plan.strings.map((x) =>
                            x.id === s.id ? { ...x, mppt: Number(e.target.value) } : x,
                          ),
                        },
                        true,
                      )
                    }
                    className="h-8 shrink-0 rounded-[8px] border border-line bg-surface px-1.5 text-[12px]"
                  >
                    {gewaehlterWr.mppt.map((_, mi) => (
                      <option key={mi} value={mi}>
                        MPPT {mi + 1}
                      </option>
                    ))}
                  </select>
                ) : null}

                {schreibrecht ? (
                  <button
                    type="button"
                    onClick={() => {
                      onPlan({ ...plan, strings: plan.strings.filter((x) => x.id !== s.id) }, true);
                      if (aktiverStrang === s.id) onAktiverStrang(null);
                    }}
                    className="shrink-0 text-[11.5px] text-muted hover:text-s-crit"
                  >
                    entfernen
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}

        {schreibrecht ? (
          <>
            {/*
              * Der Knopf, der die Handarbeit ersetzt.
              *
              * Er steht VOR „String anlegen": Wer hier ankommt, will in
              * neun von zehn Fällen die naheliegende Verlegung und nicht
              * 34 Module von Hand anmalen. Von Hand geht danach immer
              * noch — die Verlegung ist ein Vorschlag, kein Ergebnis.
              */}
            <button
              type="button"
              disabled={!gewaehltesModul || !gewaehlterWr || alleModule.length === 0}
              onClick={() => {
                if (!gewaehltesModul || !gewaehlterWr) return;
                const elektrik = alsElektrik(gewaehltesModul);
                const wr = alsWr(gewaehlterWr);
                const { strings, hinweis } = verlegeStrings(plan, {
                  max: maxModuleProString(elektrik, wr),
                  min: Math.max(
                    1,
                    ...wr.mppt.map((m) => minModuleProString(elektrik, m)),
                  ),
                  mppt: wr.mppt.length,
                });
                onPlan({ ...plan, strings }, true);
                onAktiverStrang(null);
                setVerlegt(hinweis);
              }}
              className="flex h-11 items-center justify-center rounded-[10px] bg-accent px-4 font-bold text-white transition-colors hover:bg-accent-to disabled:opacity-40"
            >
              Strings automatisch verlegen
            </button>
            {!gewaehltesModul || !gewaehlterWr ? (
              <p className="text-[11.5px] text-muted">
                Dafür müssen Modul und Wechselrichter gewählt sein — die Länge eines Strings
                hängt an der Kaltspannung des Moduls und am MPP-Fenster des Geräts.
              </p>
            ) : null}
            {verlegt ? <p className="text-[11.5px] text-muted">{verlegt}</p> : null}

            <button
              type="button"
              onClick={() => {
                const id = naechsteId(plan.strings.map((x) => x.id), "s");
                const neu = {
                  id,
                  name: `String ${plan.strings.length + 1}`,
                  mppt: 0,
                  module: [] as string[],
                };
                onPlan({ ...plan, strings: [...plan.strings, neu] }, true);
                onAktiverStrang(id);
              }}
              className="flex h-11 items-center justify-center rounded-[10px] bg-accent px-4 font-bold text-white transition-colors hover:bg-accent-to"
            >
              String anlegen
            </button>
            <p className="text-[11.5px] leading-[1.45] text-muted">
              String wählen, dann mit dem Werkzeug „String“ über die Module fahren. Nochmal
              darüberfahren nimmt sie wieder heraus.
            </p>
          </>
        ) : null}
      </section>
    </div>
  );
}

/* ── Übersetzung in die Prüfform ───────────────────────────────── */

function alsElektrik(m: GeraetModul): ModulElektrik {
  return {
    bezeichnung: `${m.hersteller} ${m.bezeichnung}`,
    uoc: Number(m.uoc),
    umpp: Number(m.umpp),
    isc: Number(m.isc),
    impp: Number(m.impp),
    tkUoc: Number(m.tk_uoc),
    wp: Number(m.wp),
  };
}

function alsWr(w: GeraetWr): WrElektrik {
  return {
    bezeichnung: `${w.hersteller} ${w.bezeichnung}`,
    maxDc: Number(w.max_dc),
    acNenn: Number(w.ac_nenn),
    hybrid: w.hybrid,
    mppt: w.mppt.map((t) => ({
      uMin: Number(t.uMin),
      uMax: Number(t.uMax),
      iMax: Number(t.iMax),
      maxStrings: Number(t.maxStrings),
    })),
  };
}

/** Module aller Gruppen — für die Zählung in der Kennzahlenleiste. */
export function moduleGesamt(gruppen: Modulgruppe[]): number {
  return gruppen.reduce((s, g) => s + anzahlModule(g), 0);
}

function Feld({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11.5px] font-semibold text-muted">{label}</span>
      {children}
    </label>
  );
}
