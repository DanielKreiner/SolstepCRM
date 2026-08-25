/*
 * Wirtschaftlichkeit einer Anlage (Briefing 7).
 *
 * Das Modell ist bewusst grob: ein Jahresmodell, kein
 * Viertelstundenmodell. Es soll beim Kunden am Tisch in Sekunden eine
 * belastbare Grössenordnung liefern — nicht ein Gutachten ersetzen.
 * Genau deshalb steht jede Zahl, die hier herauskommt, in der
 * Oberfläche unter „Richtwerte, unverbindlich".
 *
 * Alle Kennzahlen sind von Hand nachrechenbar; die Unit-Tests führen
 * eine vollständige Kette vor.
 */

/**
 * Die Stellschrauben des Modells — an EINER Stelle, mit Begründung.
 *
 * Sie sind aus Erfahrungswerten für Einfamilienhäuser in AT/DE
 * abgeleitet und werden nach Praxisfeedback kalibriert. Wer sie ändert,
 * ändert jede Zahl im Kundengespräch — deshalb nie verstreut im Code
 * nachjustieren, sondern hier.
 */
export const MODELL = {
  /**
   * Sockel der Eigenverbrauchsquote: Der Anteil, den ein Haushalt auch
   * dann direkt verbraucht, wenn die Anlage im Verhältnis zum Verbrauch
   * sehr gross ist (Grundlast tagsüber — Kühlschrank, Standby, Router).
   */
  evSockel: 0.22,
  /**
   * Steigung: Je näher der Verbrauch an den Ertrag heranreicht, desto
   * mehr des erzeugten Stroms findet im Haus einen Abnehmer.
   */
  evSteigung: 0.38,
  /**
   * Untergrenze — auch eine riesige Anlage speist nie alles ein.
   * Beim heutigen Sockel von 0,22 greift sie nie; sie sichert den Fall
   * ab, dass der Sockel bei der Kalibrierung gesenkt wird.
   */
  evMin: 0.2,
  /** Obergrenze ohne Speicher: nachts erzeugt kein Dach Strom. */
  evMax: 0.55,
  /**
   * Autarkie ohne Speicher: Sättigungswert und Steigung.
   *
   * 44 % ist die Grenze, gegen die ein Dach ohne Speicher läuft — mehr
   * geht nicht, weil nachts und im Winter nichts erzeugt wird. Die
   * Steigung 1,1 trifft die Faustzahl „30 % bei Erzeugung gleich
   * Verbrauch".
   */
  autarkieOhne: 0.44,
  autarkieSteigung: 1.1,
  /** Was ein Speicher zusätzlich holt, und wie schnell er sättigt. */
  speicherPlus: 0.42,
  speicherSteigung: 0.7,
  /** Ohne Speicher ist bei knapp der Hälfte Schluss. */
  autarkieDeckel: 0.46,
  /** Mit Speicher bleibt der Winter — 85 % ist die Grenze. */
  autarkieDeckelMitSpeicher: 0.85,
  /**
   * Was ein Speicher zusätzlich in den Eigenverbrauch holt, wenn er
   * mindestens einen Tagesverbrauch fasst. Kleinere Speicher wirken
   * anteilig.
   */
  evSpeicherPlus: 0.27,
  /** Auch mit grossem Speicher bleibt ein Rest Netzbezug (Winter). */
  evMaxMitSpeicher: 0.82,
  /** Strompreissteigerung pro Jahr, Vorbelegung (Tenant-einstellbar). */
  strompreisSteigerung: 0.02,
  /** Betrachtungszeitraum der Kurve. */
  jahre: 20,
} as const;

export interface WirtschaftEingaben {
  /** Jahresertrag der Anlage in kWh. */
  ertragKwh: number;
  /** Jahresverbrauch des Haushalts in kWh. */
  verbrauchKwh: number;
  /** Nutzbare Speicherkapazität in kWh; 0 = ohne Speicher. */
  speicherKwh: number;
  /** Was eine Kilowattstunde aus dem Netz kostet, in €. */
  strompreis: number;
  /** Einspeisevergütung in € je kWh. */
  verguetung: number;
  /** Anlagenpreis brutto in €. */
  anlagenpreis: number;
  /** Förderung in €, wird vom Anlagenpreis abgezogen. */
  foerderung: number;
  /** Jährliche Strompreissteigerung als Faktor, z. B. 0.02. */
  steigerung?: number;
}

export interface WirtschaftErgebnis {
  evQuote: number;
  eigenverbrauchKwh: number;
  autarkie: number;
  einspeisungKwh: number;
  /** Ersparnis im ersten Jahr in €. */
  ersparnisJahr1: number;
  /** Was tatsächlich zu zahlen ist: Anlagenpreis minus Förderung. */
  investition: number;
  /**
   * Amortisation nach der Formel des Briefings: Investition geteilt
   * durch die Ersparnis des ersten Jahres. `null`, wenn sich die Anlage
   * rechnerisch nie trägt (keine Ersparnis).
   */
  amortisationJahre: number | null;
  /**
   * Jahr, in dem die kumulierte Ersparnis die Investition übersteigt —
   * MIT Strompreissteigerung, deshalb meist etwas früher als die
   * Amortisation oben. `null`, wenn das binnen 20 Jahren nicht eintritt.
   */
  breakEvenJahr: number | null;
  /**
   * Kumulierte Ersparnis minus Investition, Jahr für Jahr.
   * Index 0 = nach dem ersten Jahr.
   */
  kurve: number[];
}

