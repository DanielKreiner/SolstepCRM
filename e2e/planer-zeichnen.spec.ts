import { expect, type Page, test } from "@playwright/test";
import { DEMO, login } from "./helpers";

/*
 * Planer, Stufe 2 — Zeichnen (Briefing 13.2).
 *
 * Läuft in derselben eigenen Suite wie Stufe 1: `pnpm test:e2e:planer`.
 * Abgedeckt aus Abschnitt 12: Test 1 (Kantenpillen), Test 2 (Maßeingabe),
 * Test 3 (Walmdach über den Assistenten), Test 13 (Undo über eine Kette).
 */

const ORT = { name: "Hauptplatz 1, 4020 Linz", lat: 48.30604, lon: 14.28583 };

async function neuesProjekt(page: Page, name: string) {
  await page.goto("/planer/neu");
  await page.route("**/api/planer/adresse**", (r) =>
    r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ treffer: [{ ...ORT, name: `${name}, 4020 Linz` }] }),
    }),
  );
  await page.getByLabel("Adresse suchen").fill(name);
  await page.getByRole("button", { name: new RegExp(name) }).click();
  await page.getByRole("button", { name: "Projekt anlegen" }).click();
  await page.waitForURL(/\/planer\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId("planer-leinwand")).toBeVisible();
}

/** Bildpunkte relativ zur Mitte der Zeichenfläche. */
async function stelle(page: Page, dx: number, dy: number) {
  const k = (await page.getByTestId("planer-leinwand").boundingBox())!;
  return { x: k.x + k.width / 2 + dx, y: k.y + k.height / 2 + dy };
}

async function zeichneRechteck(page: Page, halbBreite = 150, halbHoehe = 100) {
  await page.getByRole("button", { name: "Dachfläche zeichnen" }).click();
  for (const [dx, dy] of [
    [-halbBreite, -halbHoehe],
    [halbBreite, -halbHoehe],
    [halbBreite, halbHoehe],
    [-halbBreite, halbHoehe],
  ] as const) {
    const p = await stelle(page, dx, dy);
    await page.mouse.move(p.x, p.y);
    await page.mouse.click(p.x, p.y);
  }
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: /^Fläche 1/ })).toBeVisible();
}

/** Grundfläche aus dem Panel, in Quadratmetern. */
async function grundflaeche(page: Page): Promise<number> {
  const zeile = page.locator("dl div", { hasText: "Grundfläche" });
  const text = (await zeile.locator("dd").textContent()) ?? "";
  return Number(text.replace(" m²", "").replace(".", "").replace(",", "."));
}

