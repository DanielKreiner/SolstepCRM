import { expect, type Page, test } from "@playwright/test";
import { DEMO, login } from "./helpers";

/*
 * Planer, Stufe 3 — Modulbelegung (Briefing 4).
 *
 * Gehört zur eigenen Planer-Suite: `pnpm test:e2e:planer`.
 * Geprüft wird vor allem die Kette Klick → Geometrie → Kennzahl: die
 * Leistung auf der Leiste muss aus derselben Modulzahl folgen, die im
 * Panel steht. Läuft das auseinander, stimmt eine Rechnung nicht.
 */

async function neuesProjekt(page: Page, name: string) {
  await page.goto("/planer/neu");
  await page.route("**/api/planer/adresse**", (r) =>
    r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ treffer: [{ name: `${name}, 4020 Linz`, lat: 48.30604, lon: 14.28583 }] }),
    }),
  );
  await page.getByLabel("Adresse suchen").fill(name);
  await page.getByRole("button", { name: new RegExp(name) }).click();
  await page.getByRole("button", { name: "Projekt anlegen" }).click();
  await page.waitForURL(/\/planer\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId("planer-leinwand")).toBeVisible();
  // Näher heran, sonst ist ein 14-m-Dach nur ein paar Bildpunkte gross.
  await page.getByRole("button", { name: "Näher heran" }).click();
  await page.getByRole("button", { name: "Näher heran" }).click();
}

async function dachSetzen(page: Page, form: string, laenge: string, tiefe: string) {
  await page.getByRole("button", { name: /Standardform setzen/ }).click();
  await page.getByLabel("Form").selectOption(form);
  await page.getByLabel("Länge (m)").fill(laenge);
  await page.getByLabel("Tiefe (m)").fill(tiefe);
  await page.getByRole("button", { name: "In die Bildmitte setzen" }).click();
}

/** Die drei Zahlen der schwebenden Kennzahlenleiste. */
async function kennzahlen(page: Page) {
  const werte = await page.locator("div.num.text-\\[19px\\]").allTextContents();
  return {
    dachflaeche: Number((werte[0] ?? "").replace(/[^0-9]/g, "")),
    module: Number(werte[1] ?? "0"),
    kwp: Number((werte[2] ?? "0").replace(",", ".")),
  };
}

