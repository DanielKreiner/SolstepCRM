"use client";

import { useActionState, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { Dialog, DialogFuss } from "@/components/ui/Dialog";
import { LEER, Meldung, type AktionsStatus } from "@/components/ui/Formular";
import { eur, num } from "@/lib/format";
import {
  gruppeAnlegen,
  positionAusArtikel,
  positionFrei,
} from "@/app/(app)/vorgaenge/positionen-actions";
import {
  alsVorlageSpeichern,
  schnellZusammenbau,
  vorlageAnwenden,
} from "@/app/(app)/vorgaenge/vorlagen-actions";

/*
 * Die Werkzeugleiste über den Positionen.
 *
 * Vorher standen vier Formulare untereinander UNTER der Liste. Wer eine
 * Position hinzufügen wollte, scrollte an allen Positionen vorbei — und
 * je voller das Angebot, desto weiter weg der Knopf. Das ist genau
 * verkehrt herum: die Werkzeuge gehören dorthin, wo man hinschaut, bevor
 * man etwas tut.
 *
 * Jedes Werkzeug öffnet ein Fenster. Abweichung von CLAUDE.md 9 („keine
 * Modals für Dinge die inline gehen") mit Grund: der Produktkatalog hat
 * 469 Zeilen mit Suche, und der Modulrechner rechnet eine Vorschau —
 * beides geht nicht inline, ohne die Liste zu verdrängen.
 */

export type Produkt = {
  id: string;
  name: string;
  hersteller: string | null;
  kategorie: string | null;
  ekNetto: number | null;
  vkNetto: number;
  bildUrl: string | null;
  modulWp: number | null;
};

export type VorlageOption = {
  id: string;
  name: string;
  beschreibung: string | null;
  zielKwp: number | null;
  istStandard: boolean;
  anzahlPositionen: number;
};

type Fenster = "produkt" | "manuell" | "gruppe" | "vorlage" | "eigenes" | "sichern";

export function Positionsleiste({
  vorgangId,
  anzahl,
  produkte,
  vorlagen,
  einheiten,
}: {
  vorgangId: string;
  anzahl: number;
  produkte: Produkt[];
  vorlagen: VorlageOption[];
  einheiten: string[];
}) {
  const [offen, setOffen] = useState<Fenster | null>(null);
  const zu = () => setOffen(null);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-[15px] font-semibold">
          Positionen{" "}
          <span className="num font-normal text-faint">({anzahl})</span>
        </h2>

        <Knopf ton="akzent-leise" icon="✧" onClick={() => setOffen("manuell")}>
          Manuell
        </Knopf>
        <Knopf ton="violett" icon="⊞" onClick={() => setOffen("gruppe")}>
          Gruppe
        </Knopf>
        <Knopf ton="blau" icon="🗎" onClick={() => setOffen("vorlage")}>
          Vorlage
        </Knopf>
        <Knopf ton="gruen" icon="🏷" onClick={() => setOffen("eigenes")}>
          Eigenes
        </Knopf>
        <Knopf ton="voll" icon="+" onClick={() => setOffen("produkt")}>
          Produkt
        </Knopf>
      </div>

      <ProduktFenster
        offen={offen === "produkt"}
        schliessen={zu}
        vorgangId={vorgangId}
        produkte={produkte}
      />
      <ManuellFenster
        offen={offen === "manuell"}
        schliessen={zu}
        vorgangId={vorgangId}
        produkte={produkte}
      />
      <GruppeFenster offen={offen === "gruppe"} schliessen={zu} vorgangId={vorgangId} />
      <VorlageFenster
        offen={offen === "vorlage"}
        schliessen={zu}
        vorgangId={vorgangId}
        vorlagen={vorlagen}
        sichern={() => setOffen("sichern")}
      />
      <SichernFenster offen={offen === "sichern"} schliessen={zu} vorgangId={vorgangId} />
      <EigenesFenster
        offen={offen === "eigenes"}
        schliessen={zu}
        vorgangId={vorgangId}
        einheiten={einheiten}
      />
    </>
  );
}

