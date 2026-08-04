"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  kwp,
  mengenJeModul,
  speicherAnzahl,
  wechselrichterFuer,
  type Kandidat,
  type Multiplikator,
} from "@/lib/vorgang/auslegung";
import { requireMe } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

export type VorlagenStatus = { error: string | null; ok: string | null };

/*
 * Vorlagen und Schnellzusammenbau.
 *
 * Ein Betrieb baut nicht jedes Angebot neu — es gibt drei, vier
 * Standardpakete, und der Rest sind Mengen. Beide Wege hierher führen
 * zum selben Ergebnis: Positionen und Gruppen im Entwurf des Vorgangs.
 */

async function zugang(): Promise<
  | { ok: true; me: Awaited<ReturnType<typeof requireMe>> }
  | { ok: false; status: VorlagenStatus }
> {
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
 * Angebot noch änderbar?
 *
 * Ab „beauftragt" ist der Leistungsumfang vereinbart. Eine Vorlage, die
 * dort alles ersetzt, würde einen laufenden Auftrag umschreiben.
 */
async function offen(
  supabase: Awaited<ReturnType<typeof createClient>>,
  vorgangId: string,
): Promise<VorlagenStatus | null> {
  const { data: v } = await supabase
    .from("vorgang")
    .select("phase")
    .eq("id", vorgangId)
    .maybeSingle();

  if (!v) return { error: "Vorgang nicht gefunden.", ok: null };
  if (["beauftragt", "montage", "abschluss"].includes(v.phase as string)) {
    return {
      error: "Der Auftrag läuft bereits — Änderungen gehören in eine Nachtragsposition.",
      ok: null,
    };
  }
  return null;
}

function frisch(vorgangId: string) {
  revalidatePath(`/vorgaenge/${vorgangId}`);
  revalidatePath("/vorgaenge");
}

/* ==================================================== SCHNELLZUSAMMENBAU */

const schnellSchema = z.object({
  vorgangId: z.string().uuid(),
  modulArtikelId: z.string().uuid({ message: "Bitte ein Modul wählen." }),
  anzahl: z.coerce.number().int().min(1, "Mindestens ein Modul.").max(2000),
  speicherKwh: z.coerce.number().min(0).max(500).optional().default(0),
  gruppeName: z.string().trim().max(160).optional().default(""),
});

/**
 * Aus einer Modulzahl wird ein Angebot.
 *
 * Modul, passender Wechselrichter, Speicher nach Wunschkapazität und
 * alles, was sich mit der Modulzahl multipliziert. Die Auslegungsregeln
 * stehen in lib/vorgang/auslegung.ts und nicht hier — sie werden auch
 * beim Anwenden einer Vorlage gebraucht.
 *
 * Alles landet in einer Gruppe: der Kunde entscheidet über die Anlage,
 * nicht über zwanzig Modulklemmen.
 */
export async function schnellZusammenbau(
  _prev: VorlagenStatus,
  formData: FormData,
): Promise<VorlagenStatus> {
  const z1 = await zugang();
  if (!z1.ok) return z1.status;

  const parsed = schnellSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Eingabe fehlt.", ok: null };
  }
  const d = parsed.data;

  const supabase = await createClient();
  const sperre = await offen(supabase, d.vorgangId);
  if (sperre) return sperre;

  const { data: modul } = await supabase
    .from("article")
    .select(
      "id, name, unit, sale_price, purchase_price, vat_rate, image_url, description, modul_wp",
    )
    .eq("id", d.modulArtikelId)
    .maybeSingle();

  if (!modul) return { error: "Das Modul gibt es nicht mehr.", ok: null };

  const modulWp = Number(modul.modul_wp ?? 0);
  if (modulWp <= 0) {
    return {
      error: `Für ${modul.name as string} ist keine Nennleistung hinterlegt — ohne sie lässt sich nichts auslegen.`,
      ok: null,
    };
  }

  const anlage = kwp(d.anzahl, modulWp);

  /* Wechselrichter und Speicher aus dem aktiven Sortiment. */
  const [{ data: wrRoh }, { data: speicherRoh }, { data: multiRoh }] =
    await Promise.all([
      supabase
        .from("article")
        .select("id, name, wr_kw, unit, sale_price, purchase_price, image_url, description")
        .eq("active", true)
        .not("wr_kw", "is", null),
      supabase
        .from("article")
        .select("id, name, speicher_kwh, unit, sale_price, purchase_price, image_url, description")
        .eq("active", true)
        .not("speicher_kwh", "is", null)
        .order("speicher_kwh"),
      supabase
        .from("article")
        .select("id, name, unit, sale_price, purchase_price, pro_modul_menge, image_url, description")
        .eq("active", true)
        .not("pro_modul_menge", "is", null),
    ]);

  const hinweise: string[] = [];

  const wrKandidaten: Kandidat[] = (wrRoh ?? []).map((a) => ({
    id: a.id as string,
    name: a.name as string,
    wert: a.wr_kw === null ? null : Number(a.wr_kw),
  }));
  const wr = wechselrichterFuer(anlage, wrKandidaten);
  if (wr.zuKlein) {
    hinweise.push(
      `Kein Wechselrichter deckt ${anlage} kWp — der grösste im Sortiment ist eingesetzt.`,
    );
  }

  const speicher = (speicherRoh ?? [])[0];
  const speicherStueck =
    d.speicherKwh > 0 && speicher
      ? speicherAnzahl(d.speicherKwh, Number(speicher.speicher_kwh))
      : 0;
  if (d.speicherKwh > 0 && !speicher) {
    hinweise.push("Kein Speicher im Sortiment hinterlegt.");
  }

  const multiplikatoren: Multiplikator[] = (multiRoh ?? []).map((a) => ({
    id: a.id as string,
    name: a.name as string,
    einheit: (a.unit as string) ?? "Stk",
    epNetto: Number(a.sale_price),
    kalkEk: Number(a.purchase_price),
    jeModul: Number(a.pro_modul_menge),
  }));

  /* --- Gruppe anlegen --- */
  const { data: letzteGruppe } = await supabase
    .from("vorgang_gruppe")
    .select("sort")
    .eq("vorgang_id", d.vorgangId)
    .is("dokument_id", null)
    .order("sort", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: gruppe, error: gFehler } = await supabase
    .from("vorgang_gruppe")
    .insert({
      company_id: z1.me.companyId,
      vorgang_id: d.vorgangId,
      name: d.gruppeName || `PV-Anlage ${anlage} kWp`,
      beschreibung: `${d.anzahl} × ${modul.name as string}`,
      sort: Number(letzteGruppe?.sort ?? 0) + 10,
    })
    .select("id")
    .single();

  if (gFehler || !gruppe) {
    return { error: `Gruppe anlegen fehlgeschlagen: ${gFehler?.message}`, ok: null };
  }

  /* --- Positionen sammeln --- */
  type Neu = {
    articleId: string;
    bezeichnung: string;
    menge: number;
    einheit: string;
    epNetto: number;
    kalkEk: number;
    bildUrl: string | null;
    beschreibung: string | null;
  };

  const neue: Neu[] = [
    {
      articleId: modul.id as string,
      bezeichnung: modul.name as string,
      menge: d.anzahl,
      einheit: (modul.unit as string) ?? "Stk",
      epNetto: Number(modul.sale_price),
      kalkEk: Number(modul.purchase_price),
      bildUrl: (modul.image_url as string | null) ?? null,
      beschreibung: (modul.description as string | null) ?? null,
    },
  ];

  if (wr.treffer) {
    const roh = (wrRoh ?? []).find((a) => a.id === wr.treffer!.id);
    if (roh) {
      neue.push({
        articleId: roh.id as string,
        bezeichnung: roh.name as string,
        menge: 1,
        einheit: (roh.unit as string) ?? "Stk",
        epNetto: Number(roh.sale_price),
        kalkEk: Number(roh.purchase_price),
        bildUrl: (roh.image_url as string | null) ?? null,
        beschreibung: (roh.description as string | null) ?? null,
      });
    }
  }

  if (speicher && speicherStueck > 0) {
    neue.push({
      articleId: speicher.id as string,
      bezeichnung: speicher.name as string,
      menge: speicherStueck,
      einheit: (speicher.unit as string) ?? "Stk",
      epNetto: Number(speicher.sale_price),
      kalkEk: Number(speicher.purchase_price),
      bildUrl: (speicher.image_url as string | null) ?? null,
      beschreibung: (speicher.description as string | null) ?? null,
    });
  }

  for (const z of mengenJeModul(d.anzahl, multiplikatoren)) {
    const roh = (multiRoh ?? []).find((a) => a.id === z.produkt.id);
    neue.push({
      articleId: z.produkt.id,
      bezeichnung: z.produkt.name,
      menge: z.menge,
      einheit: z.produkt.einheit,
      epNetto: z.produkt.epNetto,
      kalkEk: z.produkt.kalkEk ?? 0,
      bildUrl: (roh?.image_url as string | null) ?? null,
      beschreibung: (roh?.description as string | null) ?? null,
    });
  }

  const { data: letzte } = await supabase
    .from("vorgang_position")
    .select("sort")
    .eq("vorgang_id", d.vorgangId)
    .is("dokument_id", null)
    .order("sort", { ascending: false })
    .limit(1)
    .maybeSingle();

  let sort = Number(letzte?.sort ?? 0);

  const { data: v } = await supabase
    .from("vorgang")
    .select("ust_satz")
    .eq("id", d.vorgangId)
    .maybeSingle();

  const { error: pFehler } = await supabase.from("vorgang_position").insert(
    neue.map((n) => {
      sort += 10;
      return {
        company_id: z1.me.companyId,
        vorgang_id: d.vorgangId,
        gruppe_id: gruppe.id as string,
        sort,
        article_id: n.articleId,
        bezeichnung: n.bezeichnung,
        menge: n.menge,
        einheit: n.einheit,
        ep_netto: n.epNetto,
        kalk_ek: n.kalkEk,
        ust_satz: Number(v?.ust_satz ?? 20),
        ist_material: true,
        bild_url: n.bildUrl,
        beschreibung: n.beschreibung,
      };
    }),
  );

  if (pFehler) {
    return { error: `Positionen anlegen fehlgeschlagen: ${pFehler.message}`, ok: null };
  }

  /* Anlagendaten am Vorgang mitziehen — sie stehen im Kopf und im Portal. */
  await supabase
    .from("vorgang")
    .update({
      kwp: anlage,
      speicher_kwh:
        speicher && speicherStueck > 0
          ? Math.round(speicherStueck * Number(speicher.speicher_kwh) * 100) / 100
          : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", d.vorgangId);

  frisch(d.vorgangId);

  return {
    error: null,
    ok:
      `${anlage} kWp zusammengestellt: ${neue.length} Positionen.` +
      (hinweise.length ? ` ${hinweise.join(" ")}` : ""),
  };
}

/* ============================================================ VORLAGEN */

const speichernSchema = z.object({
  vorgangId: z.string().uuid(),
  name: z.string().trim().min(2, "Name der Vorlage fehlt.").max(160),
  beschreibung: z.string().trim().max(2000).optional().default(""),
  alsStandard: z.enum(["ja", "nein"]).optional().default("nein"),
});

/**
 * Den aktuellen Entwurf als Vorlage sichern.
 *
 * Gespeichert werden Artikelbezug und Menge, nicht der Preis: eine
 * Vorlage soll beim nächsten Anwenden den heutigen Preis ziehen.
 * Eingefroren wird erst im Angebot selbst.
 */
export async function alsVorlageSpeichern(
  _prev: VorlagenStatus,
  formData: FormData,
): Promise<VorlagenStatus> {
  const z1 = await zugang();
  if (!z1.ok) return z1.status;

  const parsed = speichernSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Eingabe fehlt.", ok: null };
  }
  const d = parsed.data;

  const supabase = await createClient();

  const [{ data: gruppen }, { data: positionen }] = await Promise.all([
    supabase
      .from("vorgang_gruppe")
      .select("id, name, beschreibung, sort, paket_preis, einzelpreise_verstecken")
      .eq("vorgang_id", d.vorgangId)
      .is("dokument_id", null)
      .order("sort"),
    supabase
      .from("vorgang_position")
      .select(
        "id, gruppe_id, sort, article_id, bezeichnung, menge, einheit, ep_netto, optional, rabatt_prozent, upgrade_article_id, upgrade_kategorie, upgrade_aufpreis, upgrade_text",
      )
      .eq("vorgang_id", d.vorgangId)
      .is("dokument_id", null)
      .order("sort"),
  ]);

  if (!positionen?.length) {
    return { error: "Es gibt nichts zu speichern — der Entwurf ist leer.", ok: null };
  }

  if (d.alsStandard === "ja") {
    /* Höchstens eine Standardvorlage; der Teilindex würde sonst greifen. */
    await supabase
      .from("angebot_vorlage")
      .update({ ist_standard: false })
      .eq("company_id", z1.me.companyId)
      .eq("ist_standard", true);
  }

  const { data: vorlage, error: vFehler } = await supabase
    .from("angebot_vorlage")
    .insert({
      company_id: z1.me.companyId,
      name: d.name,
      beschreibung: d.beschreibung || null,
      ist_standard: d.alsStandard === "ja",
      created_by: z1.me.id,
    })
    .select("id")
    .single();

  if (vFehler || !vorlage) {
    const doppelt = vFehler?.code === "23505";
    return {
      error: doppelt
        ? "Eine Vorlage mit diesem Namen gibt es schon."
        : `Speichern fehlgeschlagen: ${vFehler?.message}`,
      ok: null,
    };
  }

  const gruppenKarte = new Map<string, string>();
  for (const g of gruppen ?? []) {
    const { data: neu } = await supabase
      .from("angebot_vorlage_gruppe")
      .insert({
        company_id: z1.me.companyId,
        vorlage_id: vorlage.id as string,
        name: g.name as string,
        beschreibung: (g.beschreibung as string | null) ?? null,
        sort: g.sort as number,
        paket_preis: g.paket_preis,
        einzelpreise_verstecken: g.einzelpreise_verstecken as boolean,
      })
      .select("id")
      .single();
    if (neu) gruppenKarte.set(g.id as string, neu.id as string);
  }

  const { error: pFehler } = await supabase.from("angebot_vorlage_position").insert(
    (positionen ?? []).map((p) => ({
      company_id: z1.me.companyId,
      vorlage_id: vorlage.id as string,
      gruppe_id: p.gruppe_id ? (gruppenKarte.get(p.gruppe_id as string) ?? null) : null,
      sort: p.sort as number,
      article_id: p.article_id,
      bezeichnung: p.bezeichnung as string,
      menge: p.menge,
      einheit: p.einheit as string,
      /* Freie Positionen ohne Artikel behalten ihren Preis. */
      ep_netto: p.article_id ? null : p.ep_netto,
      optional: p.optional as boolean,
      rabatt_prozent: p.rabatt_prozent,
      upgrade_article_id: p.upgrade_article_id,
      upgrade_kategorie: p.upgrade_kategorie,
      upgrade_aufpreis: p.upgrade_aufpreis,
      upgrade_text: p.upgrade_text,
    })),
  );

  if (pFehler) {
    return { error: `Positionen sichern fehlgeschlagen: ${pFehler.message}`, ok: null };
  }

  revalidatePath("/einstellungen");
  frisch(d.vorgangId);
  return { error: null, ok: `Vorlage „${d.name}" gesichert.` };
}

const anwendenSchema = z.object({
  vorgangId: z.string().uuid(),
  vorlageId: z.string().uuid({ message: "Bitte eine Vorlage wählen." }),
  ersetzen: z.enum(["ja", "nein"]).optional().default("ja"),
});

/**
 * Eine Vorlage auf den Entwurf anwenden.
 *
 * Standardmäßig ersetzend: eine Vorlage ist ein vollständiges Paket,
 * kein Baustein. Wer anhängen will, stellt um — dann wird ergänzt.
 *
 * Preise kommen frisch aus dem Artikelstamm. Eine Vorlage von vor einem
 * Jahr soll nicht die Preise von damals ins Angebot schreiben.
 */
export async function vorlageAnwenden(
  _prev: VorlagenStatus,
  formData: FormData,
): Promise<VorlagenStatus> {
  const z1 = await zugang();
  if (!z1.ok) return z1.status;

  const parsed = anwendenSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Eingabe fehlt.", ok: null };
  }
  const d = parsed.data;

  const supabase = await createClient();
  const sperre = await offen(supabase, d.vorgangId);
  if (sperre) return sperre;

  const [{ data: vGruppen }, { data: vPositionen }, { data: vorgang }] =
    await Promise.all([
      supabase
        .from("angebot_vorlage_gruppe")
        .select("id, name, beschreibung, sort, paket_preis, einzelpreise_verstecken")
        .eq("vorlage_id", d.vorlageId)
        .order("sort"),
      supabase
        .from("angebot_vorlage_position")
        .select(
          "id, gruppe_id, sort, article_id, bezeichnung, menge, einheit, ep_netto, optional, rabatt_prozent, menge_je_modul, upgrade_article_id, upgrade_kategorie, upgrade_aufpreis, upgrade_text",
        )
        .eq("vorlage_id", d.vorlageId)
        .order("sort"),
      supabase
        .from("vorgang")
        .select("ust_satz")
        .eq("id", d.vorgangId)
        .maybeSingle(),
    ]);

  if (!vPositionen?.length) {
    return { error: "Diese Vorlage hat keine Positionen.", ok: null };
  }

  if (d.ersetzen === "ja") {
    await supabase
      .from("vorgang_position")
      .delete()
      .eq("vorgang_id", d.vorgangId)
      .is("dokument_id", null);
    await supabase
      .from("vorgang_gruppe")
      .delete()
      .eq("vorgang_id", d.vorgangId)
      .is("dokument_id", null);
  }

  const gruppenKarte = new Map<string, string>();
  for (const g of vGruppen ?? []) {
    const { data: neu } = await supabase
      .from("vorgang_gruppe")
      .insert({
        company_id: z1.me.companyId,
        vorgang_id: d.vorgangId,
        name: g.name as string,
        beschreibung: (g.beschreibung as string | null) ?? null,
        sort: g.sort as number,
        paket_preis: g.paket_preis,
        einzelpreise_verstecken: g.einzelpreise_verstecken as boolean,
      })
      .select("id")
      .single();
    if (neu) gruppenKarte.set(g.id as string, neu.id as string);
  }

  /* Preise frisch aus dem Stamm — die Vorlage merkt sich nur den Artikel. */
  const artikelIds = (vPositionen ?? [])
    .map((p) => p.article_id as string | null)
    .filter((x): x is string => Boolean(x));

  const { data: artikel } = artikelIds.length
    ? await supabase
        .from("article")
        .select("id, name, unit, sale_price, purchase_price, image_url, description, active")
        .in("id", artikelIds)
    : { data: [] };

  const stamm = new Map(
    (artikel ?? []).map((a) => [a.id as string, a]),
  );

  const fehlend: string[] = [];

  const zeilen = (vPositionen ?? []).map((p) => {
    const a = p.article_id ? stamm.get(p.article_id as string) : undefined;
    if (p.article_id && !a) fehlend.push(p.bezeichnung as string);
    return {
      company_id: z1.me.companyId,
      vorgang_id: d.vorgangId,
      gruppe_id: p.gruppe_id ? (gruppenKarte.get(p.gruppe_id as string) ?? null) : null,
      sort: p.sort as number,
      article_id: (p.article_id as string | null) ?? null,
      bezeichnung: (a?.name as string | undefined) ?? (p.bezeichnung as string),
      menge: p.menge,
      einheit: (a?.unit as string | undefined) ?? (p.einheit as string),
      ep_netto: a ? Number(a.sale_price) : Number(p.ep_netto ?? 0),
      kalk_ek: a ? Number(a.purchase_price) : null,
      ust_satz: Number(vorgang?.ust_satz ?? 20),
      optional: p.optional as boolean,
      rabatt_prozent: p.rabatt_prozent,
      ist_material: true,
      bild_url: (a?.image_url as string | null | undefined) ?? null,
      beschreibung: (a?.description as string | null | undefined) ?? null,
      upgrade_article_id: p.upgrade_article_id,
      upgrade_kategorie: p.upgrade_kategorie,
      upgrade_aufpreis: p.upgrade_aufpreis,
      upgrade_text: p.upgrade_text,
    };
  });

  const { error } = await supabase.from("vorgang_position").insert(zeilen);
  if (error) return { error: `Anwenden fehlgeschlagen: ${error.message}`, ok: null };

  frisch(d.vorgangId);

  return {
    error: null,
    ok:
      `${zeilen.length} Positionen übernommen.` +
      (fehlend.length
        ? ` Nicht mehr im Stamm: ${fehlend.slice(0, 3).join(", ")} — Preise aus der Vorlage.`
        : ""),
  };
}

const loeschSchema = z.object({ vorlageId: z.string().uuid() });

export async function vorlageLoeschen(
  _prev: VorlagenStatus,
  formData: FormData,
): Promise<VorlagenStatus> {
  const z1 = await zugang();
  if (!z1.ok) return z1.status;

  const parsed = loeschSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Eingabe fehlt.", ok: null };

  const supabase = await createClient();
  const { error } = await supabase
    .from("angebot_vorlage")
    .delete()
    .eq("id", parsed.data.vorlageId);

  if (error) return { error: `Löschen fehlgeschlagen: ${error.message}`, ok: null };

  revalidatePath("/einstellungen");
  return { error: null, ok: "Vorlage gelöscht." };
}
