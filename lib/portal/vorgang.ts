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
  bezeichnung: string;
  menge: number;
  einheit: string;
  epNetto: number;
  ustSatz: number;
  bildUrl: string | null;
  beschreibung: string | null;
};

export type PortalTermin = {
  id: string;
  art: string;
  von: string;
  bis: string;
  notiz: string | null;
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
};

export async function portalVorgangDetail(
  session: PortalSession,
  vorgangId: string,
): Promise<PortalDetail | null> {
  const admin = createAdminClient();

  const { data: v } = await admin
    .from("vorgang")
    .select(
      "id, number, phase, kwp, speicher_kwh, adresse, plz, ort, angebotswert_netto, auftragswert_netto, verloren_am, created_at",
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
        .select("id, art, von, bis, notiz, personen:vorgang_termin_person ( user:user_id ( name ) )")
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
    .select("id, bezeichnung, menge, einheit, ep_netto, ust_satz, bild_url, beschreibung, sort")
    .eq("vorgang_id", vorgangId)
    .order("sort");

  const { data: positionen } = ab
    ? await posAbfrage.eq("dokument_id", ab.id)
    : await posAbfrage.is("dokument_id", null);

  return {
    vorgang: abbilden(v as unknown as Roh),
    angenommen: Boolean(ab),
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
    positionen: ((positionen ?? []) as unknown as PosRoh[]).map((p) => ({
      id: p.id,
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
  bezeichnung: string;
  menge: string;
  einheit: string;
  ep_netto: string;
  ust_satz: string;
  bild_url: string | null;
  beschreibung: string | null;
};

type TerminRoh = {
  id: string;
  art: string;
  von: string;
  bis: string;
  notiz: string | null;
  personen: { user: { name: string } | null }[] | null;
};
