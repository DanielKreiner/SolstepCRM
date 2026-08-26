import { anlagenErtrag, fallbackErtrag, regionAus } from "./ertrag";
import { ausrichtungen, kwp } from "./module";
import type { Plan } from "./plan";
import { anlagenVerschattung } from "./verschattung";
import { anlagenpreisGilt, rechne, richtpreis, type WirtschaftErgebnis } from "./wirtschaft";

/*
 * Die Zahlen, die beim Kunden landen — an einer Stelle.
 *
 * Sie stehen im Planungs-PDF, im Angebots-PDF und im Kundenportal. Als
 * der Betrieb bat, „dass der Ertrag PDF mit dem Angebot verschmilzt",
 * gab es genau zwei Möglichkeiten: die Rechnung ein drittes Mal
 * schreiben oder sie herausziehen. Das Angebots-PDF rechnete bis dahin
 * mit einer Faustformel („rund 1000 kWh je kWp"), während die Planung
 * daneben eine echte Zahl auswies — zwei Ertragsangaben in einem
 * Umschlag.
 *
 * Ohne Datenbankzugriff: Was gebraucht wird, gibt der Aufrufer herein.
 * So lässt es sich prüfen, und dieselbe Funktion läuft in beiden
 * Route-Handlern.
 */

export interface KennzahlenEingabe {
  plan: Plan;
  ursprung: { lat: number; lon: number };
  /** Nutzbare Speichergrösse des gewählten Geräts, falls eines dranhängt. */
  geraetSpeicherKwh: number;
  /**
   * Schon aufgelöste Speichergrösse — Stapel, Handeingabe oder Gerät.
   * Gesetzt gewinnt sie: Bei einem modularen Speicher zählt die
   * Modulzahl, und die kennt nur der Aufrufer.
   */
  speicherKwh?: number;
  /** Nettosumme des offenen Angebots, falls es eines gibt. */
  angebotssumme: number | null;
  vorgabe: {
    strompreis: number;
    verguetung: number;
    steigerung: number;
    speicherEurProKwh: number;
    staffel: Array<{ ab_kwp: number; eur_pro_kwp: number }>;
    verlustProzent: number;
  };
}

export interface Kennzahlen {
  kwp: number;
  jahresertragKwh: number;
  spezifischMittel: number;
  monateKwh: number[];
  /** Wie stark die Verschattung den Ertrag mindert (0 = keine). */
  verschattung: number;
  speicherKwh: number;
  anlagenpreis: number;
  wirtschaft: WirtschaftErgebnis;
  /** Was der Kunde über zwanzig Jahre spart — die Zahl, die zieht. */
  ersparnis20: number;
}

export function planungKennzahlen(e: KennzahlenEingabe): Kennzahlen {
  const { plan, ursprung, vorgabe } = e;
  const leistung = plan.gruppen.reduce((s, g) => s + kwp(g), 0);

  /*
   * Ertrag je Ausrichtung getrennt — dieselbe Regel wie am Bildschirm.
   * Ein Ost/West-Flachdach besteht aus zwei Hälften, und ihr Mittelwert
   * wäre Süden.
   *
   * Serverseitig wird der Fallback gerechnet, nicht PVGIS gefragt: Ein
   * Dokument entsteht auf Knopfdruck und darf nicht an einer fremden
   * API hängen.
   */
  const teile = plan.gruppen.flatMap((g) => {
    const flaeche = plan.flaechen.find((f) => f.id === g.flaeche);
    if (!flaeche) return [];
    const gruppeKwp = kwp(g);
    return ausrichtungen(g, flaeche).map((a) => {
      const er = fallbackErtrag(
        {
          lat: ursprung.lat,
          lon: ursprung.lon,
          azimut: a.azimut,
          neigung: a.neigung,
          verlustProzent: vorgabe.verlustProzent,
        },
        regionAus(ursprung.lat),
      );
      return { kwp: gruppeKwp * a.anteil, spezifisch: er.spezifisch, monate: er.monate };
    });
  });

  const roh = anlagenErtrag(teile);
  const schatten = anlagenVerschattung(plan, ursprung, plan.gebaeude.wandhoehe);

  const jahresertragKwh = roh.jahresertragKwh * schatten.faktor;

  /*
   * Die von Hand eingetragene Speichergrösse hat Vorrang vor dem
   * Gerät: Im Erstgespräch steht „zehn Kilowattstunden" fest, lange
   * bevor jemand ein Gerät aussucht.
   */
  const speicherKwh = e.speicherKwh ?? plan.wirtschaft.speicherKwh ?? e.geraetSpeicherKwh;

  const anlagenpreis = anlagenpreisGilt(
    plan.wirtschaft.anlagenpreis,
    e.angebotssumme,
    richtpreis(leistung, vorgabe.staffel, speicherKwh * vorgabe.speicherEurProKwh),
  ).wert;

  const wirtschaft = rechne({
    ertragKwh: jahresertragKwh,
    verbrauchKwh: plan.wirtschaft.verbrauchKwh ?? 4500,
    speicherKwh,
    strompreis: plan.wirtschaft.strompreis ?? vorgabe.strompreis,
    verguetung: plan.wirtschaft.verguetung ?? vorgabe.verguetung,
    anlagenpreis,
    foerderung: plan.wirtschaft.foerderung ?? 0,
    steigerung: vorgabe.steigerung,
  });

  /*
   * Die Zwanzigjahressumme steht in der Kurve schon drin — dort aber
   * abzüglich der Investition. Für den Satz „du sparst insgesamt" ist
   * die reine Ersparnis gemeint.
   */
  const ersparnis20 =
    (wirtschaft.kurve[wirtschaft.kurve.length - 1] ?? 0) + wirtschaft.investition;

  return {
    kwp: leistung,
    jahresertragKwh,
    spezifischMittel: roh.spezifischMittel * schatten.faktor,
    monateKwh: roh.monateKwh.map((m) => m * schatten.faktor),
    verschattung: 1 - schatten.faktor,
    speicherKwh,
    anlagenpreis,
    wirtschaft,
    ersparnis20,
  };
}
