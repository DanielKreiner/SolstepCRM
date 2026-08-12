"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireMe } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { planLesen } from "@/lib/planer/plan";
import { bedarfAusPlan, type GeraeteStand } from "@/lib/planer/uebergabe";

/*
 * Die Brücke zwischen Vorgang und Planer.
 *
 * Bisher lief der Weg nur in eine Richtung: Wer im Planer fertig war,
 * legte daraus einen Vorgang an. Umgekehrt ging nichts — wer einen
 * Vorgang vor sich hatte und die Anlage erst noch planen wollte, musste
 * in den Planer wechseln, dort ein Projekt anlegen und die Verbindung
 * von Hand herstellen. Sie entstand dabei gar nicht.
 *
 * Zwei Handgriffe, mehr braucht es nicht:
 *
 * 1. `planungAnlegen` — legt zum Vorgang eine Planung an und verknüpft
 *    beide. Ob überhaupt geplant wird, entscheidet der Betrieb: Für
 *    einen Speichertausch braucht niemand ein Dachmodell.
 * 2. `positionenAusPlanung` — holt Module, Wechselrichter und Speicher
 *    aus der Planung ins Angebot, mit Preisen aus dem Artikelstamm.
 */

export type PlanungStatus = { error: string | null; ok: string | null; id?: string };

async function zugang(): Promise<
  { ok: true; me: Awaited<ReturnType<typeof requireMe>> } | { ok: false; status: PlanungStatus }
> {
  const me = await requireMe();
  if (me.company.status !== "active") {
    return { ok: false, status: { error: "Der Zugang ist derzeit nur lesend.", ok: null } };
  }
  return { ok: true, me };
}

const vorgangSchema = z.object({ vorgangId: z.string().uuid() });

/**
 * Zum Vorgang eine Planung anlegen und beide verknüpfen.
 *
 * Der Ursprung der Karte kommt aus der Adresse des Vorgangs. Lässt sie
 * sich nicht auflösen, wird trotzdem angelegt — mit dem Standort des
 * Betriebs als Startpunkt und einem Hinweis. Ein Projekt, das wegen
 * einer unbekannten Adresse gar nicht erst entsteht, hilft niemandem;
 * die Karte lässt sich im Planer verschieben.
 */
export async function planungAnlegen(
  _prev: PlanungStatus,
  formData: FormData,
): Promise<PlanungStatus> {
  const z1 = await zugang();
  if (!z1.ok) return z1.status;
  if (z1.me.perms.planer !== "write") {
    return { error: "Zum Planen fehlt die Berechtigung.", ok: null };
  }

  const geprueft = vorgangSchema.safeParse({ vorgangId: formData.get("vorgangId") });
  if (!geprueft.success) return { error: "Vorgang fehlt.", ok: null };
  const vorgangId = geprueft.data.vorgangId;

  const supabase = await createClient();

  const { data: vorgang } = await supabase
    .from("vorgang")
    .select("id, number, adresse, plz, ort, customer:customer_id (name)")
    .eq("id", vorgangId)
    .maybeSingle();
  if (!vorgang) return { error: "Vorgang nicht gefunden.", ok: null };

  // Schon eine Planung dran? Dann die zurückgeben statt eine zweite anzulegen.
  const { data: vorhanden } = await supabase
    .from("planer_projekt")
    .select("id")
    .eq("vorgang_id", vorgangId)
    .maybeSingle();
  if (vorhanden) {
    return { error: null, ok: "Es hängt schon eine Planung an diesem Vorgang.", id: vorhanden.id as string };
  }

  const teile = [vorgang.adresse, [vorgang.plz, vorgang.ort].filter(Boolean).join(" ")]
    .filter((t) => typeof t === "string" && t.trim().length > 0)
    .join(", ");

  const ort = await ortSuchen(teile);
  const kunde = (vorgang.customer as { name?: string } | null)?.name ?? null;

  const { data, error } = await supabase
    .from("planer_projekt")
    .insert({
      company_id: z1.me.companyId,
      name: teile || `Planung ${vorgang.number as string}`,
      adresse: teile || null,
      ursprung_lat: ort?.lat ?? 47.6965,
      ursprung_lon: ort?.lon ?? 13.3457,
      vorgang_id: vorgangId,
      erstellt_von: z1.me.id,
    })
    .select("id")
    .single();

  if (error || !data) return { error: "Planung konnte nicht angelegt werden.", ok: null };

  revalidatePath(`/vorgaenge/${vorgangId}`);
  revalidatePath("/planer");
  return {
    error: null,
    ok: ort
      ? `Planung angelegt${kunde ? ` für ${kunde}` : ""}.`
      : "Planung angelegt — die Adresse liess sich nicht auflösen, die Karte startet beim Betrieb.",
    id: data.id as string,
  };
}

