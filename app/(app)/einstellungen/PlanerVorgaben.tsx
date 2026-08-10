"use client";

import { useActionState, useState } from "react";
import {
  foerderungLoeschen,
  foerderungSpeichern,
  type StammState,
  vorgabeSpeichern,
} from "./planer-actions";
import { num } from "@/lib/format";

/*
 * Rechenvorgaben und Fördersätze des Betriebs (Briefing 7).
 *
 * Was hier steht, wirkt auf jedes Angebot, das der Planer ausgibt. Eine
 * verstellte Preisstaffel ändert stillschweigend die Amortisation in
 * jedem künftigen Kundengespräch — deshalb liegt das hinter dem
 * Einstellungsrecht und nicht beim Planer selbst.
 *
 * Fördersätze werden bewusst von Hand gepflegt und nicht aus einer
 * Datenbank gezogen: Förderungen ändern sich unterjährig, laufen aus
 * und sind gedeckelt. Ein automatisch bezogener Betrag, der drei Wochen
 * alt ist, steht im Angebot und wird für den Kunden zur Zusage.
 */

const LEER: StammState = { error: null, ok: null };

export interface VorgabeZeile {
  verlust_prozent: number | string;
  steigerung: number | string;
  strompreis: number | string;
  verguetung: number | string;
  preisstaffel: Array<{ ab_kwp: number | string; eur_pro_kwp: number | string }>;
  speicher_eur_pro_kwh: number | string;
}

export interface FoerderZeile {
  region: string;
  betrag: number | string;
  hinweis: string | null;
}

const FELD =
  "h-10 w-full rounded-[10px] border border-line bg-surface px-2.5 text-[13.5px] num outline-none focus:border-line-strong";

export function PlanerVorgaben({
  vorgabe,
  foerderungen,
  schreibrecht,
}: {
  vorgabe: VorgabeZeile | null;
  foerderungen: FoerderZeile[];
  schreibrecht: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      <Rechenvorgaben vorgabe={vorgabe} schreibrecht={schreibrecht} />
      <Foerderungen zeilen={foerderungen} schreibrecht={schreibrecht} />
    </div>
  );
}

