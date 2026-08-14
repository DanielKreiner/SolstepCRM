import { expect, test, type Page } from "@playwright/test";
import { admin, COMPANY_A, DEMO, login } from "./helpers";
import { dachSetzen } from "./planer-helfer";

/*
 * Sperrzonen bewegen (Wunsch vom 13.08.2026: „Sperrzonen soll man
 * verschieben und kleiner etc machen können").
 *
 * Vorher liessen sie sich nur aufziehen. Wer den Kamin zwei Meter zu
 * weit links hatte, musste ihn löschen und neu ziehen.
 */

const LINZ = { lat: 48.30604, lon: 14.28583 };

async function aufraeumen() {
  await admin().from("planer_projekt").delete().eq("company_id", COMPANY_A).like("name", "Sperr%");
}
test.beforeEach(aufraeumen);
test.afterAll(aufraeumen);

async function neuesProjekt(page: Page): Promise<string> {
  await page.goto("/planer/neu");
  await page.route("**/api/planer/adresse**", (r) =>
    r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ treffer: [{ name: "Sperrweg 1, 4020 Linz", ...LINZ }] }),
    }),
  );
  await page.getByLabel("Adresse suchen").fill("Sperrweg 1");
  await page.getByRole("button", { name: /Sperrweg 1/ }).click();
  await page.getByLabel("Projektname").fill("Sperr");
  await page.getByRole("button", { name: "Projekt anlegen" }).click();
  await page.waitForURL(/\/planer\/[0-9a-f-]{36}$/);
  return page.url().split("/").pop()!;
}

test.describe("Planer — Sperrzonen bewegen", () => {
  test("Schieben versetzt die Zone, ein Eckzug ändert ihre Grösse", async ({ page }) => {
    await login(page, DEMO.gf);
    const id = await neuesProjekt(page);

    await dachSetzen(page, "Pultdach", "16", "10");
    await page.getByRole("button", { name: /^Fläche 1/ }).click();

    const k = (await page.getByTestId("planer-leinwand").boundingBox())!;
    const mitte = { x: k.x + k.width / 2, y: k.y + k.height / 2 };

    await page.getByRole("button", { name: /Sperrzone aufziehen/ }).click();
    await page.mouse.move(mitte.x - 60, mitte.y - 40);
    await page.mouse.down();
    await page.mouse.move(mitte.x - 10, mitte.y + 10, { steps: 10 });
    await page.mouse.up();
    await expect(page.getByText(/Sperrzonen \(1\)/i)).toBeVisible();

    /*
     * Der Plan wird verzögert gespeichert. Deshalb liefert der Leser
     * `null`, solange noch nichts in der Datenbank steht — und der Test
     * wartet darauf, statt über ein `undefined` zu stolpern.
     */
    const zone = async () => {
      const { data } = await admin().from("planer_projekt").select("plan").eq("id", id).single();
      const plan = data!.plan as {
        flaechen?: Array<{ hindernisse?: Array<{ punkte: Array<{ x: number; y: number }> }> }>;
      };
      const h = plan.flaechen?.[0]?.hindernisse?.[0];
      if (!h) return null;
      const xs = h.punkte.map((p) => p.x);
      const ys = h.punkte.map((p) => p.y);
      return {
        mitteX: (Math.min(...xs) + Math.max(...xs)) / 2,
        mitteY: (Math.min(...ys) + Math.max(...ys)) / 2,
        breite: Math.max(...xs) - Math.min(...xs),
        hoehe: Math.max(...ys) - Math.min(...ys),
      };
    };

    await expect.poll(zone, { timeout: 20_000 }).not.toBeNull();
    const vorher = (await zone())!;
    expect(vorher.breite).toBeGreaterThan(0);

    /*
     * Schieben: in die Zone fassen und ziehen. Das Werkzeug steht nach
     * dem Aufziehen wieder auf „Wählen".
     */
    const griff = { x: mitte.x - 35, y: mitte.y - 15 };
    await page.mouse.move(griff.x, griff.y);
    await page.mouse.down();
    await page.mouse.move(griff.x + 70, griff.y + 30, { steps: 12 });
    await page.mouse.up();

    await expect
      .poll(async () => Math.round(((await zone())?.mitteX ?? 0) * 100), { timeout: 15_000 })
      .not.toBe(Math.round(vorher.mitteX * 100));

    const geschoben = (await zone())!;
    expect(geschoben.mitteX, "nach rechts geschoben").toBeGreaterThan(vorher.mitteX);
    expect(geschoben.mitteY, "und nach unten (Bild-y läuft andersherum)").toBeLessThan(
      vorher.mitteY,
    );
    expect(geschoben.breite, "die Grösse bleibt beim Schieben").toBeCloseTo(vorher.breite, 2);
    expect(geschoben.hoehe).toBeCloseTo(vorher.hoehe, 2);

    /*
     * Grösse ändern: an einer Ecke ziehen. Die Ecken liegen dort, wo
     * die Zone jetzt steht — also 70/30 Bildpunkte weiter als beim
     * Aufziehen.
     */
    const ecke = { x: mitte.x - 60 + 70, y: mitte.y - 40 + 30 };
    await page.mouse.move(ecke.x, ecke.y);
    await page.mouse.down();
    await page.mouse.move(ecke.x - 40, ecke.y - 25, { steps: 12 });
    await page.mouse.up();

    await expect
      .poll(async () => Math.round(((await zone())?.breite ?? 0) * 100), { timeout: 15_000 })
      .not.toBe(Math.round(geschoben.breite * 100));

    const gezogen = (await zone())!;
    expect(gezogen.breite, "die Zone ist breiter geworden").toBeGreaterThan(geschoben.breite);
    expect(gezogen.hoehe, "und höher").toBeGreaterThan(geschoben.hoehe);
  });
});