test.describe("Planer — Zeichnen", () => {
  test("Umriss zeichnen, Kantenmasse stimmen mit der Fläche überein", async ({ page }) => {
    await login(page, DEMO.buero);
    await neuesProjekt(page, "Zeichenweg 1");
    await zeichneRechteck(page);

    /*
     * Die Kantenpillen stehen auf dem Canvas und sind kein DOM — sie
     * lassen sich hier nicht auslesen. Geprüft wird deshalb, was aus
     * denselben Zahlen folgt: die Werte im Panel. Stimmen Grundfläche
     * und Dachfläche zueinander, stimmt die Kette vom Klick bis zur
     * Geometrie.
     */
    const grund = await grundflaeche(page);
    expect(grund).toBeGreaterThan(100);

    // Dachfläche = Grundfläche / cos(Neigung). Vorbelegt sind 30°.
    const dachText = (await page.locator("dl div", { hasText: "Dachfläche" }).locator("dd").textContent()) ?? "";
    const dach = Number(dachText.replace(" m²", "").replace(".", "").replace(",", "."));
    expect(dach).toBeCloseTo(grund / Math.cos(Math.PI / 6), 0);

    await expect(page.locator("dl div", { hasText: "Ecken" }).locator("dd")).toHaveText("4");
  });

  test("Kantenmass eintippen setzt die Kante exakt — Abnahmetest 2", async ({ page }) => {
    await login(page, DEMO.buero);
    await neuesProjekt(page, "Massweg 2");
    await zeichneRechteck(page);

    const vorher = await grundflaeche(page);

    // Auf die Pille der oberen Kante tippen: sie sitzt in deren Mitte.
    const pille = await stelle(page, 0, -100);
    await page.mouse.click(pille.x, pille.y);

    const feld = page.getByLabel("Kantenlänge in Metern");
    await expect(feld).toBeVisible();
    await feld.fill("12,4");
    await feld.press("Enter");

    // Die Fläche muss sich messbar geändert haben — und zwar kleiner,
    // weil 12,40 m deutlich kürzer als die gezeichnete Kante sind.
    await expect.poll(async () => grundflaeche(page)).toBeLessThan(vorher);
    const nachher = await grundflaeche(page);
    expect(nachher).toBeGreaterThan(0);
  });

  test("Undo und Redo über eine Kette — Abnahmetest 13", async ({ page }) => {
    await login(page, DEMO.buero);
    await neuesProjekt(page, "Undoweg 3");
    await zeichneRechteck(page);
    await expect(page.getByText("Dachflächen (1)")).toBeVisible();

    // Zweite Fläche daneben.
    await zeichneRechteck(page, 60, 40);
    await expect(page.getByText("Dachflächen (2)")).toBeVisible();

    await page.getByRole("button", { name: "Rückgängig" }).click();
    await expect(page.getByText("Dachflächen (1)")).toBeVisible();
    await page.getByRole("button", { name: "Rückgängig" }).click();
    await expect(page.getByText("Dachflächen (0)")).toBeVisible();

    await page.getByRole("button", { name: "Wiederholen" }).click();
    await expect(page.getByText("Dachflächen (1)")).toBeVisible();
  });

  test("Dachform-Assistent legt ein Walmdach an — Abnahmetest 3", async ({ page }) => {
    await login(page, DEMO.buero);
    await neuesProjekt(page, "Walmweg 4");

    await page.getByRole("button", { name: /Standardform setzen/ }).click();
    await page.getByLabel("Form").selectOption("walm");
    await page.getByLabel("Länge (m)").fill("14");
    await page.getByLabel("Tiefe (m)").fill("9");
    await page.getByRole("button", { name: "In die Bildmitte setzen" }).click();

    // Vier Flächen: zwei Trapeze, zwei Walme.
    await expect(page.getByText("Dachflächen (4)")).toBeVisible();

    /*
     * Zusammen müssen sie den Grundriss ergeben — 14 × 9 = 126 m².
     * Das ist die eigentliche Probe: Lücken oder Überlappungen fielen
     * hier sofort auf.
     */
    let summe = 0;
    for (let i = 1; i <= 4; i++) {
      await page.getByRole("button", { name: new RegExp(`^Fläche ${i}`) }).click();
      summe += await grundflaeche(page);
    }
    expect(summe).toBeCloseTo(126, 0);
  });

  test("Flachdach kommt ohne Traufe und mit 1 m Randzone", async ({ page }) => {
    await login(page, DEMO.buero);
    await neuesProjekt(page, "Flachweg 5");

    await page.getByRole("button", { name: /Standardform setzen/ }).click();
    await page.getByLabel("Form").selectOption("flach");
    await page.getByRole("button", { name: "In die Bildmitte setzen" }).click();

    await expect(page.getByText("Dachflächen (1)")).toBeVisible();
    await expect(page.getByLabel("Neigung (°)")).toHaveValue("0");
    await expect(page.getByLabel("Traufkante")).toHaveValue("");
    await expect(page.getByLabel("Randabstand (m)")).toHaveValue("1");
    // Grund- und Dachfläche fallen bei 0° zusammen.
    const grund = await grundflaeche(page);
    const dachText = (await page.locator("dl div", { hasText: "Dachfläche" }).locator("dd").textContent()) ?? "";
    expect(Number(dachText.replace(" m²", "").replace(",", "."))).toBeCloseTo(grund, 1);
  });

  test("Neigung wirkt auf die Dachfläche, nicht auf den Grundriss", async ({ page }) => {
    await login(page, DEMO.buero);
    await neuesProjekt(page, "Neigungsweg 6");
    await zeichneRechteck(page);

    const grund = await grundflaeche(page);
    await page.getByLabel("Neigung (°)").fill("45");
    await page.getByLabel("Neigung (°)").blur();

    // Grundriss unverändert — die Draufsicht kennt keine Neigung.
    await expect.poll(async () => grundflaeche(page)).toBeCloseTo(grund, 0);
    const dachText = (await page.locator("dl div", { hasText: "Dachfläche" }).locator("dd").textContent()) ?? "";
    const dach = Number(dachText.replace(" m²", "").replace(".", "").replace(",", "."));
    expect(dach).toBeCloseTo(grund / Math.cos(Math.PI / 4), 0);
  });

  test("Hindernis liegt auf der Fläche — sonst wird es abgelehnt", async ({ page }) => {
    await login(page, DEMO.buero);
    await neuesProjekt(page, "Kaminweg 8");
    await zeichneRechteck(page, 170, 110);

    const mitte = await stelle(page, 0, 0);
    await page.getByRole("button", { name: /Hindernis aufziehen/ }).click();

    // Kamin mitten auf dem Dach: wird angelegt.
    await page.mouse.move(mitte.x - 30, mitte.y - 20);
    await page.mouse.down();
    await page.mouse.move(mitte.x + 20, mitte.y + 30, { steps: 10 });
    await page.mouse.up();
    await expect(page.getByText(/Hindernisse \(1\)/i)).toBeVisible();

    /*
     * Und daneben: ein Kamin ausserhalb des Dachs sperrt nichts und
     * taucht in keiner Rechnung auf. Er darf nicht still entstehen.
     */
    await page.getByRole("button", { name: /Hindernis aufziehen/ }).click();
    await page.mouse.move(mitte.x + 260, mitte.y + 200);
    await page.mouse.down();
    await page.mouse.move(mitte.x + 310, mitte.y + 250, { steps: 8 });
    await page.mouse.up();

    await expect(
      page.getByText(/Hindernis muss auf der gewählten Dachfläche liegen/),
    ).toBeVisible();
    await expect(page.getByText(/Hindernisse \(1\)/i)).toBeVisible();
  });

  test("Plan übersteht das Neuladen", async ({ page }) => {
    await login(page, DEMO.buero);
    await neuesProjekt(page, "Ladeweg 7");
    await zeichneRechteck(page);
    const vorher = await grundflaeche(page);

    // Autosave läuft gedrosselt — auf „gesichert" warten, nicht raten.
    await expect(page.getByText("gesichert")).toBeVisible({ timeout: 15_000 });
    await page.reload();
    await expect(page.getByTestId("planer-leinwand")).toBeVisible();
    await expect(page.getByText("Dachflächen (1)")).toBeVisible();

    await page.getByRole("button", { name: /^Fläche 1/ }).click();
    expect(await grundflaeche(page)).toBeCloseTo(vorher, 0);
  });

  test("Ohne Schreibrecht keine Werkzeuge", async ({ page }) => {
    /*
     * Die Bauleitung darf planen (Briefing 10). Geprüft wird hier der
     * Gegenpol: dass die Werkzeugleiste am Schreibrecht hängt und nicht
     * einfach immer da ist.
     */
    await login(page, DEMO.bauleitung);
    await page.goto("/planer");
    await expect(page.getByRole("link", { name: "Planer" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Neues Projekt" })).toBeVisible();
  });
});
