"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireMe } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

export type StammState = { error: string | null; ok: string | null };

/*
 * Stammdaten des Planers pflegen (Briefing 5.1).
 *
 * Geräte gehören dem Mandanten. Der gemeinsame Katalog (company_id NULL)
 * ist über die RLS-Policy gegen Schreiben gesperrt und taucht hier gar
 * nicht erst als Ziel auf — wer ein Katalog-Gerät anpassen will, legt
 * eine Kopie an.
 */
async function zugang() {
  const me = await requireMe();
  if (me.perms.einstellungen !== "write") {
    return {
      ok: false as const,
      status: { error: "Stammdaten darf nur pflegen, wer Einstellungen ändern darf.", ok: null },
    };
  }
  return { ok: true as const, me };
}

/** Deutsche Eingabe: „−0,25" wird zu −0.25. */
function zahl(wert: FormDataEntryValue | null): number {
  return Number(String(wert ?? "").replace(",", ".").trim());
}

const modulSchema = z.object({
  hersteller: z.string().trim().min(1, "Hersteller fehlt."),
  bezeichnung: z.string().trim().min(1, "Bezeichnung fehlt."),
  wp: z.number().positive().max(2000),
  uoc: z.number().positive().max(200),
  umpp: z.number().positive().max(200),
  isc: z.number().positive().max(100),
  impp: z.number().positive().max(100),
  /*
   * Datenblätter geben den Koeffizienten in %/K an, z. B. −0,25 %/K.
   * Das Formular nimmt genau diese Zahl und rechnet sie hier um. Wer
   * stattdessen −0,0025 einträgt, bekäme eine Anlage, die im Winter 100
   * Mal zu wenig Spannungsreserve hat — deshalb die enge Grenze.
   */
  tkProzent: z.number().min(-1).max(-0.01),
  breite: z.number().positive().max(3),
  hoehe: z.number().positive().max(3),
  gewicht: z.number().min(0).max(100).nullable(),
  datenblatt: z.string().trim().max(500),
});

export async function modulSpeichern(_prev: StammState, formData: FormData): Promise<StammState> {
  const z1 = await zugang();
  if (!z1.ok) return z1.status;

  const geprueft = modulSchema.safeParse({
    hersteller: formData.get("hersteller"),
    bezeichnung: formData.get("bezeichnung"),
    wp: zahl(formData.get("wp")),
    uoc: zahl(formData.get("uoc")),
    umpp: zahl(formData.get("umpp")),
    isc: zahl(formData.get("isc")),
    impp: zahl(formData.get("impp")),
    tkProzent: zahl(formData.get("tk_prozent")),
    breite: zahl(formData.get("breite")),
    hoehe: zahl(formData.get("hoehe")),
    gewicht: formData.get("gewicht") ? zahl(formData.get("gewicht")) : null,
    datenblatt: formData.get("datenblatt") ?? "",
  });
  if (!geprueft.success) {
    return { error: fehlertext(geprueft.error), ok: null };
  }
  const d = geprueft.data;

  // Prüfen, was die Datenbank sonst erst beim Schreiben abweist — mit
  // einem Satz, der erklärt statt einen Constraint zu nennen.
  if (d.uoc <= d.umpp) {
    return {
      error: `Leerlaufspannung (${d.uoc} V) muss über der MPP-Spannung (${d.umpp} V) liegen.`,
      ok: null,
    };
  }

  const supabase = await createClient();
  const id = String(formData.get("id") ?? "");
  const felder = {
    company_id: z1.me.companyId,
    hersteller: d.hersteller,
    bezeichnung: d.bezeichnung,
    wp: d.wp,
    uoc: d.uoc,
    umpp: d.umpp,
    isc: d.isc,
    impp: d.impp,
    tk_uoc: d.tkProzent / 100,
    breite: d.breite,
    hoehe: d.hoehe,
    gewicht: d.gewicht,
    datenblatt_url: d.datenblatt || null,
  };

  const { error } = id
    ? await supabase.from("planer_modul").update(felder).eq("id", id)
    : await supabase.from("planer_modul").insert(felder);
  if (error) return { error: "Speichern fehlgeschlagen.", ok: null };

  revalidatePath("/einstellungen");
  return { error: null, ok: `${d.hersteller} ${d.bezeichnung} gespeichert.` };
}

