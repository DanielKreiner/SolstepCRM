import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { kaskadeAusloesen } from "@/lib/vorgang/kaskade";
import type { PortalSession } from "./data";
import type { Phase } from "@/lib/vorgang/modell";

/**
 * Der Vorgang aus Sicht des Kunden.
 *
 * Das Portal hat keine Supabase-Sitzung, an der RLS greifen könnte — die
 * gesamte Trennung liegt deshalb hier: jede Abfrage schränkt selbst auf
 * customer_id und company_id ein (CLAUDE.md 4.3).
 *
 * Was der Kunde sieht, entscheidet kunde_sichtbar an Ereignis und
 * Dokument, nicht eine Liste in diesem Modul. Ein neuer Ereignistyp ist
 * damit zunächst unsichtbar — die richtige Richtung.
 */

export type PortalVorgang = {
  id: string;
  nummer: string;
  phase: Phase;
  kwp: number | null;
  speicherKwh: number | null;
  adresse: string | null;
  plz: string | null;
  ort: string | null;
  angebotswertNetto: number | null;
  auftragswertNetto: number | null;
  verlorenAm: string | null;
};

export type PortalSchritt = {
  id: string;
  typ: string;
  titel: string;
  body: string | null;
  createdAt: string;
};

export type PortalDokument = {
  id: string;
  typ: string;
  nummer: string | null;
  dateiname: string;
  betragBrutto: number | null;
  status: string | null;
  faelligAm: string | null;
  bezahltAm: string | null;
  createdAt: string;
};

export type PortalPosition = {
  id: string;
  gruppeId: string | null;
  bezeichnung: string;
  hersteller: string | null;
  kategorie: string | null;
  menge: number;
  einheit: string;
  epNetto: number;
  ustSatz: number;
  rabattProzent: number;
  optional: boolean;
  /* Was der Kunde daraus gemacht hat. */
  kundenAuswahl: string;
  upgradeName: string | null;
  upgradeAufpreis: number | null;
  upgradeText: string | null;
  bildUrl: string | null;
  beschreibung: string | null;
  datenblattUrl: string | null;
  techSpecs: { key?: string; value?: string; unit?: string; group?: string }[] | null;
};

export type PortalGruppe = {
  id: string;
  name: string;
  beschreibung: string | null;
  sort: number;
  paketPreis: number | null;
  einzelpreiseVerstecken: boolean;
};

export type PortalTermin = {
  id: string;
  art: string;
  von: string;
  bis: string;
  notiz: string | null;
  bestaetigtAm: string | null;
  /* Vornamen genügen: der Kunde will wissen, wer kommt, nicht wer wo wohnt. */
  personen: string[];
};

/** Alle Vorgänge dieses Kunden, neueste zuerst. */
export async function portalVorgaenge(
  session: PortalSession,
): Promise<PortalVorgang[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("vorgang")
    .select(
      "id, number, phase, kwp, speicher_kwh, adresse, plz, ort, angebotswert_netto, auftragswert_netto, verloren_am, created_at",
    )
    .eq("customer_id", session.customerId)
    .eq("company_id", session.companyId)
    .order("created_at", { ascending: false });

  return ((data ?? []) as unknown as Roh[]).map(abbilden);
}

export type PortalDetail = {
  vorgang: PortalVorgang;
  schritte: PortalSchritt[];
  dokumente: PortalDokument[];
  positionen: PortalPosition[];
  gruppen: PortalGruppe[];
  ansprechpartner: {
    name: string;
    rolle: string | null;
    telefon: string | null;
  } | null;
  /* Steuersatz, Rabatt und Lieferung — die Zahlen unter dem Strich. */
  rahmen: { ustSatz: number; rabattProzent: number; lieferungNetto: number };
  texte: {
    titel: string | null;
    einleitung: string | null;
    abschluss: string | null;
    gueltigBis: string | null;
  };
  termine: PortalTermin[];
  firma: {
    name: string;
    adresse: string | null;
    plz: string | null;
    ort: string | null;
    iban: string | null;
  } | null;
  /** Angenommen? Dann steht das Angebot fest. */
  angenommen: boolean;
  /**
   * Ist das Angebot überhaupt schon abgeschickt? Ist es das nicht, gibt
   * es keine Positionen — und der Kunde bekommt einen Satz statt einer
   * leeren Seite, die aussieht, als sei etwas kaputt.
   */
  angebotVersendet: boolean;
};