/* ------------------------------------------------------------- KNÖPFE */

const TON: Record<string, string> = {
  "akzent-leise": "border-accent/35 bg-accent/10 text-accent-ink",
  violett: "border-s-waiting/30 bg-s-waiting/10 text-s-waiting",
  blau: "border-s-doing/30 bg-s-doing/10 text-s-doing",
  gruen: "border-s-done/30 bg-s-done/10 text-s-done",
  voll:
    "border-transparent bg-[linear-gradient(150deg,var(--accent-from),var(--accent-to))] text-white",
};

function Knopf({
  ton,
  icon,
  onClick,
  children,
}: {
  ton: keyof typeof TON | string;
  icon: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "flex cursor-pointer items-center gap-[7px] rounded-pill border px-[15px] py-[8px] text-[13px] font-semibold transition-transform duration-200 ease-out-quint hover:-translate-y-px",
        TON[ton] ?? TON.voll!,
      ].join(" ")}
    >
      <span aria-hidden className="text-[13px] leading-none">
        {icon}
      </span>
      {children}
    </button>
  );
}

function Absenden({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="min-h-[40px] cursor-pointer rounded-pill border-0 bg-[linear-gradient(150deg,var(--accent-from),var(--accent-to))] px-[22px] text-[13.5px] font-semibold text-white disabled:opacity-60"
    >
      {pending ? "…" : label}
    </button>
  );
}

/* ------------------------------------------------------------ PRODUKT */

function ProduktFenster({
  offen,
  schliessen,
  vorgangId,
  produkte,
}: {
  offen: boolean;
  schliessen: () => void;
  vorgangId: string;
  produkte: Produkt[];
}) {
  const [status, formAction] = useActionState<AktionsStatus, FormData>(
    positionAusArtikel,
    LEER,
  );
  const [suche, setSuche] = useState("");
  const [menge, setMenge] = useState("1");

  const treffer = useMemo(() => {
    const q = suche.trim().toLowerCase();
    const liste = q
      ? produkte.filter((p) =>
          [p.name, p.hersteller, p.kategorie]
            .filter(Boolean)
            .join(" ")
            .toLowerCase()
            .includes(q),
        )
      : produkte;
    /*
     * Gedeckelt, weil 469 Zeilen auf einmal die Liste ruckeln lassen.
     * Die Zahl steht darunter — eine stille Kürzung wäre eine Lüge über
     * den Katalog.
     */
    return { zeigen: liste.slice(0, 60), gesamt: liste.length };
  }, [produkte, suche]);

  return (
    <Dialog
      offen={offen}
      titel="Produkt hinzufügen"
      breite="weit"
      schliessen={schliessen}
    >
      <input
        type="search"
        value={suche}
        onChange={(e) => setSuche(e.target.value)}
        placeholder="Suche nach Bezeichnung, Hersteller oder Kategorie"
        className="mb-3 w-full rounded-pill border border-line bg-surface px-[16px] py-[11px] text-[14px] outline-0 focus:border-accent"
      />

      <label className="mb-3 flex items-center gap-2 text-[12.5px] text-muted">
        Menge
        <input
          type="number"
          step="0.001"
          min="0.001"
          value={menge}
          onChange={(e) => setMenge(e.target.value)}
          className="num w-[92px] rounded-input border border-line bg-surface px-[11px] py-[7px] text-[13px] outline-0 focus:border-accent"
        />
        <span className="text-faint">gilt für das nächste Produkt</span>
      </label>

      <Meldung status={status} />

      <ul className="flex flex-col gap-[6px]">
        {treffer.zeigen.map((p) => (
          <li key={p.id}>
            <form action={formAction}>
              <input type="hidden" name="vorgangId" value={vorgangId} />
              <input type="hidden" name="articleId" value={p.id} />
              <input type="hidden" name="menge" value={menge} />
              <button
                type="submit"
                className="flex w-full cursor-pointer items-center gap-3 rounded-card border border-line bg-surface px-3 py-[10px] text-left transition-colors hover:border-accent hover:bg-accent/6"
              >
                {p.bildUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={p.bildUrl}
                    alt=""
                    loading="lazy"
                    className="h-[34px] w-[34px] shrink-0 rounded-[9px] bg-panel object-contain"
                  />
                ) : (
                  <span
                    aria-hidden
                    className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[9px] bg-panel text-[13px] text-faint"
                  >
                    ▢
                  </span>
                )}

                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-semibold">
                    {p.name}
                  </span>
                  <span className="num block truncate text-[11.5px] text-faint">
                    {[p.hersteller, p.kategorie].filter(Boolean).join(" · ")}
                    {p.ekNetto !== null ? ` · EK ${eur(p.ekNetto)}` : ""}
                    {` / VK ${eur(p.vkNetto)}`}
                  </span>
                </span>

                <span
                  aria-hidden
                  className="shrink-0 text-[17px] leading-none text-accent-ink"
                >
                  +
                </span>
              </button>
            </form>
          </li>
        ))}
      </ul>

      {treffer.gesamt === 0 ? (
        <p className="py-6 text-center text-[13px] text-muted">
          Nichts gefunden. Für Leistungen ohne Artikel gibt es „Eigenes“.
        </p>
      ) : treffer.gesamt > treffer.zeigen.length ? (
        <p className="num mt-3 text-center text-[11.5px] text-faint">
          {treffer.zeigen.length} von {treffer.gesamt} — weiter eingrenzen.
        </p>
      ) : null}
    </Dialog>
  );
}