function begrenze(wert: number, unten: number, oben: number): number {
  return Math.min(oben, Math.max(unten, wert));
}

/**
 * Autarkie — welcher Anteil des Verbrauchs vom eigenen Dach kommt.
 *
 * Das ist die Grösse, die der Kunde fragt, und die Grösse, an der das
 * Modell vorher gescheitert ist: Es deckelte den Eigenverbrauch bei
 * 99 % des Verbrauchs, und weil eine grosse Anlage rechnerisch fast
 * alles decken kann, kam „99 % Autarkie" heraus — ohne Speicher.
 * Aus dem Betrieb kam die richtige Frage: „wie geht eine Autarkie von
 * 99 % ohne Speicher? Da ist die Nacht nicht drin."
 *
 * Genau darum geht es. Ohne Speicher ist die Autarkie NICHT durch die
 * Jahressumme begrenzt, sondern durch die Gleichzeitigkeit: Nachts und
 * im Winter erzeugt das Dach nichts, und was mittags zu viel ist,
 * geht ins Netz. Ein doppelt so grosses Dach hebt sie kaum noch, weil
 * der Überschuss zur Mittagszeit anfällt.
 *
 * Das Modell bildet das mit einer Sättigungskurve ab. Die Stützwerte
 * stammen aus den gängigen Faustzahlen für einen Haushalt in
 * Mitteleuropa (HTW Berlin, Fraunhofer ISE):
 *
 * | Erzeugung/Verbrauch | ohne Speicher | 1 kWh/1000 kWh | 2 kWh/1000 kWh |
 * |---|---|---|---|
 * | 1  | rund 30 % | rund 50 % | rund 60 % |
 * | 2  | rund 39 % | rund 60 % | rund 71 % |
 * | 3  | rund 42 % | rund 63 % | rund 74 % |
 *
 * Es bleibt ein Jahresmodell — für ein Erstgespräch die richtige
 * Grössenordnung, für die Netzanmeldung nicht. Genau so steht es auch
 * unter der Auswertung.
 */
export function autarkie(ertragKwh: number, verbrauchKwh: number, speicherKwh: number): number {
  if (ertragKwh <= 0 || verbrauchKwh <= 0) return 0;

  const verhaeltnis = ertragKwh / verbrauchKwh;
  const ohne = MODELL.autarkieOhne * (1 - Math.exp(-MODELL.autarkieSteigung * verhaeltnis));
  if (speicherKwh <= 0) return Math.min(MODELL.autarkieDeckel, ohne);

  /*
   * Die Speichergrösse wird auf den Verbrauch bezogen, nicht absolut:
   * Zehn Kilowattstunden sind für einen Zwei-Personen-Haushalt viel
   * und für einen Betrieb mit Wärmepumpe wenig.
   */
  const jeTausend = speicherKwh / (verbrauchKwh / 1000);
  const zusatz = MODELL.speicherPlus * (1 - Math.exp(-MODELL.speicherSteigung * jeTausend));

  /*
   * Ein Speicher kann nur speichern, was übrig ist. Bei einer Anlage,
   * die über das Jahr weniger erzeugt als das Haus braucht, bringt er
   * entsprechend weniger — darüber nicht mehr, denn im Sommer ist auch
   * bei ausgeglichener Jahressumme reichlich Überschuss da.
   */
  const ueberschuss = Math.min(1, verhaeltnis);
  return Math.min(MODELL.autarkieDeckelMitSpeicher, ohne + zusatz * ueberschuss);
}

/**
 * Eigenverbrauchsquote — welcher Anteil des ERZEUGTEN Stroms im Haus
 * bleibt.
 *
 * Sie folgt aus der Autarkie und ist keine eigene Annahme mehr: Was im
 * Haus bleibt, ist Autarkie mal Verbrauch; als Quote bezogen auf den
 * Ertrag. Vorher wurden beide getrennt geschätzt und konnten sich
 * widersprechen.
 */
export function evQuote(ertragKwh: number, verbrauchKwh: number, speicherKwh: number): number {
  if (ertragKwh <= 0 || verbrauchKwh <= 0) return 0;
  const eigen = autarkie(ertragKwh, verbrauchKwh, speicherKwh) * verbrauchKwh;
  return Math.min(1, eigen / ertragKwh);
}

/**
 * Die vollständige Rechnung.
 *
 * Die Einspeisevergütung steigt in der Kurve NICHT mit: sie ist
 * vertraglich oder gesetzlich fixiert, während der Netzstrompreis
 * steigt. Alles andere wäre schöngerechnet.
 */