export async function portalVorgangDetail(
  session: PortalSession,
  vorgangId: string,
): Promise<PortalDetail | null> {
  const admin = createAdminClient();

  const { data: v } = await admin
    .from("vorgang")
    .select(
      `id, number, phase, kwp, speicher_kwh, adresse, plz, ort,
       angebotswert_netto, auftragswert_netto, verloren_am, created_at,
       ust_satz, rabatt_prozent, lieferung_netto,
       angebot_titel, angebot_einleitung, angebot_abschluss, angebot_gueltig_bis,
       angebot_versendet_am,
       zustaendig:zustaendig_user_id ( name, role, phone )`,
    )
    .eq("id", vorgangId)
    /* Der Token allein reicht nicht — der Vorgang muss diesem Kunden gehören. */
    .eq("customer_id", session.customerId)
    .eq("company_id", session.companyId)
    .maybeSingle();

  if (!v) return null;

  const [{ data: schritte }, { data: dokumente }, { data: termine }, { data: firma }] =
    await Promise.all([
      admin
        .from("vorgang_event")
        .select("id, typ, titel, body, created_at")
        .eq("vorgang_id", vorgangId)
        .eq("kunde_sichtbar", true)
        .order("created_at", { ascending: false })
        .limit(100),
      admin
        .from("vorgang_dokument")
        .select(
          "id, typ, nummer, dateiname, betrag_brutto, status, faellig_am, bezahlt_am, created_at",
        )
        .eq("vorgang_id", vorgangId)
        .eq("kunde_sichtbar", true)
        .order("created_at", { ascending: false }),
      admin
        .from("vorgang_termin")
        .select("id, art, von, bis, notiz, kunde_bestaetigt_am, personen:vorgang_termin_person ( user:user_id ( name ) )")
        .eq("vorgang_id", vorgangId)
        .order("von"),
      admin
        .from("company")
        .select("name, address, zip, city, iban")
        .eq("id", session.companyId)
        .maybeSingle(),
    ]);

  /*
   * Die Positionen der angenommenen Fassung, sonst der Entwurf. Der Kunde
   * soll das sehen, was gilt — nach der Annahme ist das die eingefrorene
   * Fassung an der Auftragsbestätigung.
   */
  const ab = ((dokumente ?? []) as unknown as { id: string; typ: string }[]).find(
    (d) => d.typ === "ab",
  );

  const posAbfrage = admin
    .from("vorgang_position")
    .select(
      `id, gruppe_id, bezeichnung, menge, einheit, ep_netto, ust_satz,
       rabatt_prozent, optional, kunden_auswahl,
       upgrade_article_id, upgrade_aufpreis, upgrade_text,
       bild_url, beschreibung, sort,
       artikel:article_id ( manufacturer, category, datasheet_url, tech_specs ),
       upgradeZiel:upgrade_article_id ( name )`,
    )
    .eq("vorgang_id", vorgangId)
    .order("sort");

  const gruppenAbfrage = admin
    .from("vorgang_gruppe")
    .select("id, name, beschreibung, sort, paket_preis, einzelpreise_verstecken")
    .eq("vorgang_id", vorgangId)
    .order("sort");

  /*
   * Ein Angebot ist so lange ein Entwurf, bis der Betrieb es abschickt.
   * Vorher liefert das Portal keine Positionen — nicht ausgeblendet im
   * Markup, sondern gar nicht geladen. Ausgeblendetes steht sonst im
   * HTML und ist mit einem Rechtsklick zu lesen.
   *
   * Nach der Annahme gilt die eingefrorene Fassung an der AB; die ist
   * per Definition abgeschickt und hängt nicht am Zeitstempel.
   */
  const angebotOffen = ab !== undefined || v.angebot_versendet_am !== null;

  const [{ data: positionen }, { data: gruppen }] = angebotOffen
    ? await Promise.all([
        ab ? posAbfrage.eq("dokument_id", ab.id) : posAbfrage.is("dokument_id", null),
        ab
          ? gruppenAbfrage.eq("dokument_id", ab.id)
          : gruppenAbfrage.is("dokument_id", null),
      ])
    : [{ data: [] }, { data: [] }];

  /*
   * Der erste Blick des Kunden. Nur der erste — die Frage im Vertrieb
   * lautet „hat er es gesehen", nicht „wie oft". Ohne await, weil der
   * Kunde nicht auf einen Schreibvorgang warten soll, der ihn nichts
   * angeht.
   */
  if (angebotOffen && !ab) {
    void admin
      .from("vorgang")
      .update({ angebot_gesehen_am: new Date().toISOString() })
      .eq("id", vorgangId)
      .is("angebot_gesehen_am", null)
      .then(() => undefined);
  }

  return {
    vorgang: abbilden(v as unknown as Roh),
    angenommen: Boolean(ab),
    angebotVersendet: angebotOffen,
    schritte: ((schritte ?? []) as unknown as {
      id: string;
      typ: string;
      titel: string;
      body: string | null;
      created_at: string;
    }[]).map((e) => ({
      id: e.id,
      typ: e.typ,
      titel: e.titel,
      body: e.body,
      createdAt: e.created_at,
    })),
    dokumente: ((dokumente ?? []) as unknown as DokRoh[]).map((d) => ({
      id: d.id,
      typ: d.typ,
      nummer: d.nummer,
      dateiname: d.dateiname,
      betragBrutto: d.betrag_brutto === null ? null : Number(d.betrag_brutto),
      status: d.status,
      faelligAm: d.faellig_am,
      bezahltAm: d.bezahlt_am,
      createdAt: d.created_at,
    })),
    gruppen: ((gruppen ?? []) as unknown as GruppeRoh[]).map((g) => ({
      id: g.id,
      name: g.name,
      beschreibung: g.beschreibung,
      sort: g.sort,
      paketPreis: g.paket_preis === null ? null : Number(g.paket_preis),
      einzelpreiseVerstecken: g.einzelpreise_verstecken,
    })),
    rahmen: {
      ustSatz: Number(v.ust_satz ?? 20),
      rabattProzent: Number(v.rabatt_prozent ?? 0),
      lieferungNetto: Number(v.lieferung_netto ?? 0),
    },
    /*
     * Wer im Portal etwas nicht versteht, sucht keine Kontaktseite,
     * sondern eine Telefonnummer. Deshalb reist der Zuständige mit.
     */
    ansprechpartner: (() => {
      const z = v.zustaendig as unknown as {
        name: string;
        role: string | null;
        phone: string | null;
      } | null;
      return z
        ? { name: z.name, rolle: z.role ? ROLLE[z.role] ?? z.role : null, telefon: z.phone }
        : null;
    })(),
    texte: {
      titel: (v.angebot_titel as string | null) ?? null,
      einleitung: (v.angebot_einleitung as string | null) ?? null,
      abschluss: (v.angebot_abschluss as string | null) ?? null,
      gueltigBis: (v.angebot_gueltig_bis as string | null) ?? null,
    },
    positionen: ((positionen ?? []) as unknown as PosRoh[]).map((p) => ({
      id: p.id,
      gruppeId: p.gruppe_id,
      hersteller: p.artikel?.manufacturer ?? null,
      kategorie: p.artikel?.category ?? null,
      rabattProzent: Number(p.rabatt_prozent ?? 0),
      optional: p.optional,
      kundenAuswahl: p.kunden_auswahl,
      upgradeName: p.upgradeZiel?.name ?? null,
      upgradeAufpreis:
        p.upgrade_aufpreis === null ? null : Number(p.upgrade_aufpreis),
      upgradeText: p.upgrade_text,
      datenblattUrl: p.artikel?.datasheet_url ?? null,
      techSpecs: p.artikel?.tech_specs ?? null,
      bezeichnung: p.bezeichnung,
      menge: Number(p.menge),
      einheit: p.einheit,
      epNetto: Number(p.ep_netto),
      ustSatz: Number(p.ust_satz),
      bildUrl: p.bild_url,
      beschreibung: p.beschreibung,
    })),
    termine: ((termine ?? []) as unknown as TerminRoh[]).map((t) => ({
      id: t.id,
      art: t.art,
      von: t.von,
      bis: t.bis,
      notiz: t.notiz,
      bestaetigtAm: t.kunde_bestaetigt_am,
      personen: (t.personen ?? [])
        .map((p) => p.user?.name?.split(/\s+/)[0])
        .filter((n): n is string => Boolean(n)),
    })),
    firma: firma
      ? {
          name: firma.name as string,
          adresse: (firma.address as string | null) ?? null,
          plz: (firma.zip as string | null) ?? null,
          ort: (firma.city as string | null) ?? null,
          iban: (firma.iban as string | null) ?? null,
        }
      : null,
  };
}