/* ------------------------------------------------------------ MANUELL */

function ManuellFenster({
  offen,
  schliessen,
  vorgangId,
  produkte,
}: {
  offen: boolean;
  schliessen: () => void;
  vorgangId: string;
  produkte: Produkt[];
}) {
  const [status, formAction] = useActionState<AktionsStatus, FormData>(
    schnellZusammenbau,
    LEER,
  );
  const modulListe = produkte.filter((p) => p.modulWp !== null);
  const [modulId, setModulId] = useState(modulListe[0]?.id ?? "");
  const [anzahl, setAnzahl] = useState(20);
  const [speicher, setSpeicher] = useState("0");
  const [vorschlagen, setVorschlagen] = useState(true);

  const modul = modulListe.find((m) => m.id === modulId) ?? modulListe[0];
  const kwp = modul?.modulWp ? (anzahl * modul.modulWp) / 1000 : 0;

  return (
    <Dialog
      offen={offen}
      titel="Module manuell hinzufügen"
      icon={<span className="text-accent">▦</span>}
      schliessen={schliessen}
    >
      {modulListe.length === 0 ? (
        <p className="text-[13px] text-muted">
          Kein PV-Modul hat eine Nennleistung hinterlegt. Ohne sie lässt sich
          nichts auslegen — im Lager beim Artikel eintragen.
        </p>
      ) : (
        <form action={formAction}>
          <input type="hidden" name="vorgangId" value={vorgangId} />

          <Beschriftung>PV-Modul</Beschriftung>
          <select
            name="modulArtikelId"
            value={modulId}
            onChange={(e) => setModulId(e.target.value)}
            className="mb-4 w-full rounded-input border border-line bg-surface px-[13px] py-[11px] text-[14px] outline-0 focus:border-accent"
          >
            {modulListe.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} ({m.modulWp} Wp)
              </option>
            ))}
          </select>

          <Beschriftung>Anzahl Module</Beschriftung>
          <div className="flex items-center gap-3">
            <Rund label="weniger" onClick={() => setAnzahl((a) => Math.max(1, a - 1))}>
              −
            </Rund>
            <input
              name="anzahl"
              type="number"
              min="1"
              value={anzahl}
              onChange={(e) => setAnzahl(Math.max(1, Number(e.target.value) || 1))}
              className="num min-w-0 flex-1 rounded-input border border-line bg-surface px-3 py-[11px] text-center text-[19px] font-bold outline-0 focus:border-accent"
            />
            <Rund label="mehr" onClick={() => setAnzahl((a) => a + 1)}>
              +
            </Rund>
          </div>
          <p className="num mt-[6px] mb-4 text-[12.5px] text-muted">
            ={" "}
            <span className="font-bold text-accent-ink">{num(kwp)} kWp</span> (
            {anzahl} × {modul?.modulWp ?? 0} Wp)
          </p>

          <div className="rounded-card border border-accent/30 bg-accent/8 p-4">
            <label className="flex items-start gap-[9px] text-[13.5px] font-semibold">
              <input
                type="checkbox"
                checked={vorschlagen}
                onChange={(e) => setVorschlagen(e.target.checked)}
                className="mt-[2px] h-4 w-4 accent-[var(--accent)]"
              />
              Wechselrichter und Komponenten vorschlagen
            </label>
            <p className="mt-1 ml-[25px] text-[12px] text-muted">
              Passende Grössen automatisch dazupacken.
            </p>

            {vorschlagen ? (
              <div className="mt-3 ml-[25px]">
                <Beschriftung>Speicher in kWh — 0 heisst keiner</Beschriftung>
                <input
                  name="speicherKwh"
                  type="number"
                  step="0.1"
                  min="0"
                  value={speicher}
                  onChange={(e) => setSpeicher(e.target.value)}
                  className="num w-full rounded-input border border-line bg-surface px-[13px] py-[9px] text-[13.5px] outline-0 focus:border-accent"
                />
              </div>
            ) : (
              /* Ohne Häkchen kommt nur das Modul — der Wert muss dann 0 sein. */
              <input type="hidden" name="speicherKwh" value="0" />
            )}
          </div>

          <p className="mt-3 text-[12px] text-faint">
            Alles mit einer Menge je Modul kommt mit: Klemmen, Schienen,
            Dachhaken. Ausgelegt wird auf rund 90 % der Modulleistung.
          </p>

          <Beschriftung>Name des Pakets</Beschriftung>
          <input
            name="gruppeName"
            placeholder={`leer = PV-Anlage ${num(kwp)} kWp`}
            className="w-full rounded-input border border-line bg-surface px-[13px] py-[10px] text-[13.5px] outline-0 focus:border-accent"
          />

          <Meldung status={status} />
          <DialogFuss abbrechen={schliessen}>
            <Absenden label={`+ ${anzahl} Module übernehmen`} />
          </DialogFuss>
        </form>
      )}
    </Dialog>
  );
}

