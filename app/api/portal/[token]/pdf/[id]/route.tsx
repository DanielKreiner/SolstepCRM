import { renderToBuffer } from "@react-pdf/renderer";
import { NextResponse } from "next/server";
import { VorgangPdf, type BelegArt, type VorgangPdfData } from "@/lib/pdf/vorgang";
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
    .select("name, address, zip, city, uid_nr, iban")
    .eq("id", session.companyId)
    .maybeSingle();

  const anz = daten.dokumente.find((d) => d.typ === "anzahlungsrechnung");

  const pdf: VorgangPdfData = {
    art,
    vorgangNummer: daten.vorgang.nummer,
    belegNummer: dok?.nummer ?? null,
    erstelltAm: new Date().toISOString(),
    gueltigBis: null,
    faelligAm: dok?.faelligAm ?? null,
    firma: {
      name: (firma?.name as string) ?? "",
      adresse: (firma?.address as string | null) ?? null,
      plz: (firma?.zip as string | null) ?? null,
      ort: (firma?.city as string | null) ?? null,
      uid: (firma?.uid_nr as string | null) ?? null,
      iban: (firma?.iban as string | null) ?? null,
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
      text: p.bezeichnung,
      menge: p.menge,
      einheit: p.einheit,
      epNetto: p.epNetto,
      ustSatz: p.ustSatz,
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
