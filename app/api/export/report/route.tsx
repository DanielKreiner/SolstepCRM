import { NextResponse } from "next/server";
import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
} from "@react-pdf/renderer";
import {
  alsCsv,
  baueBericht,
  istBerichtId,
  jahresZeitraum,
  type Bericht,
} from "@/lib/reports";
import { getMe } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * Berichtsexport nach Excel (CSV) und PDF.
 *
 * Läuft über den RLS-Client: der Export zeigt exakt das, was der Screen
 * zeigt. Ein Export, der mehr enthält als die Ansicht, ist ein Leck mit
 * Dateiendung.
 */
export async function GET(request: Request) {
  const me = await getMe();
  if (!me) {
    return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });
  }
  if (me.perms.berichte === "none") {
    return NextResponse.json({ error: "Keine Berechtigung." }, { status: 403 });
  }

  const url = new URL(request.url);
  const id = url.searchParams.get("bericht") ?? "auftraege";
  const format = url.searchParams.get("format") ?? "csv";
  const jahrRoh = url.searchParams.get("jahr") ?? "";
  const jahr = /^\d{4}$/.test(jahrRoh)
    ? Number(jahrRoh)
    : new Date().getFullYear();

  if (!istBerichtId(id)) {
    return NextResponse.json({ error: "Unbekannter Bericht." }, { status: 400 });
  }

  const bericht = await baueBericht(id, jahresZeitraum(jahr));
  const dateiname = `${id}-${jahr}`;

  if (format === "csv") {
    return new NextResponse(alsCsv(bericht), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${dateiname}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  }

  if (format !== "pdf") {
    return NextResponse.json({ error: "Unbekanntes Format." }, { status: 400 });
  }

  const buffer = await renderToBuffer(
    <ReportPdf bericht={bericht} jahr={jahr} betrieb={me.company.name} />,
  );

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${dateiname}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}

const s = StyleSheet.create({
  page: {
    paddingTop: 38,
    paddingBottom: 44,
    paddingHorizontal: 34,
    fontSize: 8,
    color: "#151210",
    fontFamily: "Helvetica",
  },
  h1: { fontSize: 14, fontWeight: 700 },
  klein: { fontSize: 7.5, color: "#6A625A" },
  zeile: { flexDirection: "row", paddingVertical: 3 },
  trenner: { borderBottomWidth: 0.5, borderBottomColor: "#EAE4DC" },
  kopf: {
    fontSize: 7,
    color: "#9C9289",
    textTransform: "uppercase",
    borderBottomWidth: 0.8,
    borderBottomColor: "#151210",
  },
  fuss: {
    position: "absolute",
    bottom: 22,
    left: 34,
    right: 34,
    fontSize: 7,
    color: "#9C9289",
  },
});

function ReportPdf({
  bericht,
  jahr,
  betrieb,
}: {
  bericht: Bericht;
  jahr: number;
  betrieb: string;
}) {
  const breite = 100 / bericht.spalten.length;

  return (
    <Document title={`${bericht.titel} ${jahr}`} language="de-AT">
      <Page size="A4" orientation="landscape" style={s.page}>
        <Text style={s.h1}>{bericht.titel}</Text>
        <Text style={s.klein}>
          {betrieb} · {jahr} · {bericht.zeilen.length} Zeilen
        </Text>

        <View style={{ marginTop: 14 }}>
          <View style={[s.zeile, s.kopf]} fixed>
            {bericht.spalten.map((sp) => (
              <Text
                key={sp.key}
                style={{
                  width: `${breite}%`,
                  textAlign: sp.numerisch ? "right" : "left",
                  paddingRight: 4,
                }}
              >
                {sp.label}
              </Text>
            ))}
          </View>

          {bericht.zeilen.map((z, i) => (
            <View key={i} style={[s.zeile, s.trenner]} wrap={false}>
              {bericht.spalten.map((sp) => (
                <Text
                  key={sp.key}
                  style={{
                    width: `${breite}%`,
                    textAlign: sp.numerisch ? "right" : "left",
                    paddingRight: 4,
                  }}
                >
                  {typeof z[sp.key] === "number"
                    ? new Intl.NumberFormat("de-AT", {
                        maximumFractionDigits: 2,
                      }).format(z[sp.key] as number)
                    : String(z[sp.key] ?? "")}
                </Text>
              ))}
            </View>
          ))}
        </View>

        <Text style={s.fuss} fixed>
          {bericht.hinweis}
        </Text>
      </Page>
    </Document>
  );
}
