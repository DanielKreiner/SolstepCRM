"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { AktionsStatus } from "@/components/ui/Formular";
import { requireMe } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

/*
 * Artikel- und Lieferantenstammdaten.
 *
 * Getrennt von lager/actions.ts, wo die Bestandsbuchungen liegen: eine
 * Buchung ist ein Vorgang, ein Artikel ist ein Stammdatum. Wer den einen
 * ändert, ändert nicht den anderen — und die Rechte unterscheiden sich in
 * der Praxis (Lager bucht, Büro pflegt).
 */

const leerZuNull = (v: string | undefined): string | null =>
  v && v.trim() !== "" ? v.trim() : null;

async function darfSchreiben() {
  const me = await requireMe();
  if (me.perms.lager !== "write") {
    return {
      ok: false as const,
      status: { error: "Für das Lager fehlt deiner Rolle das Schreibrecht.", ok: null },
    };
  }
  return { ok: true as const, me };
}

const artikelSchema = z.object({
  sku: z
    .string()
    .trim()
    .min(2, "Artikelnummer fehlt.")
    .max(60)
    .regex(/^[A-Za-z0-9._\-/]+$/, "Nur Buchstaben, Ziffern, Punkt, Bindestrich."),
  name: z.string().trim().min(2, "Bezeichnung fehlt.").max(160),
  manufacturer: z.string().trim().max(80).optional().or(z.literal("")),
  category: z.string().trim().max(80).optional().or(z.literal("")),
  unit: z.string().trim().min(1).max(12),
  minStock: z.coerce.number().min(0).max(1000000).default(0),
  locationCode: z.string().trim().max(40).optional().or(z.literal("")),
  purchasePrice: z.coerce.number().min(0).max(10000000).default(0),
  salePrice: z.coerce.number().min(0).max(10000000).default(0),
  vatRate: z.coerce.number().min(0).max(30).default(20),
  /*
   * Der Materialfluss. Steht am Artikel, damit ihn niemand auf der
   * Baustelle entscheiden muss.
   */
  typ: z.enum(["stueckliste", "vanstock", "nicht_bestandsgefuehrt"]).default("stueckliste"),
  ean: z.string().trim().max(40).optional().or(z.literal("")),
  seriennummernpflichtig: z.enum(["ja", "nein"]).default("nein"),
  istPaket: z.enum(["ja", "nein"]).default("nein"),
});

/**
 * Artikel anlegen.
 *
 * `stock` wird bewusst NICHT gesetzt: der Bestand entsteht ausschließlich
 * aus Bewegungen (CLAUDE.md 5.5, stock_move ist revisionspflichtig). Ein
 * Anfangsbestand ist ein Wareneingang und wird als solcher gebucht — sonst
 * gibt es Bestand, den keine Bewegung erklärt.
 */
