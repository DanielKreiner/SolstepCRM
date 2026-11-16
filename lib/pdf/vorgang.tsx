import {
  Document,
  Image,
  Page,
  Path,
  Rect,
  StyleSheet,
  Svg,
  Text,
  View,
} from "@react-pdf/renderer";
import {
  berechne,
  gruppenNetto,
  zeilenNetto as posNetto,
  type PreisPosition,
} from "@/lib/vorgang/preis";

/*
 * Ein Beleg zum Vorgang — Angebot, Auftragsbestätigung oder Rechnung.
 *
 * Drei Belege aus einer Vorlage, weil sie dieselben Positionen tragen und
 * sich nur in Überschrift, Fusstext und Summenblock unterscheiden. Drei
 * getrennte Vorlagen wären dreimal derselbe Briefkopf, der beim nächsten
 * Logowechsel an zwei Stellen vergessen wird.
 *
 * Der Beleg trägt Logo und Farbe des Betriebs (company.pdf_settings,
 * CLAUDE.md 6.4). Ein Angebot ist das erste, was ein Kunde von einem
 * Betrieb in die Hand bekommt — es soll nach dem Betrieb aussehen und
 * nicht nach einem Formulargenerator.
 *
 * CLAUDE.md 6.4 gilt weiter: beim Angebot steht der technische Teil ohne
 * Preise voran, der Preisteil folgt als eigener Block. Der Grund ist
 * praktisch — der technische Teil wandert zum Elektriker, zur
 * Netzanmeldung und aufs Dach, dort haben Preise nichts verloren.
 */

export type BelegArt = "angebot" | "ab" | "anzahlungsrechnung" | "schlussrechnung";

export type PdfPosition = {
  pos: number;
  gruppeId: string | null;
  text: string;
  beschreibung?: string | null;
  menge: number;
  einheit: string;
  epNetto: number;
  ustSatz: number;
  rabattProzent: number;
  optional: boolean;
  /*
   * Hat der Kunde diese Option gewaehlt? Ohne das Feld zaehlte das PDF
   * jede optionale Position als abgewaehlt — auch auf der Rechnung, nachdem
   * der Kunde sie im Portal ausdruecklich angekreuzt hatte.
   */
  gewaehlt?: boolean;
  bildUrl?: string | undefined;
};

export type PdfGruppe = {
  id: string;
  name: string;
  beschreibung: string | null;
  paketPreis: number | null;
  einzelpreiseVerstecken: boolean;
};

export interface VergleichSeite {
  autarkie: number;
  eigenverbrauchQuote: number;
  netzbezugKwh: number;
  ersparnisJahr1: number;
  investition: number;
  amortisationJahre: number | null;
  ersparnis20: number;
}

export type VorgangPdfData = {
  art: BelegArt;
  vorgangNummer: string;
  belegNummer: string | null;
  erstelltAm: string;
  gueltigBis: string | null;
  faelligAm: string | null;
  marke: { logoUrl: string | null; akzent: string };
  firma: {
    name: string;
    rechtsform: string | null;
    adresse: string | null;
    plz: string | null;
    ort: string | null;
    land: string | null;
    uid: string | null;
    firmenbuchNr: string | null;
    firmenbuchGericht: string | null;
    telefon: string | null;
    email: string | null;
    website: string | null;
    iban: string | null;
    bic: string | null;
  };
  kunde: {
    name: string;
    kontakt: string | null;
    adresse: string | null;
    plz: string | null;
    ort: string | null;
  };
  anlage: {
    kwp: number | null;
    speicherKwh: number | null;
    adresse: string | null;
    zaehlpunkt: string | null;
  };
  /**
   * Die Planung, falls eine dranhängt.
   *
   * Damit trägt EIN Blatt beides: was gebaut wird und was es bringt.
   * Vorher schätzte das Angebot den Ertrag mit einer Faustformel
   * („rund 1000 kWh je kWp"), während die Planung daneben eine
   * gerechnete Zahl auswies — zwei Ertragsangaben in einem Umschlag.
   */
  planung?: {
    kwp: number;
    jahresertragKwh: number;
    autarkie: number;
    speicherKwh: number;
    ersparnisJahr1: number;
    ersparnis20: number;
    amortisationJahre: number | null;
    /** Das Dach als Bild, schon als data-URL. */
    bild: string | null;
    /** Pfad im Speicher — für Aufrufer, die selbst signieren. */
    bildPfad?: string | null;

    /*
     * Und die Seiten, die bisher nur im Planungs-PDF standen. Der
     * Betrieb schickte zwei Dokumente: das Angebot mit den Preisen und
     * daneben „das schöne PDF" mit Ertrag und Wirtschaftlichkeit. Der
     * Kunde bekommt jetzt eines, in dem beides steht.
     */
    spezifisch: number;
    monateKwh: number[];
    verschattungProzent: number;
    verbrauchKwh: number;
    eigenverbrauchKwh: number;
    einspeisungKwh: number;
    strompreis: number;
    verguetung: number;
    steigerung: number;
    investition: number;
    modulAnzahl: number;
    modulTyp: string | null;
    wechselrichter: string | null;
    speicher: string | null;
    speicherModule: number | null;
    flaechen: Array<{ name: string; neigung: number; azimut: number; module: number }>;

    /*
     * Wohin der Strom geht und woher er kommt — die zwei Bilder, die im
     * Gespräch über den Speicher entscheiden. Dazu die kumulierte
     * Ersparnis Jahr für Jahr und die Gegenrechnung ohne Speicher.
     */
    /** Anteil des erzeugten Stroms, der im Haus bleibt. */
    eigenverbrauchQuote: number;
    fluss: {
      direktKwh: number;
      ueberSpeicherKwh: number;
      einspeisungKwh: number;
      netzbezugKwh: number;
      monate: Array<{
        produktion: number;
        verbrauch: number;
        direkt: number;
        speicher: number;
        einspeisung: number;
        netz: number;
      }>;
    };
    kurve: number[];
    breakEvenJahr: number | null;
    rendite: number | null;
    speicherPreis: number;
    vergleich: {
      mit: VergleichSeite;
      ohne: VergleichSeite;
      preis: number;
      mehrAutarkie: number;
      mehrErsparnisJahr: number;
      wenigerNetzbezugKwh: number;
    };
  } | null;
  /** Eigene Texte aus dem Angebotskopf. */
  texte: { titel: string | null; einleitung: string | null; abschluss: string | null };
  gruppen: PdfGruppe[];
  positionen: PdfPosition[];
  /** Steuersatz, Gesamtrabatt und Lieferkosten. */
  rahmen: { ustSatz: number; rabattProzent: number; lieferungNetto: number };
  abzugBrutto: number | null;
  forderungBrutto: number | null;
};

const TITEL: Record<BelegArt, string> = {
  angebot: "Angebot",
  ab: "Auftragsbestätigung",
  anzahlungsrechnung: "Anzahlungsrechnung",
  schlussrechnung: "Schlussrechnung",
};

const TINTE = "#151210";
const LEISE = "#6A625A";
const ZART = "#9C9289";
const LINIE = "#E7E1D9";
const FLAECHE = "#F7F5F2";
/*
 * Für die Strom- und Geldbilder.
 *
 * Nach der Vorlage tragen die Bilder nur drei Werte: die Akzentfarbe
 * des Betriebs, die Tinte und ein Grau. Grün und Rot sind bewusst
 * weg — ein Angebot ist keine Ampel.
 */
const NETZFARBE = "#8E93A1";

