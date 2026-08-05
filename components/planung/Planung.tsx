"use client";

import Link from "next/link";
import { useActionState, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { Dialog, DialogFuss } from "@/components/ui/Dialog";
import { Suchauswahl, type Option } from "@/components/ui/Suchauswahl";
import { einsatzLoeschen, einsatzSpeichern, type PlanStatus } from "@/app/(app)/planung/actions";
import { blockiert, pruefe } from "@/lib/einsatz/konflikte";
import { Servicetag, type ServiceEinsatz } from "./Servicetag";
import {
  Plantafel,
  type TafelAbw,
  type TafelBlock,
  type TafelPerson,
} from "./Plantafel";

const LEER: PlanStatus = { error: null, ok: null };

/**
 * Der Rahmen um die Plantafel: Wochennavigation, Legende, Einsatzdialog.
 *
 * Der Dialog ist bewusst ein Fenster: er trägt Vorgangssuche,
 * Mehrfachauswahl der Personen und die Konfliktwarnungen. Inline würde
 * er die Tafel verdrängen, die man beim Planen gerade ansieht.
 */
export function Planung({
  woche,
  tage,
  personen,
  fahrzeuge,
  bloecke,
  abwesenheiten,
  vorgaenge,
  kunden,
  anliegen,
  qualifikationen,
  darfPlanen,
  vorgangVorbelegt,
  servicetage,
}: {
  woche: string;
  tage: string[];
  personen: TafelPerson[];
  fahrzeuge: { id: string; name: string; kennzeichen: string | null }[];
  bloecke: TafelBlock[];
  abwesenheiten: TafelAbw[];
  vorgaenge: Option[];
  /** Kunden für Service ohne Vorgang — dort kommt die Adresse vom Kunden. */
  kunden: Option[];
  /** Offene Serviceanliegen, an die sich ein Einsatz hängen lässt. */
  anliegen: Option[];
  qualifikationen: { wert: string; text: string }[];
  darfPlanen: boolean;
  /**
   * Aus der Aufgabe im Vorgang: der Dialog geht gleich auf und trägt den
   * Vorgang schon. Sonst müsste der Planer den Vorgang, aus dem er
   * gerade kommt, noch einmal suchen.
   */
  vorgangVorbelegt: string | null;
  /** Serviceeinsätze der Woche — die mit mehreren Adressen an einem Tag. */
  servicetage: ServiceEinsatz[];
}) {
  const [offen, setOffen] = useState<{
    tag: string;
    userId: string | null;
    /** Gesetzt heisst bearbeiten statt anlegen. */
    block: TafelBlock | null;
  } | null>(
    vorgangVorbelegt && darfPlanen
      ? { tag: tage[0]!, userId: null, block: null }
      : null,
  );

  const vorWoche = verschoben(woche, -7);
  const naechste = verschoben(woche, 7);

  const zaehler = {
    gesamt: bloecke.length,
    mitVorgang: bloecke.filter((b) => b.vorgangId).length,
    abwesend: abwesenheiten.length,
  };

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1 rounded-pill bg-surface p-1 shadow-soft">
          <Pfeil href={`/planung?woche=${vorWoche}`} label="Woche zurück">
            ‹
          </Pfeil>
          <Link
            href="/planung"
            className="num rounded-pill px-[14px] py-[7px] text-[13px] font-semibold text-ink hover:text-ink"
          >
            Heute
          </Link>
          <Pfeil href={`/planung?woche=${naechste}`} label="Woche vor">
            ›
          </Pfeil>
        </div>

        <Legende />

        <span className="num ml-auto text-[12px] text-muted">
          {zaehler.gesamt} {zaehler.gesamt === 1 ? "Einsatz" : "Einsätze"} ·{" "}
          {zaehler.mitVorgang} auf Vorgänge ·{" "}
          {zaehler.abwesend}{" "}
          {zaehler.abwesend === 1 ? "Abwesenheit" : "Abwesenheiten"}
        </span>

        {darfPlanen ? (
          <button
            type="button"
            onClick={() => setOffen({ tag: tage[0]!, userId: null, block: null })}
            className="cursor-pointer rounded-pill border-0 bg-[linear-gradient(150deg,var(--accent-from),var(--accent-to))] px-5 py-[11px] text-[13.5px] font-semibold text-white"
          >
            + Einsatz anlegen
          </button>
        ) : null}
      </div>

      <Plantafel
        tage={tage}
        personen={personen}
        fahrzeuge={fahrzeuge}
        bloecke={bloecke}
        abwesenheiten={abwesenheiten}
        darfPlanen={darfPlanen}
        neuerEinsatz={(tag, userId) => setOffen({ tag, userId, block: null })}
        einsatzOeffnen={(id) => {
          const b = bloecke.find((x) => x.id === id);
          if (b) setOffen({ tag: b.von.slice(0, 10), userId: null, block: b });
        }}
      />

      <Servicetag einsaetze={servicetage} darfPlanen={darfPlanen} />

      {offen ? (
        <EinsatzDialog
          key={offen.block?.id ?? "neu"}
          tag={offen.tag}
          userId={offen.userId}
          block={offen.block}
          kunden={kunden}
          anliegen={anliegen}
          personen={personen}
          fahrzeuge={fahrzeuge}
          vorgaenge={vorgaenge}
          qualifikationen={qualifikationen}
          bloecke={bloecke}
          abwesenheiten={abwesenheiten}
          vorgangVorbelegt={vorgangVorbelegt}
          schliessen={() => setOffen(null)}
        />
      ) : null}
    </>
  );
}

