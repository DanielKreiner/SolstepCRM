import { expect, test } from "@playwright/test";
import {
  COMPANY_A,
  DEMO,
  admin,
  login,
  portalToken,
} from "./helpers";

/*
 * Artikelbilder auf dem ganzen Weg: in der Suche, in der Positionszeile,
 * im Kundenportal und im PDF.
 *
 * Ein Modul erkennt man am Bild schneller als am Namen — vier Hersteller
 * nennen ihr Gerät fast gleich. Genau deshalb war die Klappliste
 * unbrauchbar.
 */

test.describe.configure({ mode: "serial" });

const zustand: {
  vorgangId?: string;
  positionId?: string | undefined;
  kundeId?: string | undefined;
  artikelName?: string;
  bild?: string;
} = {};

async function aufraeumen(): Promise<void> {
  const db = admin();
  /*
   * Nach dem Namen räumen und nicht nach der gemerkten ID: bricht der
   * Test vor der Zuweisung ab, bliebe die Position sonst liegen und der
   * nächste Lauf fände zwei.
   */
  if (zustand.vorgangId && zustand.artikelName) {
    await db
      .from("vorgang_position")
      .delete()
      .eq("vorgang_id", zustand.vorgangId)
      .eq("bezeichnung", zustand.artikelName);
  }
  zustand.positionId = undefined;
  if (zustand.kundeId) {
    await db.from("portal_access").delete().eq("customer_id", zustand.kundeId);
    zustand.kundeId = undefined;
  }
}

test.beforeAll(async () => {
  await aufraeumen();
  const db = admin();

  /*
   * Sortiert wählen, nicht limit(1) auf gut Glück: ohne order liefert
   * Postgres bei jedem Lauf eine andere Zeile, und dann prüft der Test
   * mal dieses und mal jenes Bild.
   */
  const { data: artikel } = await db
    .from("article")
    .select("name, image_url")
    .eq("company_id", COMPANY_A)
    .eq("active", true)
    .not("image_url", "is", null)
    .order("sku")
    .limit(1)
    .single();

  zustand.artikelName = artikel!.name as string;
  zustand.bild = artikel!.image_url as string;
});

test.afterAll(aufraeumen);

test("1 — Die Artikelsuche zeigt Vorschaubilder", async ({ page }) => {
  await login(page, DEMO.gf);

  const db = admin();
  const { data: vorgang } = await db
    .from("vorgang")
    .select("id")
    .eq("company_id", COMPANY_A)
    .in("phase", ["anfrage", "aufnahme", "angebot"])
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  zustand.vorgangId = vorgang!.id as string;

  await page.goto(`/vorgaenge/${zustand.vorgangId}?tab=angebot`);

  /*
   * Die Auswahl steckt seit dem Umbau im Fenster „Produkt hinzufügen".
   * Ein <select> wäre es ohnehin nicht — ein Betrieb mit 468 Artikeln
   * scrollt sonst, statt zu tippen.
   */
  await page.getByRole("button", { name: "Produkt", exact: true }).click();
  const fenster = page.getByRole("dialog");
  await fenster.getByRole("searchbox").fill(zustand.artikelName!.slice(0, 12));

  /*
   * Nicht den ersten Treffer nehmen: mehrere Artikel beginnen gleich,
   * und dann prüft man das Bild eines anderen.
   */
  const treffer = fenster
    .getByRole("button")
    .filter({ hasText: zustand.artikelName! })
    .first();
  await expect(treffer).toBeVisible();
  await expect(treffer.locator("img")).toHaveAttribute("src", zustand.bild!);
});

test("2 — Das Bild wandert in die Position", async ({ page }) => {
  const db = admin();
  await aufraeumen();
  await login(page, DEMO.gf);
  await page.goto(`/vorgaenge/${zustand.vorgangId}?tab=angebot`);

  await page.getByRole("button", { name: "Produkt", exact: true }).click();
  const fenster = page.getByRole("dialog");
  await fenster.getByLabel("Menge").fill("2");
  await fenster.getByRole("searchbox").fill(zustand.artikelName!.slice(0, 12));
  await fenster
    .getByRole("button")
    .filter({ hasText: zustand.artikelName! })
    .first()
    .click();

  /*
   * Auf die Wirkung warten, nicht auf die Meldung: die Liste wird nach
   * dem Übernehmen neu gerendert, und der Erfolgstext verschwindet mit
   * dem Formular, das ihn getragen hat.
   */
  await expect
    .poll(
      async () => {
        const { count } = await db
          .from("vorgang_position")
          .select("id", { count: "exact", head: true })
          .eq("vorgang_id", zustand.vorgangId!)
          .eq("bezeichnung", zustand.artikelName!);
        return count ?? 0;
      },
      { timeout: 20_000 },
    )
    .toBeGreaterThan(0);

  const { data: position, error } = await db
    .from("vorgang_position")
    .select("id, bild_url, bezeichnung")
    .eq("vorgang_id", zustand.vorgangId!)
    .eq("bezeichnung", zustand.artikelName!)
    .limit(1)
    .single();
  expect(error, error?.message).toBeNull();

  /*
   * Kopiert, nicht verknüpft — dieselbe Regel wie beim Preis. Ein neues
   * Produktfoto beim Hersteller ändert ein verschicktes Angebot nicht.
   */
  expect(position!.bild_url).toBe(zustand.bild);
  zustand.positionId = position!.id as string;

  // Und es steht in der Positionszeile.
  await page.reload();
  await expect(
    page.locator(`img[src="${zustand.bild}"]`).first(),
  ).toBeVisible();
});

test("3 — Der Kunde sieht das Bild auf der Angebotsseite", async ({ page }) => {
  const db = admin();

  const { data: vorgang } = await db
    .from("vorgang")
    .select("customer_id")
    .eq("id", zustand.vorgangId!)
    .single();
  zustand.kundeId = vorgang!.customer_id as string;

  await login(page, DEMO.gf);
  const token = await portalToken(page, zustand.kundeId);

  /*
   * Voraussetzung, nicht Prüfgegenstand: ohne Versand ist das Angebot
   * ein Entwurf, und das Portal liefert bewusst keine einzige Position.
   * Den Versandknopf selbst prüft vorgang.spec.
   *
   * Dazu darf keine ältere eingefrorene Fassung herumliegen — das Portal
   * zeigt immer die letzte VERSENDETE, und die kennt diese Position
   * nicht. Ohne Fassung fällt es auf den Entwurf zurück.
   */
  await db
    .from("vorgang_dokument")
    .delete()
    .eq("vorgang_id", zustand.vorgangId!)
    .eq("typ", "angebot");

  await db
    .from("vorgang")
    .update({ angebot_versendet_am: new Date().toISOString() })
    .eq("id", zustand.vorgangId!);

  await page.context().clearCookies();
  await page.goto(
    `/portal/${token}/vorgang/${zustand.vorgangId}?bereich=angebot`,
  );

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
  const antwort = await page.request.get(
    `/api/pdf/vorgang/${zustand.vorgangId}?art=angebot`,
  );
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
    .from("vorgang_position")
    .select("id, bild_url")
    .eq("company_id", COMPANY_A)
    .not("bild_url", "is", null);

  const fremdePositionen = (positionen ?? []).filter(
    (p) => !(p.bild_url as string).startsWith(eigene),
  );
  expect(fremdePositionen.map((p) => p.bild_url as string)).toEqual([]);
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
