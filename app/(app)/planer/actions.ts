"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireMe } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { ANBIETER } from "@/lib/planer/anbieter";
import { ZOOM_GRENZEN } from "@/lib/planer/geo";
import { kwp, type Modulgruppe } from "@/lib/planer/module";
import { planLesen, planSchema } from "@/lib/planer/plan";
import {
  abgleichen,
  type Abgleich,
  bedarfAusPlan,
  type GeraeteStand,
  notizMitSchluessel,
} from "@/lib/planer/uebergabe";

export type PlanerState = { error: string | null; ok: string | null; id?: string };

/*
 * Schreiben am Planer.
 *
 * Der Rechtecheck steht hier zusätzlich zur RLS-Policy — nicht statt
 * ihrer. Die Policy ist die Grenze, das hier ist die verständliche
 * Fehlermeldung: ohne sie bekäme die Bauleitung bei fehlendem Recht
 * einen leeren Datenbankfehler statt eines Satzes.
 */
async function zugang() {
  const me = await requireMe();
  if (me.perms.planer !== "write") {
    return {
      ok: false as const,
      status: { error: "Zum Planen fehlt die Berechtigung.", ok: null },
    };
  }
  return { ok: true as const, me };
}

const anlegenSchema = z.object({
  name: z.string().trim().min(1, "Ohne Namen findet das Projekt später niemand.").max(120),
  adresse: z.string().trim().max(240).optional().default(""),
  lat: z.coerce.number().min(-85.05112878).max(85.05112878),
  lon: z.coerce.number().min(-180).max(180),
});