const s = StyleSheet.create({
  page: {
    paddingTop: 40,
    paddingBottom: 62,
    paddingHorizontal: 46,
    fontSize: 9.5,
    lineHeight: 1.45,
    color: TINTE,
    fontFamily: "Helvetica",
  },

  /* ---------------------------------------------------------- BRIEFKOPF */
  kopf: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 22,
  },
  logo: { height: 34, objectFit: "contain" },
  firmaName: { fontSize: 15, fontFamily: "Helvetica-Bold", letterSpacing: -0.3 },
  firmaZeile: { fontSize: 8, color: ZART, textAlign: "right", lineHeight: 1.55 },

  /* Der farbige Balken trägt den Belegtyp — ein Blick genügt. */
  band: { flexDirection: "row", alignItems: "flex-end", marginBottom: 20 },
  h1: { fontSize: 26, fontFamily: "Helvetica-Bold", letterSpacing: -0.8 },
  bandStrich: { height: 3, marginTop: 8, marginBottom: 14 },
  meta: { fontSize: 9, color: LEISE },

  /* ----------------------------------------------------------- ANSCHRIFT */
  spalten: { flexDirection: "row", justifyContent: "space-between", marginBottom: 20 },
  empfaenger: { flex: 1 },
  label: {
    fontSize: 7,
    color: ZART,
    letterSpacing: 0.9,
    marginBottom: 3,
    fontFamily: "Helvetica-Bold",
  },
  kundeName: { fontSize: 11.5, fontFamily: "Helvetica-Bold" },

  /* -------------------------------------------------------- KENNZAHLEN */
  kennband: {
    flexDirection: "row",
    backgroundColor: FLAECHE,
    borderRadius: 8,
    padding: 12,
    marginBottom: 20,
  },
  kennfeld: { flex: 1 },
  kennwert: { fontSize: 15, fontFamily: "Helvetica-Bold", letterSpacing: -0.4 },
  kennlabel: { fontSize: 7.5, color: ZART, marginTop: 1 },

  /*
   * Der Satz, um den es dem Betrieb ging: „Da soll stehen, du sparst
   * circa X Euro im Jahr — also wirklich dem Kunden das Angebot
   * schmackhaft machen." Er steht deshalb gross und vor dem
   * Leistungsumfang; die Einschränkungen darunter, klein aber da.
   */
  sparband: {
    borderWidth: 1,
    borderColor: FLAECHE,
    borderRadius: 8,
    padding: 14,
    marginBottom: 16,
  },
  sparsatz: { fontSize: 17, fontFamily: "Helvetica-Bold", letterSpacing: -0.4 },
  sparklein: { fontSize: 9, lineHeight: 1.5, marginTop: 6 },
  sparfuss: { fontSize: 7.5, color: ZART, lineHeight: 1.45, marginTop: 6 },
  dachbild: {
    width: "100%",
    height: 150,
    objectFit: "cover",
    borderRadius: 8,
    marginBottom: 16,
  },

  /* ── Die Seiten aus der Planung ───────────────────────────────── */

  /*
   * Vier Entscheidungen aus der Vorlage, hier wie am Bildschirm:
   * keine Rundungen, getrennt wird durch Linien; Überschriften gross
   * und schwer mit einem Versal-Label darüber; Kennzahlen unter einer
   * Haarlinie statt in einem Kasten; Zahlen gross genug, um über den
   * Tisch gelesen zu werden.
   *
   * Die Anzeigeschrift ist Helvetica-Bold statt der Archivo aus der
   * Vorlage: @react-pdf liest nur TTF und OTF, und im Repo liegen die
   * Schriften als woff2. Der Charakter — schwere Grotesk, enge
   * Laufweite — stimmt, die Zeichnung der Buchstaben nicht ganz.
   */
  kapitel: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 1.4,
    color: ZART,
    marginBottom: 7,
  },
  schlagzeile: {
    fontSize: 34,
    fontFamily: "Helvetica-Bold",
    letterSpacing: -1.2,
    lineHeight: 1.03,
  },
  planTitel2: {
    fontSize: 22,
    fontFamily: "Helvetica-Bold",
    letterSpacing: -0.8,
    lineHeight: 1.1,
  },
  zwischen: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 0.5,
    marginBottom: 3,
  },
  lauftext: { fontSize: 10, color: LEISE, lineHeight: 1.6 },
  kleingedruckt: { fontSize: 7.5, color: ZART, lineHeight: 1.5 },

  kennreihe: { flexDirection: "row", gap: 14, marginTop: 22 },
  kennsaeule: { flex: 1, borderTopWidth: 1.5, borderTopColor: TINTE, paddingTop: 9 },
  kennsaeuleAkzent: { flex: 1, borderTopWidth: 1.5, paddingTop: 9 },
  kennzahl: { fontSize: 17, fontFamily: "Helvetica-Bold", letterSpacing: -0.7, lineHeight: 1.15 },
  kennlabel2: {
    fontSize: 6.5,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 0.9,
    color: LEISE,
    marginTop: 6,
  },

  wertreihe: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: 7,
    borderBottomWidth: 0.5,
    borderBottomColor: LINIE,
  },
  wertLabel: {
    width: "40%",
    fontSize: 6.5,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 0.8,
    color: LEISE,
    paddingRight: 8,
  },
  wertText: { flex: 1, fontSize: 9.5, fontFamily: "Helvetica-Bold", lineHeight: 1.35 },

  saeulenfeld: { flexDirection: "row", alignItems: "flex-end", gap: 4, height: 120, marginTop: 14 },
  saeule: { flex: 1, alignItems: "center", justifyContent: "flex-end" },
  saeuleWert: { fontSize: 6, color: LEISE, marginBottom: 3 },
  monatsachse: {
    flexDirection: "row",
    gap: 4,
    borderTopWidth: 1,
    borderTopColor: TINTE,
    paddingTop: 4,
  },
  monatsname: { flex: 1, fontSize: 6.5, color: LEISE, textAlign: "center" },

  anteilBand: { flexDirection: "row", height: 22, marginTop: 8 },
  anteilFuss: { flexDirection: "row", marginTop: 6 },
  anteilProzent: { fontSize: 8, fontFamily: "Helvetica-Bold" },
  anteilName: { fontSize: 8 },
  anteilMenge: { fontSize: 7.5, color: LEISE },


  /*
   * Der Aufbau folgt dem Kostenvoranschlag, den der Betrieb als Vorbild
   * gegeben hat: grosse Überschrift, ein Satz darunter, was gezeigt
   * wird — und dann Karten statt nackter Zeilen. Nackte Zeilen auf
   * grauem Grund waren der Grund für „sieht designtechnisch komplett
   * beschissen aus".
   */
  planTitel: { fontSize: 24, fontFamily: "Helvetica-Bold", letterSpacing: -0.7, lineHeight: 1.15 },
  planLead: { fontSize: 10, color: LEISE, lineHeight: 1.55, marginTop: 8, marginBottom: 18 },
  abschnitt: { fontSize: 8, fontFamily: "Helvetica-Bold", letterSpacing: 1.1, color: ZART, marginTop: 22, marginBottom: 9 },

  karten: { flexDirection: "row", gap: 9 },
  karte: {
    flex: 1,
    borderWidth: 1,
    borderColor: LINIE,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  karteZahl: { fontSize: 17, fontFamily: "Helvetica-Bold", letterSpacing: -0.5, lineHeight: 1.2 },
  karteLabel: { fontSize: 7.5, color: ZART, marginTop: 3, lineHeight: 1.4 },

  tafel: { borderWidth: 1, borderColor: LINIE, borderRadius: 10, paddingHorizontal: 13, paddingVertical: 4 },

  balkenReihe: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 },
  balkenLabel: { width: 22, fontSize: 7.5, color: ZART },
  balkenBahn: { flex: 1, flexDirection: "row", height: 11, borderRadius: 5.5, overflow: "hidden" },
  balkenWert: { width: 56, fontSize: 7.5, textAlign: "right", color: LEISE },
  legende: { flexDirection: "row", gap: 16, marginTop: 10 },
  legendePunkt: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendeKlecks: { width: 9, height: 9, borderRadius: 4.5 },
  legendeText: { fontSize: 7.5, color: LEISE },

  flussBahn: { flexDirection: "row", height: 20, borderRadius: 10, overflow: "hidden", marginTop: 8 },
  flussTeil: { alignItems: "center", justifyContent: "center" },
  flussProzent: { fontSize: 7.5, color: "#FFFFFF", fontFamily: "Helvetica-Bold" },

  quote: { flexDirection: "row", gap: 10, marginTop: 14 },
  quoteFeld: { flex: 1, backgroundColor: FLAECHE, borderRadius: 10, padding: 13 },
  quoteZahl: { fontSize: 22, fontFamily: "Helvetica-Bold", letterSpacing: -0.6, lineHeight: 1.2 },
  quoteText: { fontSize: 8, color: LEISE, lineHeight: 1.5, marginTop: 4 },

  kurveReihe: { flexDirection: "row", alignItems: "flex-end", gap: 2, height: 96, marginTop: 10 },
  kurveSaeule: { flex: 1, alignItems: "center", justifyContent: "flex-end" },
  kurveJahr: { fontSize: 6, color: ZART, marginTop: 2 },

  vglKopf: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: LINIE, paddingBottom: 5 },
  vglZeile: {
    flexDirection: "row",
    paddingVertical: 5.5,
    borderBottomWidth: 0.5,
    borderBottomColor: LINIE,
  },
  vglSache: { flex: 1.4, color: LEISE },
  vglWert: { flex: 1, textAlign: "right", fontFamily: "Helvetica-Bold" },
  vglKlein: { fontSize: 7.5, color: ZART, textAlign: "right", flex: 1 },

  planBild: {
    width: "100%",
    height: 230,
    objectFit: "cover",
    borderRadius: 8,
    marginTop: 4,
    marginBottom: 14,
  },
  monatReihe: { flexDirection: "row", alignItems: "center", gap: 7, marginBottom: 4 },
  monatLabel: { width: 26, fontSize: 8, color: LEISE },
  monatBahn: { flex: 1, height: 9, backgroundColor: "#f2eee9", borderRadius: 3 },
  monatWert: { width: 56, fontSize: 8, textAlign: "right" },
  wertZeile: {
    flexDirection: "row",
    /* Nicht `baseline`: Ein zweizeiliger Gerätename zöge das Label mit nach unten. */
    alignItems: "flex-start",
    paddingVertical: 7,
    borderBottomWidth: 0.5,
    borderBottomColor: LINIE,
  },
  wertK: { color: LEISE, flex: 1, paddingRight: 8 },
  wertV: { flex: 1.5, textAlign: "right", fontFamily: "Helvetica-Bold" },
  spalten2: { flexDirection: "row", gap: 22 },
  spalte: { flex: 1 },

  /* -------------------------------------------------------------- TEXTE */
  h2: { fontSize: 12.5, fontFamily: "Helvetica-Bold", marginTop: 18, marginBottom: 8 },
  fliess: { fontSize: 9.5, color: LEISE, lineHeight: 1.6, marginBottom: 4 },

  /* ------------------------------------------------------------ TABELLE */
  kopfzeile: {
    flexDirection: "row",
    paddingBottom: 5,
    borderBottomWidth: 1,
    borderBottomColor: LINIE,
  },
  th: { fontSize: 7, color: ZART, letterSpacing: 0.8, fontFamily: "Helvetica-Bold" },
  zeile: {
    flexDirection: "row",
    paddingVertical: 6,
    borderBottomWidth: 0.5,
    borderBottomColor: LINIE,
    alignItems: "center",
  },
  cPos: { width: 22, color: ZART, fontSize: 8.5 },
  cBild: { width: 26, height: 26, marginRight: 7, objectFit: "contain" },
  cText: { flex: 1, paddingRight: 10 },
  cMenge: { width: 62, textAlign: "right" },
  cPreis: { width: 62, textAlign: "right" },
  cSumme: { width: 70, textAlign: "right", fontFamily: "Helvetica-Bold" },
  unterzeile: { fontSize: 8, color: ZART, marginTop: 1 },

  /* Gruppenkopf: das Paket ist die Einheit, über die entschieden wird. */
  gruppenkopf: {
    flexDirection: "row",
    alignItems: "flex-end",
    marginTop: 14,
    marginBottom: 2,
  },
  gruppenName: { flex: 1, fontSize: 11, fontFamily: "Helvetica-Bold" },
  paketPreis: { fontSize: 12, fontFamily: "Helvetica-Bold" },

  /* ------------------------------------------------------------- SUMMEN */
  summenblock: { marginTop: 14, alignItems: "flex-end" },
  summe: { flexDirection: "row", paddingVertical: 2.5 },
  summeLabel: { width: 150, textAlign: "right", marginRight: 14, color: LEISE },
  summeWert: { width: 92, textAlign: "right" },
  endbetrag: {
    flexDirection: "row",
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 7,
    marginTop: 6,
  },

  hinweis: {
    marginTop: 18,
    backgroundColor: FLAECHE,
    borderRadius: 8,
    padding: 12,
    fontSize: 8.5,
    color: LEISE,
    lineHeight: 1.6,
  },

  fuss: {
    position: "absolute",
    bottom: 26,
    left: 46,
    right: 46,
    fontSize: 7,
    color: ZART,
    borderTopWidth: 0.5,
    borderTopColor: LINIE,
    paddingTop: 6,
    flexDirection: "row",
  },
});

