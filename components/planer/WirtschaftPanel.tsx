"use client";

import { useId } from "react";
import type { Plan, Wirtschaft } from "@/lib/planer/plan";
import { richtpreis, VERBRAUCH_CHIPS, verbrauchAusChips } from "@/lib/planer/wirtschaft";
import { istModular, modulzahlFuerKwh, type SpeicherTyp } from "@/lib/planer/speicher";
import { num } from "@/lib/format";
import { Frage } from "./Bausteine";

/*
 * Die Eingaben der Wirtschaftlichkeit (Briefing 7).
 *
 * Alles ist vorbelegt und alles ist überschreibbar. Der Grundsatz
 * dahinter: Der Verkäufer sitzt beim Kunden und soll tippen, was der
 * Kunde sagt — nicht erst Felder suchen. Deshalb Chips für den
 * Verbrauch, ein Regler daneben, und Vorbelegungen, die der Betrieb
 * einmal einstellt.
 *
 * Ein von Hand gesetzter Wert bleibt stehen. Wechselt danach die Region
 * oder ändert sich die Anlagengrösse, wird er NICHT überschrieben, und
 * ein Hinweis sagt, was der Vorschlag gewesen wäre (Abnahmetest 19).
 */

export interface WirtschaftVorgabe {
  verlustProzent: number;
  steigerung: number;
  strompreis: number;
  verguetung: number;
  preisstaffel: Array<{ ab_kwp: number; eur_pro_kwp: number }>;
  speicherEurProKwh: number;
}

export interface FoerderRegion {
  region: string;
  betrag: number;
  hinweis: string | null;
}

interface Props {
  plan: Plan;
  onPlan: (naechster: Plan) => void;
  vorgabe: WirtschaftVorgabe;
  regionen: FoerderRegion[];
  /** Leistung der geplanten Anlage in kWp — für den Richtpreis. */
  anlageKwp: number;
  /** Nutzbare Kapazität des gewählten Speichers, 0 wenn keiner. */
  speicherKwh: number;
  /** Die Speicher aus den Stammdaten — für die Umrechnung auf Module. */
  speicherTypen: SpeicherTyp[];
  /** Nettosumme des offenen Angebots, falls ein Vorgang dranhängt. */
  angebotssumme: number | null;
  schreibrecht: boolean;
}

/** Der geltende Wert: was getippt wurde, sonst die Vorbelegung. */
export function gilt<T>(getippt: T | null, vorbelegt: T): T {
  return getippt ?? vorbelegt;
}

/**
 * Vorgeschlagener Anlagenpreis aus der Staffel des Betriebs.
 * Der Speicher schlägt nur auf, wenn er auch gezeigt wird.
 */
export function preisVorschlag(
  vorgabe: WirtschaftVorgabe,
  anlageKwp: number,
  speicherKwh: number,
  mitSpeicher: boolean,
): number {
  const speicher = mitSpeicher ? speicherKwh * vorgabe.speicherEurProKwh : 0;
  return richtpreis(anlageKwp, vorgabe.preisstaffel, speicher);
}