export async function projektAnlegen(_prev: PlanerState, formData: FormData): Promise<PlanerState> {
  const z1 = await zugang();
  if (!z1.ok) return z1.status;

  const geprueft = anlegenSchema.safeParse({
    name: formData.get("name"),
    adresse: formData.get("adresse"),
    lat: formData.get("lat"),
    lon: formData.get("lon"),
  });
  if (!geprueft.success) {
    return { error: geprueft.error.issues[0]?.message ?? "Eingabe unvollständig.", ok: null };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("planer_projekt")
    .insert({
      company_id: z1.me.companyId,
      name: geprueft.data.name,
      adresse: geprueft.data.adresse || null,
      ursprung_lat: geprueft.data.lat,
      ursprung_lon: geprueft.data.lon,
      erstellt_von: z1.me.id,
    })
    .select("id")
    .single();

  if (error || !data) return { error: "Projekt konnte nicht angelegt werden.", ok: null };

  revalidatePath("/planer");
  return { error: null, ok: "Projekt angelegt.", id: (data as { id: string }).id };
}

const ANBIETER_IDS = ANBIETER.map((a) => a.id) as [string, ...string[]];

const ansichtSchema = z.object({
  id: z.string().uuid(),
  anbieter: z.enum(ANBIETER_IDS),
  zoom: z.coerce.number().min(ZOOM_GRENZEN.min).max(ZOOM_GRENZEN.max),
});

/**
 * Zuletzt gesehener Ausschnitt. Autosave ruft das gedrosselt auf, damit
 * ein Projekt dort aufgeht, wo es verlassen wurde.
 *
 * Bewusst ohne revalidatePath: das läuft im Hintergrund während des
 * Planens, ein Seitenneuaufbau würde die Leinwand mitten im Zoomen
 * zurücksetzen.
 */
export async function ansichtMerken(daten: {
  id: string;
  anbieter: string;
  zoom: number;
}): Promise<{ ok: boolean }> {
  const z1 = await zugang();
  if (!z1.ok) return { ok: false };

  const geprueft = ansichtSchema.safeParse(daten);
  if (!geprueft.success) return { ok: false };

  const supabase = await createClient();
  const { error } = await supabase
    .from("planer_projekt")
    .update({ anbieter: geprueft.data.anbieter, zoom: geprueft.data.zoom })
    .eq("id", geprueft.data.id);

  return { ok: !error };
}

export async function projektLoeschen(_prev: PlanerState, formData: FormData): Promise<PlanerState> {
  const z1 = await zugang();
  if (!z1.ok) return z1.status;

  const id = z.string().uuid().safeParse(formData.get("id"));
  if (!id.success) return { error: "Projekt nicht gefunden.", ok: null };

  const supabase = await createClient();
  const { error } = await supabase.from("planer_projekt").delete().eq("id", id.data);
  if (error) return { error: "Projekt konnte nicht gelöscht werden.", ok: null };

  revalidatePath("/planer");
  return { error: null, ok: "Projekt gelöscht." };
}

/**
 * Den Planungsstand sichern.
 *
 * Geprüft wird mit demselben Schema wie beim Lesen: was hier hineinkommt,
 * stammt aus dem Browser und ist damit nichts, worauf man sich verlässt.
 * Ein Dokument mit halber Geometrie wäre zwar gültiges jsonb, würde aber
 * beim nächsten Öffnen als leerer Plan gelesen — der Kunde hätte seine
 * Dachflächen verloren, ohne dass irgendwo ein Fehler stand.
 *
 * Ohne revalidatePath: das läuft im Hintergrund während des Planens, ein
 * Seitenneuaufbau würde die Leinwand mitten im Zeichnen zurücksetzen.
 */
export async function planSpeichern(daten: { id: string; plan: unknown }): Promise<{ ok: boolean }> {
  const z1 = await zugang();
  if (!z1.ok) return { ok: false };

  const id = z.string().uuid().safeParse(daten.id);
  const plan = planSchema.safeParse(daten.plan);
  if (!id.success || !plan.success) return { ok: false };

  /*
   * Die Anlagengrösse wird beim Speichern mitgeschrieben.
   *
   * Sie steht redundant in einer eigenen Spalte, weil Projektliste und
   * Übergabe sie brauchen, ohne das ganze Plandokument zu lesen. Bisher
   * wurde sie nie gefüllt: die Liste zeigte bei jedem Projekt „noch
   * keine Belegung", und der übergebene Vorgang bekam 0 kWp.
   */
  const leistung = (plan.data.gruppen as Modulgruppe[]).reduce((s, g) => s + kwp(g), 0);

  const supabase = await createClient();
  const { error } = await supabase
    .from("planer_projekt")
    .update({ plan: plan.data, kwp: Math.round(leistung * 1000) / 1000 })
    .eq("id", id.data);

  return { ok: !error };
}

/* ── Drohnenfoto (Briefing 2.3) ──────────────────────────────────── */

const BUCKET = "planer-fotos";
/** Was ein Browser zuverlässig als Bild dekodiert. */
const FOTO_TYPEN = new Set(["image/jpeg", "image/png", "image/webp"]);
/** Drohnenaufnahmen sind gross; 25 MB decken 48-Megapixel-Bilder ab. */
const FOTO_MAX = 25 * 1024 * 1024;

export async function fotoHochladen(_prev: PlanerState, formData: FormData): Promise<PlanerState> {
  const z1 = await zugang();
  if (!z1.ok) return z1.status;

  const id = z.string().uuid().safeParse(formData.get("id"));
  if (!id.success) return { error: "Projekt nicht gefunden.", ok: null };

  const datei = formData.get("foto");
  if (!(datei instanceof File) || datei.size === 0) return { error: "Keine Datei gewählt.", ok: null };
  if (!FOTO_TYPEN.has(datei.type)) {
    return { error: "Nur JPEG, PNG oder WebP.", ok: null };
  }
  if (datei.size > FOTO_MAX) {
    return { error: "Höchstens 25 MB. Das Foto vorher verkleinern.", ok: null };
  }

  const breite = Number(formData.get("breite"));
  const hoehe = Number(formData.get("hoehe"));
  if (!Number.isInteger(breite) || !Number.isInteger(hoehe) || breite < 1 || hoehe < 1) {
    return { error: "Bildmasse fehlen.", ok: null };
  }

  const supabase = await createClient();
  const endung = (datei.name.split(".").pop() ?? "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
  const pfad = `${z1.me.companyId}/${id.data}/foto.${endung || "jpg"}`;

  const { error: hochladen } = await supabase.storage
    .from(BUCKET)
    .upload(pfad, new Uint8Array(await datei.arrayBuffer()), {
      contentType: datei.type,
      upsert: true,
    });
  if (hochladen) return { error: "Hochladen fehlgeschlagen.", ok: null };

  /*
   * Kalibrierfaktor bewusst auf null: ein frisch hochgeladenes Foto hat
   * keinen bekannten Massstab. Jede Länge daraus wäre geraten, und ein
   * geratener Massstab ist schlimmer als gar keiner — er sieht aus wie
   * eine Messung.
   */
  const { error } = await supabase
    .from("planer_projekt")
    .update({
      foto_pfad: pfad,
      foto_breite: breite,
      foto_hoehe: hoehe,
      foto_meter_pro_pixel: null,
    })
    .eq("id", id.data);
  if (error) return { error: "Foto konnte nicht gespeichert werden.", ok: null };

  revalidatePath(`/planer/${id.data}`);
  return { error: null, ok: "Foto hochgeladen — jetzt kalibrieren." };
}

/**
 * Massstab setzen.
 *
 * `faktor` ist das Verhältnis zwischen neuem und altem Massstab. Beim
 * Nachkalibrieren wandert damit auf Wunsch die gesamte Geometrie mit:
 * wer nachträglich merkt, dass die Referenzstrecke falsch war, will
 * nicht jede Dachkante neu ziehen (Briefing 2.3).
 */
export async function fotoKalibrieren(daten: {
  id: string;
  meterProPixel: number;
  geometrieSkalieren: boolean;
  faktor: number;
}): Promise<{ ok: boolean }> {
  const z1 = await zugang();
  if (!z1.ok) return { ok: false };

  const geprueft = z
    .object({
      id: z.string().uuid(),
      // 1 mm bis 10 m je Bildpunkt — alles ausserhalb ist ein Vertipper.
      meterProPixel: z.number().positive().min(0.001).max(10),
      geometrieSkalieren: z.boolean(),
      faktor: z.number().positive().min(0.001).max(1000),
    })
    .safeParse(daten);
  if (!geprueft.success) return { ok: false };

  const supabase = await createClient();
  const felder: Record<string, unknown> = {
    foto_meter_pro_pixel: geprueft.data.meterProPixel,
  };

  if (geprueft.data.geometrieSkalieren) {
    const { data } = await supabase
      .from("planer_projekt")
      .select("plan")
      .eq("id", geprueft.data.id)
      .maybeSingle();
    const alt = planSchema.safeParse((data as { plan: unknown } | null)?.plan);
    if (alt.success) {
      const f = geprueft.data.faktor;
      felder.plan = {
        ...alt.data,
        flaechen: alt.data.flaechen.map((flaeche) => ({
          ...flaeche,
          punkte: flaeche.punkte.map((p) => ({ x: p.x * f, y: p.y * f })),
          hindernisse: flaeche.hindernisse.map((h) => ({
            ...h,
            punkte: h.punkte.map((p) => ({ x: p.x * f, y: p.y * f })),
            abstand: h.abstand,
          })),
        })),
      };
    }
  }

  const { error } = await supabase.from("planer_projekt").update(felder).eq("id", geprueft.data.id);
  return { ok: !error };
}

export async function fotoEntfernen(_prev: PlanerState, formData: FormData): Promise<PlanerState> {
  const z1 = await zugang();
  if (!z1.ok) return z1.status;

  const id = z.string().uuid().safeParse(formData.get("id"));
  if (!id.success) return { error: "Projekt nicht gefunden.", ok: null };

  const supabase = await createClient();
  const { data } = await supabase
    .from("planer_projekt")
    .select("foto_pfad")
    .eq("id", id.data)
    .maybeSingle();

  const pfad = (data as { foto_pfad: string | null } | null)?.foto_pfad;
  if (pfad) await supabase.storage.from(BUCKET).remove([pfad]);

  await supabase
    .from("planer_projekt")
    .update({ foto_pfad: null, foto_breite: null, foto_hoehe: null, foto_meter_pro_pixel: null })
    .eq("id", id.data);

  revalidatePath(`/planer/${id.data}`);
  return { error: null, ok: "Foto entfernt — es gilt wieder die Karte." };
}

/* ── Übergabe als Vorgang (Briefing 8.2) ─────────────────────────── */

export interface UebergabeVorschau {
  fehler: string | null;
  /** Vorgangsnummer, falls dieses Projekt schon übergeben wurde. */
  vorgangNummer: string | null;
  vorgangId: string | null;
  positionen: Abgleich[];
  kwp: number;
  speicherKwh: number;
}

/**
 * Was bei einer Übergabe entstehen würde.
 *
 * Der Dialog zeigt das VOR dem Anlegen — ein Knopf, der einen Vorgang
 * und eine halbe Bedarfsliste erzeugt, ohne vorher zu sagen was, ist im
 * Betrieb nicht zu gebrauchen.
 */
export async function uebergabeVorschau(projektId: string): Promise<UebergabeVorschau> {
  const leer = {
    vorgangNummer: null,
    vorgangId: null,
    positionen: [],
    kwp: 0,
    speicherKwh: 0,
  };
  const z1 = await zugang();
  if (!z1.ok) return { ...leer, fehler: z1.status.error };

  const supabase = await createClient();
  const { data: projekt } = await supabase
    .from("planer_projekt")
    .select("id, plan, kwp, vorgang_id")
    .eq("id", projektId)
    .maybeSingle();
  if (!projekt) return { ...leer, fehler: "Projekt nicht gefunden." };

  const plan = planLesen(projekt.plan);
  const geraete = await geraeteLaden(supabase);
  const neu = bedarfAusPlan(plan, geraete);

  const speicher = geraete.speicher.find((s) => s.id === plan.technik.speicher);
  const speicherKwh = plan.wirtschaft.mitSpeicher && speicher ? Number(speicher.nutzbar_kwh) : 0;

  const vorgangId = (projekt.vorgang_id as string | null) ?? null;
  if (!vorgangId) {
    return {
      fehler: null,
      vorgangNummer: null,
      vorgangId: null,
      positionen: neu.map((p) => ({ art: "neu" as const, ...p })),
      kwp: Number(projekt.kwp ?? 0),
      speicherKwh,
    };
  }

  /*
   * Schon übergeben: dann wird nicht neu angelegt, sondern abgeglichen.
   * Die Bedarfsliste gehört laut Material-Briefing dem Betrieb — der
   * Planer darf sie vorschlagen, nicht überschreiben.
   */
  const [{ data: vorgang }, { data: vorhanden }] = await Promise.all([
    supabase.from("vorgang").select("number").eq("id", vorgangId).maybeSingle(),
    supabase
      .from("vorgang_bedarf")
      .select("id, bezeichnung, menge, notiz")
      .eq("vorgang_id", vorgangId),
  ]);

  return {
    fehler: null,
    vorgangNummer: (vorgang?.number as string | null) ?? null,
    vorgangId,
    positionen: abgleichen(
      neu,
      ((vorhanden ?? []) as Array<{ id: string; bezeichnung: string; menge: number; notiz: string | null }>).map(
        (v) => ({ ...v, menge: Number(v.menge) }),
      ),
    ),
    kwp: Number(projekt.kwp ?? 0),
    speicherKwh,
  };
}

type Client = Awaited<ReturnType<typeof createClient>>;

async function geraeteLaden(supabase: Client): Promise<GeraeteStand> {
  const [{ data: modulZeilen }, { data: wr }, { data: speicher }] = await Promise.all([
    supabase.from("planer_modul").select("id, hersteller, bezeichnung, artikel_id"),
    supabase.from("planer_wechselrichter").select("id, hersteller, bezeichnung, artikel_id"),
    supabase.from("planer_speicher").select("id, hersteller, bezeichnung, nutzbar_kwh, artikel_id"),
  ]);
  return {
    module: (modulZeilen ?? []) as GeraeteStand["module"],
    wechselrichter: (wr ?? []) as GeraeteStand["wechselrichter"],
    speicher: ((speicher ?? []) as Array<{
      id: string;
      hersteller: string;
      bezeichnung: string;
      nutzbar_kwh: string | number;
      artikel_id: string | null;
    }>).map((s) => ({ ...s, nutzbar_kwh: Number(s.nutzbar_kwh) })),
  };
}

const uebergabeSchema = z.object({
  projektId: z.string().uuid(),
  /*
   * Die Phase wird nur beim Anlegen gebraucht. Beim Abgleich mit einem
   * bestehenden Vorgang zeigt der Dialog das Feld gar nicht — ohne
   * Vorgabewert scheiterte die zweite Übergabe deshalb an der
   * Eingabeprüfung, mit einer Meldung, die niemand deuten kann.
   */
  phase: z.enum(["anfrage", "angebot"]).default("anfrage"),
  kundeId: z.string().uuid().nullable(),
  kundeName: z.string().trim().max(160),
  /** Schlüssel der Positionen, die übernommen werden sollen. */
  positionen: z.array(z.string()),
});

/**
 * Die Planung als Vorgang übernehmen.
 *
 * Beim ersten Mal entsteht ein Vorgang samt Bedarfsliste. Bei jedem
 * weiteren Mal werden nur die ausgewählten Änderungen eingespielt —
 * Positionen, die im Material von Hand ergänzt wurden, bleiben
 * unangetastet.
 */
export async function alsVorgangUebernehmen(
  _prev: PlanerState,
  formData: FormData,
): Promise<PlanerState> {
  const z1 = await zugang();
  if (!z1.ok) return z1.status;

  const geprueft = uebergabeSchema.safeParse({
    projektId: formData.get("projektId"),
    phase: formData.get("phase") ?? undefined,
    kundeId: formData.get("kundeId") || null,
    kundeName: formData.get("kundeName") ?? "",
    positionen: formData.getAll("position").map(String),
  });
  if (!geprueft.success) {
    return { error: geprueft.error.issues[0]?.message ?? "Eingabe unvollständig.", ok: null };
  }
  const d = geprueft.data;

  const supabase = await createClient();
  const { data: projekt } = await supabase
    .from("planer_projekt")
    .select("id, name, adresse, plan, kwp, vorgang_id")
    .eq("id", d.projektId)
    .maybeSingle();
  if (!projekt) return { error: "Projekt nicht gefunden.", ok: null };

  const plan = planLesen(projekt.plan);
  const geraete = await geraeteLaden(supabase);
  const neu = bedarfAusPlan(plan, geraete);
  const speicher = geraete.speicher.find((s) => s.id === plan.technik.speicher);
  const speicherKwh = plan.wirtschaft.mitSpeicher && speicher ? Number(speicher.nutzbar_kwh) : null;

  let vorgangId = projekt.vorgang_id as string | null;
  let nummer: string | null = null;

  if (!vorgangId) {
    /* ── Erste Übergabe: Kunde und Vorgang anlegen ──────────────── */
    let customerId = d.kundeId;
    if (!customerId) {
      if (d.kundeName.length < 2) {
        return { error: "Ohne Kunden lässt sich kein Vorgang anlegen.", ok: null };
      }
      const { data: neuerKunde, error: kFehler } = await supabase
        .from("customer")
        .insert({
          company_id: z1.me.companyId,
          /*
           * `lead`, nicht `customer`: Wer aus einer Planung entsteht,
           * hat noch nichts gekauft. Der Enum kennt ohnehin nur diese
           * beiden Werte — ein geratener dritter liess die Übergabe
           * stillschweigend scheitern.
           */
          type: "lead",
          name: d.kundeName,
          address: projekt.adresse ?? null,
          created_by: z1.me.id,
        })
        .select("id")
        .single();
      if (kFehler || !neuerKunde) {
        return { error: `Kunde anlegen fehlgeschlagen: ${kFehler?.message}`, ok: null };
      }
      customerId = neuerKunde.id as string;
    }

    const { data: nr, error: nrFehler } = await supabase.rpc("next_number", {
      p_company: z1.me.companyId,
      p_kind: "vorgang",
    });
    if (nrFehler || typeof nr !== "string") {
      return { error: "Nummer konnte nicht vergeben werden.", ok: null };
    }
    nummer = nr;

    const { data: vorgang, error } = await supabase
      .from("vorgang")
      .insert({
        company_id: z1.me.companyId,
        customer_id: customerId,
        number: nr,
        phase: d.phase,
        kwp: Number(projekt.kwp ?? 0) > 0 ? Number(projekt.kwp) : null,
        speicher_kwh: speicherKwh,
        adresse: projekt.adresse ?? null,
        zustaendig_user_id: z1.me.id,
        created_by: z1.me.id,
      })
      .select("id, number")
      .single();
    if (error || !vorgang) {
      return { error: `Vorgang anlegen fehlgeschlagen: ${error?.message}`, ok: null };
    }
    vorgangId = vorgang.id as string;
  }

  /* ── Bedarfspositionen einspielen ────────────────────────────── */
  const { data: vorhanden } = await supabase
    .from("vorgang_bedarf")
    .select("id, bezeichnung, menge, notiz")
    .eq("vorgang_id", vorgangId);

  const plan2 = abgleichen(
    neu,
    ((vorhanden ?? []) as Array<{ id: string; bezeichnung: string; menge: number; notiz: string | null }>).map(
      (v) => ({ ...v, menge: Number(v.menge) }),
    ),
  );

  const gewaehlt = new Set(d.positionen);
  let angelegt = 0;
  let geaendert = 0;
  let entfernt = 0;
  /*
   * Schreibfehler NICHT verschlucken. Der erste Anlauf zählte nur bei
   * Erfolg hoch und meldete sonst „Vorgang angelegt" — ohne eine
   * einzige Position. Wer das sieht, glaubt, die Planung habe kein
   * Material ergeben, und trägt alles von Hand nach.
   */
  let positionsfehler: string | null = null;

  for (const a of plan2) {
    if (!gewaehlt.has(a.schluessel)) continue;

    if (a.art === "neu") {
      const { error } = await supabase.from("vorgang_bedarf").insert({
        company_id: z1.me.companyId,
        vorgang_id: vorgangId,
        artikel_id: a.artikel_id,
        bezeichnung: a.bezeichnung,
        menge: a.menge,
        einheit: "Stk",
        herkunft: "planer",
        notiz: notizMitSchluessel(a.schluessel, a.artikel_id === null),
      });
      if (error) positionsfehler ??= error.message;
      else angelegt++;
    } else if (a.art === "geaendert" && a.vorhandeneId) {
      /*
       * Nur die Menge nachziehen, nicht die Bezeichnung: die wurde im
       * Material womöglich bewusst angepasst („Charge Mai"), und ein
       * stiller Rückfall auf den Planernamen wäre eine Überraschung.
       */
      const { error } = await supabase
        .from("vorgang_bedarf")
        .update({ menge: a.menge })
        .eq("id", a.vorhandeneId);
      if (error) positionsfehler ??= error.message;
      else geaendert++;
    } else if (a.art === "entfallen" && a.vorhandeneId) {
      const { error } = await supabase.from("vorgang_bedarf").delete().eq("id", a.vorhandeneId);
      if (error) positionsfehler ??= error.message;
      else entfernt++;
    }
  }

  await supabase
    .from("planer_projekt")
    .update({ status: "uebergeben", vorgang_id: vorgangId })
    .eq("id", d.projektId);

  revalidatePath("/planer");
  revalidatePath(`/planer/${d.projektId}`);
  revalidatePath(`/vorgaenge/${vorgangId}`);

  const teile = [
    angelegt > 0 ? `${angelegt} Position${angelegt === 1 ? "" : "en"} angelegt` : null,
    geaendert > 0 ? `${geaendert} geändert` : null,
    entfernt > 0 ? `${entfernt} entfernt` : null,
  ].filter(Boolean);

  if (positionsfehler) {
    return {
      error: `Bedarfsliste unvollständig: ${positionsfehler}`,
      ok: null,
      id: vorgangId,
    };
  }

  return {
    error: null,
    ok: nummer
      ? `${nummer} angelegt${teile.length > 0 ? `, ${teile.join(", ")}` : ""}.`
      : teile.length > 0
        ? `Bedarfsliste aktualisiert: ${teile.join(", ")}.`
        : "Nichts zu übernehmen — die Liste ist aktuell.",
    id: vorgangId,
  };
}
