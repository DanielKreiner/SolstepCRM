import { expect, test, type Page } from "@playwright/test";
import { admin, COMPANY_A, DEMO, login } from "./helpers";
import { dachSetzen } from "./planer-helfer";

/*
 * Nullpunkt versetzen (Wunsch vom 13.08.2026: „gib mich auch was, dass
 * ich diesen viewpunkt verschieben kann").
 *
 * Geprüft wird das Entscheidende: Der Weltbezug ändert sich, und die
 * Dachfläche bleibt trotzdem an derselben Stelle der Welt. Läge das
 * Dach danach woanders, wäre der Ursprung kein Bezugspunkt mehr,
 * sondern ein Verschiebewerkzeug für die ganze Anlage.
 */

const LINZ = { lat: 48.30604, lon: 14.28583 };
const ERDRADIUS = 6371000;
const GRAD = Math.PI / 180;

async function aufraeumen() {
  await admin().from("planer_projekt").delete().eq("company_id", COMPANY_A).like("name", "Null%");
}
test.beforeEach(aufraeumen);
test.afterAll(aufraeumen);

async function neuesProjekt(page: Page): Promise<string> {
  await page.goto("/planer/neu");
  await page.route("**/api/planer/adresse**", (r) =>
    r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ treffer: [{ name: "Nullweg 1, 4020 Linz", ...LINZ }] }),
    }),
  );
  await page.getByLabel("Adresse suchen").fill("Nullweg 1");
  await page.getByRole("button", { name: /Nullweg 1/ }).click();
  await page.getByLabel("Projektname").fill("Nullpunkt");
  await page.getByRole("button", { name: "Projekt anlegen" }).click();
  await page.waitForURL(/\/planer\/[0-9a-f-]{36}$/);
  return page.url().split("/").pop()!;
}

test.describe("Planer — Nullpunkt", () => {
  test("Versetzen ändert den Weltbezug, die Fläche bleibt liegen", async ({ page }) => {
    await login(page, DEMO.gf);
    const id = await neuesProjekt(page);

    await dachSetzen(page, "Pultdach", "14", "9");
    await page.getByRole("button", { name: /^Fläche 1/ }).click();

    const stand = async () => {
      const { data } = await admin()
        .from("planer_projekt")
        .select("ursprung_lat, ursprung_lon, plan")
        .eq("id", id)
        .single();
      const plan = data!.plan as {
        flaechen?: Array<{ punkte: Array<{ x: number; y: number }> }>;
      };
      const ecke = plan.flaechen?.[0]?.punkte?.[0];
      if (!ecke) return null;
      return {
        lat: Number(data!.ursprung_lat),
        lon: Number(data!.ursprung_lon),
        ecke,
      };
    };

    await expect.poll(stand, { timeout: 20_000 }).not.toBeNull();
    const vorher = (await stand())!;

    /** Dieselbe Ecke in Weltkoordinaten — das ist die Grösse, die gleich bleiben muss. */
    const welt = (s: NonNullable<Awaited<ReturnType<typeof stand>>>) => ({
      lat: s.lat + s.ecke.y / (ERDRADIUS * GRAD),
      lon: s.lon + s.ecke.x / (ERDRADIUS * GRAD * Math.cos(s.lat * GRAD)),
    });
    const vorherWelt = welt(vorher);

    const k = (await page.getByTestId("planer-leinwand").boundingBox())!;
    await page.getByRole("button", { name: /Nullpunkt versetzen/ }).click();
    await page.mouse.click(k.x + k.width / 2 + 90, k.y + k.height / 2 - 60);

    await expect
      .poll(async () => Math.round(((await stand())?.lat ?? 0) * 1e6), { timeout: 20_000 })
      .not.toBe(Math.round(vorher.lat * 1e6));

    const nachher = (await stand())!;
    const nachherWelt = welt(nachher);

    // Der Weltbezug hat sich bewegt …
    expect(nachher.lon).not.toBeCloseTo(vorher.lon, 6);

    // … die Ecke der Dachfläche aber nicht. Ein Meter Toleranz.
    const dLat = (nachherWelt.lat - vorherWelt.lat) * ERDRADIUS * GRAD;
    const dLon =
      (nachherWelt.lon - vorherWelt.lon) * ERDRADIUS * GRAD * Math.cos(vorher.lat * GRAD);
    expect(Math.hypot(dLat, dLon), "die Dachecke liegt noch dort, wo sie lag").toBeLessThan(1);

    /*
     * Und das Werkzeug steht wieder auf „Wählen" — ein Klick, fertig.
     * Gesucht über den Titel: Die Knöpfe der Werkzeugleiste tragen ihn
     * als zugänglichen Namen.
     */
    await expect(page.getByRole("button", { name: "Auswählen und bearbeiten" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});
