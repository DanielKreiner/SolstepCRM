import { expect, test } from "@playwright/test";
import { admin, COMPANY_A } from "./helpers";

/*
 * Standorte anlegen, ändern und entfernen.
 *
 * Gemeldet aus dem Betrieb: "es gibt hier nur einen Standort und der ist
 * in Aspang Markt, das kann man aktuell gar nicht ändern." Stimmte —
 * `saveLocation` schrieb ausschliesslich die Arbeitszeitregeln, Name und
 * Anschrift standen gar nicht im Formular, Anlegen und Entfernen gab es
 * nicht. Ein übernommener Mandant musste also mit den Standorten des
 * Demobestands leben.
 *
 * Dieser Test braucht einen eigenen Zugang, weil er auch gegen einen
 * Mandanten ohne Demokonten laufen können muss:
 *
 *   E2E_GF_MAIL=…  E2E_GF_PASSWORT=…  E2E_ZIELMANDANT=…  \
 *     npx playwright test e2e/standorte.spec.ts
 *
 * Ohne diese Angaben überspringt er sich, statt rot zu werden — er
 * gehört zur Einrichtung und nicht zum täglichen Lauf.
 */

const MAIL = process.env.E2E_GF_MAIL;
const PASSWORT = process.env.E2E_GF_PASSWORT;
const KENNUNG = `E2E Standort ${Date.now()}`;

test.describe.configure({ mode: "serial" });

test.skip(
  !MAIL || !PASSWORT,
  "E2E_GF_MAIL und E2E_GF_PASSWORT nicht gesetzt",
);

test.afterAll(async () => {
  await admin()
    .from("location")
    .delete()
    .eq("company_id", COMPANY_A)
    .like("name", "E2E Standort%");
});

test("Ein Standort lässt sich anlegen, umbenennen und wieder entfernen", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByLabel("E-Mail").fill(MAIL!);
  await page.getByLabel("Passwort").fill(PASSWORT!);
  await page.getByRole("button", { name: "Anmelden" }).click();
  await page.waitForURL(/\/cockpit/, { timeout: 20_000 });

  await page.goto("/einstellungen?bereich=standorte");

  /* ---------------------------------------------------------- anlegen */
  const neu = page.locator("form").filter({ hasText: "Standort hinzufügen" });
  await neu.getByLabel("Name").fill(KENNUNG);
  await neu.getByLabel("Anschrift").fill("Werkstrasse 1");
  await neu.getByLabel("PLZ").fill("2870");
  await neu.getByLabel("Ort").fill("Aspang Markt");
  await neu.getByRole("button", { name: "Standort anlegen" }).click();

  await expect(page.getByText(`Standort ${KENNUNG} angelegt`)).toBeVisible({
    timeout: 15_000,
  });

  const { data: angelegt } = await admin()
    .from("location")
    .select("id, address, zip, city")
    .eq("company_id", COMPANY_A)
    .eq("name", KENNUNG)
    .single();

  expect(angelegt, "Standort fehlt in der Datenbank").not.toBeNull();
  expect(angelegt!.address).toBe("Werkstrasse 1");
  expect(angelegt!.zip).toBe("2870");

  /* --------------------------------------------------------- umbenennen */
  const block = page.locator("form").filter({ hasText: KENNUNG }).first();
  await block.getByLabel("Name").fill(`${KENNUNG} neu`);
  await block.getByLabel("Ort").fill("Edlitz");
  await block.getByRole("button", { name: "Standort speichern" }).click();

  await expect(page.getByText("Standort gespeichert")).toBeVisible({
    timeout: 15_000,
  });

  /*
   * Gegen die Datenbank geprüft, nicht gegen die Meldung: Die Meldung
   * stand vorher auch da, geschrieben wurde trotzdem nur ein Teil.
   */
  await expect
    .poll(async () => {
      const { data } = await admin()
        .from("location")
        .select("city")
        .eq("id", angelegt!.id as string)
        .single();
      return data?.city;
    }, { timeout: 10_000 })
    .toBe("Edlitz");

  /* ---------------------------------------------------------- entfernen */
  /*
   * Über die Kennung, nicht über den Text: Das Entfernen steht in einem
   * EIGENEN Formular neben dem Speichern — zwei Knöpfe in einem
   * Formular würden dieselben Felder an zwei Aktionen schicken, und
   * dann löscht ein Fehlklick beim Speichern den Standort. Dieses
   * Formular trägt deshalb nur die Kennung und keinen Namen.
   */
  await page.reload();
  await page
    .getByTestId(`standort-loeschen-${angelegt!.id as string}`)
    .click();

  await expect
    .poll(async () => {
      const { count } = await admin()
        .from("location")
        .select("id", { count: "exact", head: true })
        .eq("id", angelegt!.id as string);
      return count ?? 0;
    }, { timeout: 15_000 })
    .toBe(0);
});

test("Der letzte Standort bleibt stehen", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("E-Mail").fill(MAIL!);
  await page.getByLabel("Passwort").fill(PASSWORT!);
  await page.getByRole("button", { name: "Anmelden" }).click();
  await page.waitForURL(/\/cockpit/, { timeout: 20_000 });

  await page.goto("/einstellungen?bereich=standorte");

  /*
   * Bei genau einem Standort darf der Knopf gar nicht erst dastehen.
   * Ohne Standort gäbe es keine Arbeitszeitregeln mehr, und die
   * Konfliktprüfung der Einsatzplanung hätte nichts, woran sie Ruhezeit
   * und Höchstarbeitszeit misst.
   */
  const { count } = await admin()
    .from("location")
    .select("id", { count: "exact", head: true })
    .eq("company_id", COMPANY_A);

  if ((count ?? 0) === 1) {
    await expect(
      page.getByRole("button", { name: "Standort entfernen" }),
    ).toHaveCount(0);
  }
});