function Rechenvorgaben({
  vorgabe,
  schreibrecht,
}: {
  vorgabe: VorgabeZeile | null;
  schreibrecht: boolean;
}) {
  const [stand, speichern, laeuft] = useActionState(vorgabeSpeichern, LEER);

  /*
   * PostgREST liefert numeric als Zeichenkette. Einmal beim Hereinkommen
   * umwandeln, sonst rechnet weiter unten jemand mit "0.28" weiter.
   */
  const z = (w: number | string | null | undefined, standard: number) =>
    w === null || w === undefined || w === "" ? standard : Number(w);

  const staffelStart =
    vorgabe?.preisstaffel && vorgabe.preisstaffel.length > 0
      ? vorgabe.preisstaffel.map((s) => ({
          ab_kwp: Number(s.ab_kwp),
          eur_pro_kwp: Number(s.eur_pro_kwp),
        }))
      : [{ ab_kwp: 0, eur_pro_kwp: 1750 }];
  const [staffel, setStaffel] = useState(staffelStart);

  return (
    <section className="rounded-card border border-line bg-surface p-4">
      <h4 className="text-[13.5px] font-bold">Rechenvorgaben</h4>
      <p className="mt-1 max-w-2xl text-[12.5px] leading-[1.5] text-muted">
        Vorbelegungen für die Wirtschaftlichkeit. Im Kundengespräch ist jeder Wert überschreibbar —
        hier steht, womit der Planer anfängt.
      </p>

      <form action={speichern} className="mt-3 flex flex-col gap-3">
        <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          <Feld
            label="Systemverlust"
            einheit="%"
            hinweis="Leitungen, Wechselrichter, Verschmutzung. Geht so an PVGIS."
            name="verlust"
            standard={z(vorgabe?.verlust_prozent, 14)}
            schritt={0.5}
            disabled={!schreibrecht}
          />
          <Feld
            label="Strompreissteigerung"
            einheit="%/Jahr"
            hinweis="Trägt die 20-Jahre-Kurve. Die Einspeisevergütung steigt bewusst nicht mit."
            name="steigerung"
            standard={Math.round(z(vorgabe?.steigerung, 0.02) * 1000) / 10}
            schritt={0.1}
            disabled={!schreibrecht}
          />
          <Feld
            label="Speicherpreis"
            einheit="€/kWh"
            hinweis="Aufpreis je Kilowattstunde, wenn die Rechnung mit Speicher gezeigt wird."
            name="speicherPreis"
            standard={z(vorgabe?.speicher_eur_pro_kwh, 0)}
            schritt={10}
            disabled={!schreibrecht}
          />
          <Feld
            label="Strompreis"
            einheit="€/kWh"
            hinweis="Was der Kunde heute für Netzstrom zahlt."
            name="strompreis"
            standard={z(vorgabe?.strompreis, 0.28)}
            schritt={0.01}
            disabled={!schreibrecht}
          />
          <Feld
            label="Einspeisevergütung"
            einheit="€/kWh"
            hinweis="Was es für eingespeisten Strom gibt."
            name="verguetung"
            standard={z(vorgabe?.verguetung, 0.08)}
            schritt={0.01}
            disabled={!schreibrecht}
          />
        </div>

        {/* ── Preisstaffel ────────────────────────────────────────── */}
        <div>
          <div className="text-[12.5px] font-semibold">Richtpreis je kWp</div>
          <p className="mt-0.5 max-w-2xl text-[12px] leading-[1.45] text-muted">
            Grosse Anlagen kosten je kWp weniger — Gerüst, Anfahrt und Anmeldung verteilen sich. Es
            gilt die Stufe mit der grössten Untergrenze, die noch passt. Ohne passende Stufe schlägt
            der Planer keinen Preis vor, statt einen zu erfinden.
          </p>

          <div className="mt-2 flex flex-col gap-1.5">
            {staffel.map((stufe, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="w-8 shrink-0 text-[12px] text-muted">ab</span>
                <input
                  name="ab_kwp"
                  type="number"
                  min={0}
                  step={1}
                  defaultValue={stufe.ab_kwp}
                  disabled={!schreibrecht}
                  aria-label={`Untergrenze Stufe ${i + 1} (kWp)`}
                  className={`${FELD} max-w-[110px]`}
                />
                <span className="shrink-0 text-[12px] text-muted">kWp →</span>
                <input
                  name="eur_pro_kwp"
                  type="number"
                  min={0}
                  step={10}
                  defaultValue={stufe.eur_pro_kwp}
                  disabled={!schreibrecht}
                  aria-label={`Preis Stufe ${i + 1} (€/kWp)`}
                  className={`${FELD} max-w-[130px]`}
                />
                <span className="shrink-0 text-[12px] text-muted">€/kWp</span>
                {schreibrecht && staffel.length > 1 ? (
                  <button
                    type="button"
                    onClick={() => setStaffel(staffel.filter((_, k) => k !== i))}
                    className="text-[12px] text-muted hover:text-s-crit"
                  >
                    entfernen
                  </button>
                ) : null}
              </div>
            ))}
          </div>

          {schreibrecht ? (
            <button
              type="button"
              onClick={() => setStaffel([...staffel, { ab_kwp: 0, eur_pro_kwp: 0 }])}
              className="mt-2 text-[12px] text-accent-ink hover:underline"
            >
              + Stufe
            </button>
          ) : null}
        </div>

        <Fuss stand={stand} laeuft={laeuft} schreibrecht={schreibrecht} beschriftung="Rechenvorgaben speichern" />
      </form>
    </section>
  );
}

