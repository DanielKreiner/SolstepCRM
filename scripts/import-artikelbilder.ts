/*
 * Artikelbilder in den eigenen Speicher holen.
 *
 * Beim Artikelübertrag (scripts/import-artikel.ts) sind die Bildadressen
 * mitgekommen — und die zeigten auf den Storage des Shops. Das ist genau
 * die Verbindung, die CLAUDE.md Abschnitt 0 ausschliesst: eigenes
 * Projekt, kein Zugriff auf Shop-Daten. Praktisch hing daran, dass ein
 * aufgeräumtes Produkt im Shop einem verschickten Angebot das Bild
 * wegnimmt.
 *
 * Dieses Skript lädt jedes Bild einmal herunter, legt es im Bucket
 * article-images dieses Projekts ab und schreibt article.image_url auf
 * die eigene Adresse um. Danach besteht keine Abhängigkeit mehr.
 *
 * Aufruf:
 *   pnpm tsx scripts/import-artikelbilder.ts            # Vorschau
 *   pnpm tsx scripts/import-artikelbilder.ts --schreiben
 *
 * Wiederholbar: bereits übernommene Bilder werden übersprungen.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const COMPANY_A = "11111111-1111-4111-8111-111111111111";
const BUCKET = "article-images";

/* Grosszügig, aber nicht unbegrenzt — ein 40-MB-Datenblatt gehört nicht hierher. */
const MAX_BYTES = 8 * 1024 * 1024;

const ERLAUBT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
};

function env(datei: string): Record<string, string> {
  return Object.fromEntries(
    readFileSync(datei, "utf8")
      .split("\n")
      .map((z) => z.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/))
      .filter((m): m is RegExpMatchArray => Boolean(m))
      .map((m) => [m[1] as string, (m[2] as string).replace(/^"|"$/g, "")]),
  );
}

async function main(): Promise<void> {
  const schreiben = process.argv.includes("--schreiben");
  const e = env(path.join(process.cwd(), ".env.local"));

  const db = createClient(
    e.NEXT_PUBLIC_SUPABASE_URL as string,
    e.SUPABASE_SERVICE_ROLE_KEY as string,
    { auth: { persistSession: false } },
  );

  const eigeneBasis = `${e.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${BUCKET}/`;

  const { data: artikel, error } = await db
    .from("article")
    .select("id, sku, image_url")
    .eq("company_id", COMPANY_A)
    .not("image_url", "is", null);

  if (error) throw error;

  const offen = (artikel ?? []).filter(
    (a) => !(a.image_url as string).startsWith(eigeneBasis),
  );

  console.log(
    `${artikel?.length ?? 0} Artikel mit Bild, davon ${offen.length} noch auf fremder Adresse.`,
  );
  if (!schreiben) {
    console.log("Vorschau — mit --schreiben tatsächlich übernehmen.");
    for (const a of offen.slice(0, 5)) {
      console.log(`  ${a.sku}  ${(a.image_url as string).slice(0, 78)}`);
    }
    return;
  }

  let uebernommen = 0;
  let uebersprungen = 0;
  const fehler: string[] = [];

  for (const a of offen) {
    const quelle = a.image_url as string;
    try {
      const antwort = await fetch(quelle);
      if (!antwort.ok) {
        fehler.push(`${a.sku}: HTTP ${antwort.status}`);
        continue;
      }

      const typ = (antwort.headers.get("content-type") ?? "")
        .split(";")[0]!
        .trim()
        .toLowerCase();
      const endung = ERLAUBT[typ];
      if (!endung) {
        fehler.push(`${a.sku}: unerwarteter Typ ${typ || "unbekannt"}`);
        continue;
      }

      const bytes = new Uint8Array(await antwort.arrayBuffer());
      if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) {
        fehler.push(`${a.sku}: ${bytes.byteLength} Bytes`);
        continue;
      }

      /*
       * Pfadschema wie überall in diesem Produkt:
       * {company_id}/{entity}/{entity_id}/{name}
       * Fester Dateiname je Artikel, damit ein zweiter Lauf überschreibt
       * statt Karteileichen anzuhäufen.
       */
      const pfad = `${COMPANY_A}/article/${a.id as string}/bild.${endung}`;

      const { error: hochFehler } = await db.storage
        .from(BUCKET)
        .upload(pfad, bytes, { contentType: typ, upsert: true });

      if (hochFehler) {
        fehler.push(`${a.sku}: Upload — ${hochFehler.message}`);
        continue;
      }

      const { error: schreibFehler } = await db
        .from("article")
        .update({ image_url: `${eigeneBasis}${pfad}` })
        .eq("id", a.id);

      if (schreibFehler) {
        fehler.push(`${a.sku}: Adresse — ${schreibFehler.message}`);
        continue;
      }

      uebernommen++;
      if (uebernommen % 25 === 0) console.log(`  ${uebernommen} übernommen …`);
    } catch (fehlschlag) {
      fehler.push(`${a.sku}: ${(fehlschlag as Error).message}`);
    }
  }

  uebersprungen = offen.length - uebernommen - fehler.length;

  console.log(`\n${uebernommen} Bilder übernommen.`);
  if (uebersprungen > 0) console.log(`${uebersprungen} übersprungen.`);

  if (fehler.length > 0) {
    /*
     * Fehler werden vollständig genannt, nicht gezählt. Ein Artikel ohne
     * Bild ist kein Drama — aber man soll wissen, welcher.
     */
    console.log(`\n${fehler.length} nicht übernommen:`);
    for (const f of fehler) console.log(`  ${f}`);
  }

  /*
   * Bereits erstellte Angebotspositionen tragen die alte Adresse als
   * Kopie. Sie werden mitgezogen: ein Angebot soll sich nicht ändern,
   * aber es soll auch nicht auf den Shop zeigen.
   */
  const { data: positionen } = await db
    .from("quote_item")
    .select("id, image_url")
    .eq("company_id", COMPANY_A)
    .not("image_url", "is", null);

  let nachgezogen = 0;
  for (const p of positionen ?? []) {
    const alt = p.image_url as string;
    if (alt.startsWith(eigeneBasis)) continue;

    const treffer = (artikel ?? []).find((a) => a.image_url === alt);
    if (!treffer) continue;

    const { data: jetzt } = await db
      .from("article")
      .select("image_url")
      .eq("id", treffer.id)
      .single();

    if (!jetzt?.image_url || !(jetzt.image_url as string).startsWith(eigeneBasis)) {
      continue;
    }

    await db
      .from("quote_item")
      .update({ image_url: jetzt.image_url })
      .eq("id", p.id);
    nachgezogen++;
  }

  if (nachgezogen > 0) {
    console.log(`\n${nachgezogen} Angebotspositionen auf die eigene Adresse gezogen.`);
  }
}

main().catch((f) => {
  console.error(f);
  process.exit(1);
});
