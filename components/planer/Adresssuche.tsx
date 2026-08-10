"use client";

import { useEffect, useRef, useState } from "react";

/*
 * Einstieg in ein Projekt über die Adresse (Briefing 2.2).
 *
 * Getippt wird frei, gesucht wird gedrosselt: Nominatim erlaubt eine
 * Anfrage je Sekunde, und jede Taste anzufragen wäre sowohl unhöflich
 * als auch langsamer als 400 ms Ruhe abzuwarten.
 *
 * Die Adresse ist ein Vorschlag, kein Zwang. Wer sie nicht findet, legt
 * das Projekt mit dem gewählten Kartenausschnitt an und zieht die Karte
 * von Hand — der Planer darf nie an einer fremden Suche hängen.
 */

export interface Ort {
  name: string;
  lat: number;
  lon: number;
}

export function Adresssuche({
  onWahl,
  autoFocus,
}: {
  onWahl: (ort: Ort) => void;
  autoFocus?: boolean;
}) {
  const [suche, setSuche] = useState("");
  const [treffer, setTreffer] = useState<Ort[]>([]);
  const [laeuft, setLaeuft] = useState(false);
  const [hinweis, setHinweis] = useState<string | null>(null);
  const laufendeAnfrage = useRef<AbortController | null>(null);

  useEffect(() => {
    const text = suche.trim();
    if (text.length < 3) {
      setTreffer([]);
      setHinweis(null);
      return;
    }

    const zeit = setTimeout(async () => {
      // Vorherige Anfrage abbrechen: sonst überholt eine ältere Antwort
      // die neuere und die Liste zeigt Treffer zum vorletzten Wort.
      laufendeAnfrage.current?.abort();
      const abbruch = new AbortController();
      laufendeAnfrage.current = abbruch;

      setLaeuft(true);
      try {
        const antwort = await fetch(`/api/planer/adresse?q=${encodeURIComponent(text)}`, {
          signal: abbruch.signal,
        });
        const daten = (await antwort.json()) as { treffer?: Ort[]; hinweis?: string };
        setTreffer(daten.treffer ?? []);
        setHinweis(daten.hinweis ?? null);
      } catch {
        // Abbruch ist der Normalfall beim Weitertippen, kein Fehler.
      } finally {
        setLaeuft(false);
      }
    }, 400);

    return () => clearTimeout(zeit);
  }, [suche]);

  return (
    <div className="relative w-full">
      <input
        type="search"
        value={suche}
        autoFocus={autoFocus}
        onChange={(e) => setSuche(e.target.value)}
        placeholder="Adresse eingeben — Straße, Hausnummer, Ort"
        aria-label="Adresse suchen"
        className="h-14 w-full rounded-pill border border-line bg-surface px-6 text-[16px] shadow-soft outline-none focus:border-accent"
      />

      {laeuft ? (
        <span className="pointer-events-none absolute right-6 top-1/2 -translate-y-1/2 text-[12.5px] text-muted">
          sucht …
        </span>
      ) : null}

      {treffer.length > 0 ? (
        <ul className="absolute z-10 mt-2 w-full overflow-hidden rounded-card border border-line bg-surface shadow-soft">
          {treffer.map((t) => (
            <li key={`${t.lat},${t.lon}`}>
              <button
                type="button"
                onClick={() => {
                  onWahl(t);
                  setTreffer([]);
                  setSuche(t.name);
                }}
                className="block w-full px-5 py-3 text-left text-[14px] hover:bg-sunk"
              >
                {t.name}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {hinweis && !laeuft ? (
        <p className="mt-2 px-6 text-[12.5px] text-muted">{hinweis}</p>
      ) : null}
      {!hinweis && !laeuft && suche.trim().length >= 3 && treffer.length === 0 ? (
        <p className="mt-2 px-6 text-[12.5px] text-muted">
          Keine Treffer. Du kannst das Projekt trotzdem anlegen und die Karte von Hand
          an die richtige Stelle ziehen.
        </p>
      ) : null}
    </div>
  );
}
