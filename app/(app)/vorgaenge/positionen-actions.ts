"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { summen } from "@/lib/vorgang/modell";
import { requireMe } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

export type PosStatus = { error: string | null; ok: string | null };

/**
 * Angebotspositionen — inline im Vorgang, kein eigener Screen.
 *
 * Positionen ohne dokument_id sind der lebende Entwurf. Sobald ein
 * Angebot erzeugt wird, bekommt eine Kopie die dokument_id der Version
 * und ist damit eingefroren: ein verschicktes Angebot darf sich nicht
 * ändern, weil jemand danach eine Menge korrigiert.
 */

type Zugang =
  | { ok: true; me: Awaited<ReturnType<typeof requireMe>> }
  | { ok: false; status: PosStatus };

async function zugang(): Promise<Zugang> {
  const me = await requireMe();
  if (me.perms.angebote !== "write") {
    return {
      ok: false,
      status: { error: "Für Angebote fehlt deiner Rolle das Schreibrecht.", ok: null },
    };
  }
  if (me.company.status !== "active") {
    return { ok: false, status: { error: "Der Zugang ist derzeit nur lesend.", ok: null } };
  }
  return { ok: true, me };
}

/**
 * Ein Angebot, das schon versendet wurde, wird nicht mehr angefasst.
 *
 * Geändert wird über eine neue Version. Sonst bekommt der Kunde ein PDF
 * mit anderen Zahlen als die, die im System stehen — und merkt es beim
 * Vergleich mit der Rechnung.
 */
async function gesperrt(
  supabase: Awaited<ReturnType<typeof createClient>>,
  vorgangId: string,
): Promise<PosStatus | null> {
  const { data: v } = await supabase
    .from("vorgang")
    .select("phase")
    .eq("id", vorgangId)
    .maybeSingle();

  if (!v) return { error: "Vorgang nicht gefunden.", ok: null };

  const phase = v.phase as string;
  if (["beauftragt", "montage", "abschluss"].includes(phase)) {
    return {
      error:
        "Der Auftrag läuft bereits. Änderungen am Leistungsumfang gehören in eine Nachtragsposition, nicht ins Angebot.",
      ok: null,
    };
  }
  return null;
}

async function summeSchreiben(
  supabase: Awaited<ReturnType<typeof createClient>>,
  vorgangId: string,
): Promise<void> {
  const { data } = await supabase
    .from("vorgang_position")
    .select("menge, ep_netto, ust_satz, kalk_stunden, kalk_ek, ist_material")
    .eq("vorgang_id", vorgangId)
    .is("dokument_id", null);

  const s = summen(
    ((data ?? []) as unknown as {
      menge: string;
      ep_netto: string;
      ust_satz: string;
      kalk_stunden: string | null;
      kalk_ek: string | null;
      ist_material: boolean;
    }[]).map((p) => ({
      menge: Number(p.menge),
      epNetto: Number(p.ep_netto),
      ustSatz: Number(p.ust_satz),
      kalkStunden: p.kalk_stunden === null ? null : Number(p.kalk_stunden),
      kalkEk: p.kalk_ek === null ? null : Number(p.kalk_ek),
      istMaterial: p.ist_material,
    })),
  );

  await supabase
    .from("vorgang")
    .update({ angebotswert_netto: s.netto, updated_at: new Date().toISOString() })
    .eq("id", vorgangId);
}

function frisch(vorgangId: string): void {
  revalidatePath(`/vorgaenge/${vorgangId}`);
  revalidatePath("/vorgaenge");
}

/* ------------------------------------------------------ ARTIKEL HOLEN */

const artikelSchema = z.object({
  vorgangId: z.string().uuid(),
  articleId: z.string().uuid({ message: "Bitte einen Artikel wählen." }),
  menge: z.coerce.number().gt(0, "Menge muss grösser als null sein."),
});

