import { expect, test } from "@playwright/test";
import { admin, COMPANY_A } from "./helpers";

/*
 * Der Katalog der Qualifikationen und Nachweise.
 *
 * Gemeldet aus dem Betrieb: Der Katalog liess sich nicht pflegen. Er
 * wurde im Seed angelegt und danach nur noch gelesen — sagt ein Betrieb
 * "wir führen auch die Unterweisung nach §5 ETV", ging das gar nicht.
 *
 * Der heikle Teil ist nicht das Anlegen, sondern das Entfernen:
 * `app_user.qualifikationen` ist ein Textfeld ohne Fremdschlüssel. Die
 * Datenbank würde den Katalogeintrag anstandslos löschen und beim
 * Mitarbeiter ein Schlagwort stehen lassen, das es nicht mehr gibt —
 * die Einsatzplanung sucht danach und findet niemanden.
 *
 *   E2E_GF_MAIL=…  E2E_GF_PASSWORT=…  E2E_ZIELMANDANT=…  \
 *     npx playwright test e2e/nachweiskatalog.spec.ts
 */

const MAIL = process.env.E2E_GF_MAIL;
const PASSWORT = process.env.E2E_GF_PASSWORT;
const LABEL = `E2E Unterweisung ${Date.now()}`;

test.describe.configure({ mode: "serial" });
test.skip(!MAIL || !PASSWORT, "E2E_GF_MAIL und E2E_GF_PASSWORT nicht gesetzt");

test.afterAll(async () => {
  await admin()
    .from("qualifikation")
    .delete()
    .eq("company_id", COMPANY_A)
    .like("label", "E2E Unterweisung%");
});

async function anmelden(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("E-Mail").fill(MAIL!);
  await page.getByLabel("Passwort").fill(PASSWORT!);
  await page.getByRole("button", { name: "Anmelden" }).click();
  await page.waitForURL(/\/cockpit/, { timeout: 20_000 });
}

test("Ein Nachweis lässt sich anlegen und bekommt einen Schlüssel", async ({
  page,
}) => {
  await anmelden(page);
  await page.goto("/einstellungen?bereich=nachweise");

  const neu = page.locator("li").filter({ hasText: "In den Katalog" });
  await neu.getByLabel("Bezeichnung").fill(LABEL);
  await neu.getByLabel("Läuft ab").selectOption("ja");
  await neu.getByRole("button", { name: "In den Katalog" }).click();

  await expect(page.getByText(`„${LABEL}" angelegt`)).toBeVisible({
    timeout: 15_000,
  });

  const { data } = await admin()
    .from("qualifikation")
    .select("id, schluessel, nachweis")
    .eq("company_id", COMPANY_A)
    .eq("label", LABEL)
    .single();

  expect(data, "Eintrag fehlt in der Datenbank").not.toBeNull();
  expect(data!.nachweis).toBe(true);

  /*
   * Der Schlüssel wird aus der Bezeichnung abgeleitet: klein, ohne
   * Umlaute, ohne Sonderzeichen. Er steht später in Textfeldern und
   * muss dort ohne Quoting funktionieren.
   */
  expect(String(data!.schluessel)).toMatch(/^[a-z0-9-]+$/);
});

test("Die Bezeichnung ändert sich, der Schlüssel nicht", async ({ page }) => {
  const { data: vorher } = await admin()
    .from("qualifikation")
    .select("id, schluessel")
    .eq("company_id", COMPANY_A)
    .eq("label", LABEL)
    .single();

  await anmelden(page);
  await page.goto("/einstellungen?bereich=nachweise");

  const block = page.getByTestId(`nachweis-${vorher!.id as string}`);
  await block.getByLabel("Bezeichnung").fill(`${LABEL} neu`);
  await block.getByRole("button", { name: "Speichern" }).click();

  await expect(block.getByText("Gespeichert")).toBeVisible({ timeout: 15_000 });

  const { data: nachher } = await admin()
    .from("qualifikation")
    .select("label, schluessel")
    .eq("id", vorher!.id as string)
    .single();

  expect(nachher!.label).toBe(`${LABEL} neu`);
  /*
   * Der Kern des Tests. Würde der Schlüssel mitwandern, stünde bei
   * jedem Mitarbeiter ein Schlagwort, das auf nichts mehr zeigt.
   */
  expect(nachher!.schluessel).toBe(vorher!.schluessel);
});

test("Ein zugeordneter Eintrag wird nicht aus dem Katalog geworfen", async ({
  page,
}) => {
  const db = admin();

  const { data: eintrag } = await db
    .from("qualifikation")
    .select("id, schluessel")
    .eq("company_id", COMPANY_A)
    .eq("label", `${LABEL} neu`)
    .single();

  const { data: person } = await db
    .from("app_user")
    .select("id, name, qualifikationen")
    .eq("company_id", COMPANY_A)
    .limit(1)
    .single();

  const vorher = ((person!.qualifikationen as string[] | null) ?? []).slice();
  await db
    .from("app_user")
    .update({ qualifikationen: [...vorher, eintrag!.schluessel as string] })
    .eq("id", person!.id as string);

  try {
    await anmelden(page);
    await page.goto("/einstellungen?bereich=nachweise");

    await page
      .getByTestId(`nachweis-entfernen-${eintrag!.id as string}`)
      .click();

    await expect(
      page.getByText(/ist noch zugeordnet/),
    ).toBeVisible({ timeout: 15_000 });

    const { count } = await db
      .from("qualifikation")
      .select("id", { count: "exact", head: true })
      .eq("id", eintrag!.id as string);
    expect(count).toBe(1);
  } finally {
    await db
      .from("app_user")
      .update({ qualifikationen: vorher })
      .eq("id", person!.id as string);
  }
});

test("Ohne Zuordnung lässt er sich entfernen", async ({ page }) => {
  const { data: eintrag } = await admin()
    .from("qualifikation")
    .select("id")
    .eq("company_id", COMPANY_A)
    .eq("label", `${LABEL} neu`)
    .single();

  await anmelden(page);
  await page.goto("/einstellungen?bereich=nachweise");

  await page.getByTestId(`nachweis-entfernen-${eintrag!.id as string}`).click();

  await expect
    .poll(async () => {
      const { count } = await admin()
        .from("qualifikation")
        .select("id", { count: "exact", head: true })
        .eq("id", eintrag!.id as string);
      return count ?? 0;
    }, { timeout: 15_000 })
    .toBe(0);
});
