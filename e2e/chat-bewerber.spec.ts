import { expect, test } from "@playwright/test";
import { COMPANY_A, DEMO, admin, login } from "./helpers";

/*
 * Meilenstein 11, dritter Teil: Chat und Bewerber.
 * Beides einfache Verwaltung — geprüft wird, dass geschrieben wird und dass
 * die Rechte greifen.
 */

test.describe.configure({ mode: "serial" });

async function aufraeumen() {
  const db = admin();
  await db.from("chat_message").delete().like("body", "E2E%");
  await db.from("chat_channel").delete().like("name", "E2E%");
  await db.from("applicant").delete().like("name", "E2E%");
}

test("Ein Kanal lässt sich anlegen und beschreiben", async ({ page }) => {
  await aufraeumen();
  await login(page, DEMO.gf);
  await page.goto("/chat");

  await page.getByLabel("Kanalname").fill("E2E Baustelle Wels");
  await page.getByRole("button", { name: "Kanal anlegen" }).click();

  await expect
    .poll(async () => {
      const { count } = await admin()
        .from("chat_channel")
        .select("id", { count: "exact", head: true })
        .eq("company_id", COMPANY_A)
        .eq("name", "E2E Baustelle Wels");
      return count ?? 0;
    }, { timeout: 15_000 })
    .toBe(1);

  await page.reload();
  await page.getByRole("link", { name: /E2E Baustelle Wels/ }).click();

  await page.getByLabel("Nachricht").fill("E2E Gerüst steht ab Montag.");
  await page.getByRole("button", { name: "Senden" }).click();

  await expect(page.getByText("E2E Gerüst steht ab Montag.")).toBeVisible({
    timeout: 15_000,
  });

  const { data } = await admin()
    .from("chat_message")
    .select("body, user_id")
    .like("body", "E2E%")
    .single();
  expect(String(data!.body)).toContain("Gerüst");
  expect(data!.user_id).toBeTruthy();
});

test("Ein Bewerber durchläuft die Stufen", async ({ page }) => {
  await login(page, DEMO.gf);
  await page.goto("/bewerber");

  await page.getByLabel("Name", { exact: true }).fill("E2E Anna Beispiel");
  await page.getByLabel("Position").fill("Monteur PV");
  await page.getByLabel("E-Mail").fill("anna@example.com");
  await page.getByRole("button", { name: "Aufnehmen" }).click();

  await expect(
    page.getByText("E2E Anna Beispiel", { exact: true }),
  ).toBeVisible({ timeout: 15_000 });

  // Neu angelegte Bewerber starten in der ersten Stufe.
  const { data: neu } = await admin()
    .from("applicant")
    .select("id, stage")
    .like("name", "E2E%")
    .single();
  expect(neu!.stage).toBe("neu");

  await page.getByLabel("Stufe von E2E Anna Beispiel").selectOption("gespraech");

  await expect
    .poll(async () => {
      const { data } = await admin()
        .from("applicant")
        .select("stage")
        .eq("id", neu!.id)
        .single();
      return data?.stage;
    }, { timeout: 15_000 })
    .toBe("gespraech");
});

test("Ohne Personalrecht sind Bewerber nur lesbar", async ({ page }) => {
  await login(page, DEMO.bauleitung);
  await page.goto("/bewerber");

  await expect(page.getByText("sehen, aber nicht ändern")).toBeVisible();
  await expect(page.getByRole("button", { name: "Aufnehmen" })).toHaveCount(0);

  await aufraeumen();
});