/**
 * Adresse in Koordinaten übersetzen.
 *
 * Dieselbe Quelle wie die Adresssuche im Planer. Fehler werden
 * geschluckt: Der Vorgang ist wichtiger als der exakte Kartenstart.
 */
async function ortSuchen(adresse: string): Promise<{ lat: number; lon: number } | null> {
  if (!adresse.trim()) return null;
  try {
    const url =
      "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=at,de,ch" +
      `&q=${encodeURIComponent(adresse)}`;
    const antwort = await fetch(url, {
      headers: { "User-Agent": "Betriebssoftware Planer (Adresssuche)" },
      signal: AbortSignal.timeout(6000),
    });
    if (!antwort.ok) return null;
    const zeilen = (await antwort.json()) as Array<{ lat?: string; lon?: string }>;
    const erste = zeilen[0];
    if (!erste?.lat || !erste?.lon) return null;
    return { lat: Number(erste.lat), lon: Number(erste.lon) };
  } catch {
    return null;
  }
}

/**
 * Geräte aus der Planung als Angebotspositionen anlegen.
 *
 * Übernommen wird, was die Planung an Material ergibt — Module,
 * Wechselrichter, Speicher — mit Preis, Einheit und Steuersatz aus dem
 * Artikelstamm. Kopiert, nicht verknüpft: Ein Angebot von heute darf
 * sich nicht ändern, weil jemand nächstes Jahr den Preis anhebt.
 *
 * Was in der Planung keinem Artikel zugeordnet ist, kommt als Zeile mit
 * Menge und ohne Preis ins Angebot. Weglassen wäre der teurere Fehler:
 * Eine fehlende Position fällt beim Angebotschreiben nicht auf, eine
 * Zeile mit 0 € schon.
 */
