import { renderToBuffer } from "@react-pdf/renderer";
import type { SupabaseClient } from "@supabase/supabase-js";
import { VorgangPdf, type BelegArt, type VorgangPdfData } from "@/lib/pdf/vorgang";
import { markeAus } from "@/lib/marke";
import { anzahlung, summen } from "@/lib/vorgang/modell";

/**
 * Einen Beleg als PDF erzeugen.
 *
 * Hierher gezogen aus der Route, weil der Angebotsversand dasselbe PDF
 * braucht: ohne Portalzugang muss es als Anhang mit. Zwei Aufbauten
 * derselben Daten wären zwei Belege unter einer Nummer.
 *
 * Gelesen wird mit dem übergebenen Client. Kommt er aus einer Sitzung,
 * greifen die Policies — wer die Rechnung nicht sehen darf, bekommt sie
 * auch hier nicht.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any, any, any>;

export type BelegErgebnis =
  | { ok: true; buffer: Buffer; dateiname: string }
  | { ok: false; grund: string };

export async function belegPdf(
  supabase: Client,
  id: string,
  art: BelegArt,
): Promise<BelegErgebnis> {
  const { data: v } = await supabase
    .from("vorgang")
    .select(
      `id, number, phase, kwp, speicher_kwh, adresse, plz, ort, zaehlpunkt,
       anzahlung_prozent, created_at, ust_satz,
       angebot_titel, angebot_einleitung, angebot_abschluss, angebot_gueltig_bis,
       customer:customer_id ( name, contact_person, address, zip, city )`,
    )
    .eq("id", id)
    .maybeSingle();

  if (!v) {
    return { ok: false, grund: "Vorgang nicht gefunden." };
  }

  const { data: firma } = await supabase
    .from("company")
    .select("name, rechtsform, address, zip, city, country, uid_nr, firmenbuch_nr, firmenbuch_gericht, email, phone, website, iban, bic, pdf_settings")
    .maybeSingle();

  /*
   * Rabatt und Lieferkosten sind kaufmännisch und stehen deshalb NICHT
   * als Spalte auf vorgang zur Verfügung: 0025 hat das Tabellenrecht
   * entzogen, 0041 hat sie bewusst nur für update freigegeben. Gelesen
   * werden sie über v_vorgang_wert, die can('angebote','read') prüft.
   *
   * Aufgefallen, weil das PDF plötzlich 404 lieferte: eine einzige
   * Spalte ohne Recht lässt die GANZE Abfrage leer laufen — dieselbe
   * Falle wie in 0009, 0029 und 0041.
   */
  const { data: wert } = await supabase
    .from("v_vorgang_wert")
    .select("rabatt_prozent, lieferung_netto")
    .eq("vorgang_id", id)
    .maybeSingle();

  const marke = markeAus(firma?.pdf_settings, firma?.name as string | undefined, [
    firma?.zip as string | null,
    firma?.city as string | null,
  ]);

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
      return { ok: false, grund: "Beleg nicht gefunden." };
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
    .select(
      "sort, gruppe_id, bezeichnung, beschreibung, menge, einheit, ep_netto, ust_satz, rabatt_prozent, optional, kalk_stunden, kalk_ek, ist_material, bild_url",
    )
    .eq("vorgang_id", id)
    .order("sort");

  const { data: posRoh } = positionsDokument
    ? await abfrage.eq("dokument_id", positionsDokument)
    : await abfrage.is("dokument_id", null);

  const positionen = ((posRoh ?? []) as unknown as PosRoh[]).map((p, i) => ({
    pos: (i + 1) * 10,
    gruppeId: (p.gruppe_id as string | null) ?? null,
    text: p.bezeichnung,
    beschreibung: (p.beschreibung as string | null) ?? null,
    menge: Number(p.menge),
    einheit: p.einheit,
    epNetto: Number(p.ep_netto),
    ustSatz: Number(p.ust_satz),
    rabattProzent: p.rabatt_prozent === null ? 0 : Number(p.rabatt_prozent),
    optional: Boolean(p.optional),
    ...(bildQuelle(p.bild_url) ? { bildUrl: bildQuelle(p.bild_url)! } : {}),
  }));

  /*
   * Die Gruppen derselben Fassung wie die Positionen. Ohne sie stünde im
   * PDF eine flache Liste, während der Kunde im Portal Pakete sieht —
   * zwei Darstellungen desselben Angebots sind eine zu viel.
   */
  const gruppenAbfrage = supabase
    .from("vorgang_gruppe")
    .select("id, name, beschreibung, paket_preis, einzelpreise_verstecken, sort")
    .eq("vorgang_id", id)
    .order("sort");

  const { data: gruppenRoh } = positionsDokument
    ? await gruppenAbfrage.eq("dokument_id", positionsDokument)
    : await gruppenAbfrage.is("dokument_id", null);

  const gruppen = ((gruppenRoh ?? []) as unknown as {
    id: string;
    name: string;
    beschreibung: string | null;
    paket_preis: string | null;
    einzelpreise_verstecken: boolean;
  }[]).map((g) => ({
    id: g.id,
    name: g.name,
    beschreibung: g.beschreibung,
    paketPreis: g.paket_preis === null ? null : Number(g.paket_preis),
    einzelpreiseVerstecken: g.einzelpreise_verstecken,
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
    gueltigBis:
      art === "angebot"
        ? ((v.angebot_gueltig_bis as string | null) ?? gueltig.toISOString())
        : null,
    faelligAm: dokument?.faellig_am ?? null,
    marke: {
      logoUrl: marke.logoUrl,
      akzent: marke.akzent,
    },
    texte: {
      titel: (v.angebot_titel as string | null) ?? null,
      einleitung: (v.angebot_einleitung as string | null) ?? null,
      abschluss: (v.angebot_abschluss as string | null) ?? null,
    },
    gruppen,
    rahmen: {
      ustSatz: v.ust_satz === null ? 20 : Number(v.ust_satz),
      rabattProzent: wert?.rabatt_prozent ? Number(wert.rabatt_prozent) : 0,
      lieferungNetto: wert?.lieferung_netto ? Number(wert.lieferung_netto) : 0,
    },
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

  const dateiname = `${data.belegNummer ?? data.vorgangNummer}-${art}.pdf`;
  return { ok: true, buffer, dateiname };
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
  gruppe_id: string | null;
  bezeichnung: string;
  beschreibung: string | null;
  rabatt_prozent: string | null;
  optional: boolean;
  menge: string;
  einheit: string;
  ep_netto: string;
  ust_satz: string;
  kalk_stunden: string | null;
  kalk_ek: string | null;
  ist_material: boolean;
  bild_url: string | null;
};