test.describe("Planer — Belegung", () => {
  test("Automatische Belegung füllt die Fläche, Leistung passt zur Modulzahl", async ({ page }) => {
    await login(page, DEMO.buero);
    await neuesProjekt(page, "Belegweg 1");
    await dachSetzen(page, "pult", "14", "9");

    await page.getByRole("button", { name: /^Fläche 1/ }).click();
    await expect(page.getByRole("button", { name: "Fläche automatisch belegen" })).toBeVisible();
    await page.getByRole("button", { name: "Fläche automatisch belegen" }).click();

    await expect.poll(async () => (await kennzahlen(page)).module).toBeGreaterThan(20);
    const k = await kennzahlen(page);

    /*
     * Die Leistung muss aus der Modulzahl folgen — 440 Wp je Modul.
     * Weichen die beiden Zahlen voneinander ab, rechnet irgendwo etwas
     * mit einem anderen Bestand.
     */
    expect(k.kwp).toBeCloseTo((k.module * 440) / 1000, 2);

    // Und die Belegung darf die Dachfläche nicht überschreiten.
    expect(k.module * 1.134 * 1.762).toBeLessThan(k.dachflaeche);
  });

  test("Ein Modul wegtippen senkt Zahl und Leistung um genau eines", async ({ page }) => {
    await login(page, DEMO.buero);
    await neuesProjekt(page, "Tippweg 2");
    await dachSetzen(page, "pult", "14", "9");
    await page.getByRole("button", { name: /^Fläche 1/ }).click();
    await page.getByRole("button", { name: "Fläche automatisch belegen" }).click();
    await expect.poll(async () => (await kennzahlen(page)).module).toBeGreaterThan(20);

    const vorher = await kennzahlen(page);

    // In die Mitte der Fläche tippen — dort liegt sicher ein Modul.
    const kasten = (await page.getByTestId("planer-leinwand").boundingBox())!;
    await page.mouse.click(kasten.x + kasten.width / 2, kasten.y + kasten.height / 2);

    await expect.poll(async () => (await kennzahlen(page)).module).toBe(vorher.module - 1);
    const nachher = await kennzahlen(page);
    expect(nachher.kwp).toBeCloseTo(vorher.kwp - 0.44, 2);

    /*
     * Nochmal tippen holt es zurück: das Modul wurde abgeschaltet, nicht
     * gelöscht (Briefing 4.2).
     */
    await page.mouse.click(kasten.x + kasten.width / 2, kasten.y + kasten.height / 2);
    await expect.poll(async () => (await kennzahlen(page)).module).toBe(vorher.module);
  });

  test("Ein Hindernis kostet Module", async ({ page }) => {
    await login(page, DEMO.buero);
    await neuesProjekt(page, "Kaminweg 3");
    await dachSetzen(page, "pult", "14", "9");
    await page.getByRole("button", { name: /^Fläche 1/ }).click();
    await page.getByRole("button", { name: "Fläche automatisch belegen" }).click();
    await expect.poll(async () => (await kennzahlen(page)).module).toBeGreaterThan(20);
    const ohne = (await kennzahlen(page)).module;

    // Gruppe entfernen, Kamin setzen, neu belegen.
    await page.getByRole("button", { name: "Gruppe entfernen" }).click();
    await page.getByRole("button", { name: /Hindernis aufziehen/ }).click();
    const kasten = (await page.getByTestId("planer-leinwand").boundingBox())!;
    const m = { x: kasten.x + kasten.width / 2, y: kasten.y + kasten.height / 2 };
    await page.mouse.move(m.x - 40, m.y - 30);
    await page.mouse.down();
    await page.mouse.move(m.x + 40, m.y + 30, { steps: 10 });
    await page.mouse.up();
    await expect(page.getByText(/Hindernisse \(1\)/i)).toBeVisible();

    await page.getByRole("button", { name: "Fläche automatisch belegen" }).click();
    await expect.poll(async () => (await kennzahlen(page)).module).toBeGreaterThan(0);
    expect((await kennzahlen(page)).module).toBeLessThan(ohne);
  });

  test("Flachdach bekommt Aufständerung und einen Reihenabstand gegen Winterschatten", async ({ page }) => {
    await login(page, DEMO.buero);
    await neuesProjekt(page, "Flachweg 4");
    await dachSetzen(page, "flach", "20", "14");

    await page.getByRole("button", { name: /^Fläche 1/ }).click();
    await page.getByRole("button", { name: "Fläche automatisch belegen" }).click();
    await expect.poll(async () => (await kennzahlen(page)).module).toBeGreaterThan(0);

    // Beim Flachdach steht das Modul auf einem Gestell — Süd, 15°.
    await expect(page.getByLabel("Art")).toHaveValue("sued");
    await expect(page.getByLabel("Winkel (°)")).toHaveValue("15");

    /*
     * Der vorgeschlagene Reihenabstand ist der Winterschatten:
     * 1,762 · sin(15°) / tan(90 − 48,31 − 23,44) = rund 1,36 m.
     * Er muss deutlich über dem Zeilenabstand eines Schrägdachs liegen.
     */
    const abstand = Number((await page.getByLabel("Reihenabstand (m)").inputValue()).replace(",", "."));
    expect(abstand).toBeGreaterThan(1.2);
    expect(abstand).toBeLessThan(1.6);
    await expect(page.getByRole("button", { name: /Winterverschattung/ })).toBeVisible();
  });

  test("Belegung übersteht das Neuladen", async ({ page }) => {
    await login(page, DEMO.buero);
    await neuesProjekt(page, "Bestandweg 5");
    await dachSetzen(page, "pult", "14", "9");
    await page.getByRole("button", { name: /^Fläche 1/ }).click();
    await page.getByRole("button", { name: "Fläche automatisch belegen" }).click();
    await expect.poll(async () => (await kennzahlen(page)).module).toBeGreaterThan(20);
    const vorher = await kennzahlen(page);

    await expect(page.getByText("gesichert")).toBeVisible({ timeout: 15_000 });
    await page.reload();
    await expect(page.getByTestId("planer-leinwand")).toBeVisible();
    await expect.poll(async () => (await kennzahlen(page)).module).toBe(vorher.module);
  });
});
