import { expect, test, type Page } from "@playwright/test";
import { admin, COMPANY_A, DEMO, login } from "./helpers";
import { belegen, dachSetzen } from "./planer-helfer";

/*
 * Gaube und Firstgriff (Wunsch vom 13.08.2026, Reonic-Vorbild:
 * „zieht dann die Gaube vom Dach").
 *
 * Eine Gaube sperrt Dachfläche wie eine Sperrzone — daran hängt die
 * Belegung — und steht in der räumlichen Ansicht als Körper.
 */

const LINZ = { lat: 48.30604, lon: 14.28583 };

async function aufraeumen() {
  await admin().from("planer_projekt").delete().eq("company_id", COMPANY_A).like("name", "Gaube%");
}
test.beforeEach(aufraeumen);
test.afterAll(aufraeumen);

async function neuesProjekt(page: Page): Promise<string> {
  await page.goto("/planer/neu");
  await page.route("**/api/planer/adresse**", (r) =>
    r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ treffer: [{ name: "Gaubenweg 1, 4020 Linz", ...LINZ }] }),
    }),
  );
  await page.getByLabel("Adresse suchen").fill("Gaubenweg 1");
  await page.getByRole("button", { name: /Gaubenweg 1/ }).click();
  await page.getByLabel("Projektname").fill("Gaube");
  await page.getByRole("button", { name: "Projekt anlegen" }).click();
  await page.waitForURL(/\/planer\/[0-9a-f-]{36}$/);
  return page.url().split("/").pop()!;
}

test.describe("Planer — Gaube", () => {
  test("Eine Gaube sperrt die Fläche und lässt sich verschieben", async ({ page }) => {
    await login(page, DEMO.gf);
    const id = await neuesProjekt(page);

    await dachSetzen(page, "Pultdach", "16", "10");
    await page.getByRole("button", { name: /^Fläche 1/ }).click();
    await belegen(page);

    const modulzahl = async () => {
      const { data } = await admin().from("planer_projekt").select("plan").eq("id", id).single();
      const plan = data!.plan as {
        gruppen: Array<{ reihen: number; spalten: number; aus?: string[]; entfernt?: string[] }>;
      };
      return plan.gruppen.reduce(
        (n, g) => n + g.reihen * g.spalten - new Set([...(g.aus ?? []), ...(g.entfernt ?? [])]).size,
        0,
      );
    };
    await expect.poll(modulzahl, { timeout: 20_000 }).toBeGreaterThan(10);
    const voll = await modulzahl();

    // Zurück in Schritt 1 — dort liegt das Gaubenwerkzeug.
    await page.getByRole("button", { name: /^1 Dach/ }).click();

    const k = (await page.getByTestId("planer-leinwand").boundingBox())!;
    const mitte = { x: k.x + k.width / 2, y: k.y + k.height / 2 };

    await page.getByRole("button", { name: /Gaube aufziehen/ }).click();
    await page.mouse.move(mitte.x - 50, mitte.y - 30);
    await page.mouse.down();
    await page.mouse.move(mitte.x + 20, mitte.y + 20, { steps: 10 });
    await page.mouse.up();

    const gauben = async () => {
      const { data } = await admin().from("planer_projekt").select("plan").eq("id", id).single();
      const plan = data!.plan as {
        flaechen?: Array<{ hindernisse?: Array<{ art: string; hoehe?: number; punkte: Array<{ x: number; y: number }> }> }>;
      };
      return (plan.flaechen ?? []).flatMap((f) => (f.hindernisse ?? []).filter((h) => h.art === "gaube"));
    };

    await expect.poll(async () => (await gauben()).length, { timeout: 20_000 }).toBe(1);
    const g = (await gauben())[0]!;
    expect(g.hoehe, "eine Gaube hat eine Höhe").toBeGreaterThan(0);

    /*
     * Und sie sperrt: Die Belegung darunter fällt heraus, sobald die
     * Fläche neu geführt wird. Das passiert beim nächsten Anfassen —
     * hier über einen Zug an der Gaube selbst.
     */
    const griff = { x: mitte.x - 20, y: mitte.y - 10 };
    await page.mouse.move(griff.x, griff.y);
    await page.mouse.down();
    await page.mouse.move(griff.x + 40, griff.y + 20, { steps: 10 });
    await page.mouse.up();

    await expect
      .poll(async () => Math.round(((await gauben())[0]!.punkte[0]!.x ?? 0) * 100), {
        timeout: 20_000,
      })
      .not.toBe(Math.round(g.punkte[0]!.x * 100));

    await expect
      .poll(modulzahl, { timeout: 20_000 })
      .toBeLessThan(voll);
  });
});