export async function positionAusArtikel(
  _prev: PosStatus,
  formData: FormData,
): Promise<PosStatus> {
  const z1 = await zugang();
  if (!z1.ok) return z1.status;

  const parsed = artikelSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Eingabe fehlt.", ok: null };
  }
  const d = parsed.data;

  const supabase = await createClient();
  const sperre = await gesperrt(supabase, d.vorgangId);
  if (sperre) return sperre;

  const { data: a } = await supabase
    .from("article")
    .select(
      "id, sku, name, unit, purchase_price, sale_price, vat_rate, description, image_url, kalk_stunden_pro_einheit, ist_material",
    )
    .eq("id", d.articleId)
    .maybeSingle();

  if (!a) return { error: "Artikel nicht gefunden.", ok: null };

  const { data: letzte } = await supabase
    .from("vorgang_position")
    .select("sort")
    .eq("vorgang_id", d.vorgangId)
    .is("dokument_id", null)
    .order("sort", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await supabase.from("vorgang_position").insert({
    company_id: z1.me.companyId,
    vorgang_id: d.vorgangId,
    sort: Number(letzte?.sort ?? 0) + 10,
    article_id: a.id,
    /*
     * Preise, Kalkulation, Bild und Text werden kopiert, nicht verknüpft.
     * Ein Angebot von heute darf sich nicht ändern, weil jemand nächstes
     * Jahr den Artikelpreis anhebt.
     */
    bezeichnung: a.name as string,
    menge: d.menge,
    einheit: (a.unit as string) ?? "Stk",
    ep_netto: a.sale_price,
    ust_satz: a.vat_rate,
    kalk_ek: a.purchase_price,
    kalk_stunden: a.kalk_stunden_pro_einheit,
    ist_material: (a.ist_material as boolean | null) ?? true,
    bild_url: a.image_url,
    beschreibung: a.description,
  });

  if (error) return { error: `Übernehmen fehlgeschlagen: ${error.message}`, ok: null };

  await summeSchreiben(supabase, d.vorgangId);
  frisch(d.vorgangId);
  return { error: null, ok: `${a.name as string} übernommen.` };
}

/* ------------------------------------------------------ FREIE POSITION */

const freiSchema = z.object({
  vorgangId: z.string().uuid(),
  bezeichnung: z.string().trim().min(2, "Bezeichnung fehlt.").max(200),
  menge: z.coerce.number().gt(0, "Menge muss grösser als null sein."),
  einheit: z.string().trim().max(20).optional().default("Stk"),
  epNetto: z.coerce.number().min(0),
  kalkEk: z.coerce.number().min(0).optional(),
  kalkStunden: z.coerce.number().min(0).optional(),
  ustSatz: z.coerce.number().min(0).max(30).optional(),
  istMaterial: z.enum(["ja", "nein"]).optional().default("nein"),
});

export async function positionFrei(
  _prev: PosStatus,
  formData: FormData,
): Promise<PosStatus> {
  const z1 = await zugang();
  if (!z1.ok) return z1.status;

  const parsed = freiSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Eingabe fehlt.", ok: null };
  }
  const d = parsed.data;

  const supabase = await createClient();
  const sperre = await gesperrt(supabase, d.vorgangId);
  if (sperre) return sperre;

  const { data: letzte } = await supabase
    .from("vorgang_position")
    .select("sort")
    .eq("vorgang_id", d.vorgangId)
    .is("dokument_id", null)
    .order("sort", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await supabase.from("vorgang_position").insert({
    company_id: z1.me.companyId,
    vorgang_id: d.vorgangId,
    sort: Number(letzte?.sort ?? 0) + 10,
    bezeichnung: d.bezeichnung,
    menge: d.menge,
    einheit: d.einheit || "Stk",
    ep_netto: d.epNetto,
    ust_satz: d.ustSatz ?? 20,
    kalk_ek: d.kalkEk ?? null,
    kalk_stunden: d.kalkStunden ?? null,
    ist_material: d.istMaterial === "ja",
  });

  if (error) return { error: `Anlegen fehlgeschlagen: ${error.message}`, ok: null };

  await summeSchreiben(supabase, d.vorgangId);
  frisch(d.vorgangId);
  return { error: null, ok: "Position angelegt." };
}

/* ---------------------------------------------------------- BEARBEITEN */