const mpptSchema = z.object({
  uMin: z.number().positive().max(2000),
  uMax: z.number().positive().max(2000),
  iMax: z.number().positive().max(200),
  maxStrings: z.number().int().min(1).max(20),
});

const wrSchema = z.object({
  hersteller: z.string().trim().min(1, "Hersteller fehlt."),
  bezeichnung: z.string().trim().min(1, "Bezeichnung fehlt."),
  maxDc: z.number().positive().max(2000),
  acNenn: z.number().positive().max(1000),
  maxDcLeistung: z.number().positive().max(2000).nullable(),
  hybrid: z.boolean(),
  mppt: z.array(mpptSchema).min(1, "Mindestens ein MPP-Tracker."),
  datenblatt: z.string().trim().max(500),
});

export async function wechselrichterSpeichern(
  _prev: StammState,
  formData: FormData,
): Promise<StammState> {
  const z1 = await zugang();
  if (!z1.ok) return z1.status;

  /*
   * Die MPP-Tracker kommen als gleichnamige Felder — so viele Zeilen,
   * wie das Formular anzeigt. `getAll` hält die Reihenfolge ein, und
   * damit stimmt die Nummerierung im Prüfbericht mit dem Datenblatt
   * überein.
   */
  const uMin = formData.getAll("mppt_umin");
  const uMax = formData.getAll("mppt_umax");
  const iMax = formData.getAll("mppt_imax");
  const strings = formData.getAll("mppt_strings");
  const mppt = uMin.map((_, i) => ({
    uMin: zahl(uMin[i] ?? null),
    uMax: zahl(uMax[i] ?? null),
    iMax: zahl(iMax[i] ?? null),
    maxStrings: Math.round(zahl(strings[i] ?? null)),
  }));

  const geprueft = wrSchema.safeParse({
    hersteller: formData.get("hersteller"),
    bezeichnung: formData.get("bezeichnung"),
    maxDc: zahl(formData.get("max_dc")),
    acNenn: zahl(formData.get("ac_nenn")),
    maxDcLeistung: formData.get("max_dc_leistung") ? zahl(formData.get("max_dc_leistung")) : null,
    hybrid: formData.get("hybrid") === "on",
    mppt,
    datenblatt: formData.get("datenblatt") ?? "",
  });
  if (!geprueft.success) return { error: fehlertext(geprueft.error), ok: null };
  const d = geprueft.data;

  const schief = d.mppt.findIndex((m) => m.uMin >= m.uMax);
  if (schief >= 0) {
    return {
      error: `MPP-Tracker ${schief + 1}: die untere Fenstergrenze muss unter der oberen liegen.`,
      ok: null,
    };
  }

  const supabase = await createClient();
  const id = String(formData.get("id") ?? "");
  const felder = {
    company_id: z1.me.companyId,
    hersteller: d.hersteller,
    bezeichnung: d.bezeichnung,
    max_dc: d.maxDc,
    ac_nenn: d.acNenn,
    max_dc_leistung: d.maxDcLeistung,
    hybrid: d.hybrid,
    mppt: d.mppt,
    datenblatt_url: d.datenblatt || null,
  };

  const { error } = id
    ? await supabase.from("planer_wechselrichter").update(felder).eq("id", id)
    : await supabase.from("planer_wechselrichter").insert(felder);
  if (error) return { error: "Speichern fehlgeschlagen.", ok: null };

  revalidatePath("/einstellungen");
  return { error: null, ok: `${d.hersteller} ${d.bezeichnung} gespeichert.` };
}

const speicherSchema = z.object({
  hersteller: z.string().trim().min(1, "Hersteller fehlt."),
  bezeichnung: z.string().trim().min(1, "Bezeichnung fehlt."),
  nutzbarKwh: z.number().positive().max(1000),
  modulgroesse: z.number().positive().max(100).nullable(),
  maxModule: z.number().int().min(1).max(100).nullable(),
  kompatibel: z.array(z.string().uuid()),
  datenblatt: z.string().trim().max(500),
});