function Pfeil({
  href,
  label,
  children,
}: {
  href: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-label={label}
      className="grid h-[30px] w-[30px] place-items-center rounded-pill text-[15px] text-muted hover:bg-sunk hover:text-ink"
    >
      {children}
    </Link>
  );
}

function Legende() {
  return (
    <div className="flex flex-wrap items-center gap-3 text-[12px] text-muted">
      {[
        ["Auftrag", "bg-accent/25"],
        ["Service", "bg-s-done/25"],
        ["Intern", "bg-sunk"],
        ["Abwesenheit", "bg-s-waiting/25"],
      ].map(([label, farbe]) => (
        <span key={label} className="flex items-center gap-[6px]">
          <span aria-hidden className={`h-[13px] w-[13px] rounded-[4px] ${farbe}`} />
          {label}
        </span>
      ))}
    </div>
  );
}

/**
 * Ein gespeicherter Zeitpunkt als Wert für ein datetime-local-Feld.
 *
 * `toISOString()` ginge nicht: das liefert UTC, und ein Einsatz von 07:00
 * stünde im Formular als 05:00. Gefragt ist die Wanduhrzeit des Browsers,
 * die auch der Planer sieht.
 */
function lokal(iso: string): string {
  const d = new Date(iso);
  const zwei = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${zwei(d.getMonth() + 1)}-${zwei(d.getDate())}T${zwei(
    d.getHours(),
  )}:${zwei(d.getMinutes())}`;
}

/** Datum um Tage verschieben, ohne Zeitzonenrechnerei. */
function verschoben(iso: string, tage: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + tage);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/* ------------------------------------------------------------- DIALOG */

function EinsatzDialog({
  tag,
  userId,
  block,
  personen,
  fahrzeuge,
  vorgaenge,
  kunden,
  anliegen,
  qualifikationen,
  bloecke,
  abwesenheiten,
  vorgangVorbelegt,
  schliessen,
}: {
  tag: string;
  userId: string | null;
  /** Null heisst anlegen. Sonst wird dieser Einsatz bearbeitet. */
  block: TafelBlock | null;
  personen: TafelPerson[];
  fahrzeuge: { id: string; name: string; kennzeichen: string | null }[];
  vorgaenge: Option[];
  kunden: Option[];
  anliegen: Option[];
  qualifikationen: { wert: string; text: string }[];
  bloecke: TafelBlock[];
  abwesenheiten: TafelAbw[];
  vorgangVorbelegt: string | null;
  schliessen: () => void;
}) {
  const [status, formAction] = useActionState<PlanStatus, FormData>(
    einsatzSpeichern,
    LEER,
  );
  const [loeschStatus, loeschen] = useActionState<PlanStatus, FormData>(
    einsatzLoeschen,
    LEER,
  );
  const [art, setArt] = useState<"auftrag" | "service" | "intern">(
    block?.art ?? "auftrag",
  );
  const [ganztaegig, setGanztaegig] = useState(block?.ganztaegig ?? false);
  const [gewaehlt, setGewaehlt] = useState<string[]>(
    block ? block.personen : userId ? [userId] : [],
  );
  const [fahrzeugId, setFahrzeugId] = useState(block?.fahrzeugId ?? "");
  const [benoetigt, setBenoetigt] = useState<string[]>(block?.benoetigt ?? []);
  const [vonRoh, setVonRoh] = useState(
    block ? lokal(block.von) : `${tag}T07:00`,
  );
  const [bisRoh, setBisRoh] = useState(
    block ? lokal(block.bis) : `${tag}T16:00`,
  );
  const [grund, setGrund] = useState("");
  const [loeschFrage, setLoeschFrage] = useState(false);

  /*
   * Ganztägig heisst 00:00 bis 23:59 — und dann hat eine Uhrzeit im Feld
   * nichts verloren. Vorher standen beide Felder weiter mit Uhrzeit da,
   * obwohl der Wert ignoriert wurde.
   */
  const von = ganztaegig ? `${vonRoh.slice(0, 10)}T00:00` : vonRoh;
  const bis = ganztaegig ? `${bisRoh.slice(0, 10)}T23:59` : bisRoh;

  /*
   * Geprüft wird beim Tippen, nicht erst beim Absenden.
   *
   * Vorher kam die Warnung erst als Antwort des Servers zurück — dabei
   * verlor das Formular die angekreuzten Personen, und beim zweiten
   * Absenden landete nur noch einer im Einsatz. Dieselbe reine Funktion
   * läuft jetzt hier; der Server prüft weiterhin selbst, weil man eine
   * Oberfläche umgehen kann.
   */
  const konflikte = useMemo(() => {
    if (!von || !bis || new Date(bis) <= new Date(von)) return [];
    return pruefe({
      neu: {
        id: block?.id ?? "neu",
        von: new Date(von).toISOString(),
        bis: new Date(bis).toISOString(),
        personen: gewaehlt,
        fahrzeugId: fahrzeugId || null,
        titel: "dieser Einsatz",
      },
      /*
       * Beim Bearbeiten sich selbst herausnehmen: ein Einsatz
       * überschneidet sich immer mit sich, und der Dialog meldete beim
       * blossen Verschieben um eine Stunde einen Konflikt mit dem
       * Termin, den man gerade ändert.
       */
      bestand: bloecke
        .filter((b) => b.id !== block?.id)
        .map((b) => ({
          id: b.id,
          von: b.von,
          bis: b.bis,
          personen: b.personen,
          fahrzeugId: b.fahrzeugId,
          titel: b.titel,
        })),
      personen: personen.map((p) => ({
        id: p.id,
        name: p.name,
        qualifikationen: p.qualifikationen,
      })),
      abwesenheiten: abwesenheiten
        .filter((a) => a.status === "approved")
        .map((a) => ({ userId: a.userId, von: a.von, bis: a.bis, art: a.art })),
      benoetigt,
      fahrzeuge: fahrzeuge.map((f) => ({ id: f.id, name: f.name })),
    });
  }, [
    von,
    bis,
    gewaehlt,
    fahrzeugId,
    benoetigt,
    bloecke,
    personen,
    abwesenheiten,
    fahrzeuge,
    block,
  ]);

  const hart = konflikte.filter((k) => k.stufe === "hart");
  const weich = konflikte.filter((k) => k.stufe === "weich");
  const gesperrt = blockiert(konflikte);

  /* Nach dem Speichern oder Löschen schliesst sich das Fenster selbst. */
  if (status.ok || loeschStatus.ok) schliessen();

  function umschalten(liste: string[], wert: string): string[] {
    return liste.includes(wert) ? liste.filter((x) => x !== wert) : [...liste, wert];
  }

  return (
    <Dialog
      offen
      titel={block ? "Einsatz bearbeiten" : "Einsatz anlegen"}
      breite="weit"
      schliessen={schliessen}
    >
      <form action={formAction}>
        {/* Die Auswahl liegt im Zustand — die Felder reichen sie mit. */}
        {block ? (
          <input type="hidden" name="einsatzId" value={block.id} />
        ) : null}
        <input type="hidden" name="von" value={von} />
        <input type="hidden" name="bis" value={bis} />
        {gewaehlt.map((u) => (
          <input key={u} type="hidden" name="personen" value={u} />
        ))}
        {benoetigt.map((q) => (
          <input key={q} type="hidden" name="benoetigt" value={q} />
        ))}

        <Beschriftung>Art</Beschriftung>
        <div className="mb-3 flex flex-wrap gap-2">
          {(
            [
              ["auftrag", "Auftrag", "Aufnahme oder Montage — braucht einen Vorgang"],
              ["service", "Service", "Störung oder Wartung, Vorgang optional"],
              ["intern", "Intern", "Lager, Werkstatt, Schulung"],
            ] as const
          ).map(([wert, label, hilfe]) => (
            <label
              key={wert}
              title={hilfe}
              className={[
                "cursor-pointer rounded-pill border px-[15px] py-[8px] text-[13px] font-semibold transition-colors",
                art === wert
                  ? "border-accent bg-accent/10 text-accent-ink"
                  : "border-line bg-surface text-muted",
              ].join(" ")}
            >
              <input
                type="radio"
                name="art"
                value={wert}
                checked={art === wert}
                onChange={() => setArt(wert)}
                className="sr-only"
              />
              {label}
            </label>
          ))}
        </div>

        {art !== "intern" ? (
          <div className="mb-3">
            <Suchauswahl
              name="vorgangId"
              label={art === "auftrag" ? "Vorgang — Pflicht" : "Vorgang — optional"}
              breit
              pflicht={art === "auftrag"}
              platzhalter="Nummer oder Kundenname"
              optionen={vorgaenge}
              {...(block?.vorgangId
                ? { wert: block.vorgangId }
                : vorgangVorbelegt
                  ? { wert: vorgangVorbelegt }
                  : {})}
            />
          </div>
        ) : (
          <p className="mb-3 rounded-input bg-panel px-4 py-3 text-[12.5px] text-muted">
            Interne Einsätze hängen an keinem Vorgang. Die Zeiten laufen auf
            das Sammelkonto Intern.
          </p>
        )}

        {/*
          Ein Service hat oft keinen laufenden Vorgang: die Anlage steht
          seit drei Jahren, der Wechselrichter meldet einen Fehler,
          jemand fährt hin. Ohne Kunde am Einsatz bekäme der Monteur auf
          "Heute" keine Adresse, keinen Ansprechpartner, keine Nummer —
          nur einen Freitexttitel.
        */}
        {art === "service" ? (
          <>
            <div className="mb-3">
              <Suchauswahl
                name="kundeId"
                label="Kunde — wenn kein Vorgang dahintersteht"
                breit
                platzhalter="Name oder Ort"
                optionen={kunden}
                {...(block?.kundeId ? { wert: block.kundeId } : {})}
              />
            </div>

            {anliegen.length > 0 ? (
              <div className="mb-3">
                <Suchauswahl
                  name="serviceTicketId"
                  label="Anliegen — optional"
                  breit
                  platzhalter="Nummer oder Betreff"
                  optionen={anliegen}
                  {...(block?.serviceTicketId ? { wert: block.serviceTicketId } : {})}
                />
                <p className="mt-1 text-[11.5px] text-muted">
                  Hängt der Einsatz am Anliegen, weiss die Meldung, dass
                  jemand kommt — sonst steht sie weiter als offen im Cockpit.
                </p>
              </div>
            ) : null}
          </>
        ) : null}

        <Beschriftung>Bezeichnung</Beschriftung>
        <input
          name="titel"
          defaultValue={block?.titel ?? ""}
          placeholder={art === "intern" ? "z. B. Lager aufräumen" : "z. B. Montage Tag 1"}
          className="mb-3 w-full rounded-input border border-line bg-surface px-[13px] py-[10px] text-[13.5px] outline-0 focus:border-accent"
        />

        <label className="mb-2 flex items-center gap-2 text-[12.5px]">
          <input
            type="checkbox"
            name="ganztaegig"
            value="ja"
            checked={ganztaegig}
            onChange={(e) => setGanztaegig(e.target.checked)}
            className="h-4 w-4 accent-[var(--accent)]"
          />
          Ganztägig
        </label>

        <div className="mb-3 grid gap-3 sm:grid-cols-2">
          <div>
            <Beschriftung>Von</Beschriftung>
            <input
              type={ganztaegig ? "date" : "datetime-local"}
              required
              value={ganztaegig ? vonRoh.slice(0, 10) : vonRoh}
              onChange={(e) =>
                setVonRoh(
                  ganztaegig ? `${e.target.value}T00:00` : e.target.value,
                )
              }
              className="num w-full rounded-input border border-line bg-surface px-[13px] py-[10px] text-[13.5px] outline-0 focus:border-accent"
            />
          </div>
          <div>
            <Beschriftung>Bis</Beschriftung>
            <input
              type={ganztaegig ? "date" : "datetime-local"}
              required
              value={ganztaegig ? bisRoh.slice(0, 10) : bisRoh}
              onChange={(e) =>
                setBisRoh(
                  ganztaegig ? `${e.target.value}T23:59` : e.target.value,
                )
              }
              className="num w-full rounded-input border border-line bg-surface px-[13px] py-[10px] text-[13.5px] outline-0 focus:border-accent"
            />
          </div>
        </div>

        <Beschriftung>
          Wer fährt{gewaehlt.length ? ` — ${gewaehlt.length} gewählt` : ""}
        </Beschriftung>
        <div className="mb-3 flex flex-wrap gap-2">
          {personen.map((p) => (
            <label
              key={p.id}
              className={[
                "flex cursor-pointer items-center gap-2 rounded-pill border px-[13px] py-[7px] text-[12.5px] transition-colors",
                gewaehlt.includes(p.id)
                  ? "border-accent bg-accent/10"
                  : "border-line bg-surface",
              ].join(" ")}
            >
              <input
                type="checkbox"
                checked={gewaehlt.includes(p.id)}
                onChange={() => setGewaehlt((l) => umschalten(l, p.id))}
                className="h-[15px] w-[15px] accent-[var(--accent)]"
              />
              {p.name}
            </label>
          ))}
        </div>

        <div className="mb-3 grid gap-3 sm:grid-cols-2">
          <div>
            <Beschriftung>Fahrzeug</Beschriftung>
            <select
              name="fahrzeugId"
              value={fahrzeugId}
              onChange={(e) => setFahrzeugId(e.target.value)}
              className="w-full rounded-input border border-line bg-surface px-[13px] py-[10px] text-[13.5px] outline-0 focus:border-accent"
            >
              <option value="">— keines —</option>
              {fahrzeuge.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                  {f.kennzeichen ? ` (${f.kennzeichen})` : ""}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Beschriftung>Sub — Fremdfirma</Beschriftung>
            <input
              name="subText"
              defaultValue={block?.subText ?? ""}
              placeholder="Name der Fremdfirma"
              className="w-full rounded-input border border-line bg-surface px-[13px] py-[10px] text-[13.5px] outline-0 focus:border-accent"
            />
          </div>
        </div>

        {qualifikationen.length > 0 ? (
          <>
            <Beschriftung>Nötige Qualifikation</Beschriftung>
            <div className="mb-3 flex flex-wrap gap-2">
              {qualifikationen.map((q) => (
                <label
                  key={q.wert}
                  className={[
                    "flex cursor-pointer items-center gap-2 rounded-pill border px-[13px] py-[7px] text-[12.5px] transition-colors",
                    benoetigt.includes(q.wert)
                      ? "border-accent bg-accent/10"
                      : "border-line bg-surface",
                  ].join(" ")}
                >
                  <input
                    type="checkbox"
                    checked={benoetigt.includes(q.wert)}
                    onChange={() => setBenoetigt((l) => umschalten(l, q.wert))}
                    className="h-[15px] w-[15px] accent-[var(--accent)]"
                  />
                  {q.text}
                </label>
              ))}
            </div>
          </>
        ) : null}

        <Beschriftung>Notiz</Beschriftung>
        <textarea
          name="notiz"
          defaultValue={block?.notiz ?? ""}
          rows={2}
          className="w-full resize-y rounded-input border border-line bg-surface px-[13px] py-[10px] text-[13.5px] outline-0 focus:border-accent"
        />

        {/* ------------------------------------------------- KONFLIKTE */}
        {hart.length > 0 ? (
          <div className="mt-4 rounded-card border border-s-crit/40 bg-s-crit/8 p-4">
            <p className="mb-1 text-[13px] font-semibold text-s-crit">
              Nicht speicherbar
            </p>
            <ul className="flex flex-col gap-[4px] text-[12.5px]">
              {hart.map((k, i) => (
                <li key={i}>{k.text}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {weich.length > 0 ? (
          <div className="mt-4 rounded-card border border-s-warn/40 bg-s-warn/8 p-4">
            <p className="mb-2 text-[13px] font-semibold">
              {weich.length === 1 ? "Eine Warnung" : `${weich.length} Warnungen`} —
              überstimmbar mit Begründung
            </p>
            <ul className="mb-3 flex flex-col gap-[6px]">
              {weich.map((w, i) => (
                <li key={i} className="flex flex-wrap items-baseline gap-2 text-[12.5px]">
                  <span className="min-w-0 flex-1">{w.text}</span>
                  {w.regel ? (
                    <span className="num text-[11.5px] text-muted">{w.regel}</span>
                  ) : null}
                </li>
              ))}
            </ul>
            {/*
              Ohne Begründung kein Überstimmen: der Text landet im
              Ereignis am Einsatz und am Vorgang. Ein Override, den
              hinterher niemand erklären kann, ist keiner.
            */}
            <input
              name="trotzdem"
              required
              value={grund}
              onChange={(e) => setGrund(e.target.value)}
              placeholder="Warum trotzdem so planen?"
              className="w-full rounded-input border border-line bg-surface px-[13px] py-[10px] text-[13px] outline-0 focus:border-accent"
            />
          </div>
        ) : null}

        {status.error ? (
          <p role="status" className="mt-3 rounded-input bg-s-crit/10 px-4 py-3 text-[13px] text-s-crit">
            {status.error}
          </p>
        ) : null}
        {loeschStatus.error ? (
          <p role="alert" className="mt-3 rounded-input bg-s-crit/10 px-4 py-3 text-[13px] text-s-crit">
            {loeschStatus.error}
          </p>
        ) : null}

        <DialogFuss abbrechen={schliessen}>
          <Absenden
            label={
              weich.length
                ? "Trotzdem speichern"
                : block
                  ? "Änderungen speichern"
                  : "Einsatz anlegen"
            }
            gesperrt={gesperrt}
          />
        </DialogFuss>
      </form>

      {/*
        Löschen steht ausserhalb des Formulars — ein zweites <form> im
        ersten verwirft der Browser stillschweigend.

        Und es fragt nach: ein Einsatz trägt Zeiten, Material und die
        Erwartung des Kunden. Ein Fehlklick in einer Tafel voller kleiner
        Kacheln darf das nicht wegräumen.
      */}
      {block ? (
        <div className="mt-4 border-t border-line pt-4">
          {loeschFrage ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[12.5px]">
                {block.titel} am {tagKurz(block.von)} wirklich entfernen?
              </span>
              <form action={loeschen}>
                <input type="hidden" name="einsatzId" value={block.id} />
                <button
                  type="submit"
                  data-testid="einsatz-loeschen-bestaetigen"
                  className="min-h-[36px] cursor-pointer rounded-pill border-0 bg-s-crit px-[18px] text-[12.5px] font-semibold text-white"
                >
                  Ja, entfernen
                </button>
              </form>
              <button
                type="button"
                onClick={() => setLoeschFrage(false)}
                className="min-h-[36px] cursor-pointer rounded-pill border border-line bg-surface px-[18px] text-[12.5px] text-ink"
              >
                Behalten
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                data-testid="einsatz-loeschen"
                onClick={() => setLoeschFrage(true)}
                className="cursor-pointer border-0 bg-transparent p-0 text-[12.5px] font-semibold text-s-crit underline"
              >
                Einsatz entfernen
              </button>
              {block.vorgangId ? (
                <Link
                  href={`/vorgaenge/${block.vorgangId}`}
                  className="ml-auto text-[12.5px] text-accent-ink underline"
                >
                  Zum Vorgang{block.vorgangNummer ? ` ${block.vorgangNummer}` : ""}
                </Link>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
    </Dialog>
  );
}

/** "Mo, 10.08." — genug, um sich der Zeile sicher zu sein. */
function tagKurz(iso: string): string {
  return new Date(iso).toLocaleDateString("de-AT", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
  });
}

function Beschriftung({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-1 mb-[6px] text-[11px] font-semibold tracking-[0.08em] text-muted uppercase">
      {children}
    </p>
  );
}

function Absenden({ label, gesperrt }: { label: string; gesperrt: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || gesperrt}
      title={gesperrt ? "Eine Person ist im Zeitraum abwesend." : ""}
      className="min-h-[40px] cursor-pointer rounded-pill border-0 bg-[linear-gradient(150deg,var(--accent-from),var(--accent-to))] px-[22px] text-[13.5px] font-semibold text-white disabled:opacity-60"
    >
      {pending ? "…" : label}
    </button>
  );
}

export { einsatzLoeschen };
