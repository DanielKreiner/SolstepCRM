import {
  Document,
  Image,
  Page,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";

/*
 * Ein Beleg zum Vorgang — Angebot, Auftragsbestätigung oder Rechnung.
 *
 * Drei Belege aus einer Vorlage, weil sie dieselben Positionen tragen und
 * sich nur in Überschrift, Fusstext und Summenblock unterscheiden. Drei
 * getrennte Vorlagen wären dreimal derselbe Briefkopf, der beim nächsten
 * Logowechsel an zwei Stellen vergessen wird.
 *
 * CLAUDE.md 6.4 gilt weiter: beim Angebot steht der technische Teil ohne
 * Preise voran, der Preisteil folgt als eigener Block. Der Grund ist
 * praktisch — der technische Teil wandert zum Elektriker, zur
 * Netzanmeldung und aufs Dach, dort haben Preise nichts verloren.
 */

export type BelegArt = "angebot" | "ab" | "anzahlungsrechnung" | "schlussrechnung";

export type VorgangPdfData = {
  art: BelegArt;
  /** Vorgangsnummer — bei Angebot und AB zugleich die Belegnummer. */
  vorgangNummer: string;
  /** Rechnungsnummer, nur bei Rechnungen. */
  belegNummer: string | null;
  erstelltAm: string;
  gueltigBis: string | null;
  faelligAm: string | null;
  firma: {
    name: string;
    adresse: string | null;
    plz: string | null;
    ort: string | null;
    uid: string | null;
    iban: string | null;
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
  positionen: {
    pos: number;
    text: string;
    menge: number;
    einheit: string;
    epNetto: number;
    ustSatz: number;
    bildUrl?: string | undefined;
  }[];
  /** Bei Rechnungen: was schon angezahlt wurde. */
  abzugBrutto: number | null;
  /** Bei Rechnungen der geforderte Betrag; sonst null. */
  forderungBrutto: number | null;
};

const TITEL: Record<BelegArt, string> = {
  angebot: "Angebot",
  ab: "Auftragsbestätigung",
  anzahlungsrechnung: "Anzahlungsrechnung",
  schlussrechnung: "Schlussrechnung",
};

const s = StyleSheet.create({
  page: {
    paddingTop: 46,
    paddingBottom: 56,
    paddingHorizontal: 48,
    fontSize: 9.5,
    color: "#151210",
    fontFamily: "Helvetica",
  },
  kopf: { flexDirection: "row", justifyContent: "space-between", marginBottom: 26 },
  firma: { fontSize: 8.5, color: "#6A625A", textAlign: "right", lineHeight: 1.5 },
  h1: { fontSize: 20, marginBottom: 2 },
  klein: { fontSize: 8.5, color: "#6A625A" },
  h2: { fontSize: 12, marginTop: 20, marginBottom: 6 },
  zeile: { flexDirection: "row", paddingVertical: 5 },
  trenner: { borderBottomWidth: 0.5, borderBottomColor: "#EAE4DC" },
  cPos: { width: 26, color: "#9C9289" },
  cBild: { width: 30, height: 30, marginRight: 6, objectFit: "contain" },
  cText: { flex: 1, paddingRight: 8 },
  cMenge: { width: 62, textAlign: "right" },
  cPreis: { width: 66, textAlign: "right" },
  cSumme: { width: 74, textAlign: "right" },
  kopfzeile: { fontSize: 8, color: "#9C9289", textTransform: "uppercase" },
  summe: { flexDirection: "row", justifyContent: "flex-end", paddingVertical: 3 },
  summeLabel: { width: 120, textAlign: "right", marginRight: 12 },
  summeWert: { width: 90, textAlign: "right" },
  fuss: {
    position: "absolute",
    bottom: 28,
    left: 48,
    right: 48,
    fontSize: 7.5,
    color: "#9C9289",
    borderTopWidth: 0.5,
    borderTopColor: "#EAE4DC",
    paddingTop: 6,
  },
});

const eur = (n: number) =>
  `${n.toLocaleString("de-AT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

const dat = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("de-AT") : "—";

export function VorgangPdf({ data }: { data: VorgangPdfData }) {
  const istRechnung =
    data.art === "anzahlungsrechnung" || data.art === "schlussrechnung";

  const netto = data.positionen.reduce(
    (a, p) => a + Math.round(p.menge * p.epNetto * 100) / 100,
    0,
  );
  const ust = data.positionen.reduce(
    (a, p) =>
      a + Math.round(((p.menge * p.epNetto * p.ustSatz) / 100) * 100) / 100,
    0,
  );
  const brutto = Math.round((netto + ust) * 100) / 100;

  const nummer = data.belegNummer ?? data.vorgangNummer;

  return (
    <Document>
      <Page size="A4" style={s.page}>
        <View style={s.kopf}>
          <View>
            <Text style={s.h1}>{TITEL[data.art]}</Text>
            <Text style={s.klein}>
              {nummer} · {dat(data.erstelltAm)}
            </Text>
            {/*
              Die Vorgangsnummer steht auf jedem Beleg, auch wenn er eine
              eigene Rechnungsnummer trägt. Ein Kunde, der wegen der
              Rechnung anruft, nennt eine Nummer — und im Betrieb soll
              damit sofort der ganze Vorgang auffindbar sein.
            */}
            {data.belegNummer ? (
              <Text style={s.klein}>zum Vorgang {data.vorgangNummer}</Text>
            ) : null}
          </View>
          <View style={s.firma}>
            <Text>{data.firma.name}</Text>
            {data.firma.adresse ? <Text>{data.firma.adresse}</Text> : null}
            <Text>
              {[data.firma.plz, data.firma.ort].filter(Boolean).join(" ")}
            </Text>
            {data.firma.uid ? <Text>UID {data.firma.uid}</Text> : null}
          </View>
        </View>

        {/* Empfänger */}
        <View style={{ marginBottom: 18 }}>
          <Text style={{ fontSize: 11 }}>{data.kunde.name}</Text>
          {data.kunde.kontakt ? (
            <Text style={s.klein}>{data.kunde.kontakt}</Text>
          ) : null}
          {data.kunde.adresse ? <Text>{data.kunde.adresse}</Text> : null}
          <Text>{[data.kunde.plz, data.kunde.ort].filter(Boolean).join(" ")}</Text>
        </View>

        {/* Anlage */}
        {data.anlage.kwp || data.anlage.adresse ? (
          <View style={{ marginBottom: 6 }}>
            <Text style={s.klein}>
              {[
                data.anlage.kwp ? `${data.anlage.kwp} kWp` : null,
                data.anlage.speicherKwh
                  ? `${data.anlage.speicherKwh} kWh Speicher`
                  : null,
                data.anlage.adresse ? `Standort ${data.anlage.adresse}` : null,
                data.anlage.zaehlpunkt
                  ? `Zählpunkt ${data.anlage.zaehlpunkt}`
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </Text>
          </View>
        ) : null}

        {/* Technischer Teil ohne Preise — nur beim Angebot. */}
        {data.art === "angebot" ? (
          <>
            <Text style={s.h2}>Leistungsumfang</Text>
            <View style={[s.zeile, s.trenner]}>
              <Text style={[s.cPos, s.kopfzeile]}>Pos</Text>
              <Text style={[s.cText, s.kopfzeile]}>Leistung</Text>
              <Text style={[s.cMenge, s.kopfzeile]}>Menge</Text>
            </View>
            {data.positionen.map((p) => (
              <View
                key={`t-${p.pos}`}
                style={[s.zeile, s.trenner, { alignItems: "center" }]}
              >
                <Text style={s.cPos}>{p.pos}</Text>
                {p.bildUrl ? (
                  /* eslint-disable-next-line jsx-a11y/alt-text --
                     @react-pdf/Image ist kein <img>; alt gibt es dort nicht. */
                  <Image src={p.bildUrl} style={s.cBild} />
                ) : null}
                <Text style={s.cText}>{p.text}</Text>
                <Text style={s.cMenge}>
                  {p.menge.toLocaleString("de-AT")} {p.einheit}
                </Text>
              </View>
            ))}
          </>
        ) : null}

        {/* Preisteil */}
        <Text style={s.h2}>
          {data.art === "angebot" ? "Preise" : "Positionen"}
        </Text>
        <View style={[s.zeile, s.trenner]}>
          <Text style={[s.cPos, s.kopfzeile]}>Pos</Text>
          <Text style={[s.cText, s.kopfzeile]}>Leistung</Text>
          <Text style={[s.cMenge, s.kopfzeile]}>Menge</Text>
          <Text style={[s.cPreis, s.kopfzeile]}>Einzel</Text>
          <Text style={[s.cSumme, s.kopfzeile]}>Summe</Text>
        </View>
        {data.positionen.map((p) => (
          <View key={`p-${p.pos}`} style={[s.zeile, s.trenner]}>
            <Text style={s.cPos}>{p.pos}</Text>
            <Text style={s.cText}>{p.text}</Text>
            <Text style={s.cMenge}>
              {p.menge.toLocaleString("de-AT")} {p.einheit}
            </Text>
            <Text style={s.cPreis}>{eur(p.epNetto)}</Text>
            <Text style={s.cSumme}>{eur(p.menge * p.epNetto)}</Text>
          </View>
        ))}

        <View style={{ marginTop: 10 }}>
          <Summenzeile label="Netto" wert={eur(netto)} />
          <Summenzeile label="Umsatzsteuer" wert={eur(ust)} />
          <Summenzeile label="Brutto" wert={eur(brutto)} fett />

          {data.abzugBrutto !== null && data.abzugBrutto > 0 ? (
            <Summenzeile
              label="abzüglich Anzahlung"
              wert={`− ${eur(data.abzugBrutto)}`}
            />
          ) : null}

          {istRechnung && data.forderungBrutto !== null ? (
            <Summenzeile
              label="Zahlbetrag"
              wert={eur(data.forderungBrutto)}
              fett
            />
          ) : null}
        </View>

        {/* Belegspezifischer Schlusstext */}
        <View style={{ marginTop: 18 }}>
          {data.art === "angebot" ? (
            <Text style={s.klein}>
              Gültig bis {dat(data.gueltigBis)}. Preise in Euro, zuzüglich
              Umsatzsteuer wie ausgewiesen. Der Leistungsumfang gilt
              vorbehaltlich der Machbarkeit vor Ort.
            </Text>
          ) : null}
          {data.art === "ab" ? (
            <Text style={s.klein}>
              Wir bestätigen den Auftrag zu den oben genannten Bedingungen.
              Die Auftragsnummer entspricht der Vorgangsnummer und gilt für
              alle weiteren Belege.
            </Text>
          ) : null}
          {istRechnung ? (
            <Text style={s.klein}>
              Zahlbar bis {dat(data.faelligAm)} ohne Abzug auf
              {data.firma.iban ? ` IBAN ${data.firma.iban}` : " das bekannte Konto"}.
              Bitte die Rechnungsnummer als Verwendungszweck angeben.
              {"\n"}
              Leistungszeitraum: siehe Auftragsbestätigung {data.vorgangNummer}.
            </Text>
          ) : null}
        </View>

        <Text style={s.fuss} fixed>
          {[
            data.firma.name,
            [data.firma.adresse, data.firma.plz, data.firma.ort]
              .filter(Boolean)
              .join(", "),
            data.firma.uid ? `UID ${data.firma.uid}` : null,
            data.firma.iban ? `IBAN ${data.firma.iban}` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </Text>
      </Page>
    </Document>
  );
}

function Summenzeile({
  label,
  wert,
  fett = false,
}: {
  label: string;
  wert: string;
  fett?: boolean;
}) {
  return (
    <View style={s.summe}>
      <Text style={[s.summeLabel, fett ? { fontSize: 11 } : {}]}>{label}</Text>
      <Text style={[s.summeWert, fett ? { fontSize: 11 } : {}]}>{wert}</Text>
    </View>
  );
}