const aendernSchema = z.object({
  vorgangId: z.string().uuid(),
  positionId: z.string().uuid(),
  bezeichnung: z.string().trim().min(1).max(200),
  menge: z.coerce.number().gt(0),
  einheit: z.string().trim().max(20),
  epNetto: z.coerce.number().min(0),
  kalkEk: z.coerce.number().min(0).optional(),
  kalkStunden: z.coerce.number().min(0).optional(),
  ustSatz: z.coerce.number().min(0).max(30),
  istMaterial: z.enum(["ja", "nein"]).optional().default("nein"),
  rabattProzent: z.coerce.number().min(0).max(100).optional().default(0),
  optional: z.enum(["ja", "nein"]).optional().default("nein"),
});

export async function positionAendern(
  _prev: PosStatus,
  formData: FormData,
): Promise<PosStatus> {
  const z1 = await zugang();
  if (!z1.ok) return z1.status;

  const parsed = aendernSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Eingabe fehlt.", ok: null };
  }
  const d = parsed.data;

  const supabase = await createClient();
  const sperre = await gesperrt(supabase, d.vorgangId);
  if (sperre) return sperre;

  const { data: geschrieben, error } = await supabase
    .from("vorgang_position")
    .update({
      bezeichnung: d.bezeichnung,
      menge: d.menge,
      einheit: d.einheit,
      ep_netto: d.epNetto,
      ust_satz: d.ustSatz,
      kalk_ek: d.kalkEk ?? null,
      kalk_stunden: d.kalkStunden ?? null,
      ist_material: d.istMaterial === "ja",
      rabatt_prozent: d.rabattProzent,
      optional: d.optional === "ja",
    })
    .eq("id", d.positionId)
    .eq("vorgang_id", d.vorgangId)
    /* Nur den Entwurf: eine eingefrorene Version bleibt, wie sie war. */
    .is("dokument_id", null)
    .select("id");

  if (error) return { error: `Speichern fehlgeschlagen: ${error.message}`, ok: null };
  if (!geschrieben || geschrieben.length === 0) {
    return { error: "Diese Position gehört zu einer festgeschriebenen Version.", ok: null };
  }

  await summeSchreiben(supabase, d.vorgangId);
  frisch(d.vorgangId);
  return { error: null, ok: "Gespeichert." };
}

const loeschSchema = z.object({
  vorgangId: z.string().uuid(),
  positionId: z.string().uuid(),
});

export async function positionLoeschen(
  _prev: PosStatus,
  formData: FormData,
): Promise<PosStatus> {
  const z1 = await zugang();
  if (!z1.ok) return z1.status;

  const parsed = loeschSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Eingabe fehlt.", ok: null };

  const supabase = await createClient();
  const sperre = await gesperrt(supabase, parsed.data.vorgangId);
  if (sperre) return sperre;

  const { error } = await supabase
    .from("vorgang_position")
    .delete()
    .eq("id", parsed.data.positionId)
    .eq("vorgang_id", parsed.data.vorgangId)
    .is("dokument_id", null);

  if (error) return { error: `Löschen fehlgeschlagen: ${error.message}`, ok: null };

  await summeSchreiben(supabase, parsed.data.vorgangId);
  frisch(parsed.data.vorgangId);
  return { error: null, ok: "Position entfernt." };
}

/* ============================================================ GRUPPEN */

/*
 * Ein PV-Angebot ist keine Liste, sondern ein Paket. Der Kunde
 * entscheidet über "PV-Anlage 9,3 kWp für 7205,93 €" und nicht über
 * zwanzig Modulklemmen zu 3,10 €.
 */

const gruppeNeuSchema = z.object({
  vorgangId: z.string().uuid(),
  name: z.string().trim().min(2, "Name der Gruppe fehlt.").max(160),
  beschreibung: z.string().trim().max(2000).optional().default(""),
});

export async function gruppeAnlegen(
  _prev: PosStatus,
  formData: FormData,
): Promise<PosStatus> {
  const z1 = await zugang();
  if (!z1.ok) return z1.status;

  const parsed = gruppeNeuSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Eingabe fehlt.", ok: null };
  }
  const d = parsed.data;

  const supabase = await createClient();
  const sperre = await gesperrt(supabase, d.vorgangId);
  if (sperre) return sperre;

  const { data: letzte } = await supabase
    .from("vorgang_gruppe")
    .select("sort")
    .eq("vorgang_id", d.vorgangId)
    .is("dokument_id", null)
    .order("sort", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await supabase.from("vorgang_gruppe").insert({
    company_id: z1.me.companyId,
    vorgang_id: d.vorgangId,
    name: d.name,
    beschreibung: d.beschreibung || null,
    sort: Number(letzte?.sort ?? 0) + 10,
  });

  if (error) return { error: `Anlegen fehlgeschlagen: ${error.message}`, ok: null };

  frisch(d.vorgangId);
  return { error: null, ok: `Gruppe „${d.name}" angelegt.` };
}

