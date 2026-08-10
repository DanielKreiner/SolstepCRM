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
   * Was ein Speicher zusätzlich in den Eigenverbrauch holt, wenn er
   * mindestens einen Tagesverbrauch fasst. Kleinere Speicher wirken
   * anteilig.
   */
  evSpeicherPlus: 0.27,
  /** Auch mit grossem Speicher bleibt ein Rest Netzbezug (Winter). */
  evMaxMitSpeicher: 0.82,
  /**
   * Selbst bei perfekter Deckung bleibt ein Rest Netzbezug — kein
   * Haushalt deckt 100 % aus der eigenen Anlage.
   */
  autarkieDeckel: 0.99,
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
 * Eigenverbrauchsquote — welcher Anteil des erzeugten Stroms im Haus
 * bleibt, statt ins Netz zu gehen.
 *
 * Ohne Speicher hängt sie am Verhältnis Verbrauch zu Ertrag: Wer viel
 * verbraucht, findet für mehr des eigenen Stroms Verwendung. Ein
 * Speicher hebt sie an, aber nur so weit, wie er überhaupt einen
 * Tagesverbrauch fasst — ein 5-kWh-Speicher bringt einem Haushalt mit
 * 30 kWh Tagesverbrauch wenig.
 */
export function evQuote(ertragKwh: number, verbrauchKwh: number, speicherKwh: number): number {
  if (ertragKwh <= 0 || verbrauchKwh <= 0) return 0;

  const deckung = Math.min(1, verbrauchKwh / ertragKwh);
  const ohne = begrenze(
    MODELL.evSockel + MODELL.evSteigung * deckung,
    MODELL.evMin,
    MODELL.evMax,
  );
  if (speicherKwh <= 0) return ohne;

  // Speichergrösse im Verhältnis zum Tagesverbrauch.
  const tagesverbrauch = verbrauchKwh / 365;
  const fSp = Math.min(1, speicherKwh / tagesverbrauch);
  return Math.min(MODELL.evMaxMitSpeicher, ohne + MODELL.evSpeicherPlus * fSp);
}

/**
 * Die vollständige Rechnung.
 *
 * Die Einspeisevergütung steigt in der Kurve NICHT mit: sie ist
 * vertraglich oder gesetzlich fixiert, während der Netzstrompreis
 * steigt. Alles andere wäre schöngerechnet.
 */
export function rechne(e: WirtschaftEingaben): WirtschaftErgebnis {
  const quote = evQuote(e.ertragKwh, e.verbrauchKwh, e.speicherKwh);

  const eigenverbrauch = Math.min(
    e.ertragKwh * quote,
    e.verbrauchKwh * MODELL.autarkieDeckel,
  );
  const autarkie = e.verbrauchKwh > 0 ? eigenverbrauch / e.verbrauchKwh : 0;
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
    autarkie,
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