/**
 * Der Kunde nimmt sein Angebot an.
 *
 * Löst dieselbe Kaskade aus wie das Backoffice — eine zweite Fassung wäre
 * eine zweite Wahrheit darüber, was ein Auftrag ist. Genau dieser Fehler
 * ist beim alten Modell schon einmal passiert: die Portalannahme legte
 * keinen Auftrag an.
 */
export async function portalVorgangAnnehmen(
  session: PortalSession,
  vorgangId: string,
  name: string,
  ip: string | null,
  auswahl: { optionen: string[]; upgrades: string[] } = {
    optionen: [],
    upgrades: [],
  },
): Promise<{ ok: boolean; meldung: string }> {
  const admin = createAdminClient();

  const { data: v } = await admin
    .from("vorgang")
    .select("id, number, phase, anzahlung_prozent")
    .eq("id", vorgangId)
    .eq("customer_id", session.customerId)
    .eq("company_id", session.companyId)
    .maybeSingle();

  if (!v) return { ok: false, meldung: "Angebot nicht gefunden." };

  /*
   * Erst die Wahl des Kunden festschreiben, dann die Kaskade — sie friert
   * die Positionen ein, und was dann noch optional ist, wäre für immer
   * abgewählt. Andersherum bestellte der Kunde etwas anderes, als die
   * Seite ihm ausgerechnet hat.
   *
   * Die IDs kommen aus dem Formular und sind damit vom Kunden bestimmt.
   * Deshalb wird nur innerhalb dieses Vorgangs und nur auf optionale
   * Zeilen geschrieben: eine geratene fremde ID trifft nichts.
   */
  const { data: optionen } = await admin
    .from("vorgang_position")
    .select("id, upgrade_article_id, upgrade_aufpreis, menge, ep_netto")
    .eq("vorgang_id", vorgangId)
    .is("dokument_id", null);

  const gewaehlt = new Set(auswahl.optionen);
  const upgradeWunsch = new Set(auswahl.upgrades);

  for (const p of optionen ?? []) {
    const id = p.id as string;

    if (gewaehlt.has(id)) {
      /* Angekreuzt: zählt ab jetzt wie jede andere Position. */
      await admin
        .from("vorgang_position")
        .update({ optional: false, kunden_auswahl: "gewaehlt" })
        .eq("id", id)
        .eq("vorgang_id", vorgangId)
        .eq("optional", true);
    } else {
      await admin
        .from("vorgang_position")
        .update({ kunden_auswahl: "abgewaehlt" })
        .eq("id", id)
        .eq("vorgang_id", vorgangId)
        .eq("optional", true);
    }

    /*
     * Upgrade: die Position wird zum besseren Produkt. Der Aufpreis ist
     * brutto und stand im Angebot — der Nettoaufschlag folgt daraus, mit
     * demselben Steuersatz, den die Position trägt.
     */
    if (upgradeWunsch.has(id) && p.upgrade_article_id && p.upgrade_aufpreis) {
      const { data: ziel } = await admin
        .from("article")
        .select("name, sale_price, purchase_price, image_url, description, unit")
        .eq("id", p.upgrade_article_id as string)
        .maybeSingle();

      if (ziel) {
        await admin
          .from("vorgang_position")
          .update({
            article_id: p.upgrade_article_id,
            bezeichnung: ziel.name as string,
            ep_netto: ziel.sale_price,
            kalk_ek: ziel.purchase_price,
            einheit: (ziel.unit as string) ?? "Stk",
            bild_url: ziel.image_url,
            beschreibung: ziel.description,
            kunden_auswahl: "upgraded",
            upgrade_article_id: null,
            upgrade_aufpreis: null,
            upgrade_kategorie: null,
            upgrade_text: null,
          })
          .eq("id", id)
          .eq("vorgang_id", vorgangId);
      }
    }
  }

  const ergebnis = await kaskadeAusloesen(admin, {
    vorgangId,
    companyId: session.companyId,
    /* Kein Nutzer: angenommen hat der Kunde. */
    userId: null,
    anzahlungProzent: Number(v.anzahlung_prozent),
    wunschZeitraum: "",
    /*
     * Gerüst und Sub kann der Kunde nicht beurteilen. Beide Gates bleiben
     * offen und werden im Betrieb entschieden — eine Vorbelegung wäre
     * geraten und würde später jemanden in Sicherheit wiegen.
     */
    geruest: "ja",
    sub: "nein",
    quelle: "portal",
    angenommenVon: name,
  });

  if (!ergebnis.ok) return { ok: false, meldung: ergebnis.grund };

  if (ergebnis.neu) {
    await admin.from("vorgang_event").insert({
      company_id: session.companyId,
      vorgang_id: vorgangId,
      typ: "notiz",
      titel: "Zusage erfasst",
      body: `${name}${ip ? ` · ${ip}` : ""}`,
      kunde_sichtbar: false,
      payload: { name, ip },
    });

    await admin.from("notification").insert({
      company_id: session.companyId,
      kind: "vorgang_angenommen",
      title: `${v.number as string} im Portal angenommen`,
      body: `Angenommen durch ${name}. Auftrag ausgelöst.`,
      link: `/vorgaenge/${vorgangId}`,
    });
  }

  return { ok: true, meldung: ergebnis.meldung };
}

