import { viennaDay } from "@/lib/format";
import { endOfViennaDay } from "@/lib/time";

/*
 * Die Schutzregel für laufende Zeitbuchungen.
 *
 * Ein Monteur vergisst das Ausstempeln. Am nächsten Morgen läuft die
 * Buchung seit vierzehn Stunden weiter, und niemand weiss mehr, wann er
 * wirklich Feierabend hatte. Ohne Regel wächst daraus eine Zahl, die
 * irgendwann in einer Auswertung landet und dort niemandem auffällt.
 *
 * Deshalb: über Mitternacht oder länger als zwölf Stunden wird die
 * Buchung automatisch gestoppt und als „zu prüfen" markiert. Nicht
 * gelöscht und nicht geraten — das Büro bekommt eine Korrekturliste und
 * entscheidet.
 *
 * Reines Modul ohne Datenbank, damit die Grenzfälle prüfbar sind: der
 * teure Fehler wäre, eine laufende Buchung zu stoppen, die noch läuft.
 */

export const MAX_STUNDEN = 12;

export type LaufendeBuchung = {
  id: string;
  userId: string;
  startedAt: string;
};

export type Stoppvorschlag = {
  id: string;
  userId: string;
  /** Wann die Buchung enden soll. */
  endeAt: string;
  grund: "mitternacht" | "zwoelf_stunden";
  /** Klartext für die Korrekturliste. */
  text: string;
};

/**
 * Tagesgrenze in Europe/Vienna als Zeitpunkt.
 *
 * Wichtig ist die ÖRTLICHE Mitternacht und nicht die von UTC: sonst
 * endet im Sommer jede Buchung um zwei Uhr früh.
 */
export function naechsteMitternacht(iso: string): Date {
  /*
   * Über date-fns-tz, nicht über toLocaleString: der Umweg
   * `new Date(x.toLocaleString(..., { timeZone }))` parst das Ergebnis in
   * der Zeitzone des SERVERS. Auf Vercel (UTC) kam das Richtige heraus,
   * auf einem Rechner, der selbst in Wien steht, ein Versatz von null —
   * und damit stillschweigend UTC-Mitternacht.
   */
  return endOfViennaDay(viennaDay(iso));
}

/**
 * Was ist mit dieser Buchung zu tun?
 *
 * null heisst: sie läuft zu Recht weiter. Sonst kommt zurück, wann sie
 * enden soll — die frühere der beiden Grenzen gewinnt.
 */
export function pruefeLaufende(
  b: LaufendeBuchung,
  jetzt: Date,
): Stoppvorschlag | null {
  const start = new Date(b.startedAt);
  const zwoelf = new Date(start.getTime() + MAX_STUNDEN * 3600_000);
  const mitternacht = naechsteMitternacht(b.startedAt);

  const frueher = zwoelf <= mitternacht ? zwoelf : mitternacht;
  if (jetzt < frueher) return null;

  const grund = zwoelf <= mitternacht ? "zwoelf_stunden" : "mitternacht";
  return {
    id: b.id,
    userId: b.userId,
    endeAt: frueher.toISOString(),
    text:
      grund === "zwoelf_stunden"
        ? `Lief länger als ${MAX_STUNDEN} Stunden und wurde automatisch gestoppt.`
        : "Lief über Mitternacht und wurde automatisch gestoppt.",
    grund,
  };
}

/** Alle laufenden Buchungen auf einmal. */
export function pruefeAlle(
  buchungen: LaufendeBuchung[],
  jetzt: Date,
): Stoppvorschlag[] {
  return buchungen
    .map((b) => pruefeLaufende(b, jetzt))
    .filter((v): v is Stoppvorschlag => v !== null);
}
