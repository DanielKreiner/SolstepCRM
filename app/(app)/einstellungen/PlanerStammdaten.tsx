"use client";

import { useActionState, useState } from "react";
import { num } from "@/lib/format";
import {
  geraetLoeschen,
  katalogKopieren,
  modulSpeichern,
  speicherSpeichern,
  type StammState,
  wechselrichterSpeichern,
} from "./planer-actions";

/*
 * Stammdaten des Planers (Briefing 5.1).
 *
 * Drei Gerätearten in einer Oberfläche, weil sie zusammen ausgelegt
 * werden: das Modul bestimmt die Spannung, der Wechselrichter die
 * Grenze, der Speicher hängt am Wechselrichter.
 *
 * Geräte aus dem gemeinsamen Katalog stehen mit in der Liste, sind aber
 * nicht bearbeitbar — dafür gibt es „Kopieren". So bleibt der Katalog
 * für alle gleich, und eine Anpassung gehört dem Betrieb, der sie
 * gemacht hat.
 */

const LEER: StammState = { error: null, ok: null };
const FELD =
  "h-10 w-full rounded-[10px] border border-line bg-sunk px-3 text-[13.5px] text-ink " +
  "outline-none transition-colors focus:border-accent focus:bg-surface";
const KARTE = "rounded-card border border-line bg-surface p-4";

export interface ModulZeile {
  id: string;
  company_id: string | null;
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
  gewicht: number | null;
  datenblatt_url: string | null;
}

export interface MpptZeile {
  uMin: number;
  uMax: number;
  iMax: number;
  maxStrings: number;
}

export interface WrZeile {
  id: string;
  company_id: string | null;
  hersteller: string;
  bezeichnung: string;
  max_dc: number;
  ac_nenn: number;
  max_dc_leistung: number | null;
  hybrid: boolean;
  mppt: MpptZeile[];
  datenblatt_url: string | null;
}

export interface SpeicherZeile {
  id: string;
  company_id: string | null;
  hersteller: string;
  bezeichnung: string;
  nutzbar_kwh: number;
  modulgroesse_kwh: number | null;
  max_module: number | null;
  kompatibel: string[];
  datenblatt_url: string | null;
}

type Art = "module" | "wechselrichter" | "speicher";

/*
 * PostgREST liefert `numeric` als Zeichenkette („39.40"), nicht als
 * Zahl. Ungewandelt stünde in der Liste „39.40 V" mit englischem Punkt
 * und Nachkommanull — und im Bearbeitungsformular ebenso. Deshalb hier
 * einmal beim Eintreffen umwandeln, nicht an zwanzig Stellen beim
 * Anzeigen.
 */
function z(wert: unknown): number {
  return typeof wert === "number" ? wert : Number(wert);
}

function zahlenFelder<T extends object>(zeile: T, felder: Array<keyof T & string>): T {
  const kopie = { ...zeile } as Record<string, unknown>;
  for (const f of felder) {
    if (kopie[f] !== null && kopie[f] !== undefined) kopie[f] = z(kopie[f]);
  }
  return kopie as T;
}

export function PlanerStammdaten({
  module: modulRoh,
  wechselrichter: wrRoh,
  speicher: speicherRoh,
  schreibrecht,
}: {
  module: ModulZeile[];
  wechselrichter: WrZeile[];
  speicher: SpeicherZeile[];
  schreibrecht: boolean;
}) {
  const [art, setArt] = useState<Art>("module");

  const modulListe = modulRoh.map((m) =>
    zahlenFelder(m, ["wp", "uoc", "umpp", "isc", "impp", "tk_uoc", "breite", "hoehe", "gewicht"]),
  );
  const wechselrichter: WrZeile[] = wrRoh.map((w) => ({
    ...zahlenFelder(w, ["max_dc", "ac_nenn", "max_dc_leistung"]),
    mppt: (w.mppt ?? []).map((t) => ({
      uMin: z(t.uMin),
      uMax: z(t.uMax),
      iMax: z(t.iMax),
      maxStrings: z(t.maxStrings),
    })),
  }));
  const speicher = speicherRoh.map((s) =>
    zahlenFelder(s, ["nutzbar_kwh", "modulgroesse_kwh", "max_module"]),
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-0.5 self-start rounded-pill bg-sunk p-1" role="group" aria-label="Geräteart">
        {(
          [
            ["module", `Module (${modulListe.length})`],
            ["wechselrichter", `Wechselrichter (${wechselrichter.length})`],
            ["speicher", `Speicher (${speicher.length})`],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-pressed={art === id}
            onClick={() => setArt(id)}
            className={[
              "rounded-pill px-3.5 py-1.5 text-[13px] transition-colors",
              art === id ? "bg-surface font-semibold shadow-soft" : "hover:bg-surface/70",
            ].join(" ")}
          >
            {label}
          </button>
        ))}
      </div>

      {art === "module" ? <Module zeilen={modulListe} schreibrecht={schreibrecht} /> : null}
      {art === "wechselrichter" ? (
        <Wechselrichter zeilen={wechselrichter} schreibrecht={schreibrecht} />
      ) : null}
      {art === "speicher" ? (
        <Speicher zeilen={speicher} wr={wechselrichter} schreibrecht={schreibrecht} />
      ) : null}
    </div>
  );
}

