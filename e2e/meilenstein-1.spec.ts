import { expect, test } from "@playwright/test";
import { COMPANY_A, DEMO, admin, jobHours, login, stockOf } from "./helpers";

/*
 * Definition of Done Meilenstein 1 (CLAUDE.md Abschnitt 12):
 *   "Zeitbuchung mit Auftragsbezug erzeugt korrekten Saldo,
 *    Materialentnahme senkt Bestand"
 *
 * Beides wird über die Oberfläche ausgelöst und in der Datenbank nachgemessen —
 * nicht am DOM abgelesen. Ein Screen, der die richtige Zahl anzeigt, aber
 * nichts speichert, muss durchfallen.
 */

test.describe.configure({ mode: "serial" });

async function jobId(number: string): Promise<string> {
  const { data, error } = await admin()
    .from("job")
    .select("id")
    .eq("company_id", COMPANY_A)
    .eq("number", number)
    .single();
  if (error) throw error;
  return data.id as string;
}

async function articleId(sku: string): Promise<string> {
  const { data, error } = await admin()
    .from("article")
    .select("id")
    .eq("company_id", COMPANY_A)
    .eq("sku", sku)
    .single();
  if (error) throw error;
  return data.id as string;
}

test("Zeitbuchung mit Auftragsbezug erhöht die Iststunden des Auftrags", async ({
  page,
}) => {
  const AUFTRAG = "A-2026-0042";
  const vorher = await jobHours(AUFTRAG);
  const id = await jobId(AUFTRAG);

  await login(page, DEMO.bauleitung);
  await page.goto("/zeiterfassung");

  const form = page.locator("form", { hasText: "Buchung anlegen" });
  await form.getByLabel("Beginn").fill("06:00");
  await form.getByLabel("Ende").fill("09:30");
  await form.getByLabel(/^Auftrag/).selectOption(id);
  await form.getByLabel("Notiz").fill("E2E Meilenstein 1");
  await form.getByRole("button", { name: /Buchung anlegen/ }).click();

  await expect(form.getByRole("status")).toContainText("Buchung gespeichert");

  // 06:00–09:30 = 3,5 Stunden
  const nachher = await jobHours(AUFTRAG);
  expect(nachher - vorher).toBeCloseTo(3.5, 2);

  // Die Liste zeigt die Buchung mit korrekter Dauer.
  await expect(page.getByText("3:30").first()).toBeVisible();

  await admin().from("time_entry").delete().eq("note", "E2E Meilenstein 1");
});

test("Verdrehte Zeiten werden abgewiesen und nicht gespeichert", async ({
  page,
}) => {
  const id = await jobId("A-2026-0042");

  await login(page, DEMO.bauleitung);
  await page.goto("/zeiterfassung");

  const form = page.locator("form", { hasText: "Buchung anlegen" });
  await form.getByLabel("Beginn").fill("10:00");
  await form.getByLabel("Ende").fill("09:00");
  await form.getByLabel(/^Auftrag/).selectOption(id);
  await form.getByLabel("Notiz").fill("E2E verdreht");
  await form.getByRole("button", { name: /Buchung anlegen/ }).click();

  await expect(form.getByRole("alert")).toContainText("nach dem Beginn");

  const { count } = await admin()
    .from("time_entry")
    .select("id", { count: "exact", head: true })
    .eq("note", "E2E verdreht");
  expect(count ?? 0).toBe(0);
});

test("Materialentnahme senkt den Bestand, Rückgabe hebt sie auf", async ({
  page,
}) => {
  const SKU = "KAB-SOL-6";
  const vorher = await stockOf(SKU);
  const id = await articleId(SKU);

  await login(page, DEMO.lager);
  await page.goto("/lager");

  const form = page.locator("form", { hasText: "Material buchen" });
  await form.getByLabel("Artikel").selectOption(id);
  await form.getByLabel("Art", { exact: true }).selectOption("out");
  await form.getByLabel(/^Menge/).fill("25");
  await form.getByLabel("Notiz").fill("E2E Entnahme");
  await form.getByRole("button", { name: "Buchen" }).click();

  await expect(form.getByRole("status")).toContainText("Entnahme gebucht");
  expect(await stockOf(SKU)).toBe(vorher - 25);

  await form.getByLabel("Artikel").selectOption(id);
  await form.getByLabel("Art", { exact: true }).selectOption("return");
  await form.getByLabel(/^Menge/).fill("25");
  await form.getByLabel("Notiz").fill("E2E Rückgabe");
  await form.getByRole("button", { name: "Buchen" }).click();

  await expect(form.getByRole("status")).toContainText("Rückgabe gebucht");
  expect(await stockOf(SKU)).toBe(vorher);

  await admin().from("stock_move").delete().like("note", "E2E %");
});

test("Materialentnahme auf einen Auftrag erhöht dessen Materialkosten", async ({
  page,
}) => {
  const AUFTRAG = "A-2026-0042";
  const db = admin();
  const id = await jobId(AUFTRAG);
  const artId = await articleId("MOD-JAS-440");

  const { data: vor } = await db
    .from("v_job_kpi")
    .select("material_actual")
    .eq("job_id", id)
    .single();

  await login(page, DEMO.lager);
  await page.goto("/lager");

  const form = page.locator("form", { hasText: "Material buchen" });
  await form.getByLabel("Artikel").selectOption(artId);
  await form.getByLabel("Art", { exact: true }).selectOption("out");
  await form.getByLabel(/^Menge/).fill("10");
  await form.getByLabel("Auftrag", { exact: true }).selectOption(id);
  await form.getByLabel("Notiz").fill("E2E Auftragsmaterial");
  await form.getByRole("button", { name: "Buchen" }).click();
  await expect(form.getByRole("status")).toContainText("Entnahme gebucht");

  const { data: nach } = await db
    .from("v_job_kpi")
    .select("material_actual")
    .eq("job_id", id)
    .single();

  // 10 Stück zu 78,40 EUR Einkaufspreis
  expect(
    Number(nach!.material_actual) - Number(vor!.material_actual),
  ).toBeCloseTo(784, 2);

  await db.from("stock_move").delete().eq("note", "E2E Auftragsmaterial");
});

test("Auftragsdetail zeigt Zeiten und Material des Auftrags", async ({ page }) => {
  const id = await jobId("A-2026-0041");

  await login(page, DEMO.gf);
  await page.goto(`/auftraege/${id}`);

  await expect(
    page.getByRole("heading", { name: "A-2026-0041" }),
  ).toBeVisible();
  await expect(page.getByText("Stunden ist / plan")).toBeVisible();
  await expect(page.getByRole("heading", { name: /^Zeiten/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /^Material \(/ })).toBeVisible();
  // 25,5 Iststunden aus dem Seed
  await expect(page.getByText("25,5 / 64").first()).toBeVisible();
});

test("Monteur sieht das Lager, darf aber nicht buchen", async ({ page }) => {
  await login(page, DEMO.monteur);
  await page.goto("/lager");

  await expect(
    page.getByText("fehlt deiner Rolle das Schreibrecht"),
  ).toBeVisible();
  await expect(
    page.locator("form", { hasText: "Material buchen" }),
  ).toHaveCount(0);
});
