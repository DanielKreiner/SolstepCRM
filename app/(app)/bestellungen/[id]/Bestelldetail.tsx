"use client";

import { useActionState, useMemo, useState } from "react";
import { Auswahl, Eingabe, LEER, Meldung, Textfeld, type AktionsStatus } from "@/components/ui/Formular";
import { Pill, type Tone } from "@/components/ui/Pill";
import { date, num } from "@/lib/format";
import {
  alsBestelltMarkieren,
  bestellungKopf,
  positionEntfernen,
  positionHinzufuegen,
  positionStornieren,
  terminSetzen,
  wareneingangErfassen,
} from "../actions";

export type BestellPositionAnsicht = {
  id: string;
  sku: string | null;
  bezeichnung: string;
  menge: number;
  einheit: string;
  geliefert: number;
  storniert: boolean;
  termin: string | null;
  vorgangNummer: string | null;
};

export type BestellKopf = {
  id: string;
  nummer: string | null;
  status: string;
  ziel: string;
  zielVorgangId: string | null;
  abholung: boolean;
  externBestellt: boolean;
  wunschtermin: string | null;
  notiz: string | null;
  lieferantId: string | null;
  lieferantName: string | null;
  lieferantMail: string | null;
};

const TON: Record<string, Tone> = {
  entwurf: "neutral",
  bestellt: "doing",
  teilgeliefert: "warn",
  geliefert: "done",
  storniert: "neutral",
};

/**
 * Eine Bestellung.
 *
 * Solange sie ein Entwurf ist, lässt sich alles ändern. Danach nichts
 * mehr: das archivierte PDF und die gebuchten Wareneingänge müssen zu
 * dem passen, was drinsteht. Der Weg für Änderungen heisst Storno der
 * Restmenge oder neue Bestellung.
 */