function Rund({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="grid h-[44px] w-[44px] shrink-0 cursor-pointer place-items-center rounded-pill border border-line bg-panel text-[19px] leading-none text-ink transition-colors hover:bg-sunk"
    >
      {children}
    </button>
  );
}

/*
 * Die Beschriftung ist ein echtes <label> und kein <p>: ohne die
 * Verbindung zum Feld hat das Feld gar keinen zugänglichen Namen — für
 * Screenreader wie für jeden Test, der es über sein Label sucht.
 */
/**
 * Einheit wählen — mit Ausweg für den Sonderfall.
 */
function EinheitWahl({ einheiten }: { einheiten: string[] }) {
  const liste = einheiten.includes("Stk") ? einheiten : ["Stk", ...einheiten];
  const [frei, setFrei] = useState(false);

  if (frei) {
    return (
      <div className="flex gap-2">
        <input
          id="eigen-einheit"
          name="einheit"
          autoFocus
          placeholder="z. B. Palette"
          className="w-full rounded-input border border-line bg-surface px-[13px] py-[10px] text-[13.5px] outline-0 focus:border-accent"
        />
        <button
          type="button"
          onClick={() => setFrei(false)}
          className="shrink-0 cursor-pointer rounded-input border border-line bg-surface px-3 text-[12.5px] text-muted"
        >
          Liste
        </button>
      </div>
    );
  }

  return (
    <select
      id="eigen-einheit"
      name="einheit"
      defaultValue="Stk"
      data-testid="eigen-einheit"
      onChange={(e) => {
        if (e.target.value === "__frei") setFrei(true);
      }}
      className="w-full cursor-pointer rounded-input border border-line bg-surface px-[13px] py-[10px] text-[13.5px] outline-0 focus:border-accent"
    >
      {liste.map((e) => (
        <option key={e} value={e}>
          {e}
        </option>
      ))}
      <option value="__frei">andere …</option>
    </select>
  );
}