const gruppeAendernSchema = z.object({
  vorgangId: z.string().uuid(),
  gruppeId: z.string().uuid(),
  name: z.string().trim().min(2, "Name der Gruppe fehlt.").max(160),
  beschreibung: z.string().trim().max(2000).optional().default(""),
  /* Leer heisst: die Positionen zählen sich selbst zusammen. */
  paketPreis: z.string().trim().optional().default(""),
  einzelpreiseVerstecken: z.enum(["ja", "nein"]).optional().default("nein"),
});

export async function gruppeAendern(
  _prev: PosStatus,
  formData: FormData,
): Promise<PosStatus> {
  const z1 = await zugang();
  if (!z1.ok) return z1.status;

  const parsed = gruppeAendernSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Eingabe fehlt.", ok: null };
  }
  const d = parsed.data;

  let paket: number | null = null;
  if (d.paketPreis !== "") {
    const n = Number(d.paketPreis.replace(",", "."));
    if (!Number.isFinite(n) || n < 0) {
      return { error: "Der Paketpreis ist keine Zahl.", ok: null };
    }
    paket = n;
  }

  const supabase = await createClient();
  const sperre = await gesperrt(supabase, d.vorgangId);
  if (sperre) return sperre;

  const { data: geschrieben, error } = await supabase
    .from("vorgang_gruppe")
    .update({
      name: d.name,
      beschreibung: d.beschreibung || null,
      paket_preis: paket,
      einzelpreise_verstecken: d.einzelpreiseVerstecken === "ja",
    })
    .eq("id", d.gruppeId)
    .eq("vorgang_id", d.vorgangId)
    .is("dokument_id", null)
    .select("id");

  if (error) return { error: `Speichern fehlgeschlagen: ${error.message}`, ok: null };
  if (!geschrieben?.length) {
    return { error: "Diese Gruppe gehört zu einer festgeschriebenen Version.", ok: null };
  }

  await summeSchreiben(supabase, d.vorgangId);
  frisch(d.vorgangId);
  return { error: null, ok: "Gespeichert." };
}

const gruppeLoeschSchema = z.object({
  vorgangId: z.string().uuid(),
  gruppeId: z.string().uuid(),
});

/**
 * Gruppe auflösen.
 *
 * Die Positionen bleiben und rutschen aus der Gruppe heraus — das
 * erledigt `on delete set null` am Fremdschlüssel. Eine Gruppe zu
 * löschen ist eine Gliederungsentscheidung und keine, die Leistungen
 * aus dem Angebot nimmt.
 */
export async function gruppeAufloesen(
  _prev: PosStatus,
  formData: FormData,
): Promise<PosStatus> {
  const z1 = await zugang();
  if (!z1.ok) return z1.status;

  const parsed = gruppeLoeschSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Eingabe fehlt.", ok: null };

  const supabase = await createClient();
  const sperre = await gesperrt(supabase, parsed.data.vorgangId);
  if (sperre) return sperre;

  const { error } = await supabase
    .from("vorgang_gruppe")
    .delete()
    .eq("id", parsed.data.gruppeId)
    .eq("vorgang_id", parsed.data.vorgangId)
    .is("dokument_id", null);

  if (error) return { error: `Löschen fehlgeschlagen: ${error.message}`, ok: null };

  await summeSchreiben(supabase, parsed.data.vorgangId);
  frisch(parsed.data.vorgangId);
  return { error: null, ok: "Gruppe aufgelöst, die Positionen bleiben." };
}

const zuordnenSchema = z.object({
  vorgangId: z.string().uuid(),
  positionId: z.string().uuid(),
  /* Leerstring heisst: raus aus jeder Gruppe. */
  gruppeId: z.string().uuid().optional().or(z.literal("")),
});