export function Bestelldetail({
  kopf,
  positionen,
  lieferanten,
  vorgaenge,
  artikel,
  darfSchreiben,
}: {
  kopf: BestellKopf;
  positionen: BestellPositionAnsicht[];
  lieferanten: { id: string; name: string }[];
  vorgaenge: { id: string; label: string }[];
  artikel: { id: string; sku: string; name: string }[];
  darfSchreiben: boolean;
}) {
  const entwurf = kopf.status === "entwurf";
  const [kopfStatus, kopfSpeichern] = useActionState<AktionsStatus, FormData>(
    bestellungKopf,
    LEER,
  );
  const [neuStatus, neu] = useActionState<AktionsStatus, FormData>(
    positionHinzufuegen,
    LEER,
  );
  const [wegStatus, weg] = useActionState<AktionsStatus, FormData>(
    positionEntfernen,
    LEER,
  );
  const [sendStatus, senden] = useActionState<AktionsStatus, FormData>(
    alsBestelltMarkieren,
    LEER,
  );
  const [terminStatus, termin] = useActionState<AktionsStatus, FormData>(
    terminSetzen,
    LEER,
  );
  const [stornoStatus, storno] = useActionState<AktionsStatus, FormData>(
    positionStornieren,
    LEER,
  );
  const [eingangStatus, eingang] = useActionState<AktionsStatus, FormData>(
    wareneingangErfassen,
    LEER,
  );

  const [ziel, setZiel] = useState(kopf.ziel);
  const [suche, setSuche] = useState("");
  const [menge, setMenge] = useState("1");

  const treffer = useMemo(() => {
    const q = suche.trim().toLowerCase();
    if (q.length < 2) return [];
    return artikel
      .filter((a) => `${a.sku} ${a.name}`.toLowerCase().includes(q))
      .slice(0, 8);
  }, [artikel, suche]);

  const aktiv = positionen.filter((p) => !p.storniert);
  const offeneZeilen = aktiv.filter((p) => p.geliefert < p.menge);

  return (
    <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr] xl:items-start">
      <div className="flex min-w-0 flex-col gap-4">
        <section className="rounded-[20px] bg-surface p-5 shadow-soft">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h2 className="text-[15px] font-semibold">
              Positionen{" "}
              <span className="num font-normal text-muted">({aktiv.length})</span>
            </h2>
            {!entwurf ? (
              <span className="text-[12px] text-faint">
                abgeschickt — Änderungen nur über Storno
              </span>
            ) : null}
          </div>

          {/*
            Die Rückmeldung des Wareneingangs steht hier und nicht in
            seinem Formular: mit der letzten Teillieferung wird die
            Bestellung „geliefert", der ganze Abschnitt verschwindet —
            und nähme seine eigene Bestätigung mit.
          */}
          <Meldung status={eingangStatus} />

          {positionen.length === 0 ? (
            <p className="text-[12.5px] text-muted">
              Noch keine Position. Ohne Position lässt sich nichts abschicken.
            </p>
          ) : (
            <ul className="flex flex-col gap-[6px]">
              {positionen.map((p) => (
                <li
                  key={p.id}
                  className={[
                    "flex flex-wrap items-center gap-x-3 gap-y-2 rounded-card border px-3 py-[10px]",
                    p.storniert
                      ? "border-line bg-sunk opacity-60"
                      : "border-line bg-panel",
                  ].join(" ")}
                >
                  <span className="num w-[70px] shrink-0 text-right text-[13px] font-semibold">
                    {num(p.menge)}
                  </span>
                  <span className="w-[34px] shrink-0 text-[11.5px] text-faint">
                    {p.einheit}
                  </span>
                  <span className="min-w-[150px] flex-1">
                    <span className="block truncate text-[13.5px]">
                      {p.bezeichnung}
                    </span>
                    <span className="num block text-[11px] text-faint">
                      {p.sku ?? "Freitext"}
                      {p.vorgangNummer ? ` · für ${p.vorgangNummer}` : ""}
                    </span>
                  </span>

                  {p.storniert ? (
                    <Pill tone="neutral">storniert</Pill>
                  ) : p.geliefert >= p.menge ? (
                    <Pill tone="done">geliefert</Pill>
                  ) : p.geliefert > 0 ? (
                    <Pill tone="warn">
                      {num(p.geliefert)} von {num(p.menge)}
                    </Pill>
                  ) : null}

                  {!entwurf && !p.storniert ? (
                    <form action={termin} className="flex items-center gap-1">
                      <input type="hidden" name="bestellungId" value={kopf.id} />
                      <input type="hidden" name="id" value={p.id} />
                      <input
                        name="termin"
                        type="date"
                        defaultValue={p.termin ?? ""}
                        aria-label={`Bestätigter Liefertermin ${p.bezeichnung}`}
                        className="num rounded-input border border-line bg-surface px-[9px] py-[6px] text-[12px] outline-0 focus:border-accent"
                      />
                      <button
                        type="submit"
                        className="cursor-pointer rounded-pill border border-line bg-surface px-[10px] py-[5px] text-[11.5px] text-muted transition-colors hover:border-accent hover:text-accent-ink"
                      >
                        Termin
                      </button>
                    </form>
                  ) : null}

                  {darfSchreiben && entwurf ? (
                    <form action={weg}>
                      <input type="hidden" name="bestellungId" value={kopf.id} />
                      <input type="hidden" name="id" value={p.id} />
                      <button
                        type="submit"
                        aria-label={`${p.bezeichnung} entfernen`}
                        className="cursor-pointer rounded-pill border border-line bg-surface px-[11px] py-[5px] text-[11.5px] text-muted transition-colors hover:border-s-crit hover:text-s-crit"
                      >
                        Entfernen
                      </button>
                    </form>
                  ) : null}

                  {darfSchreiben && !entwurf && !p.storniert && p.geliefert < p.menge ? (
                    <form action={storno}>
                      <input type="hidden" name="bestellungId" value={kopf.id} />
                      <input type="hidden" name="id" value={p.id} />
                      <button
                        type="submit"
                        aria-label={`${p.bezeichnung} stornieren`}
                        className="cursor-pointer rounded-pill border border-line bg-surface px-[11px] py-[5px] text-[11.5px] text-muted transition-colors hover:border-s-crit hover:text-s-crit"
                      >
                        Restmenge stornieren
                      </button>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          <Meldung status={wegStatus} />
          <Meldung status={terminStatus} />
          <Meldung status={stornoStatus} />

          {darfSchreiben && entwurf ? (
            <div className="mt-4 border-t border-line pt-4">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="search"
                  value={suche}
                  onChange={(e) => setSuche(e.target.value)}
                  placeholder="Artikel ergänzen — Nummer oder Bezeichnung"
                  className="min-w-[220px] flex-1 rounded-pill border border-line bg-surface px-[16px] py-[10px] text-[13.5px] outline-0 focus:border-accent"
                />
                <label className="flex items-center gap-2 text-[12.5px] text-muted">
                  Menge
                  <input
                    type="number"
                    step="0.001"
                    min="0.001"
                    value={menge}
                    onChange={(e) => setMenge(e.target.value)}
                    className="num w-[92px] rounded-input border border-line bg-surface px-[11px] py-[7px] text-[13px] outline-0 focus:border-accent"
                  />
                </label>
              </div>

              {treffer.length > 0 ? (
                <ul className="mt-2 flex flex-col gap-[5px]">
                  {treffer.map((a) => (
                    <li key={a.id}>
                      <form action={neu}>
                        <input type="hidden" name="bestellungId" value={kopf.id} />
                        <input type="hidden" name="artikelId" value={a.id} />
                        <input type="hidden" name="menge" value={menge} />
                        <button
                          type="submit"
                          className="flex w-full cursor-pointer items-center gap-3 rounded-card border border-line bg-surface px-3 py-[9px] text-left transition-colors hover:border-accent hover:bg-accent/6"
                        >
                          <span className="min-w-0 flex-1 truncate text-[13.5px]">
                            {a.name}
                          </span>
                          <span className="num shrink-0 text-[11.5px] text-faint">
                            {a.sku}
                          </span>
                        </button>
                      </form>
                    </li>
                  ))}
                </ul>
              ) : null}

              <Meldung status={neuStatus} />
            </div>
          ) : null}
        </section>

        {/* ------------------------------------------- WARENEINGANG */}
        {darfSchreiben && (kopf.status === "bestellt" || kopf.status === "teilgeliefert") ? (
          <section className="rounded-[20px] bg-surface p-5 shadow-soft">
            <h2 className="text-[15px] font-semibold">Wareneingang</h2>
            <p className="mt-1 mb-3 text-[12.5px] text-muted">
              Eintragen, was tatsächlich angekommen ist. Teillieferungen sind
              normal — der Rest bleibt offen.
              {kopf.ziel === "baustelle"
                ? " Ziel ist die Baustelle: die Ware geht direkt auf den Vorgang und berührt kein Regal."
                : ""}
            </p>

            <form action={eingang} className="flex flex-col gap-2">
              <input type="hidden" name="bestellungId" value={kopf.id} />

              {offeneZeilen.length === 0 ? (
                <p className="text-[12.5px] text-muted">
                  Alles geliefert oder storniert.
                </p>
              ) : (
                <>
                  {offeneZeilen.map((p) => (
                    <label
                      key={p.id}
                      className="flex flex-wrap items-center gap-3 rounded-card border border-line bg-panel px-3 py-[9px]"
                    >
                      <span className="min-w-[150px] flex-1 truncate text-[13.5px]">
                        {p.bezeichnung}
                      </span>
                      <span className="num text-[11.5px] text-faint">
                        offen {num(p.menge - p.geliefert)} {p.einheit}
                      </span>
                      <input
                        name={`menge:${p.id}`}
                        type="number"
                        step="0.001"
                        min="0"
                        placeholder="0"
                        aria-label={`Angekommen ${p.bezeichnung}`}
                        className="num w-[96px] rounded-input border border-line bg-surface px-[9px] py-[6px] text-right text-[13px] outline-0 focus:border-accent"
                      />
                    </label>
                  ))}

                  <label className="flex items-start gap-[9px] rounded-input bg-panel px-4 py-3 text-[13px]">
                    <input
                      type="checkbox"
                      name="ueberliefern"
                      value="ja"
                      className="mt-[2px] h-4 w-4 accent-[var(--accent)]"
                    />
                    <span>
                      <span className="block font-medium">
                        Mehr als bestellt zulassen
                      </span>
                      <span className="block text-[11.5px] text-muted">
                        Wird als Abweichung protokolliert.
                      </span>
                    </span>
                  </label>

                  <button
                    type="submit"
                    className="min-h-[42px] cursor-pointer rounded-pill border-0 bg-[linear-gradient(150deg,var(--accent-from),var(--accent-to))] px-[22px] text-[13px] font-semibold text-white"
                  >
                    Einbuchen
                  </button>
                </>
              )}
            </form>
          </section>
        ) : null}
      </div>

      <div className="flex flex-col gap-4">
        <section className="rounded-[20px] bg-surface p-5 shadow-soft">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h2 className="text-[15px] font-semibold">
              {kopf.nummer ?? "Entwurf"}
            </h2>
            <Pill tone={TON[kopf.status] ?? "neutral"}>{kopf.status}</Pill>
          </div>

          {/*
            Die Rückmeldung steht hier und nicht im Abschickformular: das
            verschwindet im selben Moment, in dem es Erfolg hat — und
            nimmt seine eigene Bestätigung mit. Wer abschickt, sah dann
            gar nichts.
          */}
          <Meldung status={sendStatus} />

          {darfSchreiben && entwurf ? (
            <form action={kopfSpeichern} className="grid gap-3">
              <input type="hidden" name="id" value={kopf.id} />
              <Auswahl
                id="b-lieferant"
                name="lieferantId"
                label="Lieferant"
                wert={kopf.lieferantId ?? ""}
                leerText="— wählen —"
                optionen={lieferanten.map((l) => ({ wert: l.id, text: l.name }))}
                hinweis="Pflicht zum Abschicken"
              />
              {/*
                Gesteuert und nicht nur abgeschickt: wer auf Baustelle
                stellt, soll das Vorgangsfeld sofort sehen und nicht erst
                nach dem Speichern.
              */}
              <div className="flex flex-col gap-[5px]">
                <label
                  htmlFor="b-ziel"
                  className="text-[12px] font-medium text-muted"
                >
                  Lieferung an
                </label>
                <select
                  id="b-ziel"
                  name="ziel"
                  value={ziel}
                  onChange={(e) => setZiel(e.target.value)}
                  className="w-full cursor-pointer rounded-input border border-line bg-surface px-[13px] py-[10px] text-[13.5px] outline-0 focus:border-accent"
                >
                  <option value="hauptlager">Hauptlager</option>
                  <option value="baustelle">Baustelle</option>
                </select>
              </div>

              {ziel === "baustelle" ? (
                <Auswahl
                  id="b-vorgang"
                  name="zielVorgangId"
                  label="Baustelle des Vorgangs"
                  wert={kopf.zielVorgangId ?? ""}
                  leerText="— wählen —"
                  optionen={vorgaenge.map((v) => ({ wert: v.id, text: v.label }))}
                />
              ) : null}

              <Eingabe
                id="b-termin"
                name="wunschtermin"
                label="Wunschtermin"
                typ="date"
                wert={kopf.wunschtermin ?? ""}
              />
              <Textfeld
                id="b-notiz"
                name="notiz"
                label="Notiz für den Lieferanten"
                wert={kopf.notiz ?? ""}
                zeilen={3}
              />
              <button
                type="submit"
                className="min-h-[38px] cursor-pointer rounded-pill border border-line bg-surface px-[20px] text-[12.5px] font-semibold text-ink transition-colors hover:bg-sunk"
              >
                Kopf speichern
              </button>
              <Meldung status={kopfStatus} />
            </form>
          ) : (
            <dl className="grid gap-2 text-[13px]">
              <Zeile label="Lieferant" wert={kopf.lieferantName ?? "—"} />
              <Zeile
                label="Lieferung an"
                wert={kopf.ziel === "baustelle" ? "Baustelle" : "Hauptlager"}
              />
              <Zeile
                label="Wunschtermin"
                wert={kopf.wunschtermin ? date(kopf.wunschtermin) : "—"}
              />
              {kopf.notiz ? <Zeile label="Notiz" wert={kopf.notiz} /> : null}
            </dl>
          )}
        </section>

        {darfSchreiben && entwurf ? (
          <section className="rounded-[20px] bg-surface p-5 shadow-soft">
            <h2 className="text-[15px] font-semibold">Abschicken</h2>
            <p className="mt-1 mb-3 text-[12.5px] text-muted">
              Dabei entsteht die Bestellnummer und ein PDF als Beleg. Danach ist
              die Bestellung nicht mehr änderbar.
            </p>

            <form action={senden} className="flex flex-col gap-2">
              <input type="hidden" name="id" value={kopf.id} />
              <label className="flex items-start gap-[9px] rounded-input bg-panel px-4 py-3 text-[13px]">
                <input
                  type="checkbox"
                  name="mailSenden"
                  value="ja"
                  defaultChecked={Boolean(kopf.lieferantMail)}
                  disabled={!kopf.lieferantMail}
                  className="mt-[2px] h-4 w-4 accent-[var(--accent)]"
                />
                <span>
                  <span className="block font-medium">
                    Mail an den Lieferanten
                  </span>
                  <span className="block text-[11.5px] text-muted">
                    {kopf.lieferantMail
                      ? `Geht an ${kopf.lieferantMail}, PDF im Anhang.`
                      : "Beim Lieferanten ist keine Mailadresse hinterlegt."}
                  </span>
                </span>
              </label>

              <label className="flex items-start gap-[9px] rounded-input bg-panel px-4 py-3 text-[13px]">
                <input
                  type="checkbox"
                  name="externBestellt"
                  value="ja"
                  className="mt-[2px] h-4 w-4 accent-[var(--accent)]"
                />
                <span>
                  <span className="block font-medium">
                    Wurde bereits extern bestellt
                  </span>
                  <span className="block text-[11.5px] text-muted">
                    Telefonisch oder im Händlerportal. Das PDF entsteht trotzdem
                    — als Beleg.
                  </span>
                </span>
              </label>

              <button
                type="submit"
                className="min-h-[44px] cursor-pointer rounded-pill border-0 bg-[linear-gradient(150deg,var(--accent-from),var(--accent-to))] px-[22px] text-[13.5px] font-semibold text-white"
              >
                Als bestellt markieren
              </button>
            </form>
          </section>
        ) : null}
      </div>
    </div>
  );
}

function Zeile({ label, wert }: { label: string; wert: string }) {
  return (
    <div className="flex gap-3">
      <dt className="w-[110px] shrink-0 text-[12px] text-muted">{label}</dt>
      <dd className="min-w-0 flex-1">{wert}</dd>
    </div>
  );
}
