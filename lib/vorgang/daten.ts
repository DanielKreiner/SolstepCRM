import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { GateStatus, Phase } from "./modell";

/**
 * Lesezugriff auf Vorgänge.
 *
 * Alles hier läuft über den RLS-Client des angemeldeten Nutzers. Beträge
 * kommen nicht aus vorgang (dort sind sie spaltengesperrt), sondern aus
 * v_vorgang_wert — die View prüft can('pipelines'). Ein Monteur bekommt
 * darauf schlicht keine Zeile, und die Anzeige zeigt einen Strich statt
 * einer Zahl, die er nicht sehen darf.
 */

export type VorgangKopf = {
  id: string;
  number: string;
  phase: Phase;
  phaseSeit: string;
  kundeId: string;
  kundeName: string;
  kontakt: string | null;
  email: string | null;
  telefon: string | null;
  adresse: string | null;
  plz: string | null;
  ort: string | null;
  zaehlpunkt: string | null;
  kwp: number | null;
  speicherKwh: number | null;
  anzahlungProzent: number;
  verlorenGrund: string | null;
  verlorenNotiz: string | null;
  zustaendigId: string | null;
  zustaendigName: string | null;
  wiedervorlageAm: string | null;
  altNummern: string | null;
  /** null, wenn die Rolle keine Beträge sehen darf. */
  angebotswertNetto: number | null;
  /* Angebotsrahmen — Rabatt und Lieferung nur für Rollen mit Betragsrecht. */
  ustSatz: number;
  rabattProzent: number;
  lieferungNetto: number;
  angebotTitel: string | null;
  angebotEinleitung: string | null;
  angebotAbschluss: string | null;
  angebotGueltigBis: string | null;
  auftragswertNetto: number | null;
  sollStunden: number | null;
  sollMaterialkosten: number | null;
  darfBetraege: boolean;
};

export type GateZeile = {
  id: string;
  key: string;
  label: string;
  meta: string | null;
  status: GateStatus;
  blocking: boolean;
  sort: number;
  zustaendigName: string | null;
  faelligAm: string | null;
};

export type EventZeile = {
  id: string;
  typ: string;
  titel: string;
  body: string | null;
  createdAt: string;
  autorName: string | null;
  dokumentId: string | null;
};

export type DokumentZeile = {
  id: string;
  typ: string;
  version: number;
  nummer: string | null;
  dateiname: string;
  storagePath: string | null;
  betragNetto: number | null;
  betragBrutto: number | null;
  status: string | null;
  faelligAm: string | null;
  bezahltAm: string | null;
  createdAt: string;
};

export type GruppeZeile = {
  id: string;
  name: string;
  beschreibung: string | null;
  sort: number;
  /** Überschreibt die Summe der enthaltenen Positionen. */
  paketPreis: number | null;
  einzelpreiseVerstecken: boolean;
};

export type PositionZeile = {
  id: string;
  gruppeId: string | null;
  optional: boolean;
  rabattProzent: number;
  upgradeArticleId: string | null;
  upgradeKategorie: string | null;
  upgradeAufpreis: number | null;
  upgradeText: string | null;
  sort: number;
  articleId: string | null;
  bezeichnung: string;
  menge: number;
  einheit: string;
  epNetto: number;
  ustSatz: number;
  kalkStunden: number | null;
  kalkEk: number | null;
  istMaterial: boolean;
  bildUrl: string | null;
  beschreibung: string | null;
};

export type TerminZeile = {
  id: string;
  art: string;
  von: string;
  bis: string;
  subText: string | null;
  notiz: string | null;
  personen: string[];
};

export type VorgangDetail = {
  kopf: VorgangKopf;
  gates: GateZeile[];
  events: EventZeile[];
  dokumente: DokumentZeile[];
  positionen: PositionZeile[];
  gruppen: GruppeZeile[];
  termine: TerminZeile[];
};

/**
 * Ein Vorgang mit allem, was die Detailansicht zeigt.
 *
 * Sieben Abfragen statt eines grossen Joins: der Aktivitätsstrom hat
 * hunderte Zeilen, und über einen Join würden Kopf, Gates und Dokumente
 * genauso oft mitkommen.
 */
