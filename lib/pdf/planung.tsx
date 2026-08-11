import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";

/*
 * Kunden-PDF zur Planung (Briefing 8.1).
 *
 * Das ist kein Angebot. Es ist das, was der Kunde nach dem Gespräch
 * mitbekommt: sein Dach mit den Modulen darauf, die Anlage in Zahlen,
 * was sie bringt und was sie rechnet. Preise stehen darin nur, soweit
 * sie im Gespräch besprochen wurden — Einkaufspreise, Margen und
 * interne Notizen gehören hier nirgends hin.
 *
 * Sechs Seiten laut Briefing: Deckblatt, Anlage, Ertrag,
 * Wirtschaftlichkeit, Komponenten, Betrieb. Jede Seite trägt denselben
 * Fuss mit dem Hinweis, dass es sich um Richtwerte handelt — wer das
 * Blatt aus dem Stapel zieht, soll es auch dort lesen.
 */

const TINTE = "#151210";
const GRAU = "#6a625a";
const LINIE = "#e5ded4";

export interface PlanungPdfData {
  firma: { name: string; adresse: string | null; kontakt: string | null };
  marke: { logoUrl: string | null; akzent: string };
  projekt: { name: string; adresse: string | null; datum: string };
  /** Das Bild der Planung als Daten-URL; fehlt es, bleibt die Fläche leer. */
  bild: string | null;

  anlage: {
    kwp: number;
    module: number;
    modulTyp: string | null;
    wechselrichter: string | null;
    speicher: string | null;
    speicherKwh: number;
    flaechen: Array<{ name: string; neigung: number; azimut: number; module: number }>;
    geprueft: boolean | null;
  };

  ertrag: {
    jahresertragKwh: number;
    spezifisch: number;
    monate: number[];
    quelle: "pvgis" | "geschaetzt";
  };

  wirtschaft: {
    autarkie: number;
    eigenverbrauchKwh: number;
    einspeisungKwh: number;
    verbrauchKwh: number;
    ersparnisJahr1: number;
    amortisationJahre: number | null;
    investition: number;
    strompreis: number;
    verguetung: number;
    steigerung: number;
    mitSpeicher: boolean;
  };

  komponenten: Array<{ bezeichnung: string; menge: number; einheit: string }>;
}

const s = StyleSheet.create({
  page: {
    paddingTop: 38,
    paddingBottom: 54,
    paddingHorizontal: 44,
    fontSize: 9.5,
    lineHeight: 1.45,
    color: TINTE,
    fontFamily: "Helvetica",
  },
  kopf: { flexDirection: "row", alignItems: "center", gap: 8, paddingBottom: 10 },
  kopfStrich: { borderBottomWidth: 1.5, borderBottomColor: TINTE, marginBottom: 16 },
  logo: { height: 26, objectFit: "contain" },
  firma: { fontSize: 11, fontFamily: "Helvetica-Bold" },
  datum: { marginLeft: "auto", fontSize: 8, color: GRAU },

  h1: { fontSize: 21, fontFamily: "Helvetica-Bold", lineHeight: 1.2 },
  h2: { fontSize: 14, fontFamily: "Helvetica-Bold", marginBottom: 10 },
  lauf: { color: GRAU, marginTop: 4 },

  bild: { width: "100%", height: 210, objectFit: "cover", borderRadius: 6, marginTop: 16 },
  bildErsatz: {
    width: "100%",
    height: 210,
    borderRadius: 6,
    marginTop: 16,
    borderWidth: 1,
    borderColor: LINIE,
    alignItems: "center",
    justifyContent: "center",
  },

  kacheln: { flexDirection: "row", gap: 9, marginTop: 16 },
  kachel: { flex: 1, borderWidth: 1, borderColor: LINIE, borderRadius: 6, padding: 10 },
  kachelWert: { fontSize: 14, fontFamily: "Helvetica-Bold" },
  kachelLabel: { fontSize: 7.5, color: GRAU, marginTop: 1 },

  zeile: {
    flexDirection: "row",
    alignItems: "baseline",
    paddingVertical: 6,
    borderBottomWidth: 0.5,
    borderBottomColor: LINIE,
  },
  zeileK: { color: GRAU },
  zeileV: { marginLeft: "auto", fontFamily: "Helvetica-Bold" },

  balkenReihe: { flexDirection: "row", alignItems: "center", gap: 7, marginBottom: 4 },
  balkenMonat: { width: 26, fontSize: 8, color: GRAU },
  balkenBahn: { flex: 1, height: 9, backgroundColor: "#f2eee9", borderRadius: 3 },
  balkenWert: { width: 52, fontSize: 8, textAlign: "right" },

  hinweis: {
    marginTop: 14,
    backgroundColor: "#f8f6f3",
    borderRadius: 6,
    padding: 11,
    color: GRAU,
    fontSize: 8.5,
    lineHeight: 1.5,
  },

  fuss: {
    position: "absolute",
    bottom: 26,
    left: 44,
    right: 44,
    flexDirection: "row",
    fontSize: 7.5,
    color: GRAU,
  },
});

