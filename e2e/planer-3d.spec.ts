import { expect, test } from "@playwright/test";
import { admin, COMPANY_A, DEMO, login } from "./helpers";

/*
 * Planer — räumliche Ansicht (BRIEFING-planer-3d.md).
 *
 * Was sich an einer 3D-Szene automatisch prüfen lässt, ist begrenzt:
 * Ob ein Haus „richtig aussieht", sagt kein Testlauf. Prüfbar ist, dass
 * der Umschalter wirkt, ein WebGL-Kontext entsteht, die Gebäudewerte
 * gespeichert werden und die Ansicht keine Fehler wirft — genau das
 * steht hier. Die Geometrie dahinter ist in lib/planer/gebaeude.spec.ts
 * gegen nachgerechnete Werte abgesichert.
 */

const LINZ = { lat: 48.30604, lon: 14.28583 };

async function aufraeumen() {
  await admin().from("planer_projekt").delete().eq("company_id", COMPANY_A).like("name", "3D-Prüfung%");
}

test.beforeEach(aufraeumen);
test.afterAll(aufraeumen);

test.describe("Planer — räumliche Ansicht", () => {
  test("umschalten, Gebäude bauen, Werte merken", async ({ page }) => {
    const fehler: string[] = [];
    page.on("pageerror", (e) => fehler.push(e.message));

    await login(page, DEMO.gf);
    await page.goto("/planer/neu");
    await page.route("**/api/planer/adresse**", (r) =>
      r.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ treffer: [{ name: "3D-Prüfung 1, 4020 Linz", ...LINZ }] }),
      }),
    );
    await page.getByLabel("Adresse suchen").fill("3D-Prüfung 1");
    await page.getByRole("button", { name: /3D-Prüfung 1/ }).click();
    await page.getByLabel("Projektname").fill("3D-Prüfung");
    await page.getByRole("button", { name: "Projekt anlegen" }).click();
    await page.waitForURL(/\/planer\/[0-9a-f-]{36}$/);
    const id = page.url().split("/").pop()!;

    await page.getByRole("button", { name: /Standardform setzen/ }).click();
    await page.getByLabel("Länge (m)").fill("12");
    await page.getByLabel("Tiefe (m)").fill("8");
    await page.getByRole("button", { name: "In die Bildmitte setzen" }).click();
    await expect(page.getByRole("button", { name: /^Fläche 1/ })).toBeVisible();

    /*
     * Die Gebäudewerte gehören zum Plan, nicht zum Bildschirm: Beim
     * nächsten Öffnen soll dasselbe Haus dastehen.
     */
    await page.getByLabel("Wandhöhe (m)").fill("6");
    await page.getByLabel("Dachüberstand (m)").fill("0.6");

    await expect
      .poll(
        async () => {
          const { data } = await admin()
            .from("planer_projekt")
            .select("plan")
            .eq("id", id)
            .single();
          const p = data!.plan as { gebaeude?: { wandhoehe?: number } };
          return p.gebaeude?.wandhoehe ?? 0;
        },
        { timeout: 20_000 },
      )
      .toBe(6);

    // Umschalten: Die Zeichenfläche verschwindet, die Szene erscheint.
    await page.getByRole("button", { name: "2D", exact: true }).click();
    await expect(page.getByTestId("planer-3d")).toBeVisible();
    await expect(page.getByTestId("planer-leinwand")).toHaveCount(0);

    // Ein WebGL-Kontext muss entstanden sein — sonst steht dort nur ein
    // leerer Kasten, und das sähe im Screenshot genauso aus.
    const hatKontext = await page
      .locator("[data-testid=planer-3d] canvas")
      .evaluate((c) => Boolean((c as HTMLCanvasElement).getContext("webgl2")));
    expect(hatKontext).toBe(true);

    // Und zurück.
    await page.getByRole("button", { name: "3D", exact: true }).click();
    await expect(page.getByTestId("planer-leinwand")).toBeVisible();

    expect(fehler, `Fehler in der Seite: ${fehler.join(" | ")}`).toHaveLength(0);
  });

  test("Die Ansicht kommt ohne Belegung zurecht", async ({ page }) => {
    const fehler: string[] = [];
    page.on("pageerror", (e) => fehler.push(e.message));

    await login(page, DEMO.gf);
    await page.goto("/planer/neu");
    await page.route("**/api/planer/adresse**", (r) =>
      r.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ treffer: [{ name: "3D-Prüfung 2, 4020 Linz", ...LINZ }] }),
      }),
    );
    await page.getByLabel("Adresse suchen").fill("3D-Prüfung 2");
    await page.getByRole("button", { name: /3D-Prüfung 2/ }).click();
    await page.getByLabel("Projektname").fill("3D-Prüfung leer");
    await page.getByRole("button", { name: "Projekt anlegen" }).click();
    await page.waitForURL(/\/planer\/[0-9a-f-]{36}$/);

    /*
     * Ein frisches Projekt ohne jede Fläche. Der Renderer darf daran
     * nicht scheitern — sonst steht der Planer beim ersten Klick auf
     * 3D still, und zwar genau bei dem Nutzer, der noch nichts
     * gezeichnet hat.
     */
    await page.getByRole("button", { name: "2D", exact: true }).click();
    await expect(page.getByTestId("planer-3d")).toBeVisible();
    await page.waitForTimeout(1500);
    expect(fehler, `Fehler in der Seite: ${fehler.join(" | ")}`).toHaveLength(0);
  });
});
