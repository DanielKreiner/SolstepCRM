"use client";

import Link from "next/link";
import { useActionState, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { Dialog, DialogFuss } from "@/components/ui/Dialog";
import { Suchauswahl, type Option } from "@/components/ui/Suchauswahl";
import { einsatzLoeschen, einsatzSpeichern, type PlanStatus } from "@/app/(app)/planung/actions";
import { blockiert, pruefe } from "@/lib/einsatz/konflikte";
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
  qualifikationen,
  darfPlanen,
}: {
  woche: string;
  tage: string[];
  personen: TafelPerson[];
  fahrzeuge: { id: string; name: string; kennzeichen: string | null }[];
  bloecke: TafelBlock[];
  abwesenheiten: TafelAbw[];
  vorgaenge: Option[];
  qualifikationen: { wert: string; text: string }[];
  darfPlanen: boolean;
}) {
  const [offen, setOffen] = useState<{ tag: string; userId: string | null } | null>(
    null,
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
            onClick={() => setOffen({ tag: tage[0]!, userId: null })}
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
        neuerEinsatz={(tag, userId) => setOffen({ tag, userId })}
      />

      {offen ? (
        <EinsatzDialog
          tag={offen.tag}
          userId={offen.userId}
          personen={personen}
          fahrzeuge={fahrzeuge}
          vorgaenge={vorgaenge}
          qualifikationen={qualifikationen}
          bloecke={bloecke}
          abwesenheiten={abwesenheiten}
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
  personen,
  fahrzeuge,
  vorgaenge,
  qualifikationen,
  bloecke,
  abwesenheiten,
  schliessen,
}: {
  tag: string;
  userId: string | null;
  personen: TafelPerson[];
  fahrzeuge: { id: string; name: string; kennzeichen: string | null }[];
  vorgaenge: Option[];
  qualifikationen: { wert: string; text: string }[];
  bloecke: TafelBlock[];
  abwesenheiten: TafelAbw[];
  schliessen: () => void;
}) {
  const [status, formAction] = useActionState<PlanStatus, FormData>(
    einsatzSpeichern,
    LEER,
  );
  const [art, setArt] = useState<"auftrag" | "service" | "intern">("auftrag");
  const [ganztaegig, setGanztaegig] = useState(false);
  const [gewaehlt, setGewaehlt] = useState<string[]>(userId ? [userId] : []);
  const [fahrzeugId, setFahrzeugId] = useState("");
  const [benoetigt, setBenoetigt] = useState<string[]>([]);
  const [vonRoh, setVonRoh] = useState(`${tag}T07:00`);
  const [bisRoh, setBisRoh] = useState(`${tag}T16:00`);
  const [grund, setGrund] = useState("");

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
        id: "neu",
        von: new Date(von).toISOString(),
        bis: new Date(bis).toISOString(),
        personen: gewaehlt,
        fahrzeugId: fahrzeugId || null,
        titel: "dieser Einsatz",
      },
      bestand: bloecke.map((b) => ({
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
  }, [von, bis, gewaehlt, fahrzeugId, benoetigt, bloecke, personen, abwesenheiten, fahrzeuge]);

  const hart = konflikte.filter((k) => k.stufe === "hart");
  const weich = konflikte.filter((k) => k.stufe === "weich");
  const gesperrt = blockiert(konflikte);

  /* Nach dem Speichern schliesst sich das Fenster von selbst. */
  if (status.ok) schliessen();

  function umschalten(liste: string[], wert: string): string[] {
    return liste.includes(wert) ? liste.filter((x) => x !== wert) : [...liste, wert];
  }

  return (
    <Dialog offen titel="Einsatz anlegen" breite="weit" schliessen={schliessen}>
      <form action={formAction}>
        {/* Die Auswahl liegt im Zustand — die Felder reichen sie mit. */}
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
            />
          </div>
        ) : (
          <p className="mb-3 rounded-input bg-panel px-4 py-3 text-[12.5px] text-muted">
            Interne Einsätze hängen an keinem Vorgang. Die Zeiten laufen auf
            das Sammelkonto Intern.
          </p>
        )}

        <Beschriftung>Bezeichnung</Beschriftung>
        <input
          name="titel"
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

        <DialogFuss abbrechen={schliessen}>
          <Absenden
            label={weich.length ? "Trotzdem anlegen" : "Einsatz anlegen"}
            gesperrt={gesperrt}
          />
        </DialogFuss>
      </form>
    </Dialog>
  );
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
