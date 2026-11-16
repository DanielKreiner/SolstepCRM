import { renderToBuffer } from "@react-pdf/renderer";
import { NextResponse } from "next/server";
import { VorgangPdf, type BelegArt, type VorgangPdfData } from "@/lib/pdf/vorgang";
import { planungFuerVorgang } from "@/lib/planer/zumVorgang";
import { markeAus } from "@/lib/marke";
import { resolvePortal } from "@/lib/portal/data";
import { portalVorgangDetail } from "@/lib/portal/vorgang";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * Belege für den Kunden.
 *
 * Eigene Route, weil das Portal keine Supabase-Sitzung hat. Die Prüfung
 * liegt deshalb hier: portalVorgangDetail gibt nur zurück, was diesem
 * Kunden gehört, und liefert ausschliesslich Dokumente mit
 * kunde_sichtbar. Die Materialbedarfsliste kommt damit gar nicht erst an
 * — dort stehen Einkaufspreise.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string; id: string }> },
) {
  const { token, id } = await params;
  const session = await resolvePortal(token);
  if (!session) {
    return NextResponse.json({ fehler: "Zugang abgelaufen." }, { status: 404 });
  }

  const url = new URL(request.url);
  const art = (url.searchParams.get("art") ?? "angebot") as BelegArt;
  /*
   * Belegart pruefen wie in der Backoffice-Route. Ohne die Pruefung lief
   * ein unbekannter Wert bis in `TITEL[art]`, und das PDF kam ohne
   * Ueberschrift beim Kunden an.
   */
  if (!["angebot", "ab", "anzahlungsrechnung", "schlussrechnung"].includes(art)) {
    return NextResponse.json({ fehler: "Unbekannte Belegart." }, { status: 400 });
  }

  const daten = await portalVorgangDetail(session, id);
  if (!daten) {
    return NextResponse.json({ fehler: "Nicht gefunden." }, { status: 404 });
  }

  /*
   * Angebot geht immer, alles andere nur, wenn es als sichtbares Dokument
   * vorliegt. Damit kann niemand über den Parameter einen Beleg abrufen,
   * den der Betrieb nicht freigegeben hat.
   */
  const dok = daten.dokumente.find((d) => d.typ === art);
  if (art !== "angebot" && !dok) {
    return NextResponse.json({ fehler: "Nicht gefunden." }, { status: 404 });
  }

  const admin = createAdminClient();
  const { data: firma } = await admin
    .from("company")
    .select("name, rechtsform, address, zip, city, country, uid_nr, firmenbuch_nr, firmenbuch_gericht, email, phone, website, iban, bic, pdf_settings")
    .eq("id", session.companyId)
    .maybeSingle();

  const marke = markeAus(firma?.pdf_settings, firma?.name as string | undefined, [
    firma?.zip as string | null,
    firma?.city as string | null,
  ]);

  const anz = daten.dokumente.find((d) => d.typ === "anzahlungsrechnung");

  /*
   * Auch im Portal trägt das Angebot die Planungszahlen — dieselbe
   * Funktion wie im Backoffice. Der Kunde soll auf beiden Wegen
   * dasselbe Blatt sehen.
   */
  const planung = await planungFuerVorgang(admin, daten.vorgang.id);

  const pdf: VorgangPdfData = {
    art,
    planung,
    vorgangNummer: daten.vorgang.nummer,
    belegNummer: dok?.nummer ?? null,
    /*
     * Datum des Belegs, nicht von heute. Eine drei Wochen alte Rechnung
     * trug bei jedem Oeffnen das aktuelle Datum — CLAUDE.md 6.4 verlangt
     * fuer Rechnungen ausdruecklich Unveraenderlichkeit.
     */
    erstelltAm: dok?.createdAt ?? new Date().toISOString(),
    gueltigBis: null,
    faelligAm: dok?.faelligAm ?? null,
    marke: { logoUrl: daten.firma?.logoUrl ?? null, akzent: marke.akzent },
    texte: {
      titel: daten.texte.titel,
      einleitung: daten.texte.einleitung,
      abschluss: daten.texte.abschluss,
    },
    gruppen: daten.gruppen.map((g) => ({
      id: g.id,
      name: g.name,
      beschreibung: g.beschreibung,
      paketPreis: g.paketPreis,
      einzelpreiseVerstecken: g.einzelpreiseVerstecken,
    })),
    rahmen: daten.rahmen,
    firma: {
      name: (firma?.name as string) ?? "",
      rechtsform: (firma?.rechtsform as string | null) ?? null,
      adresse: (firma?.address as string | null) ?? null,
      plz: (firma?.zip as string | null) ?? null,
      ort: (firma?.city as string | null) ?? null,
      land: (firma?.country as string | null) ?? null,
      uid: (firma?.uid_nr as string | null) ?? null,
      firmenbuchNr: (firma?.firmenbuch_nr as string | null) ?? null,
      firmenbuchGericht: (firma?.firmenbuch_gericht as string | null) ?? null,
      telefon: (firma?.phone as string | null) ?? null,
      email: (firma?.email as string | null) ?? null,
      website: (firma?.website as string | null) ?? null,
      iban: (firma?.iban as string | null) ?? null,
      bic: (firma?.bic as string | null) ?? null,
    },
    kunde: {
      name: session.customerName,
      kontakt: null,
      adresse: daten.vorgang.adresse,
      plz: daten.vorgang.plz,
      ort: daten.vorgang.ort,
    },
    anlage: {
      kwp: daten.vorgang.kwp,
      speicherKwh: daten.vorgang.speicherKwh,
      adresse: daten.vorgang.adresse,
      zaehlpunkt: null,
    },
    positionen: daten.positionen.map((p, i) => ({
      pos: (i + 1) * 10,
      gruppeId: p.gruppeId,
      text: p.bezeichnung,
      beschreibung: p.beschreibung,
      menge: p.menge,
      einheit: p.einheit,
      epNetto: p.epNetto,
      ustSatz: p.ustSatz,
      rabattProzent: p.rabattProzent,
      /*
       * Was der Kunde abgewählt hat, ist für ihn keine Option mehr,
       * sondern nicht dabei. Gewähltes zählt wie eine feste Position.
       */
      optional: p.optional && p.kundenAuswahl !== "gewaehlt",
      ...(p.bildUrl?.startsWith("https://") ? { bildUrl: p.bildUrl } : {}),
    })),
    abzugBrutto:
      art === "schlussrechnung" && anz?.betragBrutto ? anz.betragBrutto : null,
    forderungBrutto: dok?.betragBrutto ?? null,
  };

  let buffer: Buffer;
  try {
    buffer = await renderToBuffer(<VorgangPdf data={pdf} />);
  } catch {
    buffer = await renderToBuffer(
      <VorgangPdf
        data={{
          ...pdf,
          positionen: pdf.positionen.map((p) => {
            const ohne = { ...p };
            delete ohne.bildUrl;
            return ohne;
          }),
        }}
      />,
    );
  }

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${dok?.nummer ?? daten.vorgang.nummer}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