function Beschriftung({
  fuer,
  children,
}: {
  fuer?: string;
  children: React.ReactNode;
}) {
  return (
    <label
      {...(fuer ? { htmlFor: fuer } : {})}
      className="mt-3 mb-[6px] block text-[11px] font-semibold tracking-[0.08em] text-muted uppercase"
    >
      {children}
    </label>
  );
}

/* ------------------------------------------------------------- GRUPPE */

function GruppeFenster({
  offen,
  schliessen,
  vorgangId,
}: {
  offen: boolean;
  schliessen: () => void;
  vorgangId: string;
}) {
  const [status, formAction] = useActionState<AktionsStatus, FormData>(
    gruppeAnlegen,
    LEER,
  );

  return (
    <Dialog
      offen={offen}
      titel="Gruppe anlegen"
      icon={<span className="text-s-waiting">⊞</span>}
      schliessen={schliessen}
    >
      <p className="mb-3 rounded-input bg-panel px-4 py-3 text-[12.5px] text-muted">
        Für Pakete wie „PV-Anlage 9,3 kWp“. Der Kunde entscheidet über das
        Paket und nicht über zwanzig Modulklemmen zu 3,10 €.
      </p>

      <form action={formAction} key={status.ok ?? "leer"}>
        <input type="hidden" name="vorgangId" value={vorgangId} />

        <Beschriftung>Name</Beschriftung>
        <input
          name="name"
          required
          placeholder="PV-Anlage 9,3 kWp"
          className="w-full rounded-input border border-line bg-surface px-[13px] py-[10px] text-[13.5px] outline-0 focus:border-accent"
        />

        <Beschriftung>Beschreibung — optional</Beschriftung>
        <textarea
          name="beschreibung"
          rows={3}
          placeholder="Erscheint beim Kunden über den Positionen."
          className="w-full resize-y rounded-input border border-line bg-surface px-[13px] py-[10px] text-[13.5px] outline-0 focus:border-accent"
        />

        <Meldung status={status} />
        <DialogFuss abbrechen={schliessen}>
          <Absenden label="Anlegen" />
        </DialogFuss>
      </form>
    </Dialog>
  );
}

/* ------------------------------------------------------------ VORLAGE */