export async function createArticle(
  _prev: AktionsStatus,
  formData: FormData,
): Promise<AktionsStatus> {
  const zugang = await darfSchreiben();
  if (!zugang.ok) return zugang.status;

  const parsed = artikelSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Eingabe fehlt.", ok: null };
  }
  const d = parsed.data;

  if (d.salePrice > 0 && d.salePrice < d.purchasePrice) {
    return {
      error: `Der Verkaufspreis liegt unter dem Einkauf (${d.salePrice} < ${d.purchasePrice}). Wenn das so gewollt ist, trag den Verkaufspreis mit 0 ein und kalkuliere im Angebot.`,
      ok: null,
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("article")
    .insert({
      company_id: zugang.me.companyId,
      sku: d.sku,
      name: d.name,
      manufacturer: leerZuNull(d.manufacturer),
      category: leerZuNull(d.category),
      unit: d.unit,
      min_stock: d.minStock,
      location_code: leerZuNull(d.locationCode),
      purchase_price: d.purchasePrice,
      sale_price: d.salePrice,
      vat_rate: d.vatRate,
      active: true,
      typ: d.typ,
      ean: leerZuNull(d.ean),
      seriennummernpflichtig: d.seriennummernpflichtig === "ja",
      ist_paket: d.istPaket === "ja",
    })
    .select("id, sku")
    .single();

  if (error) {
    if (error.code === "23505") {
      return { error: `Die Artikelnummer ${d.sku} gibt es schon.`, ok: null };
    }
    return { error: `Anlegen fehlgeschlagen: ${error.message}`, ok: null };
  }

  revalidatePath("/lager");
  return {
    error: null,
    ok: `${data.sku as string} angelegt. Bestand entsteht über einen Wareneingang.`,
  };
}

export async function updateArticle(
  _prev: AktionsStatus,
  formData: FormData,
): Promise<AktionsStatus> {
  const zugang = await darfSchreiben();
  if (!zugang.ok) return zugang.status;

  const id = z.string().uuid().safeParse(formData.get("articleId"));
  if (!id.success) return { error: "Artikel fehlt.", ok: null };

  const parsed = artikelSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Eingabe fehlt.", ok: null };
  }
  const d = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase
    .from("article")
    .update({
      sku: d.sku,
      name: d.name,
      manufacturer: leerZuNull(d.manufacturer),
      category: leerZuNull(d.category),
      unit: d.unit,
      min_stock: d.minStock,
      location_code: leerZuNull(d.locationCode),
      purchase_price: d.purchasePrice,
      sale_price: d.salePrice,
      vat_rate: d.vatRate,
      typ: d.typ,
      ean: leerZuNull(d.ean),
      seriennummernpflichtig: d.seriennummernpflichtig === "ja",
      ist_paket: d.istPaket === "ja",
    })
    .eq("id", id.data);

  if (error) {
    if (error.code === "23505") {
      return { error: `Die Artikelnummer ${d.sku} gibt es schon.`, ok: null };
    }
    return { error: `Speichern fehlgeschlagen: ${error.message}`, ok: null };
  }

  revalidatePath("/lager");
  revalidatePath(`/lager/${id.data}`);
  return { error: null, ok: "Gespeichert." };
}

/**
 * Artikel stilllegen statt löschen.
 *
 * An einem Artikel hängen Bewegungen und Angebotspositionen. Ein
 * stillgelegter Artikel verschwindet aus den Auswahllisten, seine Historie
 * bleibt lesbar. Löschen gibt es nur, solange er nie benutzt wurde.
 */
export async function toggleArticleActive(
  _prev: AktionsStatus,
  formData: FormData,
): Promise<AktionsStatus> {
  const zugang = await darfSchreiben();
  if (!zugang.ok) return zugang.status;

  const parsed = z
    .object({ articleId: z.string().uuid(), aktiv: z.enum(["0", "1"]) })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Eingabe fehlt.", ok: null };

  const aktiv = parsed.data.aktiv === "1";
  const supabase = await createClient();

  if (!aktiv) {
    const { data: artikel } = await supabase
      .from("article")
      .select("stock, name")
      .eq("id", parsed.data.articleId)
      .maybeSingle();

    if (artikel && Number(artikel.stock) !== 0) {
      return {
        error: `${artikel.name as string} hat noch ${artikel.stock} auf Lager. Erst ausbuchen, dann stilllegen — sonst verschwindet Bestand aus der Bewertung.`,
        ok: null,
      };
    }
  }

  const { error } = await supabase
    .from("article")
    .update({ active: aktiv })
    .eq("id", parsed.data.articleId);

  if (error) return { error: `Fehlgeschlagen: ${error.message}`, ok: null };

  revalidatePath("/lager");
  return { error: null, ok: aktiv ? "Artikel wieder aktiv." : "Artikel stillgelegt." };
}

export async function deleteArticle(
  _prev: AktionsStatus,
  formData: FormData,
): Promise<AktionsStatus> {
  const zugang = await darfSchreiben();
  if (!zugang.ok) return zugang.status;

  const id = z.string().uuid().safeParse(formData.get("articleId"));
  if (!id.success) return { error: "Artikel fehlt.", ok: null };

  const supabase = await createClient();
  const { count } = await supabase
    .from("stock_move")
    .select("id", { count: "exact", head: true })
    .eq("article_id", id.data);

  if ((count ?? 0) > 0) {
    return {
      error: `Auf diesen Artikel wurden ${count} Bewegungen gebucht. Die sind revisionspflichtig — leg ihn still, statt ihn zu löschen.`,
      ok: null,
    };
  }

  const { error } = await supabase.from("article").delete().eq("id", id.data);
  if (error) return { error: `Löschen fehlgeschlagen: ${error.message}`, ok: null };

  revalidatePath("/lager");
  return { error: null, ok: "Artikel gelöscht." };
}

