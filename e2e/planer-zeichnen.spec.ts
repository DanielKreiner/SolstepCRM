import { expect, type Page, test } from "@playwright/test";
import { admin, DEMO, login } from "./helpers";
import { dachSetzen, mehrOeffnen } from "./planer-helfer";

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
  return page.url().split("/").pop()!;
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
  const text = (await page.getByTestId("stand-grundflaeche").textContent()) ?? "";
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
    const dachText = (await page.getByTestId("stand-dachflaeche").textContent()) ?? "";
    const dach = Number(dachText.replace(" m²", "").replace(".", "").replace(",", "."));
    expect(dach).toBeCloseTo(grund / Math.cos(Math.PI / 6), 0);

    await expect(page.getByTestId("stand-ecken")).toHaveText("4");
  });

  test("Kantenmass eintippen setzt die Kante exakt — Abnahmetest 2", async ({ page }) => {
    await login(page, DEMO.buero);
    await neuesProjekt(page, "Massweg 2");
    await zeichneRechteck(page);

    const vorher = await grundflaeche(page);

    /*
     * Auf die Pille der oberen Kante tippen. Sie sitzt seit dem Umbau
     * AUSSERHALB der Fläche, ein Stück vor der Kante — auf der Kante lag
     * sie über den Modulen und verdeckte die Belegung.
     */
    const feld = page.getByLabel("Kantenlänge in Metern");
    /*
     * Die Pille sitzt seit dem Umbau AUSSERHALB der Fläche, ein Stück
     * vor der Kante. Wie weit genau, hängt am Zoom — deshalb wird sie
     * gesucht statt gerechnet. Ein fester Punkt träfe je nach Ausschnitt
     * daneben, und der Test wäre grün, ohne etwas gezeigt zu haben.
     */
    let getroffen = false;
    for (const dy of [-115, -110, -120, -105, -100, -125]) {
      const pille = await stelle(page, 0, dy);
      await page.mouse.click(pille.x, pille.y);
      if (await feld.isVisible().catch(() => false)) {
        getroffen = true;
        break;
      }
    }
    expect(getroffen, "Massangabe an der oberen Kante gefunden").toBe(true);
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
    await expect(page.getByTestId("stand-flaechenzahl")).toHaveText("1");

    // Zweite Fläche daneben.
    await zeichneRechteck(page, 60, 40);
    await expect(page.getByTestId("stand-flaechenzahl")).toHaveText("2");

    await page.getByRole("button", { name: "Rückgängig" }).click();
    await expect(page.getByTestId("stand-flaechenzahl")).toHaveText("1");
    await page.getByRole("button", { name: "Rückgängig" }).click();
    /*
     * Ohne Fläche zeigt der Schritt wieder seine Frage — die Liste und
     * die Kennzahl dazu verschwinden ganz.
     */
    await expect(page.getByTestId("stand-flaechenzahl")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Fläche 1/ })).toHaveCount(0);

    await page.getByRole("button", { name: "Wiederholen" }).click();
    await expect(page.getByTestId("stand-flaechenzahl")).toHaveText("1");
  });

  test("Dachform-Assistent legt ein Walmdach an — Abnahmetest 3", async ({ page }) => {
    await login(page, DEMO.buero);
    await neuesProjekt(page, "Walmweg 4");

    await dachSetzen(page, "Walmdach", "14", "9");

    // Vier Flächen: zwei Trapeze, zwei Walme.
    await expect(page.getByTestId("stand-flaechenzahl")).toHaveText("4");

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

    await dachSetzen(page, "Flachdach");

    await expect(page.getByTestId("stand-flaechenzahl")).toHaveText("1");
    await expect(page.getByLabel("Neigung", { exact: true })).toHaveValue("0");
    // Traufkante und Randabstand liegen hinter „Mehr einstellen".
    await mehrOeffnen(page);
    await expect(page.getByLabel("Traufkante")).toHaveValue("");
    await expect(page.getByLabel("Randabstand", { exact: true })).toHaveValue("1");
    // Grund- und Dachfläche fallen bei 0° zusammen.
    const grund = await grundflaeche(page);
    const dachText = (await page.getByTestId("stand-dachflaeche").textContent()) ?? "";
    expect(Number(dachText.replace(" m²", "").replace(",", "."))).toBeCloseTo(grund, 1);
  });

  test("Neigung wirkt auf die Dachfläche, nicht auf den Grundriss", async ({ page }) => {
    await login(page, DEMO.buero);
    await neuesProjekt(page, "Neigungsweg 6");
    await zeichneRechteck(page);

    const grund = await grundflaeche(page);
    await page.getByLabel("Neigung", { exact: true }).fill("45");
    await page.getByLabel("Neigung", { exact: true }).blur();

    // Grundriss unverändert — die Draufsicht kennt keine Neigung.
    await expect.poll(async () => grundflaeche(page)).toBeCloseTo(grund, 0);
    const dachText = (await page.getByTestId("stand-dachflaeche").textContent()) ?? "";
    const dach = Number(dachText.replace(" m²", "").replace(".", "").replace(",", "."));
    expect(dach).toBeCloseTo(grund / Math.cos(Math.PI / 4), 0);
  });

  test("Hindernis liegt auf der Fläche — sonst wird es abgelehnt", async ({ page }) => {
    await login(page, DEMO.buero);
    await neuesProjekt(page, "Kaminweg 8");
    await zeichneRechteck(page, 140, 80);

    const mitte = await stelle(page, 0, 0);
    await page.getByRole("button", { name: /Sperrzone aufziehen/ }).click();

    // Kamin mitten auf dem Dach: wird angelegt.
    await page.mouse.move(mitte.x - 30, mitte.y - 20);
    await page.mouse.down();
    await page.mouse.move(mitte.x + 20, mitte.y + 30, { steps: 10 });
    await page.mouse.up();
    await expect(page.getByText(/Sperrzonen \(1\)/i)).toBeVisible();

    /*
     * Und daneben: ein Kamin ausserhalb des Dachs sperrt nichts und
     * taucht in keiner Rechnung auf. Er darf nicht still entstehen.
     */
    await page.getByRole("button", { name: /Sperrzone aufziehen/ }).click();
    /*
     * Deutlich neben der Fläche (die reicht bis ±140/±80), aber weit
     * genug INNERHALB der Zeichenfläche: endet der Zug ausserhalb, geht
     * das Loslassen an ein anderes Element und der Test wird sprunghaft.
     */
    await page.mouse.move(mitte.x + 190, mitte.y + 120);
    await page.mouse.down();
    await page.mouse.move(mitte.x + 235, mitte.y + 160, { steps: 8 });
    await page.mouse.up();

    await expect(
      page.getByText(/Sperrzone muss auf der gewählten Dachfläche liegen/),
    ).toBeVisible();
    await expect(page.getByText(/Sperrzonen \(1\)/i)).toBeVisible();
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
    await expect(page.getByTestId("stand-flaechenzahl")).toHaveText("1");

    await page.getByRole("button", { name: /^Fläche 1/ }).click();
    expect(await grundflaeche(page)).toBeCloseTo(vorher, 0);
  });


  test("Die Dachfläche lässt sich als Ganzes verschieben", async ({ page }) => {
    /*
     * Vorher ging nur das Verformen über die Ecken: Wer die
     * Standardform einen Meter neben dem Haus gesetzt hatte, musste
     * vier Ecken einzeln nachziehen — und hatte danach ein anderes
     * Dach.
     */
    await login(page, DEMO.buero);
    const id = await neuesProjekt(page, "Schiebeweg 11");
    await dachSetzen(page, "Pultdach", "12", "8");
    await page.getByRole("button", { name: /^Fläche 1/ }).click();

    const punkte = async () => {
      const { data } = await admin().from("planer_projekt").select("plan").eq("id", id).single();
      const plan = data!.plan as {
        flaechen?: Array<{ punkte: Array<{ x: number; y: number }> }>;
      };
      // Vor dem ersten Sichern gibt es noch keine Fläche — dann leer.
      return plan.flaechen?.[0]?.punkte ?? [];
    };
    await expect.poll(async () => (await punkte()).length, { timeout: 20_000 }).toBe(4);
    const vorher = await punkte();

    const k = (await page.getByTestId("planer-leinwand").boundingBox())!;
    const mitte = { x: k.x + k.width / 2, y: k.y + k.height / 2 };
    await page.mouse.move(mitte.x, mitte.y);
    await page.mouse.down();
    await page.mouse.move(mitte.x + 90, mitte.y + 60, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(1800);

    const nachher = await punkte();
    const um = { x: nachher[0]!.x - vorher[0]!.x, y: nachher[0]!.y - vorher[0]!.y };
    expect(Math.hypot(um.x, um.y), "die Fläche ist gewandert").toBeGreaterThan(1);

    /*
     * Und zwar als Ganzes: Jede Ecke um denselben Betrag. Wäre eine
     * einzelne mitgezogen worden, hätte sich die Form verzogen.
     */
    for (let i = 0; i < 4; i++) {
      expect(nachher[i]!.x - vorher[i]!.x).toBeCloseTo(um.x, 6);
      expect(nachher[i]!.y - vorher[i]!.y).toBeCloseTo(um.y, 6);
    }
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
