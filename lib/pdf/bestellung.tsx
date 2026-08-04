import {
  Document,
  Image,
  Page,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";

/**
 * Das Bestell-PDF.
 *
 * Es entsteht beim Statuswechsel entwurf → bestellt und wird an der
 * Bestellung archiviert — auch wenn telefonisch bestellt oder beim
 * Grosshändler abgeholt wurde. Dann ist es kein Anschreiben, sondern der
 * Beleg dafür, was vereinbart war.
 *
 * Gleicher Briefkopf wie Angebot und Rechnung: der Lieferant soll auf
 * einen Blick sehen, von wem die Bestellung kommt. Keine Preise in der
 * Positionsliste — bestellt wird nach Artikel und Menge; der Preis steht
 * im Rahmenvertrag und nicht im Bestellschein.
 */

export type BestellPosition = {
  bezeichnung: string;
  artikelnummer: string | null;
  lieferantenNummer: string | null;
  menge: number;
  einheit: string;
  vorgangNummer: string | null;
};

export type BestellPdfData = {
  nummer: string;
  erstelltAm: string;
  wunschtermin: string | null;
  abholung: boolean;
  externBestellt: boolean;
  notiz: string | null;
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
  lieferant: {
    name: string;
    email: string | null;
    kundennummer: string | null;
  } | null;
  lieferadresse: {
    label: string;
    zeilen: string[];
  };
  positionen: BestellPosition[];
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
  kopf: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 22,
  },
  logo: { height: 34, objectFit: "contain" },
  firmaName: { fontSize: 15, fontFamily: "Helvetica-Bold", letterSpacing: -0.3 },
  firmaZeile: { fontSize: 8, color: ZART, textAlign: "right", lineHeight: 1.55 },

  h1: { fontSize: 26, fontFamily: "Helvetica-Bold", letterSpacing: -0.8 },
  bandStrich: { height: 3, marginTop: 8, marginBottom: 14, width: 54 },
  meta: { fontSize: 9, color: LEISE },

  spalten: { flexDirection: "row", justifyContent: "space-between", marginBottom: 20 },
  spalte: { flex: 1, paddingRight: 14 },
  label: {
    fontSize: 7,
    color: ZART,
    letterSpacing: 0.9,
    marginBottom: 3,
    fontFamily: "Helvetica-Bold",
  },
  stark: { fontSize: 11.5, fontFamily: "Helvetica-Bold" },
  zeileText: { fontSize: 9.5 },

  kopfzeile: {
    flexDirection: "row",
    paddingBottom: 5,
    borderBottomWidth: 1,
    borderBottomColor: LINIE,
    marginTop: 6,
  },
  zeile: {
    flexDirection: "row",
    paddingVertical: 6,
    borderBottomWidth: 0.5,
    borderBottomColor: LINIE,
  },
  spPos: { width: 26, fontSize: 8, color: ZART },
  spText: { flex: 1, paddingRight: 10 },
  spNr: { width: 96, fontSize: 8, color: LEISE },
  spMenge: { width: 62, textAlign: "right" },
  spEinheit: { width: 40, paddingLeft: 6, fontSize: 8, color: LEISE },
  kopfText: { fontSize: 7, color: ZART, letterSpacing: 0.9, fontFamily: "Helvetica-Bold" },

  kasten: {
    backgroundColor: FLAECHE,
    borderRadius: 8,
    padding: 12,
    marginTop: 18,
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

const zahl = (n: number) => n.toLocaleString("de-AT", { maximumFractionDigits: 3 });
const dat = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("de-AT") : "—";

export function BestellungPdf({ data }: { data: BestellPdfData }) {
  const akzent = data.marke.akzent;

  return (
    <Document
      title={`Bestellung ${data.nummer}`}
      author={data.firma.name}
      creator={data.firma.name}
    >
      <Page size="A4" style={s.page}>
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
          </View>
        </View>

        <Text style={[s.h1, { color: akzent }]}>Bestellung</Text>
        <View style={[s.bandStrich, { backgroundColor: akzent }]} />

        <Text style={s.meta}>
          {data.nummer} · {dat(data.erstelltAm)}
          {data.wunschtermin ? ` · Wunschtermin ${dat(data.wunschtermin)}` : ""}
          {data.abholung ? " · Abholung" : ""}
        </Text>

        <View style={[s.spalten, { marginTop: 18 }]}>
          <View style={s.spalte}>
            <Text style={s.label}>AN</Text>
            <Text style={s.stark}>{data.lieferant?.name ?? "—"}</Text>
            {data.lieferant?.kundennummer ? (
              <Text style={{ color: LEISE }}>
                Kundennummer {data.lieferant.kundennummer}
              </Text>
            ) : null}
            {data.lieferant?.email ? <Text>{data.lieferant.email}</Text> : null}
          </View>

          <View style={s.spalte}>
            <Text style={s.label}>{data.lieferadresse.label.toUpperCase()}</Text>
            {data.lieferadresse.zeilen.map((z, i) => (
              <Text key={i} style={i === 0 ? s.stark : s.zeileText}>
                {z}
              </Text>
            ))}
          </View>
        </View>

        <View style={s.kopfzeile}>
          <Text style={[s.spPos, s.kopfText]}>NR</Text>
          <Text style={[s.spText, s.kopfText]}>ARTIKEL</Text>
          <Text style={[s.spNr, s.kopfText]}>ARTIKELNUMMER</Text>
          <Text style={[s.spMenge, s.kopfText]}>MENGE</Text>
          <Text style={[s.spEinheit, s.kopfText]}> </Text>
        </View>

        {data.positionen.map((p, i) => (
          <View key={i} style={s.zeile} wrap={false}>
            <Text style={s.spPos}>{i + 1}</Text>
            <View style={s.spText}>
              <Text>{p.bezeichnung}</Text>
              {p.vorgangNummer ? (
                <Text style={{ fontSize: 7.5, color: ZART }}>
                  für {p.vorgangNummer}
                </Text>
              ) : null}
            </View>
            {/*
              Die Nummer des Lieferanten steht vorn, wenn sie gepflegt
              ist — danach sucht er in seinem System, nicht nach unserer.
            */}
            <Text style={s.spNr}>
              {p.lieferantenNummer ?? p.artikelnummer ?? "—"}
            </Text>
            <Text style={s.spMenge}>{zahl(p.menge)}</Text>
            <Text style={s.spEinheit}>{p.einheit}</Text>
          </View>
        ))}

        {data.notiz ? (
          <View style={s.kasten}>
            <Text>{data.notiz}</Text>
          </View>
        ) : null}

        {data.externBestellt || data.abholung ? (
          <View style={s.kasten}>
            <Text>
              {data.abholung
                ? "Abholung beim Grosshändler — dieses Blatt dient als Beleg, nicht als Anschreiben."
                : "Bereits ausserhalb dieses Systems bestellt — dieses Blatt dient als Beleg."}
            </Text>
          </View>
        ) : null}

        <View style={s.fuss} fixed>
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
            ]
              .filter(Boolean)
              .join(" · ")}
          </Text>
          <Text
            render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`}
          />
        </View>
      </Page>
    </Document>
  );
}