export async function positionenAusPlanung(
  _prev: PlanungStatus,
  formData: FormData,
): Promise<PlanungStatus> {
  const z1 = await zugang();
  if (!z1.ok) return z1.status;
  if (z1.me.perms.angebote !== "write") {
    return { error: "Für Angebote fehlt deiner Rolle das Schreibrecht.", ok: null };
  }

  const geprueft = vorgangSchema.safeParse({ vorgangId: formData.get("vorgangId") });
  if (!geprueft.success) return { error: "Vorgang fehlt.", ok: null };
  const vorgangId = geprueft.data.vorgangId;

  const supabase = await createClient();

  const { data: vorgang } = await supabase
    .from("vorgang")
    .select("id, phase, ust_satz")
    .eq("id", vorgangId)
    .maybeSingle();
  if (!vorgang) return { error: "Vorgang nicht gefunden.", ok: null };

  const { data: projekt } = await supabase
    .from("planer_projekt")
    .select("id, plan")
    .eq("vorgang_id", vorgangId)
    .maybeSingle();
  if (!projekt) return { error: "An diesem Vorgang hängt keine Planung.", ok: null };

  const plan = planLesen(projekt.plan);

  const [{ data: module }, { data: wr }, { data: speicher }] = await Promise.all([
    supabase.from("planer_modul").select("id, hersteller, bezeichnung, artikel_id"),
    supabase.from("planer_wechselrichter").select("id, hersteller, bezeichnung, artikel_id"),
    supabase.from("planer_speicher").select("id, hersteller, bezeichnung, nutzbar_kwh, artikel_id"),
  ]);

  const geraete: GeraeteStand = {
    module: (module ?? []) as unknown as GeraeteStand["module"],
    wechselrichter: (wr ?? []) as unknown as GeraeteStand["wechselrichter"],
    speicher: (speicher ?? []) as unknown as GeraeteStand["speicher"],
  };

  const bedarf = bedarfAusPlan(plan, geraete);
  if (bedarf.length === 0) {
    return { error: "Die Planung enthält noch keine Geräte.", ok: null };
  }

  /*
   * Was schon im Angebot steht, wird nicht doppelt angelegt. Verglichen
   * wird über den Artikel — die Bezeichnung ändert sich, sobald jemand
   * eine Zeile umformuliert.
   */
  const { data: bestehende } = await supabase
    .from("vorgang_position")
    .select("article_id, sort")
    .eq("vorgang_id", vorgangId)
    .is("dokument_id", null);

  const schonDa = new Set(
    (bestehende ?? []).map((p) => p.article_id as string | null).filter((x): x is string => !!x),
  );
  let sort = Math.max(0, ...(bestehende ?? []).map((p) => Number(p.sort ?? 0))) + 10;

  const artikelIds = bedarf
    .map((b) => b.artikel_id)
    .filter((x): x is string => typeof x === "string");
  const { data: artikel } = artikelIds.length
    ? await supabase
        .from("article")
        .select(
          "id, name, unit, purchase_price, sale_price, vat_rate, description, image_url, kalk_stunden_pro_einheit, ist_material",
        )
        .in("id", artikelIds)
    : { data: [] };

  const stamm = new Map((artikel ?? []).map((a) => [a.id as string, a]));

  const zeilen: Record<string, unknown>[] = [];
  let uebersprungen = 0;
  let ohnePreis = 0;

  for (const b of bedarf) {
    if (b.artikel_id && schonDa.has(b.artikel_id)) {
      uebersprungen++;
      continue;
    }
    const a = b.artikel_id ? stamm.get(b.artikel_id) : undefined;
    if (!a) ohnePreis++;

    zeilen.push({
      company_id: z1.me.companyId,
      vorgang_id: vorgangId,
      sort: (sort += 10),
      article_id: a ? (a.id as string) : null,
      bezeichnung: (a?.name as string | undefined) ?? b.bezeichnung,
      menge: b.menge,
      einheit: (a?.unit as string | undefined) ?? b.einheit,
      ep_netto: a ? Number(a.sale_price ?? 0) : 0,
      ust_satz: a ? Number(a.vat_rate ?? 20) : Number(vorgang.ust_satz ?? 20),
      kalk_ek: a ? a.purchase_price : null,
      kalk_stunden: a ? a.kalk_stunden_pro_einheit : null,
      ist_material: a ? ((a.ist_material as boolean | null) ?? true) : true,
      bild_url: (a?.image_url as string | null | undefined) ?? null,
      beschreibung: a
        ? ((a.description as string | null | undefined) ?? null)
        : "Aus der Planung übernommen — im Material zuordnen und Preis nachtragen.",
    });
  }

  if (zeilen.length === 0) {
    return { error: null, ok: "Alle Geräte der Planung stehen schon im Angebot." };
  }

  const { error } = await supabase.from("vorgang_position").insert(zeilen);
  if (error) return { error: `Übernahme fehlgeschlagen: ${error.message}`, ok: null };

  revalidatePath(`/vorgaenge/${vorgangId}`);

  const teile = [`${zeilen.length} Positionen aus der Planung übernommen`];
  if (uebersprungen > 0) teile.push(`${uebersprungen} standen schon drin`);
  if (ohnePreis > 0) teile.push(`${ohnePreis} ohne Artikel — Preis nachtragen`);
  return { error: null, ok: `${teile.join(", ")}.` };
}