export async function vorgangDetail(id: string): Promise<VorgangDetail | null> {
  const supabase = await createClient();

  const { data: v } = await supabase
    .from("vorgang")
    .select(
      `id, number, phase, phase_seit, customer_id, adresse, plz, ort, zaehlpunkt,
       kwp, speicher_kwh, anzahlung_prozent, verloren_grund, verloren_notiz,
       zustaendig_user_id, wiedervorlage_am, alt_nummern, ust_satz,
       angebot_titel, angebot_einleitung, angebot_abschluss, angebot_gueltig_bis,
       customer:customer_id ( id, name, contact_person, email, phone ),
       zustaendig:zustaendig_user_id ( name )`,
    )
    .eq("id", id)
    .maybeSingle();

  if (!v) return null;

  const [
    { data: wert },
    { data: gates },
    { data: events },
    { data: dokumente },
    { data: positionen },
    { data: gruppen },
    { data: termine },
  ] =
    await Promise.all([
      supabase
        .from("v_vorgang_wert")
        .select("angebotswert_netto, auftragswert_netto, soll_stunden, soll_materialkosten, rabatt_prozent, lieferung_netto")
        .eq("vorgang_id", id)
        .maybeSingle(),
      supabase
        .from("vorgang_gate")
        .select(
          "id, key, label, meta, status, blocking, sort, faellig_am, zustaendig:zustaendig_user_id ( name )",
        )
        .eq("vorgang_id", id)
        .order("sort"),
      supabase
        .from("vorgang_event")
        .select("id, typ, titel, body, created_at, dokument_id, autor:created_by ( name )")
        .eq("vorgang_id", id)
        .order("created_at", { ascending: false })
        .limit(200),
      supabase
        .from("vorgang_dokument")
        .select(
          "id, typ, version, nummer, dateiname, storage_path, betrag_netto, betrag_brutto, status, faellig_am, bezahlt_am, created_at",
        )
        .eq("vorgang_id", id)
        .order("created_at", { ascending: false }),
      supabase
        .from("vorgang_position")
        .select(
          "id, sort, gruppe_id, optional, rabatt_prozent, upgrade_article_id, upgrade_kategorie, upgrade_aufpreis, upgrade_text, article_id, bezeichnung, menge, einheit, ep_netto, ust_satz, kalk_stunden, kalk_ek, ist_material, bild_url, beschreibung",
        )
        .eq("vorgang_id", id)
        .is("dokument_id", null)
        .order("sort"),
      supabase
        .from("vorgang_gruppe")
        .select("id, name, beschreibung, sort, paket_preis, einzelpreise_verstecken")
        .eq("vorgang_id", id)
        .is("dokument_id", null)
        .order("sort"),
      supabase
        .from("vorgang_termin")
        .select(
          "id, art, von, bis, sub_text, notiz, personen:vorgang_termin_person ( user:user_id ( name ) )",
        )
        .eq("vorgang_id", id)
        .order("von"),
    ]);

  const kunde = v.customer as unknown as {
    id: string;
    name: string;
    contact_person: string | null;
    email: string | null;
    phone: string | null;
  } | null;

  return {
    kopf: {
      id: v.id as string,
      number: v.number as string,
      phase: v.phase as Phase,
      phaseSeit: v.phase_seit as string,
      kundeId: kunde?.id ?? "",
      kundeName: kunde?.name ?? "—",
      kontakt: kunde?.contact_person ?? null,
      email: kunde?.email ?? null,
      telefon: kunde?.phone ?? null,
      adresse: (v.adresse as string | null) ?? null,
      plz: (v.plz as string | null) ?? null,
      ort: (v.ort as string | null) ?? null,
      zaehlpunkt: (v.zaehlpunkt as string | null) ?? null,
      kwp: v.kwp === null ? null : Number(v.kwp),
      speicherKwh: v.speicher_kwh === null ? null : Number(v.speicher_kwh),
      anzahlungProzent: Number(v.anzahlung_prozent),
      verlorenGrund: (v.verloren_grund as string | null) ?? null,
      verlorenNotiz: (v.verloren_notiz as string | null) ?? null,
      zustaendigId: (v.zustaendig_user_id as string | null) ?? null,
      zustaendigName:
        (v.zustaendig as unknown as { name: string } | null)?.name ?? null,
      wiedervorlageAm: (v.wiedervorlage_am as string | null) ?? null,
      altNummern: (v.alt_nummern as string | null) ?? null,
      angebotswertNetto: zahl(wert?.angebotswert_netto),
      ustSatz: Number(v.ust_satz ?? 20),
      rabattProzent: Number(wert?.rabatt_prozent ?? 0),
      lieferungNetto: Number(wert?.lieferung_netto ?? 0),
      angebotTitel: (v.angebot_titel as string | null) ?? null,
      angebotEinleitung: (v.angebot_einleitung as string | null) ?? null,
      angebotAbschluss: (v.angebot_abschluss as string | null) ?? null,
      angebotGueltigBis: (v.angebot_gueltig_bis as string | null) ?? null,
      auftragswertNetto: zahl(wert?.auftragswert_netto),
      sollStunden: zahl(wert?.soll_stunden),
      sollMaterialkosten: zahl(wert?.soll_materialkosten),
      /*
       * Kein wert-Datensatz heisst: die View hat nichts geliefert, weil
       * can('pipelines') false ist. Die Anzeige zeigt dann Striche und
       * keine Nullen — eine 0 € wäre eine Aussage, und zwar eine falsche.
       */
      darfBetraege: Boolean(wert),
    },
    gates: ((gates ?? []) as unknown as GateRoh[]).map((g) => ({
      id: g.id,
      key: g.key,
      label: g.label,
      meta: g.meta,
      status: g.status,
      blocking: g.blocking,
      sort: g.sort,
      zustaendigName: g.zustaendig?.name ?? null,
      faelligAm: g.faellig_am,
    })),
    events: ((events ?? []) as unknown as EventRoh[]).map((e) => ({
      id: e.id,
      typ: e.typ,
      titel: e.titel,
      body: e.body,
      createdAt: e.created_at,
      autorName: e.autor?.name ?? null,
      dokumentId: e.dokument_id,
    })),
    dokumente: ((dokumente ?? []) as unknown as DokumentRoh[]).map((d) => ({
      id: d.id,
      typ: d.typ,
      version: d.version,
      nummer: d.nummer,
      dateiname: d.dateiname,
      storagePath: d.storage_path,
      betragNetto: zahl(d.betrag_netto),
      betragBrutto: zahl(d.betrag_brutto),
      status: d.status,
      faelligAm: d.faellig_am,
      bezahltAm: d.bezahlt_am,
      createdAt: d.created_at,
    })),
    positionen: ((positionen ?? []) as unknown as PositionRoh[]).map((p) => ({
      id: p.id,
      gruppeId: p.gruppe_id,
      optional: p.optional,
      rabattProzent: Number(p.rabatt_prozent ?? 0),
      upgradeArticleId: p.upgrade_article_id,
      upgradeKategorie: p.upgrade_kategorie,
      upgradeAufpreis: zahl(p.upgrade_aufpreis),
      upgradeText: p.upgrade_text,
      sort: p.sort,
      articleId: p.article_id,
      bezeichnung: p.bezeichnung,
      menge: Number(p.menge),
      einheit: p.einheit,
      epNetto: Number(p.ep_netto),
      ustSatz: Number(p.ust_satz),
      kalkStunden: zahl(p.kalk_stunden),
      kalkEk: zahl(p.kalk_ek),
      istMaterial: p.ist_material,
      bildUrl: p.bild_url,
      beschreibung: p.beschreibung,
    })),
    gruppen: ((gruppen ?? []) as unknown as GruppeRoh[]).map((g) => ({
      id: g.id,
      name: g.name,
      beschreibung: g.beschreibung,
      sort: g.sort,
      paketPreis: zahl(g.paket_preis),
      einzelpreiseVerstecken: g.einzelpreise_verstecken,
    })),
    termine: ((termine ?? []) as unknown as TerminRoh[]).map((t) => ({
      id: t.id,
      art: t.art,
      von: t.von,
      bis: t.bis,
      subText: t.sub_text,
      notiz: t.notiz,
      personen: (t.personen ?? [])
        .map((p) => p.user?.name)
        .filter((n): n is string => Boolean(n)),
    })),
  };
}

