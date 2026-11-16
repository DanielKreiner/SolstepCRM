"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { LEER, Meldung, type AktionsStatus } from "@/components/ui/Formular";
import { Pill } from "@/components/ui/Pill";
import { date, eur } from "@/lib/format";
import {
  anzahlungsrechnungErstellen,
  rechnungEntwurfVerwerfen,
  rechnungStornieren,
  rechnungVersenden,
  schlussrechnungErstellen,
  vorgangAbschliessen,
  zahlungErfassen,
} from "@/app/(app)/vorgaenge/rechnung-actions";
import { offenerBetrag } from "@/lib/vorgang/zahlung";

export type RechnungZeile = {
  id: string;
  typ: string;
  nummer: string | null;
  betragBrutto: number | null;
  /** Summe der erfassten Zahlungen, brutto (Migration 0073). */
  bezahltBetrag: number;
  status: string | null;
  faelligAm: string | null;
  bezahltAm: string | null;
  storniertAm: string | null;
  stornoGrund: string | null;
};

const TYP_LABEL: Record<string, string> = {
  anzahlungsrechnung: "Anzahlung",
  schlussrechnung: "Schlussrechnung",
};

/**
 * Rechnungen am Vorgang.
 *
 * Erstellen, versenden, Zahlung erfassen, stornieren. Kein Mahnwesen,
 * keine Buchungssätze — was darüber hinausgeht, macht die Buchhaltung
 * (Briefing Abschnitt 8).
 *
 * Sichtbar nur für Rollen mit Rechnungsrecht; die Bauleitung sieht den
 * Auftragswert, aber keine Belege. Das erzwingt die Datenbank, hier wird
 * nur nicht gerendert, was ohnehin nicht ankäme.
 */
export function Rechnungen({
  vorgangId,
  belege,
  phase,
  anzahlungProzent,
  darfSchreiben,
}: {
  vorgangId: string;
  belege: RechnungZeile[];
  phase: string;
  /** Satz aus dem Vorgang — ohne ihn gibt es keine Anzahlungsrechnung. */
  anzahlungProzent: number;
  darfSchreiben: boolean;
}) {
  const [erstellen, erstellenAction] = useActionState<AktionsStatus, FormData>(
    schlussrechnungErstellen,
    LEER,
  );
  const [abschluss, abschlussAction] = useActionState<AktionsStatus, FormData>(
    vorgangAbschliessen,
    LEER,
  );
  const [anzahlung, anzahlungAction] = useActionState<AktionsStatus, FormData>(
    anzahlungsrechnungErstellen,
    LEER,
  );

  /*
   * Eine stornierte Schlussrechnung zählt nicht mehr — sonst gibt es
   * nach einem Storno keinen Weg zur Neuausstellung (CLAUDE.md 6.4).
   * Dieselbe Grenze zieht die Action noch einmal serverseitig.
   */
  const hatSchluss = belege.some(
    (b) => b.typ === "schlussrechnung" && b.status !== "storniert",
  );
  /* Storniertes ist erledigt, nicht offen. */
  const allesBezahlt =
    belege.length > 0 &&
    belege.every((b) => b.status === "bezahlt" || b.status === "storniert");
  const kannErstellen =
    darfSchreiben && !hatSchluss && (phase === "montage" || phase === "abschluss");

  /*
   * Die Anzahlungsrechnung entsteht normalerweise bei der
   * Auftragsauslösung. Der Knopf ist für danach: nach einem Storno
   * (die Kaskade läuft nur einmal) und für den Fall, dass der Satz
   * erst später gesetzt wurde. Vor der Beauftragung gibt es keine
   * eingefrorene Fassung, aus der sich rechnen liesse.
   */
  const hatAnzahlung = belege.some(
    (b) => b.typ === "anzahlungsrechnung" && b.status !== "storniert",
  );
  const kannAnzahlung =
    darfSchreiben &&
    !hatAnzahlung &&
    anzahlungProzent > 0 &&
    phase !== "anfrage" &&
    phase !== "aufnahme" &&
    phase !== "angebot" &&
    phase !== "verloren";

  return (
    <section className="rounded-[20px] bg-surface p-5 shadow-soft">
      <h2 className="mb-3 text-[15px] font-semibold">Rechnungen</h2>

      {belege.length === 0 ? (
        <p className="text-[13px] text-muted">
          Noch keine Rechnung. Die Anzahlung entsteht bei der Auftragsauslösung.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {belege.map((b) => (
            <Beleg
              key={b.id}
              vorgangId={vorgangId}
              beleg={b}
              darfSchreiben={darfSchreiben}
            />
          ))}
        </ul>
      )}

      {kannAnzahlung ? (
        <form action={anzahlungAction} className="mt-4 border-t border-line pt-4">
          <input type="hidden" name="vorgangId" value={vorgangId} />
          <p className="mb-3 text-[12.5px] text-muted">
            {anzahlungProzent} % des Auftragswerts aus der angenommenen
            Fassung. Entsteht als Entwurf — der Versand ist ein eigener
            Schritt.
          </p>
          <Knopf label="Anzahlungsrechnung erstellen" />
          <Meldung status={anzahlung} />
        </form>
      ) : null}

      {kannErstellen ? (
        <form action={erstellenAction} className="mt-4 border-t border-line pt-4">
          <input type="hidden" name="vorgangId" value={vorgangId} />
          <p className="mb-3 text-[12.5px] text-muted">
            Auftragswert minus gestellte Anzahlung. Positionen aus der
            angenommenen Fassung, nicht aus dem Entwurf.
          </p>
          <Knopf label="Schlussrechnung erstellen" gross />
          <Meldung status={erstellen} />
        </form>
      ) : null}

      {darfSchreiben && allesBezahlt ? (
        <form action={abschlussAction} className="mt-4 border-t border-line pt-4">
          <input type="hidden" name="vorgangId" value={vorgangId} />
          <p className="mb-3 text-[12.5px] text-s-done">
            Nichts mehr offen — jede Rechnung ist bezahlt oder storniert.
          </p>
          <button
            type="submit"
            className="min-h-[48px] w-full cursor-pointer rounded-pill border-0 bg-s-done px-6 text-[14px] font-semibold text-white"
          >
            Vorgang abschließen
          </button>
          <Meldung status={abschluss} />
        </form>
      ) : null}
    </section>
  );
}