function VorlageFenster({
  offen,
  schliessen,
  vorgangId,
  vorlagen,
  sichern,
}: {
  offen: boolean;
  schliessen: () => void;
  vorgangId: string;
  vorlagen: VorlageOption[];
  sichern: () => void;
}) {
  const [status, formAction] = useActionState<AktionsStatus, FormData>(
    vorlageAnwenden,
    LEER,
  );
  const [ersetzen, setErsetzen] = useState(true);

  return (
    <Dialog offen={offen} titel="Vorlage laden" schliessen={schliessen}>
      {vorlagen.length === 0 ? (
        <p className="text-[13px] text-muted">
          Noch keine Vorlage. Stell ein Angebot zusammen und sichere es —
          beim nächsten Mal steht es hier.
        </p>
      ) : (
        <>
          {/*
            Ersetzend ist die Vorgabe: eine Vorlage ist ein vollständiges
            Paket und kein Baustein. Wer anhängen will, nimmt das Häkchen weg.
          */}
          <label className="mb-3 flex items-center gap-2 text-[12.5px]">
            <input
              type="checkbox"
              checked={ersetzen}
              onChange={(e) => setErsetzen(e.target.checked)}
              className="h-4 w-4 accent-[var(--accent)]"
            />
            Bestehende Positionen ersetzen
          </label>

          <Meldung status={status} />

          <ul className="flex flex-col gap-[6px]">
            {vorlagen.map((v) => (
              <li key={v.id}>
                <form action={formAction}>
                  <input type="hidden" name="vorgangId" value={vorgangId} />
                  <input type="hidden" name="vorlageId" value={v.id} />
                  {ersetzen ? (
                    <input type="hidden" name="ersetzen" value="ja" />
                  ) : null}
                  <button
                    type="submit"
                    className="w-full cursor-pointer rounded-card border border-line bg-surface px-4 py-[13px] text-left transition-colors hover:border-accent hover:bg-accent/6"
                  >
                    <span className="block text-[14px] font-bold">
                      {v.name}
                      {v.istStandard ? (
                        <span className="ml-2 rounded-pill bg-sunk px-[8px] py-px text-[10px] font-semibold text-muted">
                          Standard
                        </span>
                      ) : null}
                    </span>
                    <span className="num block text-[12px] text-faint">
                      {v.anzahlPositionen}{" "}
                      {v.anzahlPositionen === 1 ? "Position" : "Positionen"}
                      {v.zielKwp ? ` · ${num(v.zielKwp)} kWp` : ""}
                    </span>
                  </button>
                </form>
              </li>
            ))}
          </ul>

          <p className="mt-3 text-[11.5px] text-faint">
            Preise kommen frisch aus dem Artikelstamm — eine Vorlage von
            letztem Jahr schreibt nicht die Preise von damals ins Angebot.
          </p>
        </>
      )}

      <DialogFuss abbrechen={schliessen}>
        <button
          type="button"
          onClick={sichern}
          className="min-h-[40px] cursor-pointer rounded-pill border border-line bg-surface px-[18px] text-[13px] font-semibold text-ink transition-colors hover:bg-sunk"
        >
          Dieses Angebot als Vorlage sichern
        </button>
      </DialogFuss>
    </Dialog>
  );
}

function SichernFenster({
  offen,
  schliessen,
  vorgangId,
}: {
  offen: boolean;
  schliessen: () => void;
  vorgangId: string;
}) {
  const [status, formAction] = useActionState<AktionsStatus, FormData>(
    alsVorlageSpeichern,
    LEER,
  );

  return (
    <Dialog offen={offen} titel="Als Vorlage sichern" schliessen={schliessen}>
      <form action={formAction} key={status.ok ?? "leer"}>
        <input type="hidden" name="vorgangId" value={vorgangId} />

        <Beschriftung>Name der Vorlage</Beschriftung>
        <input
          name="name"
          placeholder="z. B. Standardpaket 10 kWp mit Speicher"
          className="w-full rounded-input border border-line bg-surface px-[13px] py-[10px] text-[13.5px] outline-0 focus:border-accent"
        />

        <label className="mt-3 flex items-center gap-2 text-[12.5px]">
          <input
            type="checkbox"
            name="alsStandard"
            value="ja"
            className="h-4 w-4 accent-[var(--accent)]"
          />
          Als Standard — wird bei einem neuen Angebot vorgeschlagen
        </label>

        <Meldung status={status} />
        <DialogFuss abbrechen={schliessen}>
          <Absenden label="Sichern" />
        </DialogFuss>
      </form>
    </Dialog>
  );
}

/* ------------------------------------------------------------ EIGENES */