export async function speicherSpeichern(
  _prev: StammState,
  formData: FormData,
): Promise<StammState> {
  const z1 = await zugang();
  if (!z1.ok) return z1.status;

  const geprueft = speicherSchema.safeParse({
    hersteller: formData.get("hersteller"),
    bezeichnung: formData.get("bezeichnung"),
    nutzbarKwh: zahl(formData.get("nutzbar_kwh")),
    modulgroesse: formData.get("modulgroesse") ? zahl(formData.get("modulgroesse")) : null,
    maxModule: formData.get("max_module") ? Math.round(zahl(formData.get("max_module"))) : null,
    kompatibel: formData.getAll("kompatibel").map(String).filter(Boolean),
    datenblatt: formData.get("datenblatt") ?? "",
  });
  if (!geprueft.success) return { error: fehlertext(geprueft.error), ok: null };
  const d = geprueft.data;

  const supabase = await createClient();
  const id = String(formData.get("id") ?? "");
  const felder = {
    company_id: z1.me.companyId,
    hersteller: d.hersteller,
    bezeichnung: d.bezeichnung,
    nutzbar_kwh: d.nutzbarKwh,
    modulgroesse_kwh: d.modulgroesse,
    max_module: d.maxModule,
    kompatibel: d.kompatibel,
    datenblatt_url: d.datenblatt || null,
  };

  const { error } = id
    ? await supabase.from("planer_speicher").update(felder).eq("id", id)
    : await supabase.from("planer_speicher").insert(felder);
  if (error) return { error: "Speichern fehlgeschlagen.", ok: null };

  revalidatePath("/einstellungen");
  return { error: null, ok: `${d.hersteller} ${d.bezeichnung} gespeichert.` };
}

const TABELLEN = {
  modul: "planer_modul",
  wechselrichter: "planer_wechselrichter",
  speicher: "planer_speicher",
} as const;

export async function geraetLoeschen(_prev: StammState, formData: FormData): Promise<StammState> {
  const z1 = await zugang();
  if (!z1.ok) return z1.status;

  const art = String(formData.get("art") ?? "");
  const id = z.string().uuid().safeParse(formData.get("id"));
  if (!(art in TABELLEN) || !id.success) return { error: "Gerät nicht gefunden.", ok: null };

  const supabase = await createClient();
  const { error } = await supabase
    .from(TABELLEN[art as keyof typeof TABELLEN])
    .delete()
    .eq("id", id.data);
  if (error) return { error: "Löschen fehlgeschlagen.", ok: null };

  revalidatePath("/einstellungen");
  return { error: null, ok: "Gerät entfernt." };
}

/**
 * Kopie eines Katalog-Geräts anlegen (Briefing 5.1).
 *
 * Der gemeinsame Katalog bleibt unangetastet; die Kopie gehört dem
 * Betrieb und merkt sich über `kopie_von`, woher sie stammt.
 */
export async function katalogKopieren(_prev: StammState, formData: FormData): Promise<StammState> {
  const z1 = await zugang();
  if (!z1.ok) return z1.status;

  const art = String(formData.get("art") ?? "");
  const id = z.string().uuid().safeParse(formData.get("id"));
  if (!(art in TABELLEN) || !id.success) return { error: "Gerät nicht gefunden.", ok: null };

  const tabelle = TABELLEN[art as keyof typeof TABELLEN];
  const supabase = await createClient();
  const { data } = await supabase.from(tabelle).select("*").eq("id", id.data).maybeSingle();
  if (!data) return { error: "Gerät nicht gefunden.", ok: null };

  const quelle = data as Record<string, unknown>;
  delete quelle.id;
  delete quelle.created_at;
  delete quelle.updated_at;

  const { error } = await supabase.from(tabelle).insert({
    ...quelle,
    company_id: z1.me.companyId,
    kopie_von: id.data,
  });
  if (error) return { error: "Kopieren fehlgeschlagen.", ok: null };

  revalidatePath("/einstellungen");
  return { error: null, ok: "Kopie angelegt — jetzt bearbeitbar." };
}

function fehlertext(fehler: z.ZodError): string {
  const erstes = fehler.issues[0];
  if (!erstes) return "Eingabe unvollständig.";
  // Zod nennt bei Zahlen nur „Too small" — der Feldname hilft mehr.
  return erstes.message.startsWith("Invalid") || erstes.message.startsWith("Too")
    ? `${erstes.path.join(" ")}: ${erstes.message}`
    : erstes.message;
}

/* ── Übernahme aus dem Lager (Briefing 5.1, 8.2) ─────────────────── */

