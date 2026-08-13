"use client";

import { useState, type ReactNode } from "react";
import {
  azimutAusTraufe,
  dachflaeche,
  type Dachflaeche,
  grundflaeche,
  kanten,
  laenge,
} from "@/lib/planer/flaeche";
import type { Meter } from "@/lib/planer/geo";
import { type Dachform, DACHFORMEN, dachformFlaechen, type Plan } from "@/lib/planer/plan";
import { Frage, Knopf, Listenzeile, Mehr, Stand, Wahlkarte, Zahlfeld } from "./Bausteine";
import { ZeichenFlaeche, ZeichenRechteck } from "./Zeichen";
import type { Werkzeug } from "./Leinwand";

/*
 * Schritt 1 — „Wo ist das Dach?"
 *
 * Zwei Wege, mehr nicht: Standardform setzen oder selbst zeichnen. Der
 * erste ist der übliche — ein Einfamilienhaus ist ein Satteldach mit
 * zwei Massen, und die stehen im Angebot des Kunden ohnehin.
 *
 * Alles Weitere (Randabstand, Wandhöhe, Dachüberstand, Bäume) liegt
 * hinter „Mehr einstellen". Die erste Fassung zeigte acht Karten
 * gleichzeitig; wer damit beim Kunden sitzt, sucht statt zu planen.
 */

export interface DachSchrittProps {
  plan: Plan;
  aktiv: string | null;
  onAktiv: (id: string | null) => void;
  onPlan: (plan: Plan, schritt: boolean) => void;
  /** Bildmitte in Metern — dorthin setzt die Standardform das Dach. */
  mitte: Meter;
  werkzeug: Werkzeug;
  onWerkzeug: (w: Werkzeug) => void;
  schreibrecht: boolean;
  /** Karte auf alle Dachflächen einpassen. */
  onEinpassen: () => void;
  /** Drohnenfoto-Leiste; steckt hinter „Mehr". */
  foto?: ReactNode;
}

