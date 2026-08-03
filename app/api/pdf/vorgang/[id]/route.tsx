import { renderToBuffer } from "@react-pdf/renderer";
import { NextResponse } from "next/server";
import { VorgangPdf, type BelegArt, type VorgangPdfData } from "@/lib/pdf/vorgang";
import { anzahlung, summen } from "@/lib/vorgang/modell";
import { requireMe } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * Belege zum Vorgang als PDF.
 *
 * Eine Route für Angebot, Auftragsbestätigung und beide Rechnungen. Die
 * Art kommt als Parameter, die Positionen aus der passenden Fassung:
 *
 *   angebot  → der lebende Entwurf (dokument_id ist null)
 *   ab       → die eingefrorene Fassung an der Auftragsbestätigung
 *   Rechnung → dieselbe eingefrorene Fassung, mit Abzug der Anzahlung
 *
 * Gelesen wird mit dem RLS-Client des Anmelders. Wer die Rechnung nicht
 * sehen darf, bekommt sie auch hier nicht — die Policy aus 0025 greift,
 * ohne dass diese Route etwas dafür tun müsste.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  await requireMe();
  const { id } = await params;

  const url = new URL(request.url);
  const art = (url.searchParams.get("art") ?? "angebot") as BelegArt;
  if (!["angebot", "ab", "anzahlungsrechnung", "schlussrechnung"].includes(art)) {
    return NextResponse.json({ fehler: "Unbekannte Belegart." }, { status: 400 });
  }

  const supabase = await createClient();

  const { data: v } = await supabase
    .from("vorgang")
    .select(
      `id, number, phase, kwp, speicher_kwh, adresse, plz, ort, zaehlpunkt,
       anzahlung_prozent, created_at,
       customer:customer_id ( name, contact_person, address, zip, city )`,
    )
    .eq("id", id)
    .maybeSingle();

  if (!v) {
    return NextResponse.json({ fehler: "Vorgang nicht gefunden." }, { status: 404 });
  }

  const { data: firma } = await supabase
    .from("company")
    .select("name, address, zip, city, uid_nr, iban")
    .maybeSingle();

  /* Zu welchem Dokument gehören die Positionen? */
  type DokRoh = {
    id: string;
    nummer: string | null;
    faellig_am: string | null;
    betrag_brutto: string | null;
  };
  let dokument: DokRoh | null = null;

  if (art !== "angebot") {
    const { data } = await supabase
      .from("vorgang_dokument")
      .select("id, nummer, faellig_am, betrag_brutto")
      .eq("vorgang_id", id)
      .eq("typ", art)
      .maybeSingle();

    dokument = (data as unknown as DokRoh | null) ?? null;
    if (!dokument) {
      /*
       * Auch der Fall, dass die Rolle den Beleg nicht sehen darf — die
       * Policy liefert dann schlicht keine Zeile. Dieselbe Antwort wie
       * bei „gibt es nicht", damit sich aus dem Unterschied nichts
       * ableiten lässt.
       */
      return NextResponse.json({ fehler: "Beleg nicht gefunden." }, { status: 404 });
    }
  }

  /* Bei Rechnungen kommen die Positionen von der Auftragsbestätigung. */
  let positionsDokument: string | null = null;
  if (art === "ab") {
    positionsDokument = dokument!.id;
  } else if (art !== "angebot") {
    const { data: ab } = await supabase
      .from("vorgang_dokument")
      .select("id")
      .eq("vorgang_id", id)
      .eq("typ", "ab")
      .maybeSingle();
    positionsDokument = (ab?.id as string) ?? null;
  }

  const abfrage = supabase
    .from("vorgang_position")
    .select("sort, bezeichnung, menge, einheit, ep_netto, ust_satz, kalk_stunden, kalk_ek, ist_material, bild_url")
    .eq("vorgang_id", id)
    .order("sort");

  const { data: posRoh } = positionsDokument
    ? await abfrage.eq("dokument_id", positionsDokument)
    : await abfrage.is("dokument_id", null);

  const positionen = ((posRoh ?? []) as unknown as PosRoh[]).map((p, i) => ({
    pos: (i + 1) * 10,
    text: p.bezeichnung,
    menge: Number(p.menge),
    einheit: p.einheit,
    epNetto: Number(p.ep_netto),
    ustSatz: Number(p.ust_satz),
    ...(bildQuelle(p.bild_url) ? { bildUrl: bildQuelle(p.bild_url)! } : {}),
  }));

  const s = summen(
    ((posRoh ?? []) as unknown as PosRoh[]).map((p) => ({
      menge: Number(p.menge),
      epNetto: Number(p.ep_netto),
      ustSatz: Number(p.ust_satz),
      kalkStunden: p.kalk_stunden === null ? null : Number(p.kalk_stunden),
      kalkEk: p.kalk_ek === null ? null : Number(p.kalk_ek),
      istMaterial: p.ist_material,
    })),
  );

  /* Anzahlung nur bei der Schlussrechnung abziehen. */
  let abzug: number | null = null;
  if (art === "schlussrechnung") {
    const { data: anz } = await supabase
      .from("vorgang_dokument")
      .select("betrag_brutto")
      .eq("vorgang_id", id)
      .eq("typ", "anzahlungsrechnung")
      .maybeSingle();

    abzug = anz?.betrag_brutto
      ? Number(anz.betrag_brutto)
      : anzahlung(s.brutto, Number(v.anzahlung_prozent)).anzahlungBrutto;
  }

  const kunde = v.customer as unknown as {
    name: string;
    contact_person: string | null;
    address: string | null;
    zip: string | null;
    city: string | null;
  } | null;

  const gueltig = new Date(v.created_at as string);
  gueltig.setDate(gueltig.getDate() + 30);

  const data: VorgangPdfData = {
    art,
    vorgangNummer: v.number as string,
    belegNummer: dokument?.nummer ?? null,
    erstelltAm: new Date().toISOString(),
    gueltigBis: art === "angebot" ? gueltig.toISOString() : null,
    faelligAm: dokument?.faellig_am ?? null,
    firma: {
      name: (firma?.name as string) ?? "",
      adresse: (firma?.address as string | null) ?? null,
      plz: (firma?.zip as string | null) ?? null,
      ort: (firma?.city as string | null) ?? null,
      uid: (firma?.uid_nr as string | null) ?? null,
      iban: (firma?.iban as string | null) ?? null,
    },
    kunde: {
      name: kunde?.name ?? "",
      kontakt: kunde?.contact_person ?? null,
      adresse: kunde?.address ?? null,
      plz: kunde?.zip ?? null,
      ort: kunde?.city ?? null,
    },
    anlage: {
      kwp: v.kwp === null ? null : Number(v.kwp),
      speicherKwh: v.speicher_kwh === null ? null : Number(v.speicher_kwh),
      adresse: [(v.adresse as string | null), (v.ort as string | null)]
        .filter(Boolean)
        .join(", ") || null,
      zaehlpunkt: (v.zaehlpunkt as string | null) ?? null,
    },
    positionen,
    abzugBrutto: abzug,
    forderungBrutto: dokument?.betrag_brutto
      ? Number(dokument.betrag_brutto)
      : null,
  };

  /*
   * Bilder werden beim Rendern nachgeladen. Ein toter Link würde sonst
   * das ganze PDF scheitern lassen, und der Kunde bekäme statt eines
   * Belegs einen Fehler — dieselbe Absicherung wie beim Angebots-PDF.
   */
  let buffer: Buffer;
  try {
    buffer = await renderToBuffer(<VorgangPdf data={data} />);
  } catch {
    buffer = await renderToBuffer(
      <VorgangPdf
        data={{
          ...data,
          positionen: data.positionen.map((p) => {
            const ohne = { ...p };
            delete ohne.bildUrl;
            return ohne;
          }),
        }}
      />,
    );
  }

  const name = `${data.belegNummer ?? data.vorgangNummer}-${art}.pdf`;

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}

/** Nur https ins PDF — siehe /api/pdf/quote. */
function bildQuelle(v: unknown): string | null {
  if (typeof v !== "string" || v.length === 0) return null;
  try {
    const u = new URL(v);
    return u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

type PosRoh = {
  sort: number;
  bezeichnung: string;
  menge: string;
  einheit: string;
  ep_netto: string;
  ust_satz: string;
  kalk_stunden: string | null;
  kalk_ek: string | null;
  ist_material: boolean;
  bild_url: string | null;
};
