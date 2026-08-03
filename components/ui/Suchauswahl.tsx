"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Feld } from "./Formular";

/**
 * Auswahl über Tippen statt über eine Klappliste.
 *
 * Ein Betrieb mit 400 Kunden und 3000 Artikeln findet den richtigen
 * Eintrag in einem <select> nicht — man scrollt, statt zu suchen. Diese
 * Auswahl filtert beim Tippen und gibt trotzdem eine gewöhnliche
 * Formularvariable ab, damit sie überall dort einsetzbar ist, wo bisher
 * ein select stand: ein verstecktes input trägt die id.
 *
 * Tastatur: ↓/↑ wandern, Enter wählt, Escape schliesst. Ohne das wäre es
 * für jeden, der nicht mit der Maus arbeitet, eine Verschlechterung
 * gegenüber der Klappliste.
 */

/*
 * Dieselbe Form wie bei Auswahl: {wert, text}. Damit ist der Umstieg von
 * einer Klappliste auf die Suche ein Wort im Bauteilnamen und nicht eine
 * Umformung der Datenliste an jeder Aufrufstelle.
 */
export type Option = {
  wert: string;
  text: string;
  /** Zweite Zeile — Ort, Nummer, Rolle. Wird mitdurchsucht. */
  zusatz?: string;
};