export function DachSchritt(p: DachSchrittProps) {
  const flaeche = p.plan.flaechen.find((f) => f.id === p.aktiv) ?? null;
  const [formOffen, setFormOffen] = useState(false);

  const gesamt = p.plan.flaechen.reduce((s, f) => s + dachflaeche(f.punkte, f.neigung), 0);

  const aendere = (wie: (f: Dachflaeche) => Dachflaeche) => {
    if (!flaeche) return;
    p.onPlan(
      { ...p.plan, flaechen: p.plan.flaechen.map((f) => (f.id === flaeche.id ? wie(f) : f)) },
      true,
    );
  };

  return (
    <div className="flex flex-col gap-3.5">
      <Frage
        text={p.plan.flaechen.length === 0 ? "Wo ist das Dach?" : "Dach"}
        hinweis={
          p.plan.flaechen.length === 0
            ? "Setze die Form aufs Luftbild — oder zeichne den Umriss selbst nach."
            : undefined
        }
      />

      {p.schreibrecht && !formOffen ? (
        <div className="flex flex-col gap-2">
          <Knopf onClick={() => setFormOffen(true)} zeichen={<ZeichenRechteck />}>
            {p.plan.flaechen.length === 0 ? "Dachform setzen" : "Weitere Form setzen"}
          </Knopf>
          <Knopf
            art="zweit"
            onClick={() => p.onWerkzeug(p.werkzeug === "flaeche" ? "auswahl" : "flaeche")}
            zeichen={<ZeichenFlaeche />}
          >
            {p.werkzeug === "flaeche" ? "Zeichnen beenden" : "Selbst zeichnen"}
          </Knopf>
        </div>
      ) : null}

      {p.schreibrecht && formOffen ? (
        <Formwahl
          plan={p.plan}
          mitte={p.mitte}
          onFertig={(neue) => {
            p.onPlan({ ...p.plan, flaechen: [...p.plan.flaechen, ...neue] }, true);
            if (neue[0]) p.onAktiv(neue[0].id);
            setFormOffen(false);
            /*
             * Und gleich heranrücken. Ein 12-Meter-Haus auf Zoom 19 ist
             * fingernagelgross; wer es erst suchen muss, hält die
             * Planung für kaputt.
             */
            p.onEinpassen();
          }}
          onAbbruch={() => setFormOffen(false)}
        />
      ) : null}

      {p.plan.flaechen.length > 0 ? (
        <>
          <Stand
            eintraege={[
              {
                label: "Dachflächen",
                wert: String(p.plan.flaechen.length),
                kennung: "stand-flaechenzahl",
              },
              { label: "Fläche gesamt", wert: `${gesamt.toFixed(1).replace(".", ",")} m²` },
            ]}
          />

          <div className="flex flex-col gap-2">
            {p.plan.flaechen.map((f) => (
              <Listenzeile
                key={f.id}
                titel={f.name}
                wert={`${dachflaeche(f.punkte, f.neigung).toFixed(1).replace(".", ",")} m²`}
                gewaehlt={f.id === p.aktiv}
                /*
                 * Immer auswählen, nie umschalten. Ein Klick auf die
                 * bereits gewählte Zeile hat sie vorher abgewählt — das
                 * Panel darunter war schlagartig leer, und es sah aus,
                 * als hätte der Klick nichts bewirkt.
                 */
                onClick={() => p.onAktiv(f.id)}
                {...(p.schreibrecht
                  ? {
                      onWeg: () => {
                        p.onPlan(
                          {
                            ...p.plan,
                            flaechen: p.plan.flaechen.filter((x) => x.id !== f.id),
                            gruppen: p.plan.gruppen.filter((g) => g.flaeche !== f.id),
                          },
                          true,
                        );
                        if (p.aktiv === f.id) p.onAktiv(null);
                      },
                    }
                  : {})}
              />
            ))}
          </div>
        </>
      ) : null}

      {flaeche ? (
        <div className="flex flex-col gap-3">
          {/*
            * Grundfläche ist die Draufsicht, Dachfläche die wahre Fläche
            * auf der Schräge. Beide stehen da, weil beide gebraucht
            * werden: die eine fürs Aufmass, die andere für die Belegung.
            */}
          <Stand
            eintraege={[
              {
                label: "Grundfläche",
                wert: `${grundflaeche(flaeche.punkte).toFixed(1).replace(".", ",")} m²`,
                kennung: "stand-grundflaeche",
              },
              {
                label: "Dachfläche",
                wert: `${dachflaeche(flaeche.punkte, flaeche.neigung).toFixed(1).replace(".", ",")} m²`,
                kennung: "stand-dachflaeche",
              },
              {
                label: "Ecken",
                wert: String(flaeche.punkte.length),
                kennung: "stand-ecken",
              },
            ]}
          />
          <div className="grid grid-cols-2 gap-2.5">
            <Zahlfeld
              label="Neigung"
              einheit="°"
              wert={Math.round(flaeche.neigung)}
              min={0}
              max={75}
              aus={!p.schreibrecht}
              onWert={(v) => aendere((f) => ({ ...f, neigung: v }))}
            />
            <Zahlfeld
              label="Ausrichtung"
              einheit="°"
              wert={Math.round(flaeche.azimut)}
              min={0}
              max={359}
              aus={!p.schreibrecht}
              onWert={(v) => aendere((f) => ({ ...f, azimut: v }))}
            />
          </div>
          <p className="px-1 text-[12.5px] leading-[1.45] text-muted">
            {himmelsrichtung(flaeche.azimut)} · {flaeche.neigung === 0 ? "flach" : `${Math.round(flaeche.neigung)}° geneigt`}
            {flaeche.traufe === null ? " · Traufe noch nicht gesetzt" : ""}
          </p>
        </div>
      ) : null}

      {flaeche && flaeche.hindernisse.length > 0 ? (
        <div className="flex flex-col gap-2 rounded-[14px] border border-line bg-surface p-3.5">
          <h3 className="text-[13.5px] font-bold">Sperrzonen ({flaeche.hindernisse.length})</h3>
          {flaeche.hindernisse.map((h) => (
            <div key={h.id} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-[13.5px]">{h.name}</span>
              <input
                type="number"
                min={0}
                max={5}
                step={0.05}
                value={h.abstand}
                disabled={!p.schreibrecht}
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
                className="num h-[44px] w-[84px] shrink-0 rounded-[12px] border border-line bg-surface px-2 text-center text-[14px] tabular-nums outline-none focus:border-accent"
              />
              {p.schreibrecht ? (
                <button
                  type="button"
                  aria-label={`Entfernen: ${h.name}`}
                  onClick={() =>
                    aendere((f) => ({
                      ...f,
                      hindernisse: f.hindernisse.filter((x) => x.id !== h.id),
                    }))
                  }
                  className="flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-[12px] border border-line text-muted hover:border-s-crit hover:text-s-crit"
                >
                  ×
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      <Mehr>
        {flaeche ? (
          <>
            <label className="flex flex-col gap-1.5">
              <span className="text-[12.5px] font-semibold text-muted">Bezeichnung</span>
              <input
                value={flaeche.name}
                disabled={!p.schreibrecht}
                onChange={(e) => aendere((f) => ({ ...f, name: e.target.value }))}
                className="h-[52px] rounded-[14px] border border-line bg-surface px-3.5 text-[15px] outline-none focus:border-accent"
              />
            </label>
            <Zahlfeld
              label="Randabstand"
              einheit="m"
              schritt={0.05}
              wert={flaeche.randabstand}
              min={0}
              max={5}
              aus={!p.schreibrecht}
              onWert={(v) => aendere((f) => ({ ...f, randabstand: v }))}
            />
            {flaeche.neigung === 0 && flaeche.randabstand < 1 ? (
              <p className="rounded-[12px] bg-pl-hinweis px-3 py-2 text-[12px] leading-[1.45] text-pl-hinweis-text">
                Flachdächer haben eine Windlast-Randzone; üblich ist 1,00 m. Entscheidet der Betrieb.
              </p>
            ) : null}

            {/*
              * Die Traufkante bestimmt, wohin das Dach fällt — und damit
              * die Ausrichtung. Sie steht hier unten, weil der Assistent
              * sie richtig setzt; von Hand gezeichnete Dächer brauchen
              * sie.
              */}
            <label className="flex flex-col gap-1.5">
              <span className="text-[12.5px] font-semibold text-muted">Traufkante</span>
              <select
                aria-label="Traufkante"
                value={flaeche.traufe ?? ""}
                disabled={!p.schreibrecht}
                onChange={(e) => {
                  const wert = e.target.value === "" ? null : Number(e.target.value);
                  aendere((f) => {
                    const neu = { ...f, traufe: wert };
                    // Der Azimut folgt der Traufe — das ist der Sinn der Angabe.
                    const abgeleitet = azimutAusTraufe(neu);
                    return abgeleitet === null ? neu : { ...neu, azimut: abgeleitet };
                  });
                }}
                className="h-[52px] rounded-[14px] border border-line bg-surface px-3 text-[15px] outline-none focus:border-accent"
              >
                <option value="">keine (Flachdach)</option>
                {kanten(flaeche.punkte).map((k) => (
                  <option key={k.i} value={k.i}>
                    Kante {k.i + 1} · {laenge(k.a, k.b).toFixed(2).replace(".", ",")} m
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : null}

        <div className="grid grid-cols-2 gap-2.5">
          <Zahlfeld
            label="Wandhöhe"
            einheit="m"
            schritt={0.5}
            wert={p.plan.gebaeude.wandhoehe}
            min={0}
            max={50}
            aus={!p.schreibrecht}
            onWert={(v) =>
              p.onPlan({ ...p.plan, gebaeude: { ...p.plan.gebaeude, wandhoehe: v } }, true)
            }
          />
          <Zahlfeld
            label="Überstand"
            einheit="m"
            schritt={0.05}
            wert={p.plan.gebaeude.ueberstand}
            min={0}
            max={3}
            aus={!p.schreibrecht}
            onWert={(v) =>
              p.onPlan({ ...p.plan, gebaeude: { ...p.plan.gebaeude, ueberstand: v } }, true)
            }
          />
        </div>

        {p.foto}
      </Mehr>

      <Umgebung plan={p.plan} onPlan={p.onPlan} aenderbar={p.schreibrecht} />
    </div>
  );
}

/* ── Standardform ──────────────────────────────────────────────── */

function Formwahl({
  plan,
  mitte,
  onFertig,
  onAbbruch,
}: {
  plan: Plan;
  mitte: Meter;
  onFertig: (neue: Dachflaeche[]) => void;
  onAbbruch: () => void;
}) {
  const [form, setForm] = useState<Dachform>("sattel");
  const [breite, setBreite] = useState(12);
  const [tiefe, setTiefe] = useState(9);
  const [neigung, setNeigung] = useState(30);
  const [drehung, setDrehung] = useState(0);

  return (
    <div className="flex flex-col gap-3 rounded-[14px] border border-accent bg-accent-sunk p-3.5">
      <div className="flex flex-col gap-2">
        {DACHFORMEN.map((d) => (
          <Wahlkarte
            key={d.id}
            titel={d.label}
            zeile={d.hinweis}
            gewaehlt={form === d.id}
            onClick={() => {
              setForm(d.id);
              if (d.id === "flach") setNeigung(0);
              else if (neigung === 0) setNeigung(30);
            }}
          />
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        <Zahlfeld label="Länge" einheit="m" schritt={0.5} wert={breite} min={1} onWert={setBreite} />
        <Zahlfeld label="Tiefe" einheit="m" schritt={0.5} wert={tiefe} min={1} onWert={setTiefe} />
        <Zahlfeld
          label="Neigung"
          einheit="°"
          wert={neigung}
          min={0}
          max={75}
          aus={form === "flach"}
          onWert={setNeigung}
        />
        <Zahlfeld label="Drehung" einheit="°" wert={drehung} min={0} max={359} onWert={setDrehung} />
      </div>

      <Knopf
        onClick={() =>
          onFertig(
            dachformFlaechen(
              { form, breite, tiefe, mitte, drehung, neigung: form === "flach" ? 0 : neigung },
              plan.flaechen,
            ),
          )
        }
      >
        In die Bildmitte setzen
      </Knopf>
      <Knopf art="still" onClick={onAbbruch}>
        Abbrechen
      </Knopf>
    </div>
  );
}

/* ── Umgebung ──────────────────────────────────────────────────── */

/**
 * Bäume und Nachbargebäude, die Schatten werfen.
 *
 * Gesetzt werden sie mit dem Werkzeug „Baum", bemasst hier: Eine alte
 * Fichte und ein junger Apfelbaum stehen im Plan an derselben Stelle
 * und kosten ein Vielfaches voneinander.
 */
function Umgebung({
  plan,
  onPlan,
  aenderbar,
}: {
  plan: Plan;
  onPlan: (p: Plan, schritt: boolean) => void;
  aenderbar: boolean;
}) {
  if (plan.objekte.length === 0) return null;

  const aendere = (id: string, teil: Partial<Plan["objekte"][number]>) =>
    onPlan(
      { ...plan, objekte: plan.objekte.map((o) => (o.id === id ? { ...o, ...teil } : o)) },
      true,
    );

  return (
    <Mehr titel={`Schattenwerfer (${plan.objekte.length})`}>
      {plan.objekte.map((o) => (
        <div key={o.id} className="flex flex-col gap-2.5 rounded-[12px] bg-sunk p-3">
          <div className="flex items-center gap-2">
            <input
              value={o.name}
              disabled={!aenderbar}
              aria-label={`Bezeichnung ${o.name}`}
              onChange={(e) => aendere(o.id, { name: e.target.value })}
              className="h-[44px] flex-1 rounded-[12px] border border-line bg-surface px-3 text-[14px] outline-none focus:border-accent"
            />
            {aenderbar ? (
              <button
                type="button"
                onClick={() =>
                  onPlan({ ...plan, objekte: plan.objekte.filter((x) => x.id !== o.id) }, true)
                }
                aria-label={`Entfernen: ${o.name}`}
                className="flex h-[44px] w-[44px] items-center justify-center rounded-[12px] border border-line text-muted hover:border-s-crit hover:text-s-crit"
              >
                ×
              </button>
            ) : null}
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <Zahlfeld
              label="Höhe"
              einheit="m"
              schritt={0.5}
              wert={o.hoehe}
              min={0}
              max={60}
              aus={!aenderbar}
              onWert={(v) => aendere(o.id, { hoehe: v })}
            />
            {o.art === "baum" ? (
              <Zahlfeld
                label="Krone"
                einheit="m"
                schritt={0.5}
                wert={o.radius ?? 3}
                min={0.5}
                max={20}
                aus={!aenderbar}
                onWert={(v) => aendere(o.id, { radius: v })}
              />
            ) : null}
          </div>
        </div>
      ))}
    </Mehr>
  );
}

function himmelsrichtung(azimut: number): string {
  const namen = ["Nord", "Nordost", "Ost", "Südost", "Süd", "Südwest", "West", "Nordwest"];
  return namen[Math.round((((azimut % 360) + 360) % 360) / 45) % 8]!;
}