// --------------------------------------------------------------------------
// Lieferanten
// --------------------------------------------------------------------------

const lieferantSchema = z.object({
  name: z.string().trim().min(2, "Name fehlt.").max(120),
  email: z
    .string()
    .trim()
    .max(160)
    .refine((v) => v === "" || z.string().email().safeParse(v).success, {
      message: "Das ist keine gültige Mailadresse.",
    }),
  phone: z.string().trim().max(60).optional().or(z.literal("")),
  customerNumber: z.string().trim().max(60).optional().or(z.literal("")),
  frameworkContract: z.union([z.literal("on"), z.literal("")]).optional(),
});

export async function saveSupplier(
  _prev: AktionsStatus,
  formData: FormData,
): Promise<AktionsStatus> {
  const zugang = await darfSchreiben();
  if (!zugang.ok) return zugang.status;

  const parsed = lieferantSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Eingabe fehlt.", ok: null };
  }
  const d = parsed.data;
  const supplierId = formData.get("supplierId");

  const werte = {
    company_id: zugang.me.companyId,
    name: d.name,
    email: leerZuNull(d.email),
    phone: leerZuNull(d.phone),
    customer_number: leerZuNull(d.customerNumber),
    framework_contract: d.frameworkContract === "on",
  };

  const supabase = await createClient();
  const { error } =
    typeof supplierId === "string" && supplierId.length > 0
      ? await supabase.from("supplier").update(werte).eq("id", supplierId)
      : await supabase.from("supplier").insert(werte);

  if (error) return { error: `Speichern fehlgeschlagen: ${error.message}`, ok: null };

  revalidatePath("/bestellungen");
  return { error: null, ok: `${d.name} gespeichert.` };
}

/** Artikelpreis eines Lieferanten — Grundlage des Bestellvorschlags. */
export async function saveArticleSupplier(
  _prev: AktionsStatus,
  formData: FormData,
): Promise<AktionsStatus> {
  const zugang = await darfSchreiben();
  if (!zugang.ok) return zugang.status;

  const parsed = z
    .object({
      articleId: z.string().uuid(),
      supplierId: z.string().uuid(),
      price: z.coerce.number().min(0).max(10000000),
      leadDays: z.coerce.number().int().min(0).max(365).default(0),
    })
    .safeParse(Object.fromEntries(formData));

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Eingabe fehlt.", ok: null };
  }
  const d = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase.from("article_supplier").upsert(
    {
      company_id: zugang.me.companyId,
      article_id: d.articleId,
      supplier_id: d.supplierId,
      price: d.price,
      lead_days: d.leadDays,
    },
    { onConflict: "article_id,supplier_id" },
  );

  if (error) return { error: `Speichern fehlgeschlagen: ${error.message}`, ok: null };

  revalidatePath(`/lager/${d.articleId}`);
  revalidatePath("/bestellungen");
  return { error: null, ok: "Lieferantenpreis gespeichert." };
}

/* ------------------------------------------------------- STÜCKLISTEN */

/**
 * Ein Teil zur Stückliste eines Pakets hinzufügen.
 *
 * Das Paket ist die Verkaufszeile — „PV-Anlage 10 kWp komplett". Was
 * dahinter steckt, interessiert den Kunden nicht, das Lager aber sehr:
 * aus dieser Liste entsteht beim Annehmen der Bedarf.
 */