/** Runde Beträge ohne Cent — für Kacheln, wo zwei Nachkommastellen nur Lärm sind. */
const eurKurz = (n: number) =>
  `${Math.round(n).toLocaleString("de-AT")} €`;

const eur = (n: number) =>
  `${n.toLocaleString("de-AT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

const zahl = (n: number) =>
  n.toLocaleString("de-AT", { maximumFractionDigits: 2 });

const dat = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("de-AT") : "—";

/*
 * Die Preise kommen aus lib/vorgang/preis.ts und werden hier nicht noch
 * einmal gerechnet. Editor, Portal, Rechnungslauf und dieses PDF müssen
 * denselben Betrag zeigen — eine zweite Rundungsregel fällt genau dann
 * auf, wenn ein Kunde Angebot und Rechnung nebeneinanderlegt.
 */
function alsPreisPosition(p: PdfPosition): PreisPosition {
  return {
    id: String(p.pos),
    gruppeId: p.gruppeId,
    menge: p.menge,
    epNetto: p.epNetto,
    rabattProzent: p.rabattProzent,
    ustSatz: p.ustSatz,
    optional: p.optional,
    ...(p.optional ? { gewaehlt: p.gewaehlt === true } : {}),
  };
}

function zeilenNetto(p: PdfPosition): number {
  return posNetto(alsPreisPosition(p));
}

export function VorgangPdf({ data }: { data: VorgangPdfData }) {
  const istRechnung =
    data.art === "anzahlungsrechnung" || data.art === "schlussrechnung";
  const istAngebot = data.art === "angebot";
  const akzent = data.marke.akzent;

  /*
   * Optionale Positionen zählen nicht mit. Sie stehen als eigener Block
   * darunter — ein Angebot, dessen Summe Dinge enthält, die der Kunde
   * erst noch wählen soll, ist eine falsche Zahl.
   */
  const feste = data.positionen.filter((p) => !p.optional);
  const optionen = data.positionen.filter((p) => p.optional);

  const preisPositionen = data.positionen.map(alsPreisPosition);
  const preisGruppen = data.gruppen.map((g) => ({
    id: g.id,
    paketPreis: g.paketPreis,
  }));

  const gruppeSumme = (gid: string) =>
    gruppenNetto({ id: gid, paketPreis: data.gruppen.find((g) => g.id === gid)?.paketPreis ?? null }, preisPositionen);

  const gruppenIds = [
    ...data.gruppen.filter((g) => feste.some((p) => p.gruppeId === g.id)).map((g) => g.id),
  ];
  const ohneGruppe = feste.filter(
    (p) => !p.gruppeId || !data.gruppen.some((g) => g.id === p.gruppeId),
  );

  const preis = berechne(preisPositionen, preisGruppen, data.rahmen);
  const positionenNetto = preis.positionenNetto;
  const rabatt = preis.gesamtRabatt;
  const netto = preis.netto;
  const ust = preis.ust;
  const lieferungBrutto = preis.lieferungBrutto;
  const brutto = preis.gesamt;
  const optionenNetto = preis.optionalNetto;

  const nummer = data.belegNummer ?? data.vorgangNummer;

  /*
   * Der Ertrag kommt aus der PLANUNG, wenn eine dranhängt — gerechnet
   * aus Ausrichtung, Neigung und Verschattung. Nur ohne Planung bleibt
   * die Faustformel „rund 1000 kWh je kWp": ein grober Mittelwert für
   * Österreich und Süddeutschland, als Schätzung ausgewiesen.
   *
   * Vorher stand die Faustformel auch dann im Angebot, wenn daneben
   * eine gerechnete Zahl vorlag — zwei Ertragsangaben in einem
   * Umschlag, und der Kunde hat beide gelesen.
   */
  const geplant = data.planung ?? null;
  const ertrag = geplant
    ? Math.round(geplant.jahresertragKwh)
    : data.anlage.kwp
      ? Math.round(data.anlage.kwp * 1000)
      : null;

  return (
    <Document
      title={`${TITEL[data.art]} ${nummer}`}
      author={data.firma.name}
      creator={data.firma.name}
    >
      <Page size="A4" style={s.page}>
        {/* ------------------------------------------------- BRIEFKOPF */}
        <View style={s.kopf} fixed>
          <View>
            {data.marke.logoUrl ? (
              /* eslint-disable-next-line jsx-a11y/alt-text --
                 @react-pdf/Image ist kein <img>; alt gibt es dort nicht. */
              <Image src={data.marke.logoUrl} style={s.logo} />
            ) : (
              <Text style={s.firmaName}>{data.firma.name}</Text>
            )}
          </View>
          <View style={s.firmaZeile}>
            {data.marke.logoUrl ? <Text>{data.firma.name}</Text> : null}
            {data.firma.adresse ? <Text>{data.firma.adresse}</Text> : null}
            <Text>
              {[data.firma.plz, data.firma.ort, data.firma.land]
                .filter(Boolean)
                .join(" ")}
            </Text>
            {data.firma.telefon ? <Text>{data.firma.telefon}</Text> : null}
            {data.firma.email ? <Text>{data.firma.email}</Text> : null}
            {data.firma.website ? <Text>{data.firma.website}</Text> : null}
          </View>
        </View>

        {/* ------------------------------------------------------- TITEL */}
        <View style={s.band}>
          <Text style={[s.h1, { color: akzent }]}>
            {istAngebot && data.texte.titel ? data.texte.titel : TITEL[data.art]}
          </Text>
        </View>
        <View style={[s.bandStrich, { backgroundColor: akzent, width: 54 }]} />

        <Text style={s.meta}>
          {nummer} · {dat(data.erstelltAm)}
          {/*
            Die Vorgangsnummer steht auf jedem Beleg, auch wenn er eine
            eigene Rechnungsnummer trägt. Ein Kunde, der wegen der
            Rechnung anruft, nennt eine Nummer — und im Betrieb soll
            damit sofort der ganze Vorgang auffindbar sein.
          */}
          {data.belegNummer ? ` · zum Vorgang ${data.vorgangNummer}` : ""}
          {istAngebot && data.gueltigBis ? ` · gültig bis ${dat(data.gueltigBis)}` : ""}
        </Text>

        {/* --------------------------------------------------- EMPFÄNGER */}
        <View style={[s.spalten, { marginTop: 18 }]}>
          <View style={s.empfaenger}>
            <Text style={s.label}>FÜR</Text>
            <Text style={s.kundeName}>{data.kunde.name}</Text>
            {data.kunde.kontakt ? (
              <Text style={{ color: LEISE }}>{data.kunde.kontakt}</Text>
            ) : null}
            {data.kunde.adresse ? <Text>{data.kunde.adresse}</Text> : null}
            <Text>{[data.kunde.plz, data.kunde.ort].filter(Boolean).join(" ")}</Text>
          </View>

          {data.anlage.adresse ? (
            <View style={s.empfaenger}>
              <Text style={s.label}>STANDORT DER ANLAGE</Text>
              <Text>{data.anlage.adresse}</Text>
              {data.anlage.zaehlpunkt ? (
                <Text style={{ color: LEISE }}>
                  Zählpunkt {data.anlage.zaehlpunkt}
                </Text>
              ) : null}
            </View>
          ) : null}
        </View>

        {/* -------------------------------------------------- KENNZAHLEN */}
        {data.anlage.kwp ? (
          <View style={s.kennband}>
            <View style={s.kennfeld}>
              <Text style={[s.kennwert, { color: akzent }]}>
                {zahl(data.anlage.kwp)} kWp
              </Text>
              <Text style={s.kennlabel}>Anlagenleistung</Text>
            </View>
            {data.anlage.speicherKwh ? (
              <View style={s.kennfeld}>
                <Text style={s.kennwert}>{zahl(data.anlage.speicherKwh)} kWh</Text>
                <Text style={s.kennlabel}>Speicher</Text>
              </View>
            ) : null}
            {ertrag ? (
              <>
                <View style={s.kennfeld}>
                  <Text style={s.kennwert}>{zahl(ertrag)} kWh</Text>
                  <Text style={s.kennlabel}>
                    {geplant ? "Ertrag im Jahr, gerechnet" : "Ertrag im Jahr, geschätzt"}
                  </Text>
                </View>
                <View style={s.kennfeld}>
                  {/*
                    0,4 kg CO2 je kWh — Vermeidung gegenüber Netzstrom.
                    Ohne Subskript geschrieben: Helvetica bringt das Zeichen
                    im PDF nicht mit, und es fällt still weg — aus „CO₂"
                    wurde „CO".
                  */}
                  <Text style={s.kennwert}>{zahl(Math.round(ertrag * 0.4))} kg</Text>
                  <Text style={s.kennlabel}>CO2 weniger im Jahr</Text>
                </View>
              </>
            ) : null}
          </View>
        ) : null}

        {/* ------------------------------------------- WAS ES DIR BRINGT */}
        {istAngebot && geplant && geplant.ersparnisJahr1 > 0 ? (
          <View style={s.sparband}>
            <Text style={[s.sparsatz, { color: akzent }]}>
              Du sparst rund {zahl(Math.round(geplant.ersparnisJahr1))} € im Jahr.
            </Text>
            <Text style={s.sparklein}>
              Gerechnet mit deinem Verbrauch, {zahl(Math.round(geplant.jahresertragKwh))} kWh
              Ertrag und {Math.round(geplant.autarkie * 100)} % Autarkie
              {geplant.speicherKwh > 0
                ? ` — mit ${zahl(Math.round(geplant.speicherKwh * 10) / 10)} kWh Speicher`
                : " — ohne Speicher"}
              . Über zwanzig Jahre sind das rund {zahl(Math.round(geplant.ersparnis20))} €
              {geplant.amortisationJahre !== null
                ? `; die Anlage hat sich nach etwa ${zahl(Math.round(geplant.amortisationJahre * 10) / 10)} Jahren bezahlt.`
                : "."}
            </Text>
            <Text style={s.sparfuss}>
              Richtwerte aus der Planung — der tatsächliche Ertrag hängt vom Wetter ab, die
              Ersparnis vom Strompreis. Steigt er, wird die Rechnung besser.
            </Text>
          </View>
        ) : null}

        {istAngebot && geplant?.bild ? (
          /* eslint-disable-next-line jsx-a11y/alt-text --
             @react-pdf/Image ist kein <img>; alt gibt es dort nicht. */
          <Image src={geplant.bild} style={s.dachbild} />
        ) : null}

        {istAngebot && data.texte.einleitung ? (
          <Text style={s.fliess}>{data.texte.einleitung}</Text>
        ) : null}

        {/* --------------------- TECHNISCHER TEIL, BEIM ANGEBOT OHNE PREISE */}
        {istAngebot ? (
          <>
            <Text style={s.h2}>Leistungsumfang</Text>
            <View style={s.kopfzeile}>
              <Text style={[s.cPos, s.th]}>POS</Text>
              <Text style={[s.cText, s.th]}>LEISTUNG</Text>
              <Text style={[s.cMenge, s.th]}>MENGE</Text>
            </View>
            {data.positionen.map((p) => (
              <View key={`t-${p.pos}`} style={s.zeile} wrap={false}>
                <Text style={s.cPos}>{p.pos}</Text>
                {p.bildUrl ? (
                  /* eslint-disable-next-line jsx-a11y/alt-text -- siehe oben */
                  <Image src={p.bildUrl} style={s.cBild} />
                ) : null}
                <View style={s.cText}>
                  <Text>
                    {p.text}
                    {p.optional ? "  (Option)" : ""}
                  </Text>
                  {p.beschreibung ? (
                    <Text style={s.unterzeile}>{p.beschreibung}</Text>
                  ) : null}
                </View>
                <Text style={s.cMenge}>
                  {zahl(p.menge)} {p.einheit}
                </Text>
              </View>
            ))}
          </>
        ) : null}

        {/* ------------------------------------------------------ PREISE */}
        <Text style={s.h2} break={istAngebot}>
          {istAngebot ? "Ihr Preis" : "Positionen"}
        </Text>

        {gruppenIds.map((gid) => {
          const g = data.gruppen.find((x) => x.id === gid)!;
          const drin = feste.filter((p) => p.gruppeId === gid);
          return (
            <View key={gid} wrap={false}>
              <View style={s.gruppenkopf}>
                <Text style={s.gruppenName}>{g.name}</Text>
                <Text style={[s.paketPreis, { color: akzent }]}>
                  {eur(gruppeSumme(gid))}
                </Text>
              </View>
              {g.beschreibung ? (
                <Text style={[s.unterzeile, { marginBottom: 4 }]}>
                  {g.beschreibung}
                </Text>
              ) : null}
              <View style={[s.bandStrich, { backgroundColor: LINIE, height: 1, marginTop: 4, marginBottom: 2 }]} />

              {drin.map((p) => (
                <View key={`g-${p.pos}`} style={s.zeile} wrap={false}>
                  <Text style={s.cPos}>{p.pos}</Text>
                  <View style={s.cText}>
                    <Text>{p.text}</Text>
                  </View>
                  <Text style={s.cMenge}>
                    {zahl(p.menge)} {p.einheit}
                  </Text>
                  {/*
                    Versteckte Einzelpreise sind eine Entscheidung des
                    Betriebs, keine Auslassung: der Kunde entscheidet
                    über das Paket und nicht über zwanzig Modulklemmen.
                  */}
                  {g.einzelpreiseVerstecken ? (
                    <Text style={[s.cPreis, { color: ZART }]}>im Paket</Text>
                  ) : (
                    <Text style={s.cPreis}>{eur(p.epNetto)}</Text>
                  )}
                  {g.einzelpreiseVerstecken ? (
                    <Text style={s.cSumme}> </Text>
                  ) : (
                    <Text style={s.cSumme}>{eur(zeilenNetto(p))}</Text>
                  )}
                </View>
              ))}
            </View>
          );
        })}

        {ohneGruppe.length > 0 ? (
          <>
            {gruppenIds.length > 0 ? (
              <Text style={[s.label, { marginTop: 16 }]}>WEITERE LEISTUNGEN</Text>
            ) : null}
            <View style={s.kopfzeile}>
              <Text style={[s.cPos, s.th]}>POS</Text>
              <Text style={[s.cText, s.th]}>LEISTUNG</Text>
              <Text style={[s.cMenge, s.th]}>MENGE</Text>
              <Text style={[s.cPreis, s.th]}>EINZEL</Text>
              <Text style={[s.cSumme, s.th]}>SUMME</Text>
            </View>
            {ohneGruppe.map((p) => (
              <View key={`o-${p.pos}`} style={s.zeile} wrap={false}>
                <Text style={s.cPos}>{p.pos}</Text>
                <View style={s.cText}>
                  <Text>{p.text}</Text>
                  {p.beschreibung ? (
                    <Text style={s.unterzeile}>{p.beschreibung}</Text>
                  ) : null}
                </View>
                <Text style={s.cMenge}>
                  {zahl(p.menge)} {p.einheit}
                </Text>
                <Text style={s.cPreis}>{eur(p.epNetto)}</Text>
                <Text style={s.cSumme}>{eur(zeilenNetto(p))}</Text>
              </View>
            ))}
          </>
        ) : null}

        {/* ------------------------------------------------------ SUMMEN */}
        <View style={s.summenblock} wrap={false}>
          {data.rahmen.rabattProzent > 0 ? (
            <>
              <Summenzeile label="Zwischensumme netto" wert={eur(positionenNetto)} />
              <Summenzeile
                label={`Rabatt ${zahl(data.rahmen.rabattProzent)} %`}
                wert={`− ${eur(rabatt)}`}
              />
            </>
          ) : null}
          <Summenzeile label="Netto" wert={eur(netto)} />
          <Summenzeile
            label={`Umsatzsteuer ${zahl(data.rahmen.ustSatz)} %`}
            wert={eur(ust)}
          />
          {data.rahmen.lieferungNetto > 0 ? (
            <Summenzeile label="Lieferung inkl. USt." wert={eur(lieferungBrutto)} />
          ) : null}

          <View style={[s.endbetrag, { backgroundColor: `${akzent}1A` }]}>
            <Text
              style={[
                s.summeLabel,
                { fontFamily: "Helvetica-Bold", color: TINTE, marginRight: 14 },
              ]}
            >
              {istRechnung && data.forderungBrutto !== null
                ? "Zwischensumme brutto"
                : "Gesamt brutto"}
            </Text>
            <Text style={[s.summeWert, { fontFamily: "Helvetica-Bold", fontSize: 12 }]}>
              {eur(brutto)}
            </Text>
          </View>

          {data.abzugBrutto !== null && data.abzugBrutto > 0 ? (
            <Summenzeile
              label="abzüglich Anzahlung"
              wert={`− ${eur(data.abzugBrutto)}`}
            />
          ) : null}

          {istRechnung && data.forderungBrutto !== null ? (
            <View style={[s.endbetrag, { backgroundColor: `${akzent}1A` }]}>
              <Text
                style={[
                  s.summeLabel,
                  { fontFamily: "Helvetica-Bold", color: TINTE, marginRight: 14 },
                ]}
              >
                Zahlbetrag
              </Text>
              <Text
                style={[s.summeWert, { fontFamily: "Helvetica-Bold", fontSize: 12 }]}
              >
                {eur(data.forderungBrutto)}
              </Text>
            </View>
          ) : null}
        </View>

        {/* ---------------------------------------------------- OPTIONEN */}
        {optionen.length > 0 ? (
          <View wrap={false}>
            <Text style={s.h2}>Optionen zur Auswahl</Text>
            <Text style={[s.fliess, { marginBottom: 6 }]}>
              Nicht im Preis oben enthalten. Sagen Sie uns einfach Bescheid,
              was Sie davon möchten.
            </Text>
            <View style={s.kopfzeile}>
              <Text style={[s.cText, s.th]}>LEISTUNG</Text>
              <Text style={[s.cMenge, s.th]}>MENGE</Text>
              <Text style={[s.cSumme, s.th]}>AUFPREIS</Text>
            </View>
            {optionen.map((p) => (
              <View key={`opt-${p.pos}`} style={s.zeile} wrap={false}>
                <View style={s.cText}>
                  <Text>{p.text}</Text>
                  {p.beschreibung ? (
                    <Text style={s.unterzeile}>{p.beschreibung}</Text>
                  ) : null}
                </View>
                <Text style={s.cMenge}>
                  {zahl(p.menge)} {p.einheit}
                </Text>
                <Text style={s.cSumme}>{eur(zeilenNetto(p))}</Text>
              </View>
            ))}
            <Text style={[s.unterzeile, { textAlign: "right", marginTop: 5 }]}>
              alle Optionen zusammen {eur(optionenNetto)} netto
            </Text>
          </View>
        ) : null}

        {/* ------------------------------------------------- SCHLUSSTEXT */}
        <View style={s.hinweis} wrap={false}>
          {istAngebot ? (
            <Text>
              {data.texte.abschluss
                ? `${data.texte.abschluss}\n\n`
                : ""}
              Gültig bis {dat(data.gueltigBis)}. Preise in Euro. Der
              Leistungsumfang gilt vorbehaltlich der Machbarkeit vor Ort —
              was wir bei der Aufnahme feststellen, besprechen wir vorher
              mit Ihnen.
            </Text>
          ) : null}
          {data.art === "ab" ? (
            <Text>
              Wir bestätigen den Auftrag zu den oben genannten Bedingungen.
              Die Auftragsnummer entspricht der Vorgangsnummer und gilt für
              alle weiteren Belege.
            </Text>
          ) : null}
          {istRechnung ? (
            <Text>
              Zahlbar bis {dat(data.faelligAm)} ohne Abzug auf
              {data.firma.iban ? ` IBAN ${data.firma.iban}` : " das bekannte Konto"}.
              Bitte die Rechnungsnummer als Verwendungszweck angeben.
              {"\n"}
              Leistungszeitraum: siehe Auftragsbestätigung {data.vorgangNummer}.
            </Text>
          ) : null}
        </View>

        {/* --------------------------------------------------- FUSSZEILE */}
        <View style={s.fuss} fixed>
          {/*
            Die Pflichtangaben für Geschäftsbriefe stehen hier zusammen:
            Firma mit Rechtsform, Sitz, Firmenbuchnummer und Gericht,
            dazu UID und Bankverbindung. Was der Betrieb nicht gepflegt
            hat, fällt weg statt als leeres Feld dazustehen.
          */}
          <Text style={{ flex: 1 }}>
            {[
              [data.firma.name, data.firma.rechtsform].filter(Boolean).join(" "),
              [data.firma.adresse, data.firma.plz, data.firma.ort]
                .filter(Boolean)
                .join(", "),
              data.firma.firmenbuchNr
                ? [data.firma.firmenbuchNr, data.firma.firmenbuchGericht]
                    .filter(Boolean)
                    .join(", ")
                : null,
              data.firma.uid ? `UID ${data.firma.uid}` : null,
              data.firma.telefon,
              data.firma.email,
              data.firma.iban
                ? [`IBAN ${data.firma.iban}`, data.firma.bic ? `BIC ${data.firma.bic}` : null]
                    .filter(Boolean)
                    .join(" · ")
                : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </Text>
          {/*
            Seitenzahl, weil ein Angebot über zwei Seiten geht und der
            Kunde sonst nicht merkt, wenn die zweite im Drucker liegt.
          */}
          <Text
            render={({ pageNumber, totalPages }) =>
              `${pageNumber} / ${totalPages}`
            }
          />
        </View>
      </Page>

      {/* ═══════════════ DIE PLANUNG, WENN EINE DRANHÄNGT ═══════════ */}
      {istAngebot && geplant ? (
        <>
          {/* ── Dein Ergebnis ──────────────────────────────────── */}
          <Page size="A4" style={s.page}>
            <PlanKopf data={data} nummer={nummer} />

            <Kapitel>Dein Ergebnis</Kapitel>
            {geplant.ersparnisJahr1 > 0 ? (
              <Text style={s.schlagzeile}>
                {data.kunde.name.split(" ")[0]}, du sparst rund{" "}
                <Text style={{ color: akzent }}>
                  {zahl(Math.round(geplant.ersparnisJahr1))} €
                </Text>{" "}
                im Jahr.
              </Text>
            ) : (
              <Text style={s.schlagzeile}>Deine Anlage im Detail.</Text>
            )}

            <Text style={[s.lauftext, { marginTop: 16 }]}>
              Gerechnet mit deinem Verbrauch, {zahl(Math.round(geplant.jahresertragKwh))} kWh
              Ertrag und {Math.round(geplant.autarkie * 100)} % Autarkie
              {geplant.speicherKwh > 0
                ? ` — mit ${zahl(Math.round(geplant.speicherKwh * 10) / 10)} kWh Speicher`
                : " — ohne Speicher"}
              . Über zwanzig Jahre sind das rund {zahl(Math.round(geplant.ersparnis20))} €
              {geplant.amortisationJahre !== null
                ? `; die Anlage hat sich nach etwa ${zahl(
                    Math.round(geplant.amortisationJahre * 10) / 10,
                  )} Jahren bezahlt.`
                : "."}
            </Text>
            <Text style={[s.kleingedruckt, { marginTop: 10 }]}>
              Richtwerte aus der Planung — der tatsächliche Ertrag hängt vom Wetter ab, die
              Ersparnis vom Strompreis. Steigt er, wird die Rechnung besser.
            </Text>

            <View style={s.kennreihe}>
              <Kennsaeule zahl={`${zahl(geplant.kwp)} kWp`} label="Anlagenleistung" />
              <Kennsaeule zahl={zahl(geplant.modulAnzahl)} label="Module auf dem Dach" />
              {geplant.speicherKwh > 0 ? (
                <Kennsaeule
                  zahl={`${zahl(Math.round(geplant.speicherKwh * 10) / 10)} kWh`}
                  label="Speicher"
                />
              ) : null}
              <Kennsaeule
                zahl={`${zahl(Math.round(geplant.jahresertragKwh))} kWh`}
                label="Ertrag im Jahr"
                akzent={akzent}
              />
            </View>

            {geplant.bild ? (
              /* eslint-disable-next-line jsx-a11y/alt-text -- @react-pdf/Image ist kein <img> */
              <Image src={geplant.bild} style={[s.planBild, { marginTop: 26 }]} />
            ) : null}

            <PlanFuss firma={data.firma.name} />
          </Page>

          {/* ── Deine Anlage ───────────────────────────────────── */}
          <Page size="A4" style={s.page}>
            <PlanKopf data={data} nummer={nummer} />

            <Kapitel>Deine Anlage</Kapitel>
            <Text style={s.planTitel2}>Was verbaut wird</Text>
            <Text style={[s.lauftext, { marginTop: 12 }]}>
              Das ist die Anlage, die wir für dich geplant haben — so liegt sie auf deinem
              Dach, und das steckt darin.
            </Text>

            <View style={{ marginTop: 18, borderTopWidth: 1, borderTopColor: TINTE }}>
              {geplant.modulTyp ? (
                <Wertreihe k={`Module (${zahl(geplant.modulAnzahl)} Stück)`} v={geplant.modulTyp} />
              ) : null}
              {geplant.wechselrichter ? (
                <Wertreihe k="Wechselrichter" v={geplant.wechselrichter} />
              ) : null}
              {geplant.speicherKwh > 0 ? (
                <Wertreihe
                  k="Speicher"
                  v={[
                    geplant.speicher,
                    geplant.speicherModule ? `${geplant.speicherModule} Module` : null,
                    `${zahl(Math.round(geplant.speicherKwh * 10) / 10)} kWh`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                />
              ) : null}
              {geplant.flaechen
                .filter((f) => f.module > 0)
                .map((f) => (
                  <Wertreihe
                    key={f.name}
                    k={f.name}
                    v={`${zahl(f.module)} Module · ${zahl(f.neigung)}° · ${himmelsrichtung(f.azimut)}`}
                  />
                ))}
              {geplant.verschattungProzent > 0.005 ? (
                <Wertreihe
                  k="Verschattung"
                  v={`− ${zahl(Math.round(geplant.verschattungProzent * 1000) / 10)} %`}
                />
              ) : null}
            </View>

            <Text style={[s.kleingedruckt, { marginTop: 14 }]}>
              Die Belegung zeigt den geplanten Stand. Was vor Ort möglich ist, stellen wir bei
              der Aufnahme fest und besprechen es vorher mit dir.
            </Text>

            <PlanFuss firma={data.firma.name} />
          </Page>

          {/* ── Dein Strom ─────────────────────────────────────── */}
          <Page size="A4" style={s.page}>
            <PlanKopf data={data} nummer={nummer} />

            <Kapitel>Dein Strom</Kapitel>
            <Text style={s.planTitel2}>Monat für Monat</Text>
            <Text style={[s.lauftext, { marginTop: 12 }]}>
              {zahl(Math.round(geplant.jahresertragKwh))} kWh im Jahr, das sind{" "}
              {zahl(Math.round(geplant.spezifisch))} kWh je kWp — gerechnet aus Ausrichtung,
              Neigung und Verschattung deines Dachs. Die Farben zeigen, was direkt ins Haus
              geht, was über den Speicher läuft und was eingespeist wird.
            </Text>

            <View style={s.saeulenfeld}>
              {geplant.fluss.monate.map((mo, i) => {
                const hoechst = Math.max(...geplant.fluss.monate.map((x) => x.produktion), 1);
                const anteil = (w: number) =>
                  `${(w / (mo.produktion || 1)) * 100}%`;
                return (
                  <View key={MONATE[i]} style={s.saeule}>
                    <Text style={s.saeuleWert}>{zahl(Math.round(mo.produktion))}</Text>
                    <View
                      style={{
                        width: "100%",
                        height: `${(mo.produktion / hoechst) * 100}%`,
                        justifyContent: "flex-end",
                      }}
                    >
                      <View style={{ height: anteil(mo.einspeisung), backgroundColor: "#D7D3D3" }} />
                      <View style={{ height: anteil(mo.speicher), backgroundColor: TINTE }} />
                      <View style={{ height: anteil(mo.direkt), backgroundColor: akzent }} />
                    </View>
                  </View>
                );
              })}
            </View>
            <View style={s.monatsachse}>
              {MONATE.map((mo) => (
                <Text key={mo} style={s.monatsname}>
                  {mo}
                </Text>
              ))}
            </View>
            <Legende
              akzent={akzent}
              eintraege={[
                ["Direkt verbraucht", akzent],
                ["Über den Speicher", TINTE],
                ["Ins Netz", "#D7D3D3"],
              ]}
            />

            <View style={[s.spalten2, { marginTop: 26 }]}>
              <View style={s.spalte}>
                <Text style={s.zwischen}>WOHIN GEHT DEIN STROM?</Text>
                <Text style={s.kleingedruckt}>
                  Von {zahl(Math.round(geplant.jahresertragKwh))} kWh Erzeugung bleiben{" "}
                  {Math.round(geplant.eigenverbrauchQuote * 100)} % im Haus.
                </Text>
                <Anteilsband
                  teile={[
                    { wert: geplant.fluss.direktKwh, farbe: akzent, name: "Direkt" },
                    { wert: geplant.fluss.ueberSpeicherKwh, farbe: TINTE, name: "Speicher" },
                    { wert: geplant.fluss.einspeisungKwh, farbe: "#D7D3D3", name: "Ins Netz" },
                  ]}
                />
              </View>
              <View style={s.spalte}>
                <Text style={s.zwischen}>WOHER KOMMT DEIN STROM?</Text>
                <Text style={s.kleingedruckt}>
                  Dein Haushalt braucht {zahl(Math.round(geplant.verbrauchKwh))} kWh im Jahr.
                </Text>
                <Anteilsband
                  teile={[
                    { wert: geplant.fluss.direktKwh, farbe: akzent, name: "Vom Dach" },
                    { wert: geplant.fluss.ueberSpeicherKwh, farbe: TINTE, name: "Aus dem Speicher" },
                    { wert: geplant.fluss.netzbezugKwh, farbe: "#D7D3D3", name: "Aus dem Netz" },
                  ]}
                />
              </View>
            </View>

            <Text style={[s.zwischen, { marginTop: 26 }]}>ENERGIEFLUSS</Text>
            <Text style={s.kleingedruckt}>
              Vom Dach ins Haus, in den Speicher und ins Netz — Bandbreite gleich Strommenge.
            </Text>
            <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 8 }}>
              <Text style={{ fontSize: 8, fontFamily: "Helvetica-Bold" }}>
                Photovoltaik · {zahl(Math.round(geplant.jahresertragKwh))} kWh
              </Text>
              <Text style={{ fontSize: 8, fontFamily: "Helvetica-Bold" }}>
                Haushalt · {zahl(Math.round(geplant.verbrauchKwh))} kWh
              </Text>
            </View>
            <SankeyPdf
              akzent={akzent}
              direkt={geplant.fluss.direktKwh}
              speicher={geplant.fluss.ueberSpeicherKwh}
              einspeisung={geplant.fluss.einspeisungKwh}
              netzbezug={geplant.fluss.netzbezugKwh}
              produktion={geplant.jahresertragKwh}
              verbrauch={geplant.verbrauchKwh}
            />
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <Text style={s.kleingedruckt}>
                Netzbezug · {zahl(Math.round(geplant.fluss.netzbezugKwh))} kWh
              </Text>
              <Text style={s.kleingedruckt}>
                Netz · {zahl(Math.round(geplant.fluss.einspeisungKwh))} kWh
              </Text>
            </View>

            <View style={s.kennreihe}>
              <Kennsaeule
                zahl={`${Math.round(geplant.autarkie * 100)} %`}
                label="Autarkie — so viel deines Verbrauchs deckst du selbst"
                akzent={akzent}
              />
              <Kennsaeule
                zahl={`${Math.round(geplant.eigenverbrauchQuote * 100)} %`}
                label="Eigenverbrauch — so viel bleibt im Haus"
              />
            </View>

            <PlanFuss firma={data.firma.name} />
          </Page>

          {/* ── Was die Anlage rechnet ─────────────────────────── */}
          <Page size="A4" style={s.page}>
            <PlanKopf data={data} nummer={nummer} />

            <Kapitel>Wirtschaftlichkeit</Kapitel>
            <Text style={s.planTitel2}>Was die Anlage rechnet</Text>

            <View style={s.kennreihe}>
              <Kennsaeule
                zahl={eurKurz(geplant.ersparnis20)}
                label="Ersparnis in 20 Jahren"
                akzent={akzent}
              />
              {geplant.amortisationJahre !== null ? (
                <Kennsaeule
                  zahl={`${zahl(Math.round(geplant.amortisationJahre * 10) / 10)} Jahre`}
                  label={
                    geplant.breakEvenJahr !== null
                      ? `bezahlt im Jahr ${new Date(data.erstelltAm).getFullYear() + geplant.breakEvenJahr}`
                      : "bis sie sich bezahlt hat"
                  }
                />
              ) : null}
              {geplant.rendite !== null ? (
                <Kennsaeule
                  zahl={`${zahl(Math.round(geplant.rendite * 1000) / 10)} %`}
                  label="Rendite im Jahr"
                />
              ) : null}
              <Kennsaeule zahl={eurKurz(geplant.investition)} label="Investition laut Angebot" />
            </View>

            <Text style={[s.zwischen, { marginTop: 26 }]}>BIS SIE SICH BEZAHLT HAT</Text>
            <Text style={s.kleingedruckt}>
              Jeder Balken ist ein Jahr: in der Akzentfarbe, solange die Anlage noch nicht
              bezahlt ist — danach im Plus.
            </Text>
            <Kurve
              kurve={geplant.kurve}
              start={new Date(data.erstelltAm).getFullYear() + 1}
              akzent={akzent}
            />

            <View style={[s.spalten2, { marginTop: 26 }]}>
              <View style={s.spalte}>
                <Text style={s.zwischen}>WOMIT GERECHNET WURDE</Text>
                <View style={{ marginTop: 8, borderTopWidth: 1, borderTopColor: TINTE }}>
                  <Wertreihe
                    k="Verbrauch im Haus"
                    v={`${zahl(Math.round(geplant.verbrauchKwh))} kWh`}
                  />
                  <Wertreihe k="Strompreis heute" v={`${eur(geplant.strompreis)} je kWh`} />
                  <Wertreihe k="Einspeisevergütung" v={`${eur(geplant.verguetung)} je kWh`} />
                  <Wertreihe
                    k="Angenommene Steigerung"
                    v={`${zahl(Math.round(geplant.steigerung * 1000) / 10)} % im Jahr`}
                  />
                </View>
              </View>

              {geplant.speicherKwh > 0 && geplant.vergleich.preis > 0 ? (
                <View style={s.spalte}>
                  <Text style={s.zwischen}>MIT ODER OHNE SPEICHER</Text>
                  <View style={[s.vglKopf, { marginTop: 8 }]}>
                    <Text style={s.vglSache}> </Text>
                    <Text style={[s.vglWert, { color: akzent, fontSize: 7 }]}>
                      MIT {zahl(Math.round(geplant.speicherKwh * 10) / 10)} KWH
                    </Text>
                    <Text style={[s.vglWert, { color: LEISE, fontSize: 7 }]}>OHNE SPEICHER</Text>
                  </View>
                  <Vergleichszeile
                    k="Investition"
                    a={eurKurz(geplant.vergleich.mit.investition)}
                    b={eurKurz(geplant.vergleich.ohne.investition)}
                  />
                  <Vergleichszeile
                    k="Autarkie"
                    a={`${Math.round(geplant.vergleich.mit.autarkie * 100)} %`}
                    b={`${Math.round(geplant.vergleich.ohne.autarkie * 100)} %`}
                  />
                  <Vergleichszeile
                    k="Strom aus dem Netz"
                    a={`${zahl(Math.round(geplant.vergleich.mit.netzbezugKwh))} kWh`}
                    b={`${zahl(Math.round(geplant.vergleich.ohne.netzbezugKwh))} kWh`}
                  />
                  <Vergleichszeile
                    k="Ersparnis im Jahr"
                    a={eurKurz(geplant.vergleich.mit.ersparnisJahr1)}
                    b={eurKurz(geplant.vergleich.ohne.ersparnisJahr1)}
                  />
                  <Text style={[s.kleingedruckt, { marginTop: 10 }]}>
                    Der Speicher kostet {eurKurz(geplant.vergleich.preis)} und hebt die Autarkie
                    um {Math.round(geplant.vergleich.mehrAutarkie * 100)} Punkte. Er spart{" "}
                    {eurKurz(geplant.vergleich.mehrErsparnisJahr)} im Jahr, weil{" "}
                    {zahl(Math.round(geplant.vergleich.wenigerNetzbezugKwh))} kWh weniger aus dem
                    Netz kommen.
                  </Text>
                </View>
              ) : null}
            </View>

            <PlanFuss firma={data.firma.name} />
          </Page>
        </>
      ) : null}
    </Document>
  );
}

const MONATE = ["Jän", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];

/*
 * Die Bausteine der Planungsseiten.
 *
 * Sie stehen hier und nicht in der Seite selbst, weil jede der drei
 * Seiten denselben Kopf, denselben Fuss und dieselben Bilder braucht —
 * und weil eine Seite mit vierhundert Zeilen JSX niemand mehr liest.
 */

function PlanKopf({ data, nummer }: { data: VorgangPdfData; nummer: string }) {
  return (
    <View style={s.kopf} fixed>
      <View>
        {data.marke.logoUrl ? (
          /* eslint-disable-next-line jsx-a11y/alt-text -- @react-pdf/Image ist kein <img> */
          <Image src={data.marke.logoUrl} style={s.logo} />
        ) : (
          <Text style={s.firmaName}>{data.firma.name}</Text>
        )}
      </View>
      <View style={s.firmaZeile}>
        <Text>
          {nummer} · {data.kunde.name}
        </Text>
      </View>
    </View>
  );
}

function PlanFuss({ firma }: { firma: string }) {
  return (
    <View style={s.fuss} fixed>
      <Text style={{ flex: 1 }}>
        {firma} · Richtwerte aus der Planung, keine Zusage über den Ertrag
      </Text>
      <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
    </View>
  );
}

/** Ein waagrechtes Band, in Anteilen eingefärbt. */
function Flussband({ teile }: { teile: Array<{ wert: number; farbe: string }> }) {
  const gesamt = teile.reduce((a, t) => a + Math.max(0, t.wert), 0) || 1;
  return (
    <View style={s.flussBahn}>
      {teile.map((t, i) => {
        const anteil = Math.max(0, t.wert) / gesamt;
        return (
          <View
            key={i}
            style={[s.flussTeil, { width: `${anteil * 100}%`, backgroundColor: t.farbe }]}
          >
            {/* Unter acht Prozent ist kein Platz für eine Zahl. */}
            {anteil > 0.08 ? (
              <Text style={s.flussProzent}>{Math.round(anteil * 100)} %</Text>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

function Legende({
  eintraege,
}: {
  akzent: string;
  eintraege: Array<[string, string]>;
}) {
  return (
    <View style={s.legende}>
      {eintraege.map(([text, farbe]) => (
        <View key={text} style={s.legendePunkt}>
          <View style={[s.legendeKlecks, { backgroundColor: farbe }]} />
          <Text style={s.legendeText}>{text}</Text>
        </View>
      ))}
    </View>
  );
}

/**
 * Die kumulierte Ersparnis als Säulen.
 *
 * Rot, solange die Anlage nicht bezahlt ist, danach grün — dasselbe
 * Bild, das der Betrieb aus anderen Angeboten kennt. Die Nulllinie
 * liegt dort, wo der Wechsel passiert.
 */
function Kurve({
  kurve,
  start,
  akzent,
}: {
  kurve: number[];
  start: number;
  akzent: string;
}) {
  if (kurve.length === 0) return null;
  const hoch = Math.max(...kurve, 0);
  const tief = Math.min(...kurve, 0);
  const spanne = hoch - tief || 1;
  const nulllinie = (hoch / spanne) * 88;

  return (
    <>
      <View style={s.kurveReihe}>
        {/*
          Die Nulllinie: ohne sie schweben die roten Balken, und man
          sieht nicht, wo der Wechsel passiert.
        */}
        <View
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 88 - nulllinie,
            height: 0.7,
            backgroundColor: LINIE,
          }}
        />
        {kurve.map((wert, i) => {
          const hoehe = (Math.abs(wert) / spanne) * 88;
          return (
            <View key={i} style={s.kurveSaeule}>
              {wert >= 0 ? (
                <View
                  style={{
                    width: "72%",
                    height: hoehe,
                    backgroundColor: TINTE,
                    borderRadius: 1.5,
                    marginBottom: 88 - nulllinie,
                  }}
                />
              ) : (
                <View
                  style={{
                    width: "72%",
                    height: hoehe,
                    backgroundColor: akzent,
                    borderRadius: 1.5,
                    marginBottom: 88 - nulllinie - hoehe,
                  }}
                />
              )}
            </View>
          );
        })}
      </View>
      <View style={{ flexDirection: "row", gap: 2 }}>
        {kurve.map((_, i) => (
          <Text key={i} style={[s.kurveJahr, { flex: 1, textAlign: "center" }]}>
            {/* Nur jedes fünfte Jahr beschriften, sonst klebt alles aneinander. */}
            {i === 0 || (i + 1) % 5 === 0 ? start + i : " "}
          </Text>
        ))}
      </View>
    </>
  );
}

/* ── Bausteine der Planungsseiten, nach der Vorlage ───────────────── */

function Kapitel({ children }: { children: string }) {
  return <Text style={s.kapitel}>{children.toUpperCase()}</Text>;
}

/** Kennzahl unter einer Haarlinie — genau eine je Reihe im Akzent. */
function Kennsaeule({
  zahl,
  label,
  akzent,
}: {
  zahl: string;
  label: string;
  akzent?: string;
}) {
  return (
    <View style={akzent ? [s.kennsaeuleAkzent, { borderTopColor: akzent }] : s.kennsaeule}>
      <Text style={akzent ? [s.kennzahl, { color: akzent }] : s.kennzahl}>{zahl}</Text>
      <Text style={s.kennlabel2}>{label.toUpperCase()}</Text>
    </View>
  );
}

function Wertreihe({ k, v }: { k: string; v: string }) {
  return (
    <View style={s.wertreihe}>
      <Text style={s.wertLabel}>{k.toUpperCase()}</Text>
      <Text style={s.wertText}>{v}</Text>
    </View>
  );
}

/** Anteilsband mit Prozent, Name und Menge darunter. */
function Anteilsband({
  teile,
}: {
  teile: Array<{ wert: number; farbe: string; name: string }>;
}) {
  const gesamt = teile.reduce((a, t) => a + Math.max(0, t.wert), 0) || 1;
  const breit = (w: number) => `${(Math.max(0, w) / gesamt) * 100}%`;
  return (
    <>
      <View style={s.anteilBand}>
        {teile.map((t) => (
          <View key={t.name} style={{ width: breit(t.wert), backgroundColor: t.farbe }} />
        ))}
      </View>
      <View style={s.anteilFuss}>
        {teile.map((t) => (
          <View key={t.name} style={{ width: breit(t.wert), paddingRight: 6 }}>
            <Text style={s.anteilProzent}>
              {Math.round((Math.max(0, t.wert) / gesamt) * 100)} %
            </Text>
            <Text style={s.anteilName}>{t.name}</Text>
            <Text style={s.anteilMenge}>{zahl(Math.round(t.wert))} kWh</Text>
          </View>
        ))}
      </View>
    </>
  );
}

/**
 * Der Energiefluss als Sankey — dieselben vier Bänder wie im Portal.
 *
 * Breite gleich Strommenge: Wer das Bild sieht, versteht ohne Legende,
 * wohin der grösste Teil geht.
 */
function SankeyPdf({
  akzent,
  direkt,
  speicher,
  einspeisung,
  netzbezug,
  produktion,
  verbrauch,
}: {
  akzent: string;
  direkt: number;
  speicher: number;
  einspeisung: number;
  netzbezug: number;
  produktion: number;
  verbrauch: number;
}) {
  const B = 1000;
  const H = 300;
  const stab = 10;
  const x1 = stab;
  const x2 = B - stab;
  const m = B / 2;

  const gesamt = Math.max(produktion, verbrauch + einspeisung, 1);
  const px = (kwh: number) => (Math.max(0, kwh) / gesamt) * H;

  const hD = px(direkt);
  const hS = px(speicher);
  const hE = px(einspeisung);
  const hN = px(netzbezug);

  const ausD = 0;
  const ausS = hD;
  const ausE = hD + hS;
  const ausN = ausE + hE;

  const einD = 0;
  const einS = hD;
  const einN = hD + hS;
  const einNetz = einN + hN;

  const band = (y1: number, y2: number, h: number) =>
    `M${x1},${y1} C${m},${y1} ${m},${y2} ${x2},${y2} L${x2},${y2 + h} C${m},${y2 + h} ${m},${y1 + h} ${x1},${y1 + h} Z`;

  return (
    <Svg viewBox={`0 0 ${B} ${H}`} style={{ width: "100%", height: 150, marginTop: 8 }}>
      <Path d={band(ausD, einD, hD)} fill={akzent} fillOpacity={0.9} />
      <Path d={band(ausS, einS, hS)} fill={TINTE} fillOpacity={0.8} />
      <Path d={band(ausE, einNetz, hE)} fill="#C9C5BC" fillOpacity={0.75} />
      <Path d={band(ausN, einN, hN)} fill={NETZFARBE} fillOpacity={0.75} />

      <Rect x={0} y={0} width={stab} height={hD + hS + hE} fill={akzent} />
      <Rect x={0} y={ausN} width={stab} height={hN} fill={NETZFARBE} />
      <Rect x={B - stab} y={0} width={stab} height={hD + hS + hN} fill={TINTE} />
      <Rect x={B - stab} y={einNetz} width={stab} height={hE} fill="#C9C5BC" />
    </Svg>
  );
}

function Vergleichszeile({ k, a, b }: { k: string; a: string; b: string }) {
  return (
    <View style={s.vglZeile}>
      <Text style={s.vglSache}>{k}</Text>
      <Text style={s.vglWert}>{a}</Text>
      <Text style={[s.vglWert, { color: LEISE }]}>{b}</Text>
    </View>
  );
}


/**
 * Himmelsrichtung aus dem Azimut — 180° ist Süden.
 *
 * Dieselbe Umrechnung wie im Planungs-PDF: „Süd-West" sagt einem Kunden
 * etwas, „218°" nicht.
 */
function himmelsrichtung(azimut: number): string {
  const namen = ["Nord", "Nord-Ost", "Ost", "Süd-Ost", "Süd", "Süd-West", "West", "Nord-West"];
  const i = Math.round(((azimut % 360) + 360) % 360 / 45) % 8;
  return namen[i]!;
}

function Wertzeile({ k, v }: { k: string; v: string }) {
  return (
    <View style={s.wertZeile}>
      <Text style={s.wertK}>{k}</Text>
      <Text style={s.wertV}>{v}</Text>
    </View>
  );
}

function Summenzeile({ label, wert }: { label: string; wert: string }) {
  return (
    <View style={s.summe}>
      <Text style={s.summeLabel}>{label}</Text>
      <Text style={s.summeWert}>{wert}</Text>
    </View>
  );
}