/* ── Module ────────────────────────────────────────────────────── */

function Module({ zeilen, schreibrecht }: { zeilen: ModulZeile[]; schreibrecht: boolean }) {
  const [stand, speichern, laeuft] = useActionState(modulSpeichern, LEER);
  const [bearbeitet, setBearbeitet] = useState<ModulZeile | null>(null);
  const m = bearbeitet;

  return (
    <div className="flex flex-col gap-4">
      <Liste
        zeilen={zeilen}
        art="modul"
        schreibrecht={schreibrecht}
        onBearbeiten={(z) => setBearbeitet(z as ModulZeile)}
        spalten={(z) => {
          const mm = z as ModulZeile;
          return [
            num(mm.wp, "Wp"),
            `Uoc ${num(mm.uoc, "V")}`,
            `Umpp ${num(mm.umpp, "V")}`,
            `${(mm.tk_uoc * 100).toFixed(3).replace(".", ",")} %/K`,
            `${num(mm.breite)} × ${num(mm.hoehe)} m`,
          ];
        }}
      />

      {schreibrecht ? (
        <form action={speichern} className={`${KARTE} flex flex-col gap-3`} key={m?.id ?? "neu"}>
          <h4 className="text-[13.5px] font-bold">
            {m ? `${m.hersteller} ${m.bezeichnung} bearbeiten` : "Modul hinzufügen"}
          </h4>
          <input type="hidden" name="id" value={m?.id ?? ""} />

          <div className="grid gap-3 sm:grid-cols-3">
            <Feld label="Hersteller">
              <input name="hersteller" defaultValue={m?.hersteller ?? ""} className={FELD} required />
            </Feld>
            <Feld label="Bezeichnung" className="sm:col-span-2">
              <input name="bezeichnung" defaultValue={m?.bezeichnung ?? ""} className={FELD} required />
            </Feld>
          </div>

          <div className="grid gap-3 sm:grid-cols-4">
            <Feld label="Nennleistung (Wp)">
              <input name="wp" defaultValue={m?.wp ?? ""} className={`${FELD} num`} required />
            </Feld>
            <Feld label="Uoc (V)">
              <input name="uoc" defaultValue={m?.uoc ?? ""} className={`${FELD} num`} required />
            </Feld>
            <Feld label="Umpp (V)">
              <input name="umpp" defaultValue={m?.umpp ?? ""} className={`${FELD} num`} required />
            </Feld>
            <Feld label="Isc (A)">
              <input name="isc" defaultValue={m?.isc ?? ""} className={`${FELD} num`} required />
            </Feld>
            <Feld label="Impp (A)">
              <input name="impp" defaultValue={m?.impp ?? ""} className={`${FELD} num`} required />
            </Feld>
            <Feld label="Temp.-Koeff. Uoc (%/K)">
              <input
                name="tk_prozent"
                defaultValue={m ? (m.tk_uoc * 100).toFixed(3).replace(".", ",") : "-0,25"}
                className={`${FELD} num`}
                required
              />
            </Feld>
            <Feld label="Breite (m)">
              <input name="breite" defaultValue={m?.breite ?? ""} className={`${FELD} num`} required />
            </Feld>
            <Feld label="Höhe (m)">
              <input name="hoehe" defaultValue={m?.hoehe ?? ""} className={`${FELD} num`} required />
            </Feld>
            <Feld label="Gewicht (kg)">
              <input name="gewicht" defaultValue={m?.gewicht ?? ""} className={`${FELD} num`} />
            </Feld>
            <Feld label="Datenblatt (URL)" className="sm:col-span-3">
              <input name="datenblatt" defaultValue={m?.datenblatt_url ?? ""} className={FELD} />
            </Feld>
          </div>

          <p className="text-[11.5px] leading-[1.45] text-muted">
            Der Temperaturkoeffizient steht im Datenblatt als Prozent je Kelvin und ist NEGATIV
            (typisch −0,25 %/K). Genau so eintragen — daraus folgt die Leerlaufspannung bei −10 °C,
            und die entscheidet, wie viele Module in einen String dürfen.
          </p>

          <Fuss stand={stand} laeuft={laeuft} bearbeitet={!!m} onAbbrechen={() => setBearbeitet(null)} />
        </form>
      ) : null}
    </div>
  );
}

