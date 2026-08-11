import { expect, test } from "@playwright/test";
import { admin, COMPANY_A, DEMO, login } from "./helpers";

/*
 * Planer — Projektliste (Briefing 8.3).
 *
 * Kartenraster mit Vorschaubild, Suche, Duplizieren und dem Status
 * „übergeben als V-…". Das Bild entsteht beim Wechsel in die Übergabe;
 * dass es wirklich entsteht, prüft dieser Test am Storage, nicht am
 * Aussehen der Karte.
 */

const LINZ = { lat: 48.30604, lon: 14.28583 };

async function aufraeumen() {
  const db = admin();
  const { data } = await db
    .from("planer_projekt")
    .select("id")
    .eq("company_id", COMPANY_A)
    .like("name", "Listentest%");
  for (const p of data ?? []) {
    await db.storage.from("planer-fotos").remove([`${COMPANY_A}/${p.id}/vorschau.jpg`]);
    await db.from("planer_projekt").delete().eq("id", p.id);
  }
  await db.from("planer_projekt").delete().eq("company_id", COMPANY_A).like("name", "%(Kopie)%");
}

test.beforeEach(aufraeumen);
test.afterAll(aufraeumen);

/** Ein Projekt mit Belegung anlegen und die Kennung zurückgeben. */
async function projektAnlegen(page: import("@playwright/test").Page, name: string) {
  await page.goto("/planer/neu");
  await page.route("**/api/planer/adresse**", (r) =>
    r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ treffer: [{ name: `${name}weg 1, 4020 Linz`, ...LINZ }] }),
    }),
  );
  await page.getByLabel("Adresse suchen").fill(name);
  // Der Projektname erscheint erst, wenn ein Ort gewählt ist — vorher
  // gibt es das Feld gar nicht.
  await page.getByRole("button", { name: new RegExp(`${name}weg 1`) }).click();
  await page.getByLabel("Projektname").fill(name);
  await page.getByRole("button", { name: "Projekt anlegen" }).click();
  await page.waitForURL(/\/planer\/[0-9a-f-]{36}$/);
  return page.url().split("/").pop()!;
}

test.describe("Planer — Projektliste", () => {
  test("Vorschaubild entsteht beim Wechsel in die Übergabe", async ({ page }) => {
    await login(page, DEMO.gf);
    const id = await projektAnlegen(page, "Listentest A");

    await page.getByRole("button", { name: "Näher heran" }).click();
    await page.getByRole("button", { name: /Standardform setzen/ }).click();
    await page.getByRole("button", { name: "In die Bildmitte setzen" }).click();
    await page.getByRole("button", { name: /^Fläche 1/ }).click();
    await page.getByRole("button", { name: "Fläche automatisch belegen" }).click();
    await expect(page.getByRole("button", { name: /^Feld 1/ })).toBeVisible();

    await page.getByRole("button", { name: /^5 Übergabe/ }).click();

    /*
     * Am Storage prüfen, nicht am Aussehen: Ein <img> im DOM sagt
     * nichts darüber, ob wirklich ein Bild abgelegt wurde — und genau
     * das braucht später das Kunden-PDF.
     */
    const db = admin();
    await expect
      .poll(
        async () => {
          const { data } = await db
            .from("planer_projekt")
            .select("vorschau_pfad")
            .eq("id", id)
            .single();
          return data?.vorschau_pfad ?? null;
        },
        { timeout: 30_000 },
      )
      .toBe(`${COMPANY_A}/${id}/vorschau.jpg`);

    const { data: datei } = await db.storage
      .from("planer-fotos")
      .download(`${COMPANY_A}/${id}/vorschau.jpg`);
    expect(datei).toBeTruthy();
    // Ein leeres oder winziges Bild wäre kein Bild.
    expect(datei!.size).toBeGreaterThan(3000);

    // Und in der Liste steht es dann auch.
    await page.goto("/planer");
    await expect(page.getByAltText(/Belegung Listentest A/)).toBeVisible();
  });

  test("Suche findet über Name und Adresse", async ({ page }) => {
    await login(page, DEMO.gf);
    await projektAnlegen(page, "Listentest Süd");
    await projektAnlegen(page, "Listentest Nord");

    /*
     * Auf die Karte zielen, nicht auf den blossen Text: „Listentest
     * Süd" steht sowohl im Namen als auch in der Adresse
     * („Listentest Südweg 1"), und ein Textvergleich träfe beide.
     */
    const karte = (name: string) => page.locator("li", { hasText: name });

    await page.goto("/planer");
    await expect(karte("Listentest Süd")).toHaveCount(1);
    await expect(karte("Listentest Nord")).toHaveCount(1);

    await page.getByLabel("Projekte durchsuchen").fill("Süd");
    await expect(karte("Listentest Nord")).toHaveCount(0);
    await expect(karte("Listentest Süd")).toHaveCount(1);

    // Über die Adresse muss dasselbe gehen — man erinnert sich an die
    // Strasse oder an den Namen, selten an beides.
    await page.getByLabel("Projekte durchsuchen").fill("Nordweg");
    await expect(karte("Listentest Nord")).toHaveCount(1);
    await expect(karte("Listentest Süd")).toHaveCount(0);

    await page.getByLabel("Projekte durchsuchen").fill("gibtesnicht");
    await expect(page.getByText("Nichts gefunden")).toBeVisible();
  });

  test("Duplizieren erzeugt eine eigenständige Kopie", async ({ page }) => {
    await login(page, DEMO.gf);
    const id = await projektAnlegen(page, "Listentest Kopie");

    await page.goto("/planer");
    const karte = page.locator("li", { hasText: "Listentest Kopie" }).first();
    await karte.getByRole("button", { name: "duplizieren" }).click();

    await expect(page.getByText("Listentest Kopie (Kopie)")).toBeVisible({ timeout: 15_000 });

    /*
     * Die Kopie muss ein eigenes Projekt sein — nicht dasselbe unter
     * anderem Namen. Und sie startet als Entwurf: zwei Planungen am
     * selben Vorgang wären eine Falle.
     */
    const db = admin();
    const { data } = await db
      .from("planer_projekt")
      .select("id, status, vorgang_id, plan")
      .eq("company_id", COMPANY_A)
      .like("name", "%(Kopie)%");
    expect(data).toHaveLength(1);
    expect(data![0]!.id).not.toBe(id);
    expect(data![0]!.status).toBe("entwurf");
    expect(data![0]!.vorgang_id).toBeNull();
  });
});
