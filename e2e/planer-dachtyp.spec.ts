import { expect, test, type Page } from "@playwright/test";
import { admin, COMPANY_A, DEMO, login } from "./helpers";

/*
 * Umriss zeichnen, Dachtyp wählen (Wunsch vom 13.08.2026, Reonic als
 * Vorbild: „da zeichnet man ein Dach komplett … und es verschiebt sich
 * alles gleich").
 */

const LINZ = { lat: 48.30604, lon: 14.28583 };

async function aufraeumen() {
  await admin().from("planer_projekt").delete().eq("company_id", COMPANY_A).like("name", "Typ%");
}
test.beforeEach(aufraeumen);
test.afterAll(aufraeumen);

async function neuesProjekt(page: Page): Promise<string> {
  await page.goto("/planer/neu");
  await page.route("**/api/planer/adresse**", (r) =>
    r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ treffer: [{ name: "Typweg 1, 4020 Linz", ...LINZ }] }),
    }),
  );
  await page.getByLabel("Adresse suchen").fill("Typweg 1");
  await page.getByRole("button", { name: /Typweg 1/ }).click();
  await page.getByLabel("Projektname").fill("Typ");
  await page.getByRole("button", { name: "Projekt anlegen" }).click();
  await page.waitForURL(/\/planer\/[0-9a-f-]{36}$/);
  return page.url().split("/").pop()!;
}

test.describe("Planer — Dachtyp aus dem Umriss", () => {
  test("Ein Umriss, vier Dachformen, derselbe Grundriss", async ({ page }) => {
    await login(page, DEMO.gf);
    const id = await neuesProjekt(page);

    // Umriss zeichnen: vier Ecken, dann schliessen.
    const leinwand = page.getByTestId("planer-leinwand");
    const k = (await leinwand.boundingBox())!;
    const mitte = { x: k.x + k.width / 2, y: k.y + k.height / 2 };

    await page.getByRole("button", { name: "Selbst zeichnen" }).click();
    for (const [dx, dy] of [
      [-110, -70],
      [110, -70],
      [110, 70],
      [-110, 70],
    ] as Array<[number, number]>) {
      await page.mouse.click(mitte.x + dx, mitte.y + dy);
      await page.waitForTimeout(120);
    }
    await page.keyboard.press("Enter");

    const stand = async () => {
      const { data } = await admin().from("planer_projekt").select("plan").eq("id", id).single();
      const plan = data!.plan as {
        bauten?: Array<{ id: string; form: string; umriss: Array<{ x: number; y: number }> }>;
        flaechen?: Array<{ id: string; neigung: number; bau?: string | null }>;
      };
      return { bauten: plan.bauten ?? [], flaechen: plan.flaechen ?? [] };
    };

    await expect.poll(async () => (await stand()).bauten.length, { timeout: 20_000 }).toBe(1);
    const nachZeichnen = await stand();
    expect(nachZeichnen.flaechen, "erst einmal eine Fläche — wie vorher auch").toHaveLength(1);
    expect(nachZeichnen.bauten[0]!.form, "Pultdach mit 30 Grad wie vorher").toBe("pult");
    const umriss = nachZeichnen.bauten[0]!.umriss;
    expect(umriss).toHaveLength(4);

    // Satteldach: zwei Flächen, Umriss unverändert.
    await page.getByRole("button", { name: "Satteldach", exact: true }).click();
    await expect.poll(async () => (await stand()).flaechen.length, { timeout: 20_000 }).toBe(2);
    expect((await stand()).bauten[0]!.umriss, "der Umriss bleibt stehen").toEqual(umriss);

    // Walmdach: vier Flächen, Umriss immer noch derselbe.
    await page.getByRole("button", { name: "Walmdach", exact: true }).click();
    await expect.poll(async () => (await stand()).flaechen.length, { timeout: 20_000 }).toBe(4);
    expect((await stand()).bauten[0]!.umriss).toEqual(umriss);

    // Und zurück auf Flachdach: eine Fläche, ohne Neigung.
    await page.getByRole("button", { name: "Flachdach", exact: true }).click();
    await expect.poll(async () => (await stand()).flaechen.length, { timeout: 20_000 }).toBe(1);
    expect((await stand()).flaechen[0]!.neigung).toBe(0);
    expect((await stand()).bauten[0]!.umriss).toEqual(umriss);
  });

  test("An der Hausecke ziehen rechnet das ganze Dach mit", async ({ page }) => {
    await login(page, DEMO.gf);
    const id = await neuesProjekt(page);

    const leinwand = page.getByTestId("planer-leinwand");
    const k = (await leinwand.boundingBox())!;
    const mitte = { x: k.x + k.width / 2, y: k.y + k.height / 2 };

    await page.getByRole("button", { name: "Selbst zeichnen" }).click();
    const ecken: Array<[number, number]> = [
      [-110, -70],
      [110, -70],
      [110, 70],
      [-110, 70],
    ];
    for (const [dx, dy] of ecken) {
      await page.mouse.click(mitte.x + dx, mitte.y + dy);
      await page.waitForTimeout(120);
    }
    await page.keyboard.press("Enter");

    const stand = async () => {
      const { data } = await admin().from("planer_projekt").select("plan").eq("id", id).single();
      const plan = data!.plan as {
        bauten?: Array<{ umriss: Array<{ x: number; y: number }> }>;
        flaechen?: Array<{ punkte: Array<{ x: number; y: number }> }>;
      };
      return { bauten: plan.bauten ?? [], flaechen: plan.flaechen ?? [] };
    };
    await expect.poll(async () => (await stand()).bauten.length, { timeout: 20_000 }).toBe(1);

    await page.getByRole("button", { name: "Walmdach", exact: true }).click();
    await expect.poll(async () => (await stand()).flaechen.length, { timeout: 20_000 }).toBe(4);

    const vorher = await stand();
    const eckeVorher = vorher.bauten[0]!.umriss[0]!;

    /*
     * An der ersten Hausecke ziehen. Sie liegt dort, wo sie gesetzt
     * wurde — die Karte hat sich seither nicht bewegt.
     */
    const griff = { x: mitte.x + ecken[0]![0], y: mitte.y + ecken[0]![1] };
    await page.mouse.move(griff.x, griff.y);
    await page.mouse.down();
    await page.mouse.move(griff.x - 60, griff.y - 40, { steps: 14 });
    await page.mouse.up();

    await expect
      .poll(async () => Math.round(((await stand()).bauten[0]!.umriss[0]!.x ?? 0) * 100), {
        timeout: 20_000,
      })
      .not.toBe(Math.round(eckeVorher.x * 100));

    const nachher = await stand();
    expect(nachher.flaechen, "es bleiben vier Teilflächen").toHaveLength(4);

    /*
     * Und die neue Hausecke steckt in den Dachflächen: Mindestens eine
     * Teilfläche hat einen Punkt genau dort.
     */
    const ecke = nachher.bauten[0]!.umriss[0]!;
    const trifft = nachher.flaechen.some((f) =>
      f.punkte.some((q) => Math.hypot(q.x - ecke.x, q.y - ecke.y) < 0.01),
    );
    expect(trifft, "die Dachflächen sind mitgewandert").toBe(true);
  });
});