/* Rollenbezeichnung in Kundensprache — „bauleitung" sagt niemandem etwas. */
const ROLLE: Record<string, string> = {
  gf: "Geschäftsführung",
  buero: "Büro",
  bauleitung: "Bauleitung",
  monteur: "Montage",
  lager: "Lager",
};

/* ------------------------------------------------------------- INTERN */

function abbilden(v: Roh): PortalVorgang {
  return {
    id: v.id,
    nummer: v.number,
    phase: v.phase,
    kwp: v.kwp === null ? null : Number(v.kwp),
    speicherKwh: v.speicher_kwh === null ? null : Number(v.speicher_kwh),
    adresse: v.adresse,
    plz: v.plz,
    ort: v.ort,
    angebotswertNetto:
      v.angebotswert_netto === null ? null : Number(v.angebotswert_netto),
    auftragswertNetto:
      v.auftragswert_netto === null ? null : Number(v.auftragswert_netto),
    verlorenAm: v.verloren_am,
  };
}

type Roh = {
  id: string;
  number: string;
  phase: Phase;
  kwp: string | null;
  speicher_kwh: string | null;
  adresse: string | null;
  plz: string | null;
  ort: string | null;
  angebotswert_netto: string | null;
  auftragswert_netto: string | null;
  verloren_am: string | null;
};