function Beleg({
  vorgangId,
  beleg,
  darfSchreiben,
}: {
  vorgangId: string;
  beleg: RechnungZeile;
  darfSchreiben: boolean;
}) {
  const [zahlungOffen, setZahlungOffen] = useState(false);
  const [stornoOffen, setStornoOffen] = useState(false);
  const [versand, versandAction] = useActionState<AktionsStatus, FormData>(
    rechnungVersenden,
    LEER,
  );
  const [zahlung, zahlungAction] = useActionState<AktionsStatus, FormData>(
    zahlungErfassen,
    LEER,
  );
  const [storno, stornoAction] = useActionState<AktionsStatus, FormData>(
    rechnungStornieren,
    LEER,
  );
  const [verwerfen, verwerfenAction] = useActionState<AktionsStatus, FormData>(
    rechnungEntwurfVerwerfen,
    LEER,
  );

  const storniert = beleg.status === "storniert";
  const offen = offenerBetrag(beleg);
  /* Teilzahlung: etwas ist eingegangen, aber nicht alles. */
  const teilbezahlt = beleg.bezahltBetrag > 0 && offen > 0;

  const ueberfaellig =
    beleg.status !== "bezahlt" &&
    !storniert &&
    beleg.faelligAm !== null &&
    new Date(beleg.faelligAm) < new Date();

  return (
    <li className="rounded-input bg-panel px-4 py-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="num text-[12.5px] font-semibold">
          {beleg.nummer ?? "ohne Nummer"}
        </span>
        <span className="text-[12px] text-muted">
          {TYP_LABEL[beleg.typ] ?? beleg.typ}
        </span>
        <Pill
          tone={
            storniert
              ? "neutral"
              : beleg.status === "bezahlt"
                ? "done"
                : ueberfaellig
                  ? "crit"
                  : beleg.status === "versendet"
                    ? "warn"
                    : "neutral"
          }
        >
          {storniert
            ? "storniert"
            : beleg.status === "bezahlt"
              ? "bezahlt"
              : ueberfaellig
                ? "überfällig"
                : (beleg.status ?? "—")}
        </Pill>
        {teilbezahlt && !storniert ? (
          <Pill tone="warn">teilbezahlt</Pill>
        ) : null}
        <span
          className={[
            "num ml-auto text-[13px] font-semibold",
            storniert ? "text-faint line-through" : "",
          ].join(" ")}
        >
          {beleg.betragBrutto !== null ? eur(beleg.betragBrutto) : "—"}
        </span>
      </div>

      <p className="num mt-[2px] text-[11px] text-faint">
        {storniert
          ? `storniert${beleg.storniertAm ? ` am ${date(beleg.storniertAm)}` : ""}`
          : beleg.bezahltAm
            ? `bezahlt am ${date(beleg.bezahltAm)}`
            : beleg.faelligAm
              ? `fällig ${date(beleg.faelligAm)}`
              : ""}
      </p>

      {/*
        Der Restbetrag gehört an den Beleg und nicht nur in die
        Postenliste: wer hier eine Zahlung erfasst, braucht die Zahl, die
        er gleich eintippt.
      */}
      {teilbezahlt && !storniert ? (
        <p className="num mt-[2px] text-[11px] text-accent-ink">
          {eur(beleg.bezahltBetrag)} eingegangen · {eur(offen)} offen
        </p>
      ) : null}

      {storniert && beleg.stornoGrund ? (
        <p className="mt-1 text-[11.5px] text-muted">Grund: {beleg.stornoGrund}</p>
      ) : null}

      {darfSchreiben && beleg.status === "entwurf" ? (
        <>
          <form action={versandAction} className="mt-2">
            <input type="hidden" name="vorgangId" value={vorgangId} />
            <input type="hidden" name="dokumentId" value={beleg.id} />
            <Knopf label="Als versendet vermerken" />
            <Meldung status={versand} />
          </form>

          {/*
            Ein Entwurf wird verworfen, nicht storniert — er hat den
            Betrieb nie verlassen. Ohne diesen Weg blockierte eine falsch
            erzeugte Schlussrechnung die richtige.
          */}
          <form action={verwerfenAction} className="mt-2">
            <input type="hidden" name="vorgangId" value={vorgangId} />
            <input type="hidden" name="dokumentId" value={beleg.id} />
            <Knopf label="Entwurf verwerfen" />
            <Meldung status={verwerfen} />
          </form>
        </>
      ) : null}

      {/*
        Die Rückmeldung steht ausserhalb des Formulars: mit der Zahlung
        wechselt der Beleg auf „bezahlt", und der ganze Block
        verschwindet — samt seiner eigenen Bestätigung. Dieselbe Falle
        wie beim Angebotsversand und beim Wareneingang.
      */}
      <Meldung status={zahlung} />

      {darfSchreiben && beleg.status === "versendet" ? (
        zahlungOffen ? (
          <form action={zahlungAction} className="mt-3 border-t border-line pt-3">
            <input type="hidden" name="vorgangId" value={vorgangId} />
            <input type="hidden" name="dokumentId" value={beleg.id} />

            <div className="grid gap-2 sm:grid-cols-2">
              <span className="flex flex-col gap-[4px]">
                <label
                  htmlFor={`zd-${beleg.id}`}
                  className="text-[11px] text-muted"
                >
                  Bezahlt am
                </label>
                <input
                  id={`zd-${beleg.id}`}
                  name="bezahltAm"
                  type="date"
                  required
                  defaultValue={new Date().toISOString().slice(0, 10)}
                  className="num w-full rounded-input border border-transparent bg-surface px-[11px] py-[8px] text-[12.5px] outline-0 focus:border-accent"
                />
              </span>
              <span className="flex flex-col gap-[4px]">
                <label
                  htmlFor={`zb-${beleg.id}`}
                  className="text-[11px] text-muted"
                >
                  Betrag
                </label>
                {/*
                  Vorgeschlagen wird der offene Rest, nicht der
                  Gesamtbetrag: nach einer Teilzahlung von 10.000 auf
                  12.427,20 wäre der Gesamtbetrag eine Überzahlung.
                */}
                <input
                  id={`zb-${beleg.id}`}
                  name="betrag"
                  type="number"
                  step="0.01"
                  min="0.01"
                  max={offen}
                  defaultValue={offen}
                  className="num w-full rounded-input border border-transparent bg-surface px-[11px] py-[8px] text-[12.5px] outline-0 focus:border-accent"
                />
              </span>
            </div>

            <p className="mt-1 text-[10.5px] text-faint">
              Ein kleinerer Betrag gilt als Teilzahlung — der Beleg bleibt
              dann offen und steht weiter in der Postenliste.
            </p>

            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Knopf label="Zahlung erfassen" />
              <button
                type="button"
                onClick={() => setZahlungOffen(false)}
                className="cursor-pointer border-0 bg-transparent text-[11.5px] text-muted underline"
              >
                Abbrechen
              </button>
            </div>

          </form>
        ) : (
          <button
            type="button"
            onClick={() => setZahlungOffen(true)}
            className="mt-2 cursor-pointer rounded-pill border border-line bg-surface px-[13px] py-[6px] text-[12px] font-medium text-ink hover:bg-sunk"
          >
            Zahlung erfassen
          </button>
        )
      ) : null}

      {/*
        Storno. Steht ausserhalb des Formulars, weil der Beleg mit dem
        Storno seinen Zustand wechselt und der Block samt Bestätigung
        verschwinden würde — dieselbe Falle wie bei der Zahlung.
      */}
      <Meldung status={storno} />

      {darfSchreiben && (beleg.status === "versendet" || beleg.status === "bezahlt") ? (
        stornoOffen ? (
          <form action={stornoAction} className="mt-3 border-t border-line pt-3">
            <input type="hidden" name="vorgangId" value={vorgangId} />
            <input type="hidden" name="dokumentId" value={beleg.id} />

            <label
              htmlFor={`sg-${beleg.id}`}
              className="text-[11px] text-muted"
            >
              Grund für das Storno
            </label>
            <textarea
              id={`sg-${beleg.id}`}
              name="grund"
              rows={2}
              required
              minLength={4}
              placeholder="Falscher Betrag, Rechnung geht neu an den Kunden."
              className="mt-[4px] w-full rounded-input border border-transparent bg-surface px-[11px] py-[8px] text-[12.5px] outline-0 focus:border-accent"
            />

            <p className="mt-1 text-[10.5px] text-faint">
              Die Rechnung bleibt stehen — sie ist aufzubewahren. Sie zählt
              danach nicht mehr in offenen Posten, Umsatz und Mahnlauf, und
              eine neue Rechnung lässt sich erstellen.
              {beleg.bezahltBetrag > 0
                ? ` Bereits eingegangen sind ${eur(beleg.bezahltBetrag)} — die Rückzahlung bucht die Buchhaltung, nicht diese Software.`
                : ""}
            </p>

            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Knopf label="Rechnung stornieren" />
              <button
                type="button"
                onClick={() => setStornoOffen(false)}
                className="cursor-pointer border-0 bg-transparent text-[11.5px] text-muted underline"
              >
                Abbrechen
              </button>
            </div>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setStornoOffen(true)}
            className="mt-2 ml-2 cursor-pointer rounded-pill border border-line bg-surface px-[13px] py-[6px] text-[12px] font-medium text-s-crit hover:bg-sunk"
          >
            Stornieren
          </button>
        )
      ) : null}
    </li>
  );
}

function Knopf({ label, gross = false }: { label: string; gross?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={
        gross
          ? "min-h-[48px] w-full cursor-pointer rounded-pill border-0 bg-[linear-gradient(150deg,var(--accent-from),var(--accent-to))] px-6 text-[14px] font-semibold text-white shadow-[0_8px_22px_rgba(201,121,24,0.28)] disabled:opacity-60"
          : "cursor-pointer rounded-pill border border-line bg-surface px-[13px] py-[6px] text-[12px] font-medium text-ink hover:bg-sunk disabled:opacity-50"
      }
    >
      {pending ? "…" : label}
    </button>
  );
}