export function WirtschaftPanel({
  plan,
  onPlan,
  vorgabe,
  regionen,
  anlageKwp,
  speicherKwh,
  speicherTypen,
  angebotssumme,
  schreibrecht,
}: Props) {
  const w = plan.wirtschaft;
  const kennung = useId();

  const setze = (aenderung: Partial<Wirtschaft>) => {
    if (!schreibrecht) return;
    onPlan({ ...plan, wirtschaft: { ...w, ...aenderung } });
  };

  /*
   * Eine gewünschte Speichergrösse in Module umrechnen.
   *
   * „15 kWh" gibt es bei einem Stapel nicht — bei Fronius Reserva sind
   * es vier Module (12,6) oder fünf (15,8). Wer die Zahl eintippt, soll
   * nicht rechnen müssen: Der Planer nimmt die nächste Stapelgrösse,
   * die den Wunsch deckt, und schreibt sie in die Technik. Von dort
   * kommt sie in die Stückliste und ins Angebot.
   */
  const gewaehlterStapel = speicherTypen.find(
    (t) => t.id === plan.technik.speicher && istModular(t),
  );
  const setzeSpeicher = (kwh: number) => {
    if (!schreibrecht) return;
    const technik = gewaehlterStapel
      ? { ...plan.technik, speicherModule: kwh > 0 ? modulzahlFuerKwh(gewaehlterStapel, kwh) : null }
      : plan.technik;
    onPlan({
      ...plan,
      technik,
      wirtschaft: { ...w, speicherKwh: kwh === 0 ? 0 : kwh, mitSpeicher: kwh > 0 },
    });
  };

  const verbrauch = gilt(w.verbrauchKwh, 4500);
  const vorschlag = preisVorschlag(vorgabe, anlageKwp, speicherKwh, w.mitSpeicher);
  const foerderRegion = regionen.find((r) => r.region === w.region);

  return (
    <div className="flex flex-col gap-3.5">
      <Frage
        text="Wie rechnet sich das?"
        hinweis="Alles ist vorbelegt. Überschreib, was der Kunde sagt — ein getippter Wert bleibt stehen."
      />

      {/* ── Jahresverbrauch ─────────────────────────────────────── */}
      <section className="rounded-[14px] border border-line bg-surface p-3.5">
        <div className="flex items-baseline">
          <label htmlFor={`${kennung}-verbrauch`} className="text-[13px] font-semibold text-muted">
            Jahresverbrauch
          </label>
          <span className="num ml-auto text-[19px] font-extrabold tabular-nums">
            {num(verbrauch)} kWh
          </span>
        </div>
        <input
          id={`${kennung}-verbrauch`}
          type="range"
          min={1500}
          max={14000}
          step={100}
          value={verbrauch}
          disabled={!schreibrecht}
          onChange={(e) => setze({ verbrauchKwh: Number(e.target.value) })}
          className="mt-2 w-full accent-[var(--accent)]"
        />
        <div className="mt-2 flex flex-wrap gap-1.5">
          {VERBRAUCH_CHIPS.map((c) => {
            const an = w.chips.includes(c.id);
            return (
              <button
                key={c.id}
                type="button"
                disabled={!schreibrecht}
                aria-pressed={an}
                onClick={() => {
                  /*
                   * Basis-Chips schliessen einander aus, Zusatz-Chips
                   * addieren sich. Der Regler springt auf die Summe —
                   * wer danach zieht, überschreibt sie bewusst.
                   */
                  const ohneGleichartige = c.additiv
                    ? w.chips
                    : w.chips.filter((id) => {
                        const andere = VERBRAUCH_CHIPS.find((x) => x.id === id);
                        return andere?.additiv ?? false;
                      });
                  const chips = an
                    ? w.chips.filter((id) => id !== c.id)
                    : [...ohneGleichartige, c.id];
                  setze({ chips, verbrauchKwh: verbrauchAusChips(chips) || null });
                }}
                className={[
                  "flex h-[44px] items-center rounded-pill border-[1.5px] px-3.5 text-[13px] font-semibold transition-colors",
                  an
                    ? "border-accent bg-accent-sunk text-accent-ink"
                    : "border-line bg-surface text-muted hover:border-line-strong",
                ].join(" ")}
              >
                {c.label}
              </button>
            );
          })}
        </div>
      </section>

      {/* ── Preise ──────────────────────────────────────────────── */}
      <section className="grid grid-cols-2 gap-2.5 rounded-[14px] border border-line bg-surface p-3.5">
        <Geldfeld
          label="Strompreis"
          titel="Was heute pro Kilowattstunde aus dem Netz zu zahlen ist."
          einheit="€/kWh"
          wert={gilt(w.strompreis, vorgabe.strompreis)}
          schritt={0.01}
          disabled={!schreibrecht}
          onWert={(v) => setze({ strompreis: v })}
        />
        <Geldfeld
          label="Einspeisung"
          titel="Was es pro eingespeister Kilowattstunde gibt."
          einheit="€/kWh"
          wert={gilt(w.verguetung, vorgabe.verguetung)}
          schritt={0.01}
          disabled={!schreibrecht}
          onWert={(v) => setze({ verguetung: v })}
        />
        <Geldfeld
          label="Anlagenpreis"
          titel="Vorbelegt aus der Preisstaffel des Betriebs — überschreibbar."
          einheit="€"
          wert={gilt(w.anlagenpreis, angebotssumme && angebotssumme > 0 ? angebotssumme : vorschlag)}
          schritt={100}
          disabled={!schreibrecht}
          onWert={(v) => setze({ anlagenpreis: v })}
        />
        <Geldfeld
          label="Förderung"
          titel="Vorbelegt je Region — den aktuellen Fördersatz vor dem Angebot prüfen."
          einheit="€"
          wert={gilt(w.foerderung, foerderRegion?.betrag ?? 0)}
          schritt={100}
          disabled={!schreibrecht}
          onWert={(v) => setze({ foerderung: v })}
        />
      </section>

      {/*
       * Der Hinweis erscheint nur, wenn ein getippter Preis vom
       * Vorschlag abweicht. Er überschreibt nichts — er sagt bloss, was
       * die Staffel hergäbe, damit ein alter Wert nach dem Umplanen
       * nicht unbemerkt stehen bleibt.
       */}
      {/*
        * Woher der Preis kommt — das muss dastehen.
        *
        * Vorher rechnete die Planung mit einem Richtpreis, während der
        * Kunde ein Angebot mit einer anderen Summe in der Hand hielt:
        * zwei Amortisationen für dieselbe Anlage. Jetzt gilt die
        * Angebotssumme, sobald es eine gibt — und hier steht, dass sie
        * es tut.
        */}
      {w.anlagenpreis === null && angebotssumme && angebotssumme > 0 ? (
        <p className="-mt-2 text-[12.5px] leading-[1.45] text-muted">
          Das ist die Summe des Angebots — {num(Math.round(angebotssumme))} € netto. Ändert sich
          dort eine Position, rechnet die Wirtschaftlichkeit mit.
        </p>
      ) : null}

      {w.anlagenpreis !== null && angebotssumme && angebotssumme > 0 ? (
        <p className="-mt-2 text-[12.5px] leading-[1.45] text-muted">
          Von Hand gesetzt. Das Angebot steht bei{" "}
          <button
            type="button"
            disabled={!schreibrecht}
            onClick={() => setze({ anlagenpreis: null })}
            className="num font-semibold text-accent-ink hover:underline"
          >
            {num(Math.round(angebotssumme))} €
          </button>{" "}
          — übernehmen
        </p>
      ) : null}

      {w.anlagenpreis !== null &&
      !(angebotssumme && angebotssumme > 0) &&
      vorschlag > 0 &&
      Math.abs(w.anlagenpreis - vorschlag) > 1 ? (
        <p className="-mt-2 text-[12.5px] leading-[1.45] text-muted">
          Richtpreis für {num(Math.round(anlageKwp * 100) / 100)} kWp
          {w.mitSpeicher && speicherKwh > 0 ? ` mit ${num(Math.round(speicherKwh * 10) / 10)} kWh Speicher` : ""}:{" "}
          <button
            type="button"
            disabled={!schreibrecht}
            onClick={() => setze({ anlagenpreis: null })}
            className="num font-semibold text-accent-ink hover:underline"
          >
            {num(Math.round(vorschlag))} €
          </button>{" "}
          übernehmen
        </p>
      ) : null}

      {/* ── Speicher ────────────────────────────────────────────── */}
      <section className="rounded-[14px] border border-line bg-surface p-3.5">
        <div className="flex items-baseline">
          <label htmlFor={`${kennung}-speicher`} className="text-[13px] font-semibold text-muted">
            Speicher
          </label>
          <span className="num ml-auto text-[19px] font-extrabold tabular-nums">
            {speicherKwh > 0 ? `${num(Math.round(speicherKwh * 10) / 10)} kWh` : "keiner"}
          </span>
        </div>

        <div className="mt-2 flex flex-wrap gap-1.5">
          {[0, 5, 10, 15, 20].map((kwh) => (
            <button
              key={kwh}
              type="button"
              disabled={!schreibrecht}
              onClick={() => setzeSpeicher(kwh)}
              aria-pressed={Math.abs(speicherKwh - kwh) < 0.05}
              className={[
                "num h-10 rounded-[10px] border px-3 text-[13px] font-semibold tabular-nums transition-colors",
                Math.abs(speicherKwh - kwh) < 0.05
                  ? "border-accent bg-accent-sunk text-ink"
                  : "border-line bg-surface text-muted hover:border-accent hover:text-ink",
              ].join(" ")}
            >
              {kwh === 0 ? "ohne" : `${kwh} kWh`}
            </button>
          ))}
        </div>

        <input
          id={`${kennung}-speicher`}
          type="number"
          min={0}
          max={200}
          step={0.5}
          disabled={!schreibrecht}
          aria-label="Speicher in kWh"
          value={speicherKwh || ""}
          placeholder="eigene Grösse in kWh"
          onChange={(e) => {
            const v = Number(e.target.value);
            if (!Number.isFinite(v) || v < 0 || v > 200) return;
            setzeSpeicher(v);
          }}
          className="num mt-2 h-[52px] w-full rounded-[14px] border border-line bg-surface px-3.5 text-[16px] font-bold tabular-nums outline-none focus:border-accent disabled:opacity-50"
        />

        <p className="mt-2 text-[11.5px] leading-[1.45] text-muted">
          Ohne Speicher deckt ein Dach rund ein Drittel des Verbrauchs — nachts erzeugt es
          nichts. Der Speicher hebt die Autarkie, je nach Grösse im Verhältnis zum Verbrauch.
        </p>
      </section>

      {/* ── Region ──────────────────────────────────────────────── */}
      {regionen.length > 0 ? (
        <section className="rounded-[14px] border border-line bg-surface p-3.5">
          <div className="text-[13px] font-semibold text-muted">Region</div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {regionen.map((r) => {
              const an = w.region === r.region;
              return (
                <button
                  key={r.region}
                  type="button"
                  disabled={!schreibrecht}
                  aria-pressed={an}
                  onClick={() => setze({ region: an ? null : r.region })}
                  className={[
                    "flex h-[44px] items-center rounded-[12px] border-[1.5px] px-3.5 text-[13px] font-semibold transition-colors",
                    an
                      ? "border-accent bg-accent-sunk text-accent-ink"
                      : "border-line bg-surface text-muted hover:border-line-strong",
                  ].join(" ")}
                >
                  {r.region}
                </button>
              );
            })}
          </div>
          {/*
           * Ein von Hand gesetzter Betrag bleibt beim Regionswechsel
           * stehen — das ist Absicht und muss gesagt werden, sonst hält
           * man den alten Wert für den neuen Fördersatz.
           */}
          {foerderRegion && w.foerderung !== null && w.foerderung !== foerderRegion.betrag ? (
            <p className="mt-2 text-[12.5px] leading-[1.45] text-muted">
              Für {foerderRegion.region} hinterlegt:{" "}
              <button
                type="button"
                disabled={!schreibrecht}
                onClick={() => setze({ foerderung: null })}
                className="num font-semibold text-accent-ink hover:underline"
              >
                {num(foerderRegion.betrag)} €
              </button>
              . Der eingetippte Betrag bleibt bis zum Zurücksetzen stehen.
            </p>
          ) : null}
          {foerderRegion?.hinweis ? (
            <p className="mt-1.5 text-[12.5px] leading-[1.45] text-muted">{foerderRegion.hinweis}</p>
          ) : null}
        </section>
      ) : (
        <p className="text-[12.5px] leading-[1.45] text-muted">
          Es sind noch keine Fördersätze hinterlegt. Sie werden in den Einstellungen gepflegt —
          bewusst von Hand, weil eine veraltete Zahl sonst im Angebot landet.
        </p>
      )}
    </div>
  );
}

function Geldfeld({
  label,
  titel,
  einheit,
  wert,
  schritt,
  disabled,
  onWert,
}: {
  label: string;
  titel: string;
  einheit: string;
  wert: number;
  schritt: number;
  disabled: boolean;
  onWert: (wert: number) => void;
}) {
  const kennung = useId();
  return (
    <div>
      <label htmlFor={kennung} className="mb-1.5 flex items-center gap-1 text-[12.5px] font-semibold text-muted">
        {label}
        <span title={titel} className="cursor-help text-muted/70">
          ⓘ
        </span>
      </label>
      <div className="flex h-[52px] items-center rounded-[14px] border border-line bg-surface px-3.5">
        <input
          id={kennung}
          type="number"
          inputMode="decimal"
          step={schritt}
          min={0}
          value={wert}
          disabled={disabled}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n) && n >= 0) onWert(n);
          }}
          className="num w-full border-none bg-transparent text-[16px] font-bold outline-none"
        />
        <span className="whitespace-nowrap text-[12.5px] font-semibold text-muted">{einheit}</span>
      </div>
    </div>
  );
}