function zahl(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

type GateRoh = {
  id: string;
  key: string;
  label: string;
  meta: string | null;
  status: GateStatus;
  blocking: boolean;
  sort: number;
  faellig_am: string | null;
  zustaendig: { name: string } | null;
};

type EventRoh = {
  id: string;
  typ: string;
  titel: string;
  body: string | null;
  created_at: string;
  dokument_id: string | null;
  autor: { name: string } | null;
};

type DokumentRoh = {
  id: string;
  typ: string;
  version: number;
  nummer: string | null;
  dateiname: string;
  storage_path: string | null;
  betrag_netto: string | null;
  betrag_brutto: string | null;
  status: string | null;
  faellig_am: string | null;
  bezahlt_am: string | null;
  created_at: string;
};

type GruppeRoh = {
  id: string;
  name: string;
  beschreibung: string | null;
  sort: number;
  paket_preis: string | null;
  einzelpreise_verstecken: boolean;
};

type PositionRoh = {
  id: string;
  sort: number;
  gruppe_id: string | null;
  optional: boolean;
  rabatt_prozent: string | null;
  upgrade_article_id: string | null;
  upgrade_kategorie: string | null;
  upgrade_aufpreis: string | null;
  upgrade_text: string | null;
  article_id: string | null;
  bezeichnung: string;
  menge: string;
  einheit: string;
  ep_netto: string;
  ust_satz: string;
  kalk_stunden: string | null;
  kalk_ek: string | null;
  ist_material: boolean;
  bild_url: string | null;
  beschreibung: string | null;
};

type TerminRoh = {
  id: string;
  art: string;
  von: string;
  bis: string;
  sub_text: string | null;
  notiz: string | null;
  personen: { user: { name: string } | null }[] | null;
};
