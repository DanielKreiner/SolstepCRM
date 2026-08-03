import {
  Document,
  Image,
  Page,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";

/*
 * Angebots-PDF.
 *
 * CLAUDE.md 6.4: technischer Teil OHNE Preise, Preisteil als separater Block.
 * Der Grund ist praktisch — der technische Teil wandert zum Elektriker, zur
 * Netzanmeldung und aufs Dach; dort haben Einkaufspreise nichts verloren.
 */

export type QuotePdfData = {
  number: string;
  company: {
    name: string;
    address: string | null;
    zip: string | null;
    city: string | null;
    uid: string | null;
    iban: string | null;
  };
  customer: {
    name: string;
    contact: string | null;
    address: string | null;
    zip: string | null;
    city: string | null;
  };
  validUntil: string | null;
  createdAt: string;
  plant: {
    kwp?: number | undefined;
    speicher?: number | undefined;
    module?: string | undefined;
    wechselrichter?: string | undefined;
    ertrag?: number | undefined;
    co2?: number | undefined;
  } | null;
  items: {
    pos: number;
    text: string;
    qty: number;
    unit: string;
    salePrice: number;
    vatRate: number;
    /* Nur im technischen Teil, und nur https — siehe Route. */
    imageUrl?: string | undefined;
  }[];
  netTotal: number;
};

const s = StyleSheet.create({
  page: {
    paddingTop: 46,
    paddingBottom: 56,
    paddingHorizontal: 48,
    fontSize: 9.5,
    lineHeight: 1.45,
    color: "#151210",
    fontFamily: "Helvetica",
  },
  kopf: { flexDirection: "row", justifyContent: "space-between", marginBottom: 26 },
  firma: { fontSize: 13, fontWeight: 700 },
  klein: { fontSize: 8.5, color: "#6A625A" },
  h1: { fontSize: 17, fontWeight: 700, marginBottom: 2 },
  h2: {
    fontSize: 10.5,
    fontWeight: 700,
    marginTop: 18,
    marginBottom: 7,
    paddingBottom: 4,
    borderBottomWidth: 0.7,
    borderBottomColor: "#EAE4DC",
  },
  block: { marginBottom: 4 },
  zeile: { flexDirection: "row", paddingVertical: 3.5 },
  trenner: { borderBottomWidth: 0.5, borderBottomColor: "#EAE4DC" },
  cPos: { width: 24, color: "#9C9289" },
  cText: { flex: 1, paddingRight: 8 },
  cBild: { width: 34, height: 34, marginRight: 6, objectFit: "contain" },
  cMenge: { width: 62, textAlign: "right" },
  cPreis: { width: 66, textAlign: "right" },
  cSumme: { width: 74, textAlign: "right" },
  kopfzeile: { fontSize: 8, color: "#9C9289", textTransform: "uppercase" },
  summe: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 0.7,
    borderTopColor: "#151210",
  },
  summeLabel: { fontSize: 11, fontWeight: 700, marginRight: 14 },
  fuss: {
    position: "absolute",
    bottom: 26,
    left: 48,
    right: 48,
    fontSize: 7.5,
    color: "#9C9289",
    borderTopWidth: 0.5,
    borderTopColor: "#EAE4DC",
    paddingTop: 6,
  },
  daten: { flexDirection: "row", flexWrap: "wrap" },
  datenPaar: { width: "50%", paddingVertical: 2, flexDirection: "row" },
  datenLabel: { width: 96, color: "#6A625A" },
});

const eur = (n: number) =>
  new Intl.NumberFormat("de-AT", {
    style: "currency",
    currency: "EUR",
  }).format(n);

const datum = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("de-AT") : "—";