const MONATE = ["Jän", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];

/** Ganze Zahl mit Tausenderpunkt, wie überall in der Anwendung. */
function n(wert: number, stellen = 0): string {
  return wert.toLocaleString("de-AT", {
    minimumFractionDigits: stellen,
    maximumFractionDigits: stellen,
  });
}

function Kopf({ data, seite }: { data: PlanungPdfData; seite: number }) {
  return (
    <>
      <View style={s.kopf}>
        {data.marke.logoUrl ? <Image src={data.marke.logoUrl} style={s.logo} /> : null}
        <Text style={s.firma}>{data.firma.name}</Text>
        <Text style={s.datum}>{data.projekt.datum}</Text>
      </View>
      <View style={s.kopfStrich} />
      <View style={s.fuss} fixed>
        <Text>Richtwerte, unverbindlich · kein Angebot</Text>
        <Text style={{ marginLeft: "auto" }}>Seite {seite}/6</Text>
      </View>
    </>
  );
}

export function PlanungPdf({ data }: { data: PlanungPdfData }) {
  const akzent = data.marke.akzent;
  const hoechster = Math.max(...data.ertrag.monate, 1);

  return (
    <Document
      title={`Planung ${data.projekt.name}`}
      author={data.firma.name}
      creator="Solstep Betrieb"
    >
      {/* ── 1 Deckblatt ────────────────────────────────────────── */}
      <Page size="A4" style={s.page}>
        <Kopf data={data} seite={1} />

        <Text style={s.h1}>Ihr Solarkraftwerk{"\n"}auf dem eigenen Dach</Text>
        <Text style={s.lauf}>{data.projekt.adresse ?? data.projekt.name}</Text>

        {data.bild ? (
          <Image src={data.bild} style={s.bild} />
        ) : (
          /*
           * Ohne Bild bleibt die Fläche leer statt mit einem Platzhalter
           * zu behaupten, es gäbe eine Ansicht. Der Kunde merkt den
           * Unterschied.
           */
          <View style={s.bildErsatz}>
            <Text style={{ color: GRAU, fontSize: 8.5 }}>
              Keine Ansicht hinterlegt — die Planung wurde ohne Kartenbild erstellt.
            </Text>
          </View>
        )}

        <View style={s.kacheln}>
          <View style={s.kachel}>
            <Text style={s.kachelWert}>{n(data.anlage.kwp, 2)} kWp</Text>
            <Text style={s.kachelLabel}>Anlagenleistung</Text>
          </View>
          <View style={s.kachel}>
            <Text style={s.kachelWert}>{n(data.ertrag.jahresertragKwh)} kWh</Text>
            <Text style={s.kachelLabel}>Strom pro Jahr</Text>
          </View>
          <View style={s.kachel}>
            <Text style={[s.kachelWert, { color: akzent }]}>
              {data.wirtschaft.amortisationJahre === null
                ? "—"
                : `${n(data.wirtschaft.amortisationJahre, 1)} Jahre`}
            </Text>
            <Text style={s.kachelLabel}>Amortisation</Text>
          </View>
        </View>

        <Text style={s.hinweis}>
          Die Anlage wurde auf dem Luftbild Ihres Hauses geplant und elektrisch auf den
          Wechselrichter abgestimmt. Alle Werte sind sorgfältig gerechnet — die Feinabstimmung
          passiert beim Termin vor Ort.
        </Text>
      </Page>

      {/* ── 2 Anlage ───────────────────────────────────────────── */}
      <Page size="A4" style={s.page}>
        <Kopf data={data} seite={2} />
        <Text style={s.h2}>Ihre Anlage im Überblick</Text>

        <Zeile k="Anlagenleistung" v={`${n(data.anlage.kwp, 2)} kWp`} />
        <Zeile k="Module" v={`${n(data.anlage.module)} Stück`} />
        {data.anlage.modulTyp ? <Zeile k="Modultyp" v={data.anlage.modulTyp} /> : null}
        {data.anlage.wechselrichter ? (
          <Zeile k="Wechselrichter" v={data.anlage.wechselrichter} />
        ) : null}
        <Zeile
          k="Speicher"
          v={
            data.anlage.speicher && data.wirtschaft.mitSpeicher
              ? `${data.anlage.speicher} · ${n(data.anlage.speicherKwh, 1)} kWh`
              : "nicht vorgesehen"
          }
        />

        <Text style={[s.h2, { marginTop: 20 }]}>Dachflächen</Text>
        {data.anlage.flaechen.map((f) => (
          <Zeile
            key={f.name}
            k={f.name}
            v={`${n(f.neigung)}° Neigung · ${himmelsrichtung(f.azimut)} · ${n(f.module)} Module`}
          />
        ))}

        {/*
         * Der Prüfstatus gehört auf dieses Blatt, weil es zum Elektriker
         * wandert. „Nicht geprüft" wird ausgeschrieben — ein fehlender
         * Haken wäre zu leicht zu übersehen.
         */}
        <Text style={s.hinweis}>
          {data.anlage.geprueft === true
            ? "Elektrisch geprüft: Die Strangauslegung hält die Spannungs- und Stromgrenzen des Wechselrichters ein, gerechnet bei −10 °C."
            : data.anlage.geprueft === false
              ? "Die elektrische Prüfung meldet noch offene Punkte. Die Strangauslegung wird vor der Ausführung angepasst."
              : "Die Strangauslegung steht noch aus und wird vor der Ausführung festgelegt."}
        </Text>
      </Page>

      {/* ── 3 Ertrag ───────────────────────────────────────────── */}
      <Page size="A4" style={s.page}>
        <Kopf data={data} seite={3} />
        <Text style={s.h2}>Was das Dach liefert</Text>

        <Zeile k="Ertrag im Jahr" v={`${n(data.ertrag.jahresertragKwh)} kWh`} />
        <Zeile k="Je Kilowatt-Peak" v={`${n(data.ertrag.spezifisch)} kWh/kWp`} />
        <Zeile
          k="Datengrundlage"
          v={
            data.ertrag.quelle === "pvgis"
              ? "PVGIS (EU-Kommission), standortgenau"
              : "Schätzwert aus Vergleichsdaten"
          }
        />

        <Text style={[s.h2, { marginTop: 20 }]}>Über das Jahr verteilt</Text>
        {data.ertrag.monate.map((wert, i) => (
          <View key={MONATE[i]} style={s.balkenReihe}>
            <Text style={s.balkenMonat}>{MONATE[i]}</Text>
            <View style={s.balkenBahn}>
              <View
                style={{
                  width: `${(wert / hoechster) * 100}%`,
                  height: 9,
                  backgroundColor: akzent,
                  borderRadius: 3,
                }}
              />
            </View>
            <Text style={s.balkenWert}>{n(wert)} kWh</Text>
          </View>
        ))}

        <Text style={s.hinweis}>
          Im Sommer liefert die Anlage gut das Dreifache eines Wintermonats. Das ist keine
          Schwäche der Planung, sondern der Lauf der Sonne — und der Grund, warum ein Speicher im
          Dezember weniger bringt als im Juni.
        </Text>
      </Page>

      {/* ── 4 Wirtschaftlichkeit ──────────────────────────────── */}
      <Page size="A4" style={s.page}>
        <Kopf data={data} seite={4} />
        <Text style={s.h2}>Was sich das rechnet</Text>

        <View style={s.kacheln}>
          <View style={s.kachel}>
            <Text style={s.kachelWert}>{n(data.wirtschaft.autarkie * 100)} %</Text>
            <Text style={s.kachelLabel}>Autarkie</Text>
          </View>
          <View style={s.kachel}>
            <Text style={s.kachelWert}>{n(data.wirtschaft.ersparnisJahr1)} €</Text>
            <Text style={s.kachelLabel}>Ersparnis im 1. Jahr</Text>
          </View>
          <View style={s.kachel}>
            <Text style={[s.kachelWert, { color: akzent }]}>
              {data.wirtschaft.amortisationJahre === null
                ? "—"
                : `${n(data.wirtschaft.amortisationJahre, 1)} Jahre`}
            </Text>
            <Text style={s.kachelLabel}>Amortisation</Text>
          </View>
        </View>

        <Text style={[s.h2, { marginTop: 22 }]}>Jahresbilanz</Text>
        <Zeile k="Erzeugter Strom" v={`${n(data.ertrag.jahresertragKwh)} kWh`} />
        <Zeile k="Davon selbst genutzt" v={`${n(data.wirtschaft.eigenverbrauchKwh)} kWh`} />
        <Zeile k="Ins Netz eingespeist" v={`${n(data.wirtschaft.einspeisungKwh)} kWh`} />
        <Zeile
          k="Weiterhin aus dem Netz"
          v={`${n(Math.max(0, data.wirtschaft.verbrauchKwh - data.wirtschaft.eigenverbrauchKwh))} kWh`}
        />

        {/*
         * Die Annahmen offen hinschreiben. Eine Amortisationszahl ohne
         * die Annahmen dahinter ist eine Behauptung; mit ihnen ist sie
         * nachrechenbar — und der Kunde sieht, an welcher Schraube sich
         * etwas ändert, wenn der Strompreis anders läuft.
         */}
        <Text style={[s.h2, { marginTop: 22 }]}>Womit gerechnet wurde</Text>
        <Zeile k="Jahresverbrauch" v={`${n(data.wirtschaft.verbrauchKwh)} kWh`} />
        <Zeile k="Strompreis heute" v={`${n(data.wirtschaft.strompreis, 2)} €/kWh`} />
        <Zeile k="Einspeisevergütung" v={`${n(data.wirtschaft.verguetung, 2)} €/kWh`} />
        <Zeile
          k="Strompreissteigerung"
          v={`${n(data.wirtschaft.steigerung * 100, 1)} % pro Jahr`}
        />
        <Zeile k="Anlagenpreis abzüglich Förderung" v={`${n(data.wirtschaft.investition)} €`} />

        <Text style={s.hinweis}>
          Gerechnet wird mit Jahreswerten, nicht mit Ihrem tatsächlichen Tagesverlauf. Für eine
          erste Einordnung ist das genau richtig; die Einspeisevergütung wurde bewusst nicht
          gesteigert, weil sie vertraglich festliegt.
        </Text>
      </Page>

      {/* ── 5 Komponenten ─────────────────────────────────────── */}
      <Page size="A4" style={s.page}>
        <Kopf data={data} seite={5} />
        <Text style={s.h2}>Was verbaut wird</Text>

        {data.komponenten.length === 0 ? (
          <Text style={{ color: GRAU }}>
            Die Komponentenliste wird nach der Feinplanung ergänzt.
          </Text>
        ) : (
          data.komponenten.map((k) => (
            <Zeile key={k.bezeichnung} k={k.bezeichnung} v={`${n(k.menge)} ${k.einheit}`} />
          ))
        )}

        <Text style={s.hinweis}>
          Montagematerial, Kabel und Kleinteile sind in der Ausführung enthalten und hier nicht
          einzeln aufgeführt. Änderungen gleichwertiger Art bleiben vorbehalten — Verfügbarkeiten
          ändern sich, die Anlage bleibt dieselbe.
        </Text>
      </Page>

      {/* ── 6 Betrieb ─────────────────────────────────────────── */}
      <Page size="A4" style={s.page}>
        <Kopf data={data} seite={6} />
        <Text style={s.h2}>Ihr Ansprechpartner</Text>

        <Text style={{ fontSize: 12, fontFamily: "Helvetica-Bold" }}>{data.firma.name}</Text>
        {data.firma.adresse ? <Text style={s.lauf}>{data.firma.adresse}</Text> : null}
        {data.firma.kontakt ? <Text style={s.lauf}>{data.firma.kontakt}</Text> : null}

        <Text style={s.hinweis}>
          Diese Unterlage ist eine Planung, kein Angebot: Sie enthält keine verbindlichen Preise
          und begründet keinen Vertrag. Ertrag und Wirtschaftlichkeit sind sorgfältig gerechnete
          Richtwerte — der tatsächliche Ertrag hängt vom Wetter ab, die tatsächliche Ersparnis von
          Ihrem Verbrauch und der Preisentwicklung.
        </Text>
      </Page>
    </Document>
  );
}

function Zeile({ k, v }: { k: string; v: string }) {
  return (
    <View style={s.zeile}>
      <Text style={s.zeileK}>{k}</Text>
      <Text style={s.zeileV}>{v}</Text>
    </View>
  );
}

/** Azimut als Himmelsrichtung — „180°" sagt einem Kunden nichts. */
export function himmelsrichtung(azimut: number): string {
  const namen = [
    "Nord",
    "Nordost",
    "Ost",
    "Südost",
    "Süd",
    "Südwest",
    "West",
    "Nordwest",
  ];
  const i = Math.round((((azimut % 360) + 360) % 360) / 45) % 8;
  return namen[i]!;
}