export async function stuecklisteHinzufuegen(
  _prev: AktionsStatus,
  formData: FormData,
): Promise<AktionsStatus> {
  const zugang = await darfSchreiben();
  if (!zugang.ok) return zugang.status;

  const parsed = z
    .object({
      paketId: z.string().uuid(),
      artikelId: z.string().uuid(),
      menge: z.coerce.number().gt(0, "Menge muss größer als null sein."),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Eingabe fehlt.", ok: null };
  }
  const d = parsed.data;

  if (d.paketId === d.artikelId) {
    return { error: "Ein Paket kann sich nicht selbst enthalten.", ok: null };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("artikel_stueckliste").insert({
    company_id: zugang.me.companyId,
    paket_id: d.paketId,
    artikel_id: d.artikelId,
    menge: d.menge,
  });

  if (error) {
    if (error.code === "23505") {
      return {
        error: "Der Artikel steht schon in der Stückliste. Ändere dort die Menge.",
        ok: null,
      };
    }
    return { error: `Fehlgeschlagen: ${error.message}`, ok: null };
  }

  revalidatePath(`/lager/${d.paketId}`);
  return { error: null, ok: "Zur Stückliste hinzugefügt." };
}

export async function stuecklisteEntfernen(
  _prev: AktionsStatus,
  formData: FormData,
): Promise<AktionsStatus> {
  const zugang = await darfSchreiben();
  if (!zugang.ok) return zugang.status;

  const parsed = z
    .object({ id: z.string().uuid(), paketId: z.string().uuid() })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Eingabe fehlt.", ok: null };

  const supabase = await createClient();
  const { error } = await supabase
    .from("artikel_stueckliste")
    .delete()
    .eq("id", parsed.data.id);

  if (error) return { error: `Fehlgeschlagen: ${error.message}`, ok: null };

  revalidatePath(`/lager/${parsed.data.paketId}`);
  return { error: null, ok: "Aus der Stückliste entfernt." };
}

/* --------------------------------------------------------- VAN-STOCK */

/**
 * Min- und Sollmenge eines Artikels auf einem Fahrzeug.
 *
 * Ohne Mindestmenge gibt es keine Nachfüll-Liste — und ohne die merkt
 * niemand, dass das Kabel alle ist, bevor er auf dem Dach steht.
 */
export async function vanstockRegel(
  _prev: AktionsStatus,
  formData: FormData,
): Promise<AktionsStatus> {
  const zugang = await darfSchreiben();
  if (!zugang.ok) return zugang.status;

  const parsed = z
    .object({
      artikelId: z.string().uuid(),
      lagerortId: z.string().uuid(),
      min: z.coerce.number().min(0).max(1000000),
      max: z.string().optional().default(""),
    })
    .safeParse(Object.fromEntries(formData));

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Eingabe fehlt.", ok: null };
  }
  const d = parsed.data;

  const maxWert = d.max.trim() === "" ? null : Number(d.max.replace(",", "."));
  if (maxWert !== null && (!Number.isFinite(maxWert) || maxWert < d.min)) {
    return {
      error: "Die Sollmenge darf nicht unter der Mindestmenge liegen.",
      ok: null,
    };
  }

  const supabase = await createClient();

  /*
   * Ohne Mindestmenge und ohne Sollmenge wird der Artikel auf diesem
   * Fahrzeug nicht mehr geführt — die Regel verschwindet, statt als
   * Nullzeile stehen zu bleiben.
   */
  if (d.min === 0 && maxWert === null) {
    await supabase
      .from("vanstock_regel")
      .delete()
      .eq("artikel_id", d.artikelId)
      .eq("lagerort_id", d.lagerortId);

    revalidatePath(`/lager/${d.artikelId}`);
    return { error: null, ok: "Nicht mehr geführt." };
  }

  const { error } = await supabase.from("vanstock_regel").upsert(
    {
      company_id: zugang.me.companyId,
      artikel_id: d.artikelId,
      lagerort_id: d.lagerortId,
      min_menge: d.min,
      max_menge: maxWert,
    },
    { onConflict: "lagerort_id,artikel_id" },
  );

  if (error) return { error: `Fehlgeschlagen: ${error.message}`, ok: null };

  revalidatePath(`/lager/${d.artikelId}`);
  revalidatePath("/material");
  return { error: null, ok: "Gesetzt." };
}