export async function positionZuordnen(
  _prev: PosStatus,
  formData: FormData,
): Promise<PosStatus> {
  const z1 = await zugang();
  if (!z1.ok) return z1.status;

  const parsed = zuordnenSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Eingabe fehlt.", ok: null };
  const d = parsed.data;

  const supabase = await createClient();
  const sperre = await gesperrt(supabase, d.vorgangId);
  if (sperre) return sperre;

  const { error } = await supabase
    .from("vorgang_position")
    .update({ gruppe_id: d.gruppeId || null })
    .eq("id", d.positionId)
    .eq("vorgang_id", d.vorgangId)
    .is("dokument_id", null);

  if (error) return { error: `Verschieben fehlgeschlagen: ${error.message}`, ok: null };

  await summeSchreiben(supabase, d.vorgangId);
  frisch(d.vorgangId);
  return { error: null, ok: d.gruppeId ? "In die Gruppe verschoben." : "Aus der Gruppe genommen." };
}

/* ====================================================== ANGEBOTSKOPF */

const kopfSchema = z.object({
  vorgangId: z.string().uuid(),
  ustSatz: z.coerce.number().min(0).max(30),
  rabattProzent: z.coerce.number().min(0).max(100),
  lieferungNetto: z.coerce.number().min(0),
  titel: z.string().trim().max(200).optional().default(""),
  einleitung: z.string().trim().max(4000).optional().default(""),
  abschluss: z.string().trim().max(4000).optional().default(""),
  gueltigBis: z.string().trim().optional().default(""),
});

/**
 * Steuersatz, Rabatt, Lieferung und die Texte des Angebots.
 *
 * Der Steuersatz gilt für alle Positionen und die Lieferung: eine PV-
 * Anlage nach Deutschland ist vollständig steuerfrei, eine nach
 * Österreich vollständig mit 20 %. Ein Angebot mit gemischten Sätzen
 * gibt es in diesem Geschäft nicht.
 */