export interface UebernahmeBericht {
  angelegt: { module: number; wechselrichter: number; speicher: number };
  luecken: Array<{ art: string; sku: string; name: string; fehlt: string[] }>;
  /** Artikel, die gar keine Geräte sind — Kabelsätze, Halter, Zubehör. */
  uebersprungen: number;
  fehler: string | null;
}

/**
 * Die Artikel aus dem Lager als Planer-Geräte anlegen.
 *
 * Übernommen wird NUR, was im Artikel belegt dasteht. Was fehlt, kommt
 * als Liste zurück, damit es gezielt nachgetragen werden kann — geraten
 * wird nichts. Eine erfundene DC-Grenze ergibt einen String, der im
 * Winter den Wechselrichter überspannt, und niemand würde es merken.
 *
 * Bereits übernommene Artikel werden aktualisiert, nicht verdoppelt
 * (eindeutiger Index auf company_id + artikel_id, Migration 0065).
 */
export async function ausLagerUebernehmen(): Promise<UebernahmeBericht> {
  const leer = { module: 0, wechselrichter: 0, speicher: 0 };
  const nichts = { angelegt: leer, luecken: [], uebersprungen: 0 };
  const z1 = await zugang();
  if (!z1.ok) return { ...nichts, fehler: z1.status.error };

  const { moduleAusArtikeln, speicherAusArtikeln, wechselrichterAusArtikeln } = await import(
    "@/lib/planer/uebernahme"
  );
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("article")
    .select("id, sku, name, manufacturer, category, datasheet_url, modul_wp, wr_kw, tech_specs")
    .eq("active", true)
    .in("category", ["PV-Module", "Module", "Wechselrichter", "Speicher"]);
  if (error) return { ...nichts, fehler: "Lager konnte nicht gelesen werden." };

  type Zeile = Parameters<typeof moduleAusArtikeln>[0][number];
  const artikel = (data ?? []) as unknown as Zeile[];
  const nach = (...kategorien: string[]) =>
    artikel.filter((a) => kategorien.includes(a.category ?? ""));

  const modulListe = moduleAusArtikeln(nach("PV-Module", "Module"));
  const wr = wechselrichterAusArtikeln(nach("Wechselrichter"));
  const speicher = speicherAusArtikeln(nach("Speicher"));

  const firma = z1.me.companyId;
  const angelegt = { ...leer };

  /*
   * Ein fehlgeschlagenes Schreiben muss sichtbar werden.
   *
   * Der erste Anlauf prüfte den Fehler mit `if (!e)` und liess den
   * Zähler sonst auf 0 stehen. Die Oberfläche meldete dann „0 Module
   * übernommen", als wäre nichts Passendes im Lager gewesen — während
   * in Wahrheit jeder Upsert am partiellen Index scheiterte (Migration
   * 0065). Falsche Ruhe ist schlimmer als eine Fehlermeldung.
   */
  let schreibfehler: string | null = null;
  const schreibe = async <T extends object>(
    tabelle: "planer_modul" | "planer_wechselrichter" | "planer_speicher",
    zeilen: T[],
  ): Promise<number> => {
    if (zeilen.length === 0) return 0;
    const { error: e } = await supabase
      .from(tabelle)
      .upsert(
        zeilen.map((z) => ({ ...z, company_id: firma })),
        { onConflict: "company_id,artikel_id" },
      );
    if (e) {
      schreibfehler ??= `Schreiben nach ${tabelle} fehlgeschlagen: ${e.message}`;
      return 0;
    }
    return zeilen.length;
  };

  angelegt.module = await schreibe("planer_modul", modulListe.fertig);
  angelegt.wechselrichter = await schreibe("planer_wechselrichter", wr.fertig);
  angelegt.speicher = await schreibe("planer_speicher", speicher.fertig);

  revalidatePath("/einstellungen");
  return {
    angelegt,
    luecken: [
      ...modulListe.luecken.map((l) => ({ art: "Modul", ...l })),
      ...wr.luecken.map((l) => ({ art: "Wechselrichter", ...l })),
      ...speicher.luecken.map((l) => ({ art: "Speicher", ...l })),
    ],
    uebersprungen: modulListe.uebersprungen + wr.uebersprungen + speicher.uebersprungen,
    fehler: schreibfehler,
  };
}