export function Suchauswahl({
  name,
  label,
  optionen,
  wert,
  pflicht = false,
  breit = false,
  platzhalter = "Suchen",
  hinweis,
  leerLabel = "— keine Auswahl —",
  onAuswahl,
}: {
  name: string;
  label: string;
  optionen: Option[];
  /** Vorbelegung als id. */
  wert?: string | null;
  pflicht?: boolean;
  breit?: boolean;
  platzhalter?: string;
  hinweis?: string;
  /** Text für „nichts gewählt". Bei pflicht wird er nicht angeboten. */
  leerLabel?: string;
  onAuswahl?: (id: string) => void;
}) {
  const id = useId();
  const listeId = `${id}-liste`;

  const gewaehltInitial = optionen.find((o) => o.wert === wert) ?? null;
  const [gewaehlt, setGewaehlt] = useState<Option | null>(gewaehltInitial);
  const [suche, setSuche] = useState("");
  const [offen, setOffen] = useState(false);
  const [aktiv, setAktiv] = useState(0);

  const huelle = useRef<HTMLDivElement>(null);

  /*
   * Ändert sich die Vorbelegung von aussen — etwa weil der Server nach dem
   * Speichern neue Werte liefert —, muss die Anzeige mitgehen.
   *
   * Die Abhängigkeit ist bewusst nur `wert`: `optionen` ist bei jedem
   * Rendern der Elternkomponente ein neues Array, und mit ihm in der
   * Liste liefe der Effekt nach jedem Rendern und setzte den Zustand neu.
   * Die Liste wird trotzdem gelesen, sie ist beim Lauf des Effekts
   * aktuell.
   */
  const suchIn = useRef(optionen);
  suchIn.current = optionen;

  useEffect(() => {
    setGewaehlt(suchIn.current.find((o) => o.wert === wert) ?? null);
  }, [wert]);

  useEffect(() => {
    if (!offen) return;
    function beiKlick(e: MouseEvent) {
      if (!huelle.current?.contains(e.target as Node)) setOffen(false);
    }
    document.addEventListener("mousedown", beiKlick);
    return () => document.removeEventListener("mousedown", beiKlick);
  }, [offen]);

  const treffer = useMemo(() => {
    const q = suche.trim().toLowerCase();
    const gefiltert = q
      ? optionen.filter(
          (o) =>
            o.text.toLowerCase().includes(q) ||
            (o.zusatz ?? "").toLowerCase().includes(q),
        )
      : optionen;
    // Mehr als 50 Zeilen liest niemand — wer so viel sieht, sucht weiter.
    return gefiltert.slice(0, 50);
  }, [optionen, suche]);

  function waehle(o: Option | null) {
    setGewaehlt(o);
    setSuche("");
    setOffen(false);
    onAuswahl?.(o?.wert ?? "");
  }

  function beiTaste(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!offen) {
        setOffen(true);
        setAktiv(0);
        return;
      }
      setAktiv((i) => {
        const max = treffer.length - 1;
        if (max < 0) return 0;
        return e.key === "ArrowDown"
          ? i >= max
            ? 0
            : i + 1
          : i <= 0
            ? max
            : i - 1;
      });
      return;
    }
    if (e.key === "Enter" && offen) {
      e.preventDefault();
      const o = treffer[aktiv];
      if (o) waehle(o);
      return;
    }
    if (e.key === "Escape" && offen) {
      e.preventDefault();
      setOffen(false);
    }
  }

  return (
    <Feld
      id={`${id}-eingabe`}
      label={label}
      pflicht={pflicht}
      breit={breit}
      {...(hinweis ? { hinweis } : {})}
    >
      <div ref={huelle} className="relative">
        <input type="hidden" name={name} value={gewaehlt?.wert ?? ""} />

        <input
          id={`${id}-eingabe`}
          role="combobox"
          aria-expanded={offen}
          aria-controls={listeId}
          aria-autocomplete="list"
          autoComplete="off"
          required={pflicht && !gewaehlt}
          value={offen ? suche : (gewaehlt?.text ?? "")}
          placeholder={gewaehlt ? gewaehlt.text : platzhalter}
          onFocus={() => {
            setOffen(true);
            setSuche("");
            setAktiv(0);
          }}
          onChange={(e) => {
            setSuche(e.target.value);
            setOffen(true);
            setAktiv(0);
          }}
          onKeyDown={beiTaste}
          className={
            "w-full rounded-input border border-transparent bg-sunk px-[13px] py-[10px] text-[13.5px] text-ink outline-0 " +
            "focus:border-accent focus:bg-surface"
          }
        />

        {gewaehlt && !offen ? (
          <button
            type="button"
            aria-label={`${label} zurücksetzen`}
            onClick={() => waehle(null)}
            className="absolute top-1/2 right-[10px] -translate-y-1/2 rounded-pill px-2 py-1 text-[13px] leading-none text-faint hover:text-ink"
          >
            ×
          </button>
        ) : null}

        {offen ? (
          <ul
            id={listeId}
            role="listbox"
            aria-label={label}
            className="absolute z-40 mt-1 max-h-[280px] w-full overflow-auto rounded-input border border-line bg-surface py-1 shadow-[0_12px_32px_rgba(21,18,16,0.14)]"
          >
            {!pflicht ? (
              <li>
                <Zeile
                  aktiv={false}
                  onWaehlen={() => waehle(null)}
                  label={leerLabel}
                  leise
                />
              </li>
            ) : null}

            {treffer.length === 0 ? (
              <li className="px-[13px] py-[10px] text-[12.5px] text-faint">
                Nichts gefunden.
              </li>
            ) : (
              treffer.map((o, i) => (
                <li key={o.wert}>
                  <Zeile
                    aktiv={i === aktiv}
                    gewaehlt={o.wert === gewaehlt?.wert}
                    onWaehlen={() => waehle(o)}
                    onZeigen={() => setAktiv(i)}
                    label={o.text}
                    {...(o.zusatz ? { zusatz: o.zusatz } : {})}
                  />
                </li>
              ))
            )}
          </ul>
        ) : null}
      </div>
    </Feld>
  );
}

function Zeile({
  label,
  zusatz,
  aktiv,
  gewaehlt = false,
  leise = false,
  onWaehlen,
  onZeigen,
}: {
  label: string;
  zusatz?: string;
  aktiv: boolean;
  gewaehlt?: boolean;
  leise?: boolean;
  onWaehlen: () => void;
  onZeigen?: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={gewaehlt}
      onMouseEnter={onZeigen}
      onClick={onWaehlen}
      className={[
        "block w-full cursor-pointer px-[13px] py-[9px] text-left text-[13px]",
        aktiv ? "bg-sunk" : "",
        leise ? "text-faint" : "",
      ].join(" ")}
    >
      <span className={gewaehlt ? "font-semibold" : ""}>{label}</span>
      {zusatz ? (
        <span className="num mt-[1px] block text-[11.5px] text-faint">
          {zusatz}
        </span>
      ) : null}
    </button>
  );
}