function Foerderungen({
  zeilen,
  schreibrecht,
}: {
  zeilen: FoerderZeile[];
  schreibrecht: boolean;
}) {
  const [stand, speichern, laeuft] = useActionState(foerderungSpeichern, LEER);
  const [loeschStand, loeschen] = useActionState(foerderungLoeschen, LEER);
  const [bearbeitet, setBearbeitet] = useState<FoerderZeile | null>(null);

  return (
    <section className="rounded-card border border-line bg-surface p-4">
      <h4 className="text-[13.5px] font-bold">Fördersätze je Region</h4>
      <p className="mt-1 max-w-2xl text-[12.5px] leading-[1.5] text-muted">
        Wird im Planer als Vorbelegung angeboten. Bewusst von Hand gepflegt: Förderungen ändern
        sich unterjährig und sind gedeckelt — ein automatisch bezogener Betrag von letzter Woche
        steht sonst im Angebot und wird für den Kunden zur Zusage.
      </p>

      {zeilen.length > 0 ? (
        <ul className="mt-3 flex flex-col divide-y divide-line border-y border-line">
          {zeilen.map((f) => (
            <li key={f.region} className="flex items-baseline gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-semibold">{f.region}</div>
                {f.hinweis ? (
                  <div className="text-[12px] leading-[1.4] text-muted">{f.hinweis}</div>
                ) : null}
              </div>
              <div className="num shrink-0 text-[13px] font-semibold">
                {num(Math.round(Number(f.betrag)))} €
              </div>
              {schreibrecht ? (
                <div className="flex shrink-0 gap-2.5">
                  <button
                    type="button"
                    onClick={() => setBearbeitet(f)}
                    className="text-[12px] text-accent-ink hover:underline"
                  >
                    bearbeiten
                  </button>
                  <form action={loeschen}>
                    <input type="hidden" name="region" value={f.region} />
                    <button type="submit" className="text-[12px] text-muted hover:text-s-crit">
                      entfernen
                    </button>
                  </form>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-[12.5px] text-muted">Noch keine Region hinterlegt.</p>
      )}

      {loeschStand.ok ? (
        <p className="mt-2 text-[12.5px] font-semibold text-s-done">{loeschStand.ok}</p>
      ) : null}
      {loeschStand.error ? (
        <p className="mt-2 text-[12.5px] font-semibold text-s-crit">{loeschStand.error}</p>
      ) : null}

      {schreibrecht ? (
        /*
         * Der Schlüssel ist die Region: „bearbeiten" füllt dasselbe
         * Formular neu vor, und ohne key behielte React die alten
         * defaultValues bei.
         */
        <form key={bearbeitet?.region ?? "neu"} action={speichern} className="mt-3 flex flex-col gap-2.5">
          <div className="grid gap-2.5 sm:grid-cols-[1fr_140px]">
            <div>
              <label htmlFor="foerder-region" className="mb-1 block text-[12px] font-semibold text-muted">
                Region
              </label>
              <input
                id="foerder-region"
                name="region"
                defaultValue={bearbeitet?.region ?? ""}
                placeholder="Oberösterreich"
                className={`${FELD} font-sans`}
              />
            </div>
            <div>
              <label htmlFor="foerder-betrag" className="mb-1 block text-[12px] font-semibold text-muted">
                Betrag (€)
              </label>
              <input
                id="foerder-betrag"
                name="betrag"
                type="number"
                min={0}
                step={50}
                defaultValue={bearbeitet ? Number(bearbeitet.betrag) : 0}
                className={FELD}
              />
            </div>
          </div>
          <div>
            <label htmlFor="foerder-hinweis" className="mb-1 block text-[12px] font-semibold text-muted">
              Hinweis
            </label>
            <input
              id="foerder-hinweis"
              name="hinweis"
              defaultValue={bearbeitet?.hinweis ?? ""}
              placeholder="Stand 07/2026, gedeckelt auf 20 kWp — vor dem Angebot prüfen"
              className={`${FELD} font-sans`}
            />
          </div>
          <Fuss
            stand={stand}
            laeuft={laeuft}
            schreibrecht={schreibrecht}
            beschriftung={bearbeitet ? "Fördersatz übernehmen" : "Fördersatz eintragen"}
            abbrechen={bearbeitet ? () => setBearbeitet(null) : undefined}
          />
        </form>
      ) : null}
    </section>
  );
}

function Feld({
  label,
  einheit,
  hinweis,
  name,
  standard,
  schritt,
  disabled,
}: {
  label: string;
  einheit: string;
  hinweis: string;
  name: string;
  standard: number;
  schritt: number;
  disabled: boolean;
}) {
  return (
    <div>
      <label htmlFor={`vorgabe-${name}`} className="mb-1 block text-[12px] font-semibold text-muted">
        {label} <span className="text-muted/70">({einheit})</span>
      </label>
      <input
        id={`vorgabe-${name}`}
        name={name}
        type="number"
        step={schritt}
        min={0}
        defaultValue={standard}
        disabled={disabled}
        className={FELD}
      />
      <p className="mt-1 text-[11.5px] leading-[1.4] text-muted">{hinweis}</p>
    </div>
  );
}

function Fuss({
  stand,
  laeuft,
  schreibrecht,
  beschriftung,
  abbrechen,
}: {
  stand: StammState;
  laeuft: boolean;
  schreibrecht: boolean;
  beschriftung: string;
  abbrechen?: (() => void) | undefined;
}) {
  if (!schreibrecht) return null;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="submit"
        disabled={laeuft}
        className="flex h-10 items-center rounded-[10px] bg-accent px-4 text-[13.5px] font-bold text-white transition-colors hover:bg-accent-to disabled:opacity-50"
      >
        {laeuft ? "Speichert …" : beschriftung}
      </button>
      {abbrechen ? (
        <button type="button" onClick={abbrechen} className="text-[12.5px] text-muted hover:text-ink">
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
