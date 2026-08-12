import { expect, type Page, test } from "@playwright/test";
import { admin, COMPANY_A, DEMO, login } from "./helpers";

/*
 * Planer — was ein Schritt sperrt.
 *
 * Ein späterer Schritt fasst nicht mehr an, was ein früherer festgelegt
 * hat. Der teuerste Fehler in diesem Ablauf ist eine verrutschte
 * Dachkante, nachdem die Belegung steht: Die Module liegen noch da, die
 * Fläche stimmt nicht mehr, und niemand merkt es.
 */

const LINZ = { lat: 48.30604, lon: 14.28583 };

async function aufraeumen() {
  await admin().from("planer_projekt").delete().eq("company_id", COMPANY_A).like("name", "Phasen%");
}

test.beforeEach(aufraeumen);
test.afterAll(aufraeumen);

async function projektMitBelegung(page: Page, name: string) {
  await page.goto("/planer/neu");
  await page.route("**/api/planer/adresse**", (r) =>
    r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ treffer: [{ name: `${name}, 4020 Linz`, ...LINZ }] }),
    }),
  );
  await page.getByLabel("Adresse suchen").fill(name);
  await page.getByRole("button", { name: new RegExp(name) }).click();
  await page.getByLabel("Projektname").fill(name);
  await page.getByRole("button", { name: "Projekt anlegen" }).click();
  await page.waitForURL(/\/planer\/[0-9a-f-]{36}$/);
  const id = page.url().split("/").pop()!;

  await page.getByRole("button", { name: "Näher heran" }).click();
  await page.getByRole("button", { name: /Standardform setzen/ }).click();
  await page.getByLabel("Form").selectOption("pult");
  await page.getByLabel("Länge (m)").fill("14");
  await page.getByLabel("Tiefe (m)").fill("9");
  await page.getByRole("button", { name: "In die Bildmitte setzen" }).click();
  await page.getByRole("button", { name: /^Fläche 1/ }).click();
  return id;
}

/** Die Eckpunkte der ersten Fläche aus dem gespeicherten Plan. */
async function punkte(id: string): Promise<string> {
  const { data } = await admin().from("planer_projekt").select("plan").eq("id", id).single();
  const plan = data!.plan as { flaechen: Array<{ punkte: unknown[] }> };
  return JSON.stringify(plan.flaechen[0]?.punkte ?? null);
}

test.describe("Planer — Schrittsperren", () => {
  test("Jeder Schritt zeigt nur seine Werkzeuge", async ({ page }) => {
    await login(page, DEMO.gf);
    await projektMitBelegung(page, "Phasen Werkzeuge");

    /*
     * Schritt 1 und 2 teilen sich das Panel: Dach und Belegung
     * entstehen im selben Durchgang. Deshalb hat Schritt 1 beides.
     * Gesperrt wird nach vorn — ab Schritt 2 bleibt das Dach, wie es
     * ist.
     */
    await expect(page.getByRole("button", { name: "Dachfläche zeichnen" })).toBeVisible();

    // Schritt 2: belegen — die Zeichenwerkzeuge sind weg.
    await page.getByRole("button", { name: /^2 Belegung/ }).click();
    await expect(page.getByRole("button", { name: "Dachfläche zeichnen" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Einzelnes Modul/ })).toBeVisible();

    // Schritt 3: Strings — auch die Modulwerkzeuge sind weg.
    await page.getByRole("button", { name: /^3 Technik/ }).click();
    await expect(page.getByRole("button", { name: /Einzelnes Modul/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Module dem gewählten String/ })).toBeVisible();
  });

  test("In der Belegung ist die Kante nicht mehr zu bearbeiten", async ({ page }) => {
    await login(page, DEMO.gf);
    await projektMitBelegung(page, "Phasen Kante");

    /*
     * Geprüft wird über die Massangabe an der Kante: Sie ist ein
     * eindeutig treffbares Ziel und dieselbe Trefferprüfung, die auch
     * Ecken und Kanten bedient. Ein Mauszug quer über die Fläche wäre
     * kein Beweis — er könnte die Kante schlicht verfehlen, und der
     * Test wäre grün, ohne etwas zu zeigen.
     */
    const kasten = (await page.getByTestId("planer-leinwand").boundingBox())!;
    const mitte = { x: kasten.x + kasten.width / 2, y: kasten.y + kasten.height / 2 };

    /*
     * Wo genau die Massangabe sitzt, hängt vom Kartenausschnitt ab.
     * Der Test sucht sie deshalb erst und prüft die Sperre dann an
     * genau dieser Stelle — ein fest gewählter Punkt könnte danebenn
     * liegen, und der Test wäre grün, ohne etwas gezeigt zu haben.
     */
    const feld = page.getByLabel("Kantenlänge in Metern");
    let obereKante: { x: number; y: number } | null = null;
    for (const dy of [-70, -80, -90, -100, -110, -120, -60, -50]) {
      await page.mouse.click(mitte.x, mitte.y + dy);
      if (await feld.isVisible().catch(() => false)) {
        obereKante = { x: mitte.x, y: mitte.y + dy };
        await page.keyboard.press("Escape");
        break;
      }
    }
    expect(obereKante, "Massangabe an der Kante gefunden").not.toBeNull();

    // In Schritt 2 tut derselbe Klick nichts mehr.
    await page.getByRole("button", { name: /^2 Belegung/ }).click();
    await expect(page.getByText(/zurück zu Schritt 1/)).toBeVisible();
    await page.mouse.click(obereKante!.x, obereKante!.y);
    await expect(page.getByLabel("Kantenlänge in Metern")).toHaveCount(0);

    // Und zurück in Schritt 1 geht es wieder.
    await page.getByRole("button", { name: /^1 Dach/ }).click();
    await page.getByRole("button", { name: /^Fläche 1/ }).click();
    await page.mouse.click(obereKante!.x, obereKante!.y);
    await expect(page.getByLabel("Kantenlänge in Metern")).toBeVisible();
  });

  test("In der Technik lässt sich die Belegung nicht mehr ändern", async ({ page }) => {
    await login(page, DEMO.gf);
    const id = await projektMitBelegung(page, "Phasen Module");

    await page.getByRole("button", { name: /^2 Belegung/ }).click();
    await page.getByRole("button", { name: "Fläche automatisch belegen" }).click();
    await expect(page.getByRole("button", { name: /^Feld 1/ })).toBeVisible();

    const zahl = async () => {
      const { data } = await admin().from("planer_projekt").select("plan").eq("id", id).single();
      const plan = data!.plan as { gruppen: Array<{ aus: string[] }> };
      return plan.gruppen[0]?.aus.length ?? -1;
    };
    await expect.poll(zahl, { timeout: 20_000 }).toBeGreaterThanOrEqual(0);
    const vorher = await zahl();

    /*
     * In Schritt 3 auf ein Modul tippen. In der Belegung schaltete das
     * ein Modul ab; hier darf es nur die Karte betreffen.
     */
    await page.getByRole("button", { name: /^3 Technik/ }).click();
    const kasten = (await page.getByTestId("planer-leinwand").boundingBox())!;
    await page.mouse.click(kasten.x + kasten.width / 2, kasten.y + kasten.height / 2);
    await page.waitForTimeout(2500);

    expect(await zahl(), "kein Modul darf sich geändert haben").toBe(vorher);
  });
});