export function rechne(e: WirtschaftEingaben): WirtschaftErgebnis {
  /*
   * Zuerst die Autarkie, daraus der Eigenverbrauch — nicht umgekehrt.
   * Beides getrennt zu schätzen führte zu Zahlen, die sich
   * widersprachen: 99 % Autarkie bei 35 % Eigenverbrauchsquote.
   */
  const anteil = autarkie(e.ertragKwh, e.verbrauchKwh, e.speicherKwh);
  const eigenverbrauch = Math.min(e.verbrauchKwh * anteil, e.ertragKwh);
  const quote = e.ertragKwh > 0 ? eigenverbrauch / e.ertragKwh : 0;
  const einspeisung = Math.max(0, e.ertragKwh - eigenverbrauch);

  const ersparnisJahr1 = eigenverbrauch * e.strompreis + einspeisung * e.verguetung;
  const investition = Math.max(0, e.anlagenpreis - e.foerderung);

  const amortisationJahre = ersparnisJahr1 > 0 ? investition / ersparnisJahr1 : null;

  /*
   * Die Kurve rechnet Jahr für Jahr: der gesparte Netzstrom wird mit
   * dem gestiegenen Strompreis bewertet, die Einspeisung bleibt beim
   * vereinbarten Satz.
   */
  const steigerung = e.steigerung ?? MODELL.strompreisSteigerung;
  const kurve: number[] = [];
  let kumuliert = 0;
  let breakEvenJahr: number | null = null;

  for (let jahr = 1; jahr <= MODELL.jahre; jahr++) {
    const preis = e.strompreis * Math.pow(1 + steigerung, jahr - 1);
    kumuliert += eigenverbrauch * preis + einspeisung * e.verguetung;
    kurve.push(kumuliert - investition);
    if (breakEvenJahr === null && kumuliert >= investition) breakEvenJahr = jahr;
  }

  return {
    evQuote: quote,
    eigenverbrauchKwh: eigenverbrauch,
    autarkie: anteil,
    einspeisungKwh: einspeisung,
    ersparnisJahr1,
    investition,
    amortisationJahre,
    breakEvenJahr,
    kurve,
  };
}

/*
 * ── Vorbelegungen ──────────────────────────────────────────────────
 */

/**
 * Verbrauchs-Chips wie im Prototyp: eine Basis nach Haushaltsgrösse,
 * dazu additiv, was den Verbrauch spürbar hebt.
 *
 * Die Werte sind Hausnummern für ein Erstgespräch. Wer die Jahresab-
 * rechnung dabei hat, tippt die echte Zahl ein — dafür ist der Regler da.
 */
export const VERBRAUCH_CHIPS = [
  { id: "p2", label: "2 Personen", kwh: 3000, additiv: false },
  { id: "p4", label: "4 Personen", kwh: 4500, additiv: false },
  { id: "wp", label: "+ Wärmepumpe", kwh: 3500, additiv: true },
  { id: "auto", label: "+ E-Auto", kwh: 2500, additiv: true },
] as const;

export type ChipId = (typeof VERBRAUCH_CHIPS)[number]["id"];

/** Verbrauch aus den gewählten Chips — Basis plus alle Zuschläge. */
export function verbrauchAusChips(gewaehlt: readonly string[]): number {
  const basis = VERBRAUCH_CHIPS.filter((c) => !c.additiv && gewaehlt.includes(c.id));
  const zusatz = VERBRAUCH_CHIPS.filter((c) => c.additiv && gewaehlt.includes(c.id));
  // Ohne Basis-Chip ergibt die Auswahl keinen Haushalt — dann 0.
  if (basis.length === 0) return zusatz.reduce((s, c) => s + c.kwh, 0);
  const groesste = Math.max(...basis.map((c) => c.kwh));
  return groesste + zusatz.reduce((s, c) => s + c.kwh, 0);
}

/**
 * Richtpreis der Anlage aus einer Staffel €/kWp.
 *
 * Grosse Anlagen kosten je kWp weniger — Gerüst, Anfahrt und Planung
 * verteilen sich. Die Staffel pflegt der Betrieb in den Einstellungen;
 * gilt immer die Stufe mit der grössten Untergrenze, die noch passt.
 */
export interface PreisStufe {
  ab_kwp: number;
  eur_pro_kwp: number;
}

export function richtpreis(kwp: number, staffel: PreisStufe[], speicherPreis = 0): number {
  if (kwp <= 0) return speicherPreis;
  const passend = staffel
    .filter((s) => kwp >= s.ab_kwp)
    .sort((a, b) => b.ab_kwp - a.ab_kwp)[0];
  // Ohne passende Stufe kein erfundener Preis — der Anlagenpreis bleibt
  // dann leer und wird von Hand gesetzt.
  if (!passend) return speicherPreis;
  return Math.round(kwp * passend.eur_pro_kwp) + speicherPreis;
}