export function QuotePdf({ data }: { data: QuotePdfData }) {
  const anlage = data.plant;

  return (
    <Document
      title={`Angebot ${data.number}`}
      author={data.company.name}
      language="de-AT"
    >
      <Page size="A4" style={s.page}>
        <View style={s.kopf}>
          <View>
            <Text style={s.firma}>{data.company.name}</Text>
            <Text style={s.klein}>
              {[
                data.company.address,
                [data.company.zip, data.company.city].filter(Boolean).join(" "),
              ]
                .filter(Boolean)
                .join(", ")}
            </Text>
            {data.company.uid ? (
              <Text style={s.klein}>UID {data.company.uid}</Text>
            ) : null}
          </View>
          <View>
            <Text style={s.h1}>Angebot</Text>
            <Text style={s.klein}>{data.number}</Text>
            <Text style={s.klein}>vom {datum(data.createdAt)}</Text>
            {data.validUntil ? (
              <Text style={s.klein}>gültig bis {datum(data.validUntil)}</Text>
            ) : null}
          </View>
        </View>

        <View style={s.block}>
          <Text style={s.klein}>Angebot für</Text>
          <Text style={{ fontWeight: 700 }}>{data.customer.name}</Text>
          {data.customer.contact ? (
            <Text>{data.customer.contact}</Text>
          ) : null}
          <Text>
            {[
              data.customer.address,
              [data.customer.zip, data.customer.city].filter(Boolean).join(" "),
            ]
              .filter(Boolean)
              .join(", ")}
          </Text>
        </View>

        {/* --- Technischer Teil: bewusst ohne Preise --- */}
        <Text style={s.h2}>Anlage und Umfang</Text>

        {anlage ? (
          <View style={s.daten}>
            {anlage.kwp ? (
              <Datenpaar label="Leistung" wert={`${anlage.kwp} kWp`} />
            ) : null}
            {anlage.speicher ? (
              <Datenpaar label="Speicher" wert={`${anlage.speicher} kWh`} />
            ) : null}
            {anlage.module ? (
              <Datenpaar label="Module" wert={anlage.module} />
            ) : null}
            {anlage.wechselrichter ? (
              <Datenpaar label="Wechselrichter" wert={anlage.wechselrichter} />
            ) : null}
            {anlage.ertrag ? (
              <Datenpaar
                label="Ertrag"
                wert={`rund ${Math.round(anlage.ertrag).toLocaleString("de-AT")} kWh im Jahr`}
              />
            ) : null}
            {anlage.co2 ? (
              <Datenpaar
                label="CO₂-Ersparnis"
                wert={`rund ${Math.round(anlage.co2).toLocaleString("de-AT")} kg im Jahr`}
              />
            ) : null}
          </View>
        ) : (
          <Text style={s.klein}>Keine Planungsdaten hinterlegt.</Text>
        )}

        <View style={{ marginTop: 10 }}>
          <View style={[s.zeile, s.trenner]}>
            <Text style={[s.cPos, s.kopfzeile]}>Pos</Text>
            <Text style={[s.cText, s.kopfzeile]}>Leistung</Text>
            <Text style={[s.cMenge, s.kopfzeile]}>Menge</Text>
          </View>
          {/*
            Bilder stehen im technischen Teil, nicht im Preisteil: dort
            soll der Kunde sehen, was verbaut wird. Der Preisteil bleibt
            eine Liste (CLAUDE.md 6.4).
          */}
          {data.items.map((it) => (
            <View
              key={it.pos}
              style={[s.zeile, s.trenner, { alignItems: "center" }]}
            >
              <Text style={s.cPos}>{it.pos}</Text>
              {it.imageUrl ? (
                /* eslint-disable-next-line jsx-a11y/alt-text --
                   @react-pdf/Image ist kein <img>; alt gibt es dort nicht. */
                <Image src={it.imageUrl} style={s.cBild} />
              ) : null}
              <Text style={s.cText}>{it.text}</Text>
              <Text style={s.cMenge}>
                {it.qty.toLocaleString("de-AT")} {it.unit}
              </Text>
            </View>
          ))}
        </View>

        {/* --- Preisteil: eigener Block --- */}
        <Text style={s.h2}>Preise</Text>
        <View>
          <View style={[s.zeile, s.trenner]}>
            <Text style={[s.cPos, s.kopfzeile]}>Pos</Text>
            <Text style={[s.cText, s.kopfzeile]}>Leistung</Text>
            <Text style={[s.cMenge, s.kopfzeile]}>Menge</Text>
            <Text style={[s.cPreis, s.kopfzeile]}>Einzel</Text>
            <Text style={[s.cSumme, s.kopfzeile]}>Summe</Text>
          </View>
          {data.items.map((it) => (
            <View key={it.pos} style={[s.zeile, s.trenner]}>
              <Text style={s.cPos}>{it.pos}</Text>
              <Text style={s.cText}>{it.text}</Text>
              <Text style={s.cMenge}>
                {it.qty.toLocaleString("de-AT")} {it.unit}
              </Text>
              <Text style={s.cPreis}>{eur(it.salePrice)}</Text>
              <Text style={s.cSumme}>{eur(it.qty * it.salePrice)}</Text>
            </View>
          ))}
        </View>

        <View style={s.summe}>
          <Text style={s.summeLabel}>Gesamt netto</Text>
          <Text style={[s.summeLabel, { marginRight: 0 }]}>
            {eur(data.netTotal)}
          </Text>
        </View>
        <Text style={[s.klein, { textAlign: "right", marginTop: 2 }]}>
          Alle Beträge exkl. USt.
        </Text>

        <View style={s.fuss} fixed>
          <Text>
            {data.company.name}
            {data.company.iban ? ` · IBAN ${data.company.iban}` : ""}
            {data.company.uid ? ` · UID ${data.company.uid}` : ""}
          </Text>
        </View>
      </Page>
    </Document>
  );
}

function Datenpaar({ label, wert }: { label: string; wert: string }) {
  return (
    <View style={s.datenPaar}>
      <Text style={s.datenLabel}>{label}</Text>
      <Text>{wert}</Text>
    </View>
  );
}
