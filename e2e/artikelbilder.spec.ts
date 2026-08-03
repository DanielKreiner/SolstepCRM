import { expect, test } from "@playwright/test";
import {
  COMPANY_A,
  DEMO,
  admin,
  login,
  portalToken,
  suchwahl,
} from "./helpers";

/*
 * Artikelbilder auf dem ganzen Weg: in der Suche, in der Positionszeile,
 * auf der Angebotsseite des Kunden und im PDF.
 *
 * Ein Modul erkennt man am Bild schneller als am Namen — vier Hersteller
 * nennen ihr Gerät fast gleich. Genau deshalb war die Klappliste
 * unbrauchbar.
 */

test.describe.configure({ mode: "serial" });

const zustand: {
  quoteId?: string;
  positionId?: string | undefined;
  kundeId?: string | undefined;
  artikelName?: string;
  bild?: string;
} = {};

async function aufraeumen(): Promise<void> {
  const db = admin();
  if (zustand.positionId) {
    await db.from("quote_item").delete().eq("id", zustand.positionId);
    zustand.positionId = undefined;
  }
  if (zustand.kundeId) {
    await db.from("portal_access").delete().eq("customer_id", zustand.kundeId);
    zustand.kundeId = undefined;
  }
}

test.beforeAll(async () => {
  await aufraeumen();
  const db = admin();

  const { data: artikel } = await db
    .from("article")
    .select("name, image_url")
    .eq("company_id", COMPANY_A)
    .eq("active", true)
    .not("image_url", "is", null)
    .limit(1)
    .single();

  zustand.artikelName = artikel!.name as string;
  zustand.bild = artikel!.image_url as string;
});

test.afterAll(aufraeumen);