function EigenesFenster({
  offen,
  schliessen,
  vorgangId,
  einheiten,
}: {
  offen: boolean;
  schliessen: () => void;
  vorgangId: string;
  einheiten: string[];
}) {
  const [status, formAction] = useActionState<AktionsStatus, FormData>(
    positionFrei,
    LEER,
  );

  return (
    <Dialog
      offen={offen}
      titel="Eigene Position"
      icon={<span className="text-s-done">🏷</span>}
      schliessen={schliessen}
    >
      <p className="mb-4 rounded-input bg-s-doing/8 px-4 py-3 text-[12.5px]">
        <strong className="font-semibold">Nur für dieses Angebot</strong> — sie
        wandert nicht in den Artikelstamm. Für Montage, Anfahrt, Gerüst.
      </p>

      <form action={formAction} key={status.ok ?? "leer"}>
        <input type="hidden" name="vorgangId" value={vorgangId} />

        {/*
          Keine Kategorie: eine freie Position hat keinen Artikel, und am
          Positionsdatensatz gibt es keine Spalte dafür. Ein Feld, dessen
          Inhalt beim Speichern verschwindet, ist schlimmer als keines.
        */}
        {/*
          Ein Auswahlfeld und keine datalist.
          Die datalist zeigt keinen Pfeil und klappt erst auf, wenn man
          zu tippen anfängt — sie sah aus wie ein totes Textfeld, in dem
          für immer "Stk" steht. Wer eine Einheit braucht, die nicht in
          der Liste ist, bekommt sie über "andere"; das ist der seltene
          Fall und darf einen Klick mehr kosten.
        */}
        <Beschriftung fuer="eigen-einheit">Einheit</Beschriftung>
        <EinheitWahl einheiten={einheiten} />

        <Beschriftung fuer="eigen-bezeichnung">Bezeichnung — Pflicht</Beschriftung>
        <input
          id="eigen-bezeichnung"
          name="bezeichnung"
          required
          placeholder="z. B. Gerüst Aufbau 2 Tage"
          className="w-full rounded-input border border-line bg-surface px-[13px] py-[10px] text-[13.5px] outline-0 focus:border-accent"
        />

        <Beschriftung fuer="eigen-beschreibung">Beschreibung — optional</Beschriftung>
        <textarea
          id="eigen-beschreibung"
          name="beschreibung"
          rows={3}
          placeholder="Erscheint beim Kunden unter der Position."
          className="w-full resize-y rounded-input border border-line bg-surface px-[13px] py-[10px] text-[13.5px] outline-0 focus:border-accent"
        />

        <div className="grid gap-3 sm:grid-cols-4">
          <Zahl name="menge" label="Menge" wert="1" schritt="0.001" />
          <Zahl name="kalkEk" label="EK" wert="0" schritt="0.01" />
          <Zahl name="epNetto" label="VK — Pflicht" wert="0" schritt="0.01" />
          <Zahl name="kalkStunden" label="Stunden" wert="" schritt="0.001" />
        </div>

        <label className="mt-3 flex items-center gap-2 text-[12.5px]">
          <input
            type="checkbox"
            name="istMaterial"
            value="ja"
            className="h-4 w-4 accent-[var(--accent)]"
          />
          Material — zählt in die Bedarfsliste der Montage
        </label>

        <Meldung status={status} />
        <DialogFuss abbrechen={schliessen}>
          <Absenden label="Hinzufügen" />
        </DialogFuss>
      </form>
    </Dialog>
  );
}

function Zahl({
  name,
  label,
  wert,
  schritt,
}: {
  name: string;
  label: string;
  wert: string;
  schritt: string;
}) {
  const id = `zahl-${name}`;
  return (
    <div>
      <Beschriftung fuer={id}>{label}</Beschriftung>
      <input
        id={id}
        name={name}
        type="number"
        step={schritt}
        defaultValue={wert}
        className="num w-full rounded-input border border-line bg-surface px-[11px] py-[9px] text-[13.5px] outline-0 focus:border-accent"
      />
    </div>
  );
}
