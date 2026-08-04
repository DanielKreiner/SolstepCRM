/*
 * Schnellzusammenbau: aus einer Modulzahl wird ein Angebot.
 *
 * Der Verkäufer hat den Kunden am Telefon und weiss zwei Dinge — wie
 * viele Module aufs Dach passen und ob ein Speicher dazu soll. Alles
 * andere folgt daraus und muss nicht von Hand gesucht werden. Wer
 * zwanzig Modulklemmen einzeln einträgt, vergisst beim vierten Angebot
 * den Überspannungsschutz.
 *
 * Eigenes Regelmodul, weil dieselbe Auslegung an drei Stellen gebraucht
 * wird: im Schnellzusammenbau, beim Anwenden einer Vorlage und später
 * beim Planungsimport. Die Faustregeln stehen hier einmal und sind
 * nachlesbar — nicht in einer Formel mitten in einem Formular.
 */

export type Kandidat = {
  id: string;
  name: string;
  /** Nennleistung: Wp beim Modul, kW beim Wechselrichter, kWh beim Speicher. */
  wert: number | null;
};

/** Anlagenleistung in kWp aus Modulzahl und Modulleistung. */
export function kwp(module: number, modulWp: number): number {
  return Math.round(((module * modulWp) / 1000) * 100) / 100;
}

/**
 * Passender Wechselrichter zu einer Anlagenleistung.
 *
 * Ausgelegt wird auf etwa 90 % der Modulleistung: ein Wechselrichter,
 * der genau so gross ist wie die Anlage, läuft nie im besten
 * Wirkungsgradbereich, und die Spitzenleistung wird ohnehin selten
 * erreicht. Zu klein darf er trotzdem nicht sein — deshalb ist die
 * Untergrenze 70 %.
 *
 * Gewählt wird der kleinste Kandidat, der mindestens die Untergrenze
 * erfüllt. Gibt es keinen, nimmt die Auslegung den grössten vorhandenen
 * und meldet das dem Aufrufer über `zuKlein`.
 */
export function wechselrichterFuer(
  anlageKwp: number,
  kandidaten: readonly Kandidat[],
): { treffer: Kandidat | null; zuKlein: boolean } {
  const brauchbar = kandidaten
    .filter((k) => k.wert !== null && k.wert > 0)
    .sort((a, b) => (a.wert as number) - (b.wert as number));

  if (brauchbar.length === 0) return { treffer: null, zuKlein: false };

  const untergrenze = anlageKwp * 0.7;
  const passend = brauchbar.find((k) => (k.wert as number) >= untergrenze);

  if (passend) return { treffer: passend, zuKlein: false };

  return { treffer: brauchbar[brauchbar.length - 1] ?? null, zuKlein: true };
}

/**
 * Wie viele Speichermodule für eine gewünschte Kapazität?
 *
 * Aufgerundet: 12 kWh Wunsch bei 9,04 kWh je Modul sind zwei Module.
 * Abrunden hiesse, dem Kunden weniger zu liefern, als besprochen wurde.
 */
export function speicherAnzahl(
  wunschKwh: number,
  modulKwh: number,
): number {
  if (wunschKwh <= 0 || modulKwh <= 0) return 0;
  return Math.ceil(wunschKwh / modulKwh);
}

export type Multiplikator = {
  id: string;
  name: string;
  einheit: string;
  epNetto: number;
  kalkEk: number | null;
  /** Menge je Modul — vier Klemmen stehen hier als 4. */
  jeModul: number;
};

/**
 * Mengen, die sich aus der Modulzahl ergeben.
 *
 * Aufgerundet auf ganze Einheiten, wo die Einheit ganzzahlig ist:
 * 2,5 Kabelrollen gibt es nicht zu kaufen. Bei Metern und Pauschalen
 * bleibt die Nachkommastelle stehen.
 */
export function mengenJeModul(
  module: number,
  produkte: readonly Multiplikator[],
): { produkt: Multiplikator; menge: number }[] {
  return produkte
    .filter((p) => p.jeModul > 0)
    .map((p) => {
      const roh = module * p.jeModul;
      const ganz = p.einheit === "m" || p.einheit === "Pausch.";
      return {
        produkt: p,
        menge: ganz ? Math.round(roh * 1000) / 1000 : Math.ceil(roh),
      };
    })
    .filter((z) => z.menge > 0);
}
