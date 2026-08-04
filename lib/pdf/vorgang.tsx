import {
  Document,
  Image,
  Page,
  StyleSheet,
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
  bildUrl?: string | undefined;
};

export type PdfGruppe = {
  id: string;
  name: string;
  beschreibung: string | null;
  paketPreis: number | null;
  einzelpreiseVerstecken: boolean;
};

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
    optional: p.optional,
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
   * Rund 1000 kWh je kWp im Jahr — grober Mittelwert für Österreich und
   * Süddeutschland. Steht als Schätzung da und nicht als Zusage; eine
   * genaue Zahl käme aus der Planung und nicht aus einer Faustformel.
   */
  const ertrag = data.anlage.kwp ? Math.round(data.anlage.kwp * 1000) : null;

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
                  <Text style={s.kennlabel}>Ertrag im Jahr, geschätzt</Text>
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
    </Document>
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
