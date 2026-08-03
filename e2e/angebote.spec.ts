import { expect, test } from "@playwright/test";
import { COMPANY_A, DEMO, admin, login } from "./helpers";

/*
 * Angebote von Hand erstellen.
 *
 * Der Planungsimport ist entfallen. Ein Angebot entsteht jetzt wie in einem
 * Angebotswerkzeug: Kunde wählen, Positionen aus dem Artikelstamm übernehmen
 * oder frei eintragen, Summen rechnet das System nach.
 *
 * Geprüft wird die Rechnung, nicht die Optik — eine Angebotssumme, die von
 * ihren Positionen abweicht, ist der teuerste Fehler in diesem System.
 */

test.describe.configure({ mode: "serial" });

const MARKE = "E2E-ANGEBOT";

async function aufraeumen(): Promise<void> {
  const db = admin();
  const { data: quotes } = await db
    .from("quote")
    .select("id")
    .eq("company_id", COMPANY_A)
    .is("sent_at", null)
    .is("accepted_at", null);

  for (const q of quotes ?? []) {
    const { data: items } = await db
      .from("quote_item")
      .select("id, text")
      .eq("quote_id", q.id);
    if ((items ?? []).some((i) => String(i.text).includes(MARKE))) {
      await db.from("quote_item").delete().eq("quote_id", q.id);
      await db.from("quote_event").delete().eq("quote_id", q.id);
      await db.from("quote").delete().eq("id", q.id);
    }
  }
}

test.afterAll(aufraeumen);

test("Angebot anlegen, Positionen erfassen, Summe stimmt", async ({ page }) => {
  const db = admin();
  await login(page, DEMO.gf);
  await page.goto("/angebote");

  const { data: kunde } = await db
    .from("customer")
    .select("id, name")
    .eq("company_id", COMPANY_A)
    .is("deleted_at", null)
    .limit(1)
    .single();

  // --- Anlegen ---
  await page.getByRole("button", { name: "Angebot erstellen" }).click();
  await page.getByLabel("Kunde").selectOption(kunde!.id as string);
  await page.getByRole("button", { name: "Angebot anlegen" }).last().click();

  await expect(page.getByText(/Angebot AN-\d{4}-\d{4} angelegt/)).toBeVisible({
    timeout: 15_000,
  });

  const { data: angebot } = await db
    .from("quote")
    .select("id, number, net_total, cost_total, status")
    .eq("company_id", COMPANY_A)
    .eq("customer_id", kunde!.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  expect(angebot!.number).toMatch(/^AN-\d{4}-\d{4}$/);
  expect(angebot!.status).toBe("draft");
  expect(Number(angebot!.net_total)).toBe(0);

  // --- Freie Position ---
  await page.goto(`/angebote/${angebot!.id}`);
  await page.getByLabel("Bezeichnung").fill(`${MARKE} Montage`);
  await page.getByLabel("Menge").last().fill("16");
  await page.getByLabel("Einkauf netto").last().fill("38");
  await page.getByLabel("Verkauf netto").last().fill("72.50");
  await page.getByRole("button", { name: "Hinzufügen" }).click();

  await expect(page.getByText(/hinzugefügt/)).toBeVisible({ timeout: 15_000 });

  /*
   * 16 × 72,50 = 1160,00 netto; Kosten 16 × 38 = 608,00.
   * Beide Summen müssen am Angebot stehen, nicht nur an den Positionen —
   * Listen und Kennzahlen lesen sie von dort.
   */
  await expect
    .poll(
      async () => {
        const { data } = await db
          .from("quote")
          .select("net_total, cost_total, margin_pct")
          .eq("id", angebot!.id)
          .single();
        return {
          netto: Number(data?.net_total),
          kosten: Number(data?.cost_total),
          marge: Number(data?.margin_pct),
        };
      },
      { timeout: 15_000 },
    )
    .toEqual({ netto: 1160, kosten: 608, marge: 47.59 });
});

test("Artikel übernehmen kopiert Preise, statt sie zu verknüpfen", async ({
  page,
}) => {
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

  const { data: artikel } = await db
    .from("article")
    .select("id, sku, name, purchase_price, sale_price")
    .eq("company_id", COMPANY_A)
    .eq("active", true)
    .gt("sale_price", 0)
    .limit(1)
    .single();

  await login(page, DEMO.gf);
  await page.goto(`/angebote/${angebot!.id}`);

  await page.getByLabel("Artikel").selectOption(artikel!.id as string);
  await page.getByLabel("Menge").first().fill("4");
  await page.getByRole("button", { name: "Übernehmen" }).click();

  await expect(page.getByText(/übernommen/)).toBeVisible({ timeout: 15_000 });

  const { data: position } = await db
    .from("quote_item")
    .select("qty, purchase_price, sale_price, article_id, text")
    .eq("quote_id", angebot!.id)
    .eq("article_id", artikel!.id)
    .single();

  expect(Number(position!.qty)).toBe(4);
  expect(Number(position!.sale_price)).toBe(Number(artikel!.sale_price));
  expect(Number(position!.purchase_price)).toBe(Number(artikel!.purchase_price));
  expect(String(position!.text)).toContain(artikel!.sku as string);

  /*
   * Der spätere Artikelpreis darf das Angebot nicht rückwirkend ändern.
   * Deshalb werden die Preise kopiert und nicht über den Fremdschlüssel
   * gelesen.
   */
  const alterVk = Number(artikel!.sale_price);
  await db
    .from("article")
    .update({ sale_price: alterVk + 100 })
    .eq("id", artikel!.id);

  const { data: unveraendert } = await db
    .from("quote_item")
    .select("sale_price")
    .eq("quote_id", angebot!.id)
    .eq("article_id", artikel!.id)
    .single();
  expect(Number(unveraendert!.sale_price)).toBe(alterVk);

  await db.from("article").update({ sale_price: alterVk }).eq("id", artikel!.id);
});

test("Ein angenommenes Angebot lässt sich nicht mehr ändern", async ({
  page,
}) => {
  const db = admin();

  const { data: angenommen } = await db
    .from("quote")
    .select("id")
    .eq("company_id", COMPANY_A)
    .not("accepted_at", "is", null)
    .limit(1)
    .maybeSingle();

  test.skip(!angenommen, "Kein angenommenes Angebot im Seed.");

  await login(page, DEMO.gf);
  await page.goto(`/angebote/${angenommen!.id}`);

  await expect(
    page.getByText("Positionen lassen sich nicht mehr ändern"),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Hinzufügen" })).toHaveCount(0);
});

test("Ohne Schreibrecht gibt es keinen Angebotseditor", async ({ page }) => {
  await login(page, DEMO.monteur);
  await page.goto("/angebote");

  await expect(
    page.getByRole("button", { name: "Angebot erstellen" }),
  ).toHaveCount(0);
});