type DokRoh = {
  id: string;
  typ: string;
  nummer: string | null;
  dateiname: string;
  betrag_brutto: string | null;
  status: string | null;
  faellig_am: string | null;
  bezahlt_am: string | null;
  created_at: string;
};

type PosRoh = {
  id: string;
  gruppe_id: string | null;
  bezeichnung: string;
  menge: string;
  einheit: string;
  ep_netto: string;
  ust_satz: string;
  rabatt_prozent: string | null;
  optional: boolean;
  kunden_auswahl: string;
  upgrade_article_id: string | null;
  upgrade_aufpreis: string | null;
  upgrade_text: string | null;
  bild_url: string | null;
  beschreibung: string | null;
  /* PostgREST liefert eingebettete 1:1-Bezüge als Objekt oder null. */
  artikel: {
    manufacturer: string | null;
    category: string | null;
    datasheet_url: string | null;
    tech_specs: { key?: string; value?: string; unit?: string; group?: string }[] | null;
  } | null;
  upgradeZiel: { name: string } | null;
};

type GruppeRoh = {
  id: string;
  name: string;
  beschreibung: string | null;
  sort: number;
  paket_preis: string | null;
  einzelpreise_verstecken: boolean;
};

type TerminRoh = {
  id: string;
  art: string;
  von: string;
  bis: string;
  notiz: string | null;
  kunde_bestaetigt_am: string | null;
  personen: { user: { name: string } | null }[] | null;
};