export async function angebotskopfSpeichern(
  _prev: PosStatus,
  formData: FormData,
): Promise<PosStatus> {
  const z1 = await zugang();
  if (!z1.ok) return z1.status;

  const parsed = kopfSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Eingabe fehlt.", ok: null };
  }
  const d = parsed.data;

  const supabase = await createClient();
  const sperre = await gesperrt(supabase, d.vorgangId);
  if (sperre) return sperre;

  const { error } = await supabase
    .from("vorgang")
    .update({
      ust_satz: d.ustSatz,
      rabatt_prozent: d.rabattProzent,
      lieferung_netto: d.lieferungNetto,
      angebot_titel: d.titel || null,
      angebot_einleitung: d.einleitung || null,
      angebot_abschluss: d.abschluss || null,
      angebot_gueltig_bis: d.gueltigBis || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", d.vorgangId);

  if (error) return { error: `Speichern fehlgeschlagen: ${error.message}`, ok: null };

  /*
   * Der Steuersatz steht zusätzlich an jeder Position, weil eine
   * eingefrorene Angebotsversion ihn mitnehmen muss. Der Entwurf wird
   * deshalb mitgezogen.
   */
  await supabase
    .from("vorgang_position")
    .update({ ust_satz: d.ustSatz })
    .eq("vorgang_id", d.vorgangId)
    .is("dokument_id", null);

  await summeSchreiben(supabase, d.vorgangId);
  frisch(d.vorgangId);
  return { error: null, ok: "Gespeichert." };
}

/* =========================================================== UPGRADES */

const upgradeSchema = z.object({
  vorgangId: z.string().uuid(),
  positionId: z.string().uuid(),
  /* Entweder ein konkretes Produkt oder eine ganze Kategorie — nicht beides. */
  upgradeArticleId: z.string().uuid().optional().or(z.literal("")),
  upgradeKategorie: z.string().trim().max(80).optional().default(""),
  /* Leer heisst: aus der Preisdifferenz rechnen. */
  upgradeAufpreis: z.string().trim().optional().default(""),
  upgradeText: z.string().trim().max(500).optional().default(""),
});

/**
 * Ein Upgrade an eine Position hängen.
 *
 * Zwei Formen, weil es zwei Gespräche gibt: „statt der 9er die 12er
 * Batterie" ist ein konkretes Produkt, „einen grösseren Speicher, such
 * dir was aus" ist eine Kategorie.
 *
 * Der Aufpreis ist brutto und das, was der Kunde sieht. Leer gelassen
 * rechnet ihn die Aktion aus der Verkaufspreisdifferenz mal Menge mal
 * Steuersatz — genau einmal, beim Einrichten. Danach steht er fest:
 * ein Angebot darf sich nicht ändern, weil jemand einen Artikelpreis
 * anhebt.
 */
export async function upgradeSetzen(
  _prev: PosStatus,
  formData: FormData,
): Promise<PosStatus> {
  const z1 = await zugang();
  if (!z1.ok) return z1.status;

  const parsed = upgradeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Eingabe fehlt.", ok: null };
  }
  const d = parsed.data;

  const supabase = await createClient();
  const sperre = await gesperrt(supabase, d.vorgangId);
  if (sperre) return sperre;

  const artikelId = d.upgradeArticleId || null;
  const kategorie = d.upgradeKategorie || null;

  if (artikelId && kategorie) {
    return {
      error: "Entweder ein Produkt oder eine Kategorie — nicht beides.",
      ok: null,
    };
  }

  /* Beides leer heisst: Upgrade entfernen. */
  if (!artikelId && !kategorie) {
    const { error } = await supabase
      .from("vorgang_position")
      .update({
        upgrade_article_id: null,
        upgrade_kategorie: null,
        upgrade_aufpreis: null,
        upgrade_text: null,
      })
      .eq("id", d.positionId)
      .eq("vorgang_id", d.vorgangId)
      .is("dokument_id", null);

    if (error) return { error: `Speichern fehlgeschlagen: ${error.message}`, ok: null };
    frisch(d.vorgangId);
    return { error: null, ok: "Upgrade entfernt." };
  }

  let aufpreis: number | null = null;
  if (d.upgradeAufpreis !== "") {
    const n = Number(d.upgradeAufpreis.replace(",", "."));
    if (!Number.isFinite(n) || n < 0) {
      return { error: "Der Aufpreis ist keine Zahl.", ok: null };
    }
    aufpreis = n;
  }

  const { data: pos } = await supabase
    .from("vorgang_position")
    .select("menge, ep_netto, ust_satz")
    .eq("id", d.positionId)
    .eq("vorgang_id", d.vorgangId)
    .maybeSingle();

  if (!pos) return { error: "Position nicht gefunden.", ok: null };

  /*
   * Aufpreis aus der Differenz — nur bei einem konkreten Produkt. Bei
   * einer Kategorie steht erst bei der Wahl des Kunden fest, worauf er
   * upgradet; dort wird dann gerechnet.
   */
  if (aufpreis === null && artikelId) {
    const { data: ziel } = await supabase
      .from("article")
      .select("sale_price, name")
      .eq("id", artikelId)
      .maybeSingle();

    if (!ziel) return { error: "Das Upgrade-Produkt gibt es nicht mehr.", ok: null };

    const differenz = Number(ziel.sale_price) - Number(pos.ep_netto);
    if (differenz <= 0) {
      return {
        error: `${ziel.name as string} ist nicht teurer als die Position — dafür braucht es kein Upgrade.`,
        ok: null,
      };
    }
    const brutto = differenz * Number(pos.menge) * (1 + Number(pos.ust_satz) / 100);
    aufpreis = Math.round((brutto + Number.EPSILON) * 100) / 100;
  }

  if (aufpreis === null) {
    return {
      error: "Bei einem Kategorie-Upgrade braucht es einen Aufpreis.",
      ok: null,
    };
  }

  const { data: geschrieben, error } = await supabase
    .from("vorgang_position")
    .update({
      upgrade_article_id: artikelId,
      upgrade_kategorie: kategorie,
      upgrade_aufpreis: aufpreis,
      upgrade_text: d.upgradeText || null,
    })
    .eq("id", d.positionId)
    .eq("vorgang_id", d.vorgangId)
    .is("dokument_id", null)
    .select("id");

  if (error) return { error: `Speichern fehlgeschlagen: ${error.message}`, ok: null };
  if (!geschrieben?.length) {
    return { error: "Diese Position gehört zu einer festgeschriebenen Version.", ok: null };
  }

  frisch(d.vorgangId);
  return { error: null, ok: "Upgrade gespeichert." };
}