test("1 — Die Artikelsuche zeigt Vorschaubilder", async ({ page }) => {
  await login(page, DEMO.gf);

  const db = admin();
  const { data: angebot } = await db
    .from("quote")
    .select("id")
    .eq("company_id", COMPANY_A)
    .is("accepted_at", null)
    .is("sent_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  zustand.quoteId = angebot!.id as string;

  await page.goto(`/angebote/${zustand.quoteId}`);

  /*
   * Kein <select> mehr — ein Betrieb mit 468 Artikeln scrollt sonst,
   * statt zu tippen.
   */
  const feld = page.getByRole("combobox", { name: "Artikel", exact: true });
  await expect(feld).toBeVisible();
  await feld.click();
  await feld.fill(zustand.artikelName!.slice(0, 12));

  /*
   * Nicht den ersten Treffer nehmen: mehrere Artikel beginnen gleich,
   * und dann prüft man das Bild eines anderen.
   */
  const treffer = page
    .getByRole("listbox", { name: "Artikel" })
    .getByRole("option")
    .filter({ hasText: zustand.artikelName! })
    .first();
  await expect(treffer).toBeVisible();
  await expect(treffer.locator("img")).toHaveAttribute("src", zustand.bild!);
});

test("2 — Das Bild wandert in die Position", async ({ page }) => {
  const db = admin();
  await login(page, DEMO.gf);
  await page.goto(`/angebote/${zustand.quoteId}`);

  // Auf der Seite stehen zwei Mengenfelder — Artikel und freie Position.
  const form = page.locator("form", { hasText: "Artikel übernehmen" });
  await suchwahl(form, "Artikel", zustand.artikelName!);
  await form.getByLabel("Menge").fill("2");
  await form.getByRole("button", { name: "Übernehmen" }).click();

  await expect(page.getByText(/übernommen/)).toBeVisible({ timeout: 20_000 });

  const { data: position } = await db
    .from("quote_item")
    .select("id, image_url, text")
    .eq("quote_id", zustand.quoteId!)
    .eq("text", zustand.artikelName!)
    .single();

  /*
   * Kopiert, nicht verknüpft — dieselbe Regel wie beim Preis. Ein neues
   * Produktfoto beim Hersteller ändert ein verschicktes Angebot nicht.
   */
  expect(position!.image_url).toBe(zustand.bild);
  zustand.positionId = position!.id as string;

  // Und es steht in der Positionszeile.
  await page.reload();
  await expect(
    page.locator(`img[src="${zustand.bild}"]`).first(),
  ).toBeVisible();
});

test("3 — Der Kunde sieht das Bild auf der Angebotsseite", async ({ page }) => {
  const db = admin();

  const { data: quote } = await db
    .from("quote")
    .select("customer_id")
    .eq("id", zustand.quoteId!)
    .single();
  zustand.kundeId = quote!.customer_id as string;

  await login(page, DEMO.gf);
  const token = await portalToken(page, zustand.kundeId);

  await page.context().clearCookies();
  await page.goto(`/portal/${token}/angebot/${zustand.quoteId}`);

  await expect(
    page.locator(`img[src="${zustand.bild}"]`).first(),
  ).toBeVisible();
});

test("4 — Das PDF entsteht auch mit Bildern", async ({ page }) => {
  await login(page, DEMO.gf);

  /*
   * Bilder werden beim Rendern nachgeladen. Ein toter Link würde ohne
   * den zweiten Anlauf ohne Bilder das ganze PDF scheitern lassen — und
   * der Kunde bekäme statt eines Angebots einen Fehler.
   */
  const antwort = await page.request.get(`/api/pdf/quote/${zustand.quoteId}`);
  expect(antwort.status()).toBe(200);
  expect(antwort.headers()["content-type"]).toContain("application/pdf");

  const körper = await antwort.body();
  expect(körper.length).toBeGreaterThan(1000);
  expect(körper.subarray(0, 4).toString()).toBe("%PDF");
});

test("5 — Kein Bild zeigt auf eine fremde Domain", async () => {
  const db = admin();

  /*
   * Die Bilder kamen mit dem Artikelübertrag aus dem Handelsgeschäft und
   * zeigten anfangs auf dessen Storage. CLAUDE.md Abschnitt 0 schliesst
   * jede solche Verbindung aus: räumt jemand dort ein Produkt weg,
   * verliert ein verschicktes Angebot sein Bild, und das Angebots-PDF
   * würde bei jeder Erzeugung eine fremde Infrastruktur abrufen.
   *
   * scripts/import-artikelbilder.ts hat sie einmalig herübergeholt.
   * Dieser Test hält fest, dass sie dort bleiben.
   */
  const eigene = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/article-images/`;

  const { data: artikel } = await db
    .from("article")
    .select("sku, image_url")
    .eq("company_id", COMPANY_A)
    .not("image_url", "is", null);

  const fremd = (artikel ?? []).filter(
    (a) => !(a.image_url as string).startsWith(eigene),
  );

  expect(
    fremd.map((a) => `${a.sku as string}: ${a.image_url as string}`),
  ).toEqual([]);

  const { data: positionen } = await db
    .from("quote_item")
    .select("id, image_url")
    .eq("company_id", COMPANY_A)
    .not("image_url", "is", null);

  const fremdePositionen = (positionen ?? []).filter(
    (p) => !(p.image_url as string).startsWith(eigene),
  );
  expect(fremdePositionen.map((p) => p.image_url as string)).toEqual([]);
});

test("6 — Das Bild ist ohne Anmeldung abrufbar", async ({ page }) => {
  const db = admin();
  const { data } = await db
    .from("article")
    .select("image_url")
    .eq("company_id", COMPANY_A)
    .not("image_url", "is", null)
    .limit(1)
    .single();

  /*
   * Der Bucket ist öffentlich wie avatars: das Kundenportal und das
   * PDF laden die Bilder ohne Sitzung. Ein Produktfoto ist kein
   * Personendatum.
   */
  await page.context().clearCookies();
  const antwort = await page.request.get(data!.image_url as string);
  expect(antwort.status()).toBe(200);
  expect(antwort.headers()["content-type"]).toContain("image/");
});