/* ── Wechselrichter ────────────────────────────────────────────── */

function Wechselrichter({ zeilen, schreibrecht }: { zeilen: WrZeile[]; schreibrecht: boolean }) {
  const [stand, speichern, laeuft] = useActionState(wechselrichterSpeichern, LEER);
  const [bearbeitet, setBearbeitet] = useState<WrZeile | null>(null);
  const [tracker, setTracker] = useState<MpptZeile[]>([
    { uMin: 200, uMax: 800, iMax: 26, maxStrings: 2 },
  ]);
  const w = bearbeitet;

  function bearbeiten(z: WrZeile) {
    setBearbeitet(z);
    setTracker(z.mppt.length ? z.mppt : [{ uMin: 200, uMax: 800, iMax: 26, maxStrings: 2 }]);
  }

  return (
    <div className="flex flex-col gap-4">
      <Liste
        zeilen={zeilen}
        art="wechselrichter"
        schreibrecht={schreibrecht}
        onBearbeiten={(z) => bearbeiten(z as WrZeile)}
        spalten={(z) => {
          const ww = z as WrZeile;
          return [
            `${num(ww.ac_nenn)} kW AC`,
            `max. ${num(ww.max_dc, "V")} DC`,
            `${ww.mppt.length} MPPT`,
            ww.hybrid ? "Hybrid" : "Netz",
          ];
        }}
      />

      {schreibrecht ? (
        <form action={speichern} className={`${KARTE} flex flex-col gap-3`} key={w?.id ?? "neu"}>
          <h4 className="text-[13.5px] font-bold">
            {w ? `${w.hersteller} ${w.bezeichnung} bearbeiten` : "Wechselrichter hinzufügen"}
          </h4>
          <input type="hidden" name="id" value={w?.id ?? ""} />

          <div className="grid gap-3 sm:grid-cols-3">
            <Feld label="Hersteller">
              <input name="hersteller" defaultValue={w?.hersteller ?? ""} className={FELD} required />
            </Feld>
            <Feld label="Bezeichnung" className="sm:col-span-2">
              <input name="bezeichnung" defaultValue={w?.bezeichnung ?? ""} className={FELD} required />
            </Feld>
          </div>

          <div className="grid gap-3 sm:grid-cols-4">
            <Feld label="Max. DC-Spannung (V)">
              <input name="max_dc" defaultValue={w?.max_dc ?? ""} className={`${FELD} num`} required />
            </Feld>
            <Feld label="AC-Nennleistung (kW)">
              <input name="ac_nenn" defaultValue={w?.ac_nenn ?? ""} className={`${FELD} num`} required />
            </Feld>
            <Feld label="Max. DC-Leistung (kW)">
              <input
                name="max_dc_leistung"
                defaultValue={w?.max_dc_leistung ?? ""}
                className={`${FELD} num`}
              />
            </Feld>
            <label className="flex items-end gap-2 pb-2 text-[13px]">
              <input type="checkbox" name="hybrid" defaultChecked={w?.hybrid ?? false} />
              Hybrid (speicherfähig)
            </label>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <h5 className="text-[12.5px] font-bold">MPP-Tracker</h5>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setTracker((t) => [...t, { uMin: 200, uMax: 800, iMax: 26, maxStrings: 2 }])
                  }
                  className="text-[12px] text-accent-ink hover:underline"
                >
                  + Tracker
                </button>
                {tracker.length > 1 ? (
                  <button
                    type="button"
                    onClick={() => setTracker((t) => t.slice(0, -1))}
                    className="text-[12px] text-muted hover:text-s-crit"
                  >
                    letzten entfernen
                  </button>
                ) : null}
              </div>
            </div>

            <div className="mt-2 flex flex-col gap-2">
              {tracker.map((t, i) => (
                <div key={i} className="grid gap-2 sm:grid-cols-[auto_1fr_1fr_1fr_1fr]">
                  <span className="num flex h-10 items-center text-[12.5px] text-muted">
                    {i + 1}
                  </span>
                  <Feld label="MPP von (V)">
                    <input name="mppt_umin" defaultValue={t.uMin} className={`${FELD} num`} required />
                  </Feld>
                  <Feld label="MPP bis (V)">
                    <input name="mppt_umax" defaultValue={t.uMax} className={`${FELD} num`} required />
                  </Feld>
                  <Feld label="Max. Strom (A)">
                    <input name="mppt_imax" defaultValue={t.iMax} className={`${FELD} num`} required />
                  </Feld>
                  <Feld label="Strings">
                    <input
                      name="mppt_strings"
                      defaultValue={t.maxStrings}
                      className={`${FELD} num`}
                      required
                    />
                  </Feld>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[11.5px] leading-[1.45] text-muted">
              Je Tracker das MPP-Fenster aus dem Datenblatt. Die untere Grenze entscheidet, wie
              viele Module ein String MINDESTENS braucht — darunter findet der Wechselrichter den
              Arbeitspunkt nicht.
            </p>
          </div>

          <Fuss stand={stand} laeuft={laeuft} bearbeitet={!!w} onAbbrechen={() => setBearbeitet(null)} />
        </form>
      ) : null}
    </div>
  );
}

/* ── Speicher ──────────────────────────────────────────────────── */

function Speicher({
  zeilen,
  wr,
  schreibrecht,
}: {
  zeilen: SpeicherZeile[];
  wr: WrZeile[];
  schreibrecht: boolean;
}) {
  const [stand, speichern, laeuft] = useActionState(speicherSpeichern, LEER);
  const [bearbeitet, setBearbeitet] = useState<SpeicherZeile | null>(null);
  const s = bearbeitet;

  return (
    <div className="flex flex-col gap-4">
      <Liste
        zeilen={zeilen}
        art="speicher"
        schreibrecht={schreibrecht}
        onBearbeiten={(z) => setBearbeitet(z as SpeicherZeile)}
        spalten={(z) => {
          const ss = z as SpeicherZeile;
          return [
            `${num(ss.nutzbar_kwh)} kWh nutzbar`,
            ss.modulgroesse_kwh ? `Stufen à ${num(ss.modulgroesse_kwh)} kWh` : "nicht erweiterbar",
            `${ss.kompatibel.length} WR`,
          ];
        }}
      />

      {schreibrecht ? (
        <form action={speichern} className={`${KARTE} flex flex-col gap-3`} key={s?.id ?? "neu"}>
          <h4 className="text-[13.5px] font-bold">
            {s ? `${s.hersteller} ${s.bezeichnung} bearbeiten` : "Speicher hinzufügen"}
          </h4>
          <input type="hidden" name="id" value={s?.id ?? ""} />

          <div className="grid gap-3 sm:grid-cols-3">
            <Feld label="Hersteller">
              <input name="hersteller" defaultValue={s?.hersteller ?? ""} className={FELD} required />
            </Feld>
            <Feld label="Bezeichnung" className="sm:col-span-2">
              <input name="bezeichnung" defaultValue={s?.bezeichnung ?? ""} className={FELD} required />
            </Feld>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <Feld label="Nutzbar (kWh)">
              <input
                name="nutzbar_kwh"
                defaultValue={s?.nutzbar_kwh ?? ""}
                className={`${FELD} num`}
                required
              />
            </Feld>
            <Feld label="Modulgrösse (kWh)">
              <input
                name="modulgroesse"
                defaultValue={s?.modulgroesse_kwh ?? ""}
                className={`${FELD} num`}
              />
            </Feld>
            <Feld label="Max. Module">
              <input name="max_module" defaultValue={s?.max_module ?? ""} className={`${FELD} num`} />
            </Feld>
          </div>

          <fieldset>
            <legend className="text-[12px] font-semibold text-muted">
              Passende Wechselrichter
            </legend>
            {wr.length === 0 ? (
              <p className="mt-1 text-[12.5px] text-muted">
                Noch keine Wechselrichter angelegt — ohne sie lässt sich keine Zuordnung treffen.
              </p>
            ) : (
              <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1.5">
                {wr.map((w) => (
                  <label key={w.id} className="flex items-center gap-1.5 text-[12.5px]">
                    <input
                      type="checkbox"
                      name="kompatibel"
                      value={w.id}
                      defaultChecked={s?.kompatibel.includes(w.id) ?? false}
                    />
                    {w.hersteller} {w.bezeichnung}
                  </label>
                ))}
              </div>
            )}
            <p className="mt-2 text-[11.5px] leading-[1.45] text-muted">
              Der Planer bietet später nur passende Speicher an, statt eine falsche Wahl hinterher
              zu bemängeln (Briefing 5.4).
            </p>
          </fieldset>

          <Feld label="Datenblatt (URL)">
            <input name="datenblatt" defaultValue={s?.datenblatt_url ?? ""} className={FELD} />
          </Feld>

          <Fuss stand={stand} laeuft={laeuft} bearbeitet={!!s} onAbbrechen={() => setBearbeitet(null)} />
        </form>
      ) : null}
    </div>
  );
}

/* ── Gemeinsames ───────────────────────────────────────────────── */

interface Basiszeile {
  id: string;
  company_id: string | null;
  hersteller: string;
  bezeichnung: string;
  datenblatt_url: string | null;
}

function Liste({
  zeilen,
  art,
  schreibrecht,
  onBearbeiten,
  spalten,
}: {
  zeilen: Basiszeile[];
  art: string;
  schreibrecht: boolean;
  onBearbeiten: (z: Basiszeile) => void;
  spalten: (z: Basiszeile) => string[];
}) {
  const [, loeschen] = useActionState(geraetLoeschen, LEER);
  const [, kopieren] = useActionState(katalogKopieren, LEER);

  if (zeilen.length === 0) {
    return (
      <p className="rounded-card border border-dashed border-line-strong/40 p-5 text-center text-[13px] text-muted">
        Noch nichts angelegt. Werte kommen aus dem Datenblatt — geraten hilft hier niemandem.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-1.5">
      {zeilen.map((z) => {
        const ausKatalog = z.company_id === null;
        return (
          <li
            key={z.id}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-card border border-line bg-surface px-3.5 py-2.5"
          >
            <div className="min-w-[180px] flex-1">
              <p className="text-[13.5px] font-semibold">
                {z.hersteller} {z.bezeichnung}
              </p>
              <p className="num text-[11.5px] tabular-nums text-muted">{spalten(z).join(" · ")}</p>
            </div>

            {ausKatalog ? (
              <span className="rounded-pill bg-sunk px-2.5 py-0.5 text-[11px] text-muted">
                Katalog
              </span>
            ) : null}

            {z.datenblatt_url ? (
              <a
                href={z.datenblatt_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[12px]"
              >
                Datenblatt
              </a>
            ) : null}

            {schreibrecht && !ausKatalog ? (
              <>
                <button
                  type="button"
                  onClick={() => onBearbeiten(z)}
                  className="text-[12px] text-accent-ink hover:underline"
                >
                  bearbeiten
                </button>
                <form action={loeschen}>
                  <input type="hidden" name="art" value={art} />
                  <input type="hidden" name="id" value={z.id} />
                  <button type="submit" className="text-[12px] text-muted hover:text-s-crit">
                    entfernen
                  </button>
                </form>
              </>
            ) : null}

            {schreibrecht && ausKatalog ? (
              <form action={kopieren}>
                <input type="hidden" name="art" value={art} />
                <input type="hidden" name="id" value={z.id} />
                <button type="submit" className="text-[12px] text-accent-ink hover:underline">
                  kopieren und anpassen
                </button>
              </form>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function Fuss({
  stand,
  laeuft,
  bearbeitet,
  onAbbrechen,
}: {
  stand: StammState;
  laeuft: boolean;
  bearbeitet: boolean;
  onAbbrechen: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="submit"
        disabled={laeuft}
        className="flex h-10 items-center rounded-[10px] bg-accent px-4 text-[13.5px] font-bold text-white transition-colors hover:bg-accent-to disabled:opacity-50"
      >
        {laeuft ? "Speichert …" : bearbeitet ? "Änderungen sichern" : "Hinzufügen"}
      </button>
      {bearbeitet ? (
        <button type="button" onClick={onAbbrechen} className="text-[12.5px] text-muted hover:text-ink">
          abbrechen
        </button>
      ) : null}
      {stand.ok ? <span className="text-[12.5px] font-semibold text-s-done">{stand.ok}</span> : null}
      {stand.error ? (
        <span className="text-[12.5px] font-semibold text-s-crit">{stand.error}</span>
      ) : null}
    </div>
  );
}

function Feld({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`flex flex-col gap-1 ${className ?? ""}`}>
      <span className="text-[11.5px] font-semibold text-muted">{label}</span>
      {children}
    </label>
  );
}
