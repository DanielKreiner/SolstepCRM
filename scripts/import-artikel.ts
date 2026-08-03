/*
 * Einmaliger Artikelübertrag aus dem Solstep-Shop.
 *
 * CLAUDE.md Abschnitt 0 verbietet eine Verbindung zwischen Shop und
 * Betriebssoftware. Dieses Skript ist keine: es liest den Shopbestand
 * EINMAL, schreibt ihn als eigene Artikelstammdaten in den Mandanten und
 * läuft danach nie wieder. Es gibt keinen Abgleich, keinen Job, keine
 * gemeinsame Datenbank — nach dem Lauf sind die Artikel Eigentum des
 * Mandanten und entwickeln sich unabhängig weiter.
 *
 * Aufruf:
 *   pnpm tsx scripts/import-artikel.ts            # Vorschau
 *   pnpm tsx scripts/import-artikel.ts --schreiben
 *
 * Die Zugangsdaten des Shops kommen aus dessen eigener .env.local und
 * werden nicht in dieses Repo übernommen.
 *
 * ACHTUNG: image_url zeigt nach diesem Lauf auf den Storage des Shops.
 * Das ist eine Verbindung, die Abschnitt 0 ausschliesst — direkt danach
 * muss scripts/import-artikelbilder.ts laufen, das die Bilder in den
 * eigenen Bucket holt und die Adressen umschreibt.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SHOP = "/Users/daniel/Documents/SolstepB2B";
const COMPANY_A = "11111111-1111-4111-8111-111111111111";

/** Verkaufspreis, wenn der Shop keinen führt: Einkauf plus Aufschlag. */
const AUFSCHLAG = 1.25;

function env(datei: string): Record<string, string> {
  return Object.fromEntries(
    readFileSync(datei, "utf8")
      .split("\n")
      .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
      .map((l) => {
        const i = l.indexOf("=");
        return [
          l.slice(0, i).trim(),
          l.slice(i + 1).trim().replace(/^["']|["']$/g, ""),
        ];
      }),
  );
}

function klient(datei: string): SupabaseClient {
  const e = env(datei);
  const url = e.NEXT_PUBLIC_SUPABASE_URL;
  const key = e.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error(`Zugangsdaten fehlen in ${datei}`);
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * Einheit aus der Verpackungseinheit des Shops ableiten.
 *
 * Der Shop kennt "Rolle", "Palette", "Stk" — der Betrieb rechnet in dem,
 * was der Monteur vom Regal nimmt. Alles Unbekannte wird Stück.
 */
function einheit(verpackung: unknown): string {
  const v = String(verpackung ?? "").toLowerCase();
  if (v.includes("rolle")) return "Rolle";
  if (v.includes("meter") || v === "m") return "m";
  if (v.includes("palette")) return "Pal";
  if (v.includes("satz") || v.includes("set")) return "Satz";
  return "Stk";
}

/** Erstes Bild aus dem Bildfeld des Shops. Formate variieren. */
function erstesBild(images: unknown): string | null {
  if (Array.isArray(images) && images.length > 0) {
    const b = images[0] as unknown;
    if (typeof b === "string") return b;
    if (b && typeof b === "object" && "url" in b) {
      return String((b as { url: unknown }).url);
    }
  }
  return null;
}

function erstesDatenblatt(datasheets: unknown): string | null {
  if (Array.isArray(datasheets) && datasheets.length > 0) {
    const d = datasheets[0] as unknown;
    if (typeof d === "string") return d;
    if (d && typeof d === "object" && "url" in d) {
      return String((d as { url: unknown }).url);
    }
  }
  return null;
}

async function main() {
  const schreiben = process.argv.includes("--schreiben");

  const shop = klient(path.join(SHOP, ".env.local"));
  const crm = klient(path.join(process.cwd(), ".env.local"));

  const { data: kategorien } = await shop.from("categories").select("id, name");
  const kategorieName = new Map(
    (kategorien ?? []).map((k) => [k.id as string, k.name as string]),
  );

  const { data: produkte, error } = await shop
    .from("products")
    .select(
      "sku, name, manufacturer, category_id, short_desc, description, tech_specs, images, datasheets, list_price, cost_price, min_stock, packaging_unit",
    )
    .eq("status", "active")
    .order("sku");

  if (error) throw new Error(`Shop lesen fehlgeschlagen: ${error.message}`);

  const zeilen = (produkte ?? []).map((p) => {
    const ek = Number(p.cost_price ?? 0);
    const vkRoh = Number(p.list_price ?? 0);
    return {
      company_id: COMPANY_A,
      sku: String(p.sku),
      name: String(p.name),
      manufacturer: (p.manufacturer as string | null) ?? null,
      category: kategorieName.get(p.category_id as string) ?? null,
      unit: einheit(p.packaging_unit),
      /*
       * Bestand bleibt bei null. Er entsteht aus Bewegungen — ein
       * übernommener Shopbestand wäre Bestand, den keine Buchung im
       * Betrieb erklärt, und die Inventur ginge nie auf.
       */
      min_stock: Number(p.min_stock ?? 0),
      purchase_price: ek,
      sale_price: vkRoh > 0 ? vkRoh : Math.round(ek * AUFSCHLAG * 100) / 100,
      vat_rate: 20,
      active: true,
      description:
        (p.short_desc as string | null) ?? (p.description as string | null) ?? null,
      tech_specs: p.tech_specs ?? null,
      datasheet_url: erstesDatenblatt(p.datasheets),
      image_url: erstesBild(p.images),
    };
  });

  console.log(`${zeilen.length} aktive Artikel im Shop.`);
  console.log(
    `Davon mit Datenblatt: ${zeilen.filter((z) => z.datasheet_url).length}, ` +
      `mit Bild: ${zeilen.filter((z) => z.image_url).length}, ` +
      `mit Beschreibung: ${zeilen.filter((z) => z.description).length}`,
  );

  const ohnePreis = zeilen.filter((z) => z.purchase_price === 0);
  if (ohnePreis.length > 0) {
    console.log(
      `Ohne Einkaufspreis: ${ohnePreis.length} (${ohnePreis
        .slice(0, 3)
        .map((z) => z.sku)
        .join(", ")}…)`,
    );
  }

  if (!schreiben) {
    console.log("\nVorschau. Zum Schreiben mit --schreiben aufrufen.");
    return;
  }

  /*
   * Upsert auf (company_id, sku): ein zweiter Lauf aktualisiert, statt zu
   * scheitern. Bestand und Lagerort bleiben unberührt — die gehören dem
   * Betrieb, nicht dem Shop.
   */
  let geschrieben = 0;
  for (let i = 0; i < zeilen.length; i += 100) {
    const teil = zeilen.slice(i, i + 100);
    const { error: fehler } = await crm
      .from("article")
      .upsert(teil, { onConflict: "company_id,sku", ignoreDuplicates: false });
    if (fehler) throw new Error(`Schreiben fehlgeschlagen: ${fehler.message}`);
    geschrieben += teil.length;
    process.stdout.write(`\r${geschrieben}/${zeilen.length}`);
  }
  console.log(`\n${geschrieben} Artikel übernommen.`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
