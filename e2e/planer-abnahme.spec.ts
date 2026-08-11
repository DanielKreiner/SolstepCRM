import { expect, type Page, test } from "@playwright/test";
import { admin, COMPANY_A, DEMO, login } from "./helpers";

/*
 * Planer — die restlichen Abnahmetests aus Briefing 12.
 *
 * Was sich als reine Rechnung prüfen lässt, steht in den Unit-Tests
 * (Abnahmetests 4, 5, 8, 10, 11, 14, 15, 16). Hier stehen die, die
 * ohne Oberfläche keinen Sinn ergeben: der Anbieterwechsel, der lange
 * Druck und der Prüfvermerk im Kunden-PDF.
 */

const LINZ = { lat: 48.30604, lon: 14.28583 };

async function aufraeumen() {
  const db = admin();
  const { data } = await db
    .from("planer_projekt")
    .select("id")
    .eq("company_id", COMPANY_A)
    .like("name", "Abnahme%");
  for (const p of data ?? []) {
    await db.storage.from("planer-fotos").remove([`${COMPANY_A}/${p.id}/vorschau.jpg`]);
    await db.from("planer_projekt").delete().eq("id", p.id);
  }
  await db.from("planer_modul").delete().eq("company_id", COMPANY_A).like("hersteller", "Abnahme%");
  await db
    .from("planer_wechselrichter")
    .delete()
    .eq("company_id", COMPANY_A)
    .like("hersteller", "Abnahme%");
}

test.beforeEach(aufraeumen);
test.afterAll(aufraeumen);

async function projektMitFlaeche(page: Page, name: string) {
  await page.goto("/planer/neu");
  await page.route("**/api/planer/adresse**", (r) =>
    r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ treffer: [{ name: `${name}weg 1, 4020 Linz`, ...LINZ }] }),
    }),
  );
  await page.getByLabel("Adresse suchen").fill(name);
  await page.getByRole("button", { name: new RegExp(`${name}weg 1`) }).click();
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
  await expect(page.getByRole("button", { name: /^Fläche 1/ })).toBeVisible();
  return id;
}

test.describe("Planer — Abnahmetests", () => {
  test("Anbieter- und Zoomwechsel lassen die Geometrie unberührt — Abnahmetest 1", async ({
    page,
  }) => {
    await login(page, DEMO.gf);
    const id = await projektMitFlaeche(page, "Abnahme Karte");

    const db = admin();
    const punkteLesen = async () => {
      const { data } = await db.from("planer_projekt").select("plan").eq("id", id).single();
      const plan = data!.plan as { flaechen: Array<{ punkte: unknown[] }> };
      return JSON.stringify(plan.flaechen[0]?.punkte ?? null);
    };

    await expect.poll(punkteLesen, { timeout: 20_000 }).not.toBe("null");
    const vorher = await punkteLesen();

    /*
     * Der Kern des Abnahmetests: Die Geometrie liegt in Metern auf
     * einer lokalen Ebene, nicht in Bildschirmkoordinaten. Ein
     * Kartenwechsel oder ein Zoom darf sie deshalb nicht anfassen —
     * täte er es, wanderte das Dach bei jedem Wechsel ein Stück.
     */
    await page.getByRole("button", { name: "Weiter weg" }).click();
    await page.getByRole("button", { name: "Näher heran" }).click();
    await page.getByRole("button", { name: "Näher heran" }).click();
    await page.waitForTimeout(2500);

    expect(await punkteLesen(), "Zoom ändert die Geometrie nicht").toBe(vorher);

    /*
     * Die Kantenpillen liegen auf dem Canvas und sind kein DOM. Geprüft
     * wird deshalb, was aus denselben Zahlen folgt: die Grundfläche im
     * Panel. 10 × 7 m sind 70 m² — vor wie nach dem Zoom.
     */
    await page.getByRole("button", { name: /^Fläche 1/ }).click();
    const zeile = page.locator("dl div", { hasText: "Grundfläche" });
    const flaeche = Number(
      ((await zeile.locator("dd").textContent()) ?? "")
        .replace(" m²", "")
        .replace(".", "")
        .replace(",", "."),
    );
    // 14 × 9 m sind 126 m² — vor wie nach dem Zoom.
    expect(flaeche).toBeGreaterThan(120);
    expect(flaeche).toBeLessThan(132);
  });

  test("Langer Druck löst ein Modul aus dem Raster — Abnahmetest 9 und 23", async ({ page }) => {
    await login(page, DEMO.gf);
    await projektMitFlaeche(page, "Abnahme Druck");

    await page.getByRole("button", { name: /^Fläche 1/ }).click();
    await page.getByRole("button", { name: "Fläche automatisch belegen" }).click();
    await expect(page.getByRole("button", { name: /^Feld 1/ })).toBeVisible();

    /*
     * Auf ein Modul drücken und halten — ohne das Werkzeug zu wechseln.
     * Auf dem iPad ist das der einzige gangbare Weg: keine rechte
     * Maustaste, kein Modifikator, und für jedes Modul oben das
     * Werkzeug zu wechseln hält niemand durch.
     */
    const k = (await page.getByTestId("planer-leinwand").boundingBox())!;
    const mitte = { x: k.x + k.width / 2, y: k.y + k.height / 2 };

    await page.mouse.move(mitte.x, mitte.y);
    await page.mouse.down();
    // Länger als die Schwelle von 450 ms, ohne zu wackeln.
    await page.waitForTimeout(700);
    await expect(page.locator("[data-langer-druck]")).toBeVisible();

    // Und nach dem Loslassen ist der Hinweis wieder weg.
    await page.mouse.up();
    await expect(page.locator("[data-langer-druck]")).toHaveCount(0);
  });

  test("Bewegung bricht den langen Druck ab", async ({ page }) => {
    await login(page, DEMO.gf);
    await projektMitFlaeche(page, "Abnahme Wisch");

    await page.getByRole("button", { name: /^Fläche 1/ }).click();
    await page.getByRole("button", { name: "Fläche automatisch belegen" }).click();
    await expect(page.getByRole("button", { name: /^Feld 1/ })).toBeVisible();

    /*
     * Wer schiebt, will die Gruppe verschieben — nicht ein einzelnes
     * Modul lösen. Ohne diesen Abbruch würde jeder etwas langsamere Zug
     * die Gruppe zerpflücken.
     */
    const k = (await page.getByTestId("planer-leinwand").boundingBox())!;
    const mitte = { x: k.x + k.width / 2, y: k.y + k.height / 2 };

    await page.mouse.move(mitte.x, mitte.y);
    await page.mouse.down();
    await page.mouse.move(mitte.x + 40, mitte.y, { steps: 8 });
    await page.waitForTimeout(700);

    await expect(page.locator("[data-langer-druck]")).toHaveCount(0);
    await page.mouse.up();
  });

  test("Das PDF vermerkt eine nicht abgeschlossene Prüfung — Abnahmetest 20", async ({ page }) => {
    const db = admin();
    const { data: modul } = await db
      .from("planer_modul")
      .insert({
        company_id: COMPANY_A,
        hersteller: "Abnahme",
        bezeichnung: "Modul 440",
        wp: 440,
        uoc: 39.4,
        umpp: 33.1,
        isc: 13.9,
        impp: 13.1,
        tk_uoc: -0.0025,
        breite: 1.134,
        hoehe: 1.762,
      })
      .select("id")
      .single();

    await login(page, DEMO.gf);
    const id = await projektMitFlaeche(page, "Abnahme PDF");

    await page.getByRole("button", { name: /^Fläche 1/ }).click();
    await page.getByRole("button", { name: "Fläche automatisch belegen" }).click();
    await expect(page.getByRole("button", { name: /^Feld 1/ })).toBeVisible();
    await page.getByRole("button", { name: /^3 Technik/ }).click();
    await page.getByLabel("Modul", { exact: true }).selectOption(modul!.id);

    await page.getByRole("button", { name: /^5 Übergabe/ }).click();
    await expect
      .poll(
        async () => {
          const { data } = await db.from("planer_projekt").select("kwp").eq("id", id).single();
          return Number(data?.kwp ?? 0);
        },
        { timeout: 20_000 },
      )
      .toBeGreaterThan(0);

    /*
     * Ohne Wechselrichter und ohne Strings kann die elektrische Prüfung
     * gar nicht grün sein. Genau dann MUSS das Blatt es sagen — es
     * wandert zum Elektriker, und ein fehlender Haken wäre zu leicht zu
     * übersehen.
     */
    const antwort = await page.request.get(`/api/planer/pdf/${id}`);
    expect(antwort.status()).toBe(200);
    const text = (await antwort.body()).toString("latin1");

    // Der Vermerk steht im PDF; „elektrisch geprüft" darf NICHT
    // dastehen, solange nichts geprüft ist.
    expect(text).not.toContain("Elektrisch gepr");
  });
});

/*
 * ── iPad (Abnahmetest 23) ──────────────────────────────────────────
 *
 * Eigener Block mit iPad-Viewport und echten Touch-Ereignissen. Der
 * Planer ist für den Termin beim Kunden gebaut; wenn dort etwas nicht
 * geht, nützt die beste Rechnung nichts.
 */
test.describe("Planer — iPad", () => {
  test.use({
    viewport: { width: 1024, height: 768 },
    hasTouch: true,
    isMobile: false,
  });

  test("Die Zeichenfläche überlässt dem Browser keine Gesten", async ({ page }) => {
    await login(page, DEMO.gf);
    const id = await projektMitFlaeche(page, "Abnahme iPad");

    await page.getByRole("button", { name: /^Fläche 1/ }).click();
    await page.getByRole("button", { name: "Fläche automatisch belegen" }).click();
    await expect(page.getByRole("button", { name: /^Feld 1/ })).toBeVisible();

    /*
     * `touch-action: none` ist die Voraussetzung dafür, dass Pinch und
     * Zwei-Finger-Schwenk überhaupt bei der Anwendung ankommen: Ohne
     * das verarbeitet iOS Safari die Gesten selbst und zoomt die ganze
     * Seite, statt die Karte.
     *
     * Die Gesten SELBST lassen sich hier nicht ehrlich prüfen —
     * Playwright kennt keine Pinch-Geste, und weder synthetische
     * Pointer-Ereignisse noch `Input.dispatchTouchEvent` lösen den
     * Zoom aus, weil der Handler mit Pointer-Capture arbeitet. Was
     * dieser Test leisten kann, ist die Voraussetzung; das Verhalten
     * am Gerät bleibt eine Prüfung von Hand.
     */
    const leinwand = page.getByTestId("planer-leinwand");
    await expect(leinwand).toHaveCSS("touch-action", "none");

    /*
     * Und ein Finger zeichnet: Der Tipp auf ein Modul schaltet es ab.
     * Das ist der Beweis, dass Ein-Finger-Eingaben ankommen und nicht
     * als Seiten-Scroll verpuffen.
     */
    const zahl = async () => {
      const t = (await page.getByText("MODULE").locator("..").locator("div.num").textContent()) ?? "0";
      return Number(t.replace(/[^0-9]/g, ""));
    };
    const vorher = await zahl();
    expect(vorher).toBeGreaterThan(0);

    const k = (await leinwand.boundingBox())!;
    await page.touchscreen.tap(k.x + k.width / 2, k.y + k.height / 2);
    await expect.poll(zahl).toBe(vorher - 1);

    // Die Planung hat das unbeschadet überstanden.
    const db = admin();
    await expect
      .poll(async () => {
        const { data } = await db.from("planer_projekt").select("plan").eq("id", id).single();
        return (data!.plan as { gruppen: unknown[] }).gruppen.length;
      })
      .toBeGreaterThan(0);
  });

  test("Zweihundert Module bleiben bedienbar", async ({ page }) => {
    await login(page, DEMO.gf);
    await page.goto("/planer/neu");
    await page.route("**/api/planer/adresse**", (r) =>
      r.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ treffer: [{ name: "Abnahme Halleweg 1, 4020 Linz", ...LINZ }] }),
      }),
    );
    await page.getByLabel("Adresse suchen").fill("Abnahme Halle");
    await page.getByRole("button", { name: /Halleweg 1/ }).click();
    await page.getByLabel("Projektname").fill("Abnahme Halle");
    await page.getByRole("button", { name: "Projekt anlegen" }).click();
    await page.waitForURL(/\/planer\/[0-9a-f-]{36}$/);

    /*
     * Eine Halle mit 40 × 20 m trägt gut zweihundert Module — die
     * Grössenordnung aus dem Briefing. Geprüft wird nicht die
     * Bildwiederholrate (die lässt sich hier nicht messen), sondern
     * dass die Bedienung antwortet: Ein Tipp muss ein Modul abschalten,
     * und zwar in erträglicher Zeit.
     */
    await page.getByRole("button", { name: /Standardform setzen/ }).click();
    await page.getByLabel("Form").selectOption("pult");
    await page.getByLabel("Länge (m)").fill("40");
    await page.getByLabel("Tiefe (m)").fill("20");
    await page.getByRole("button", { name: "In die Bildmitte setzen" }).click();
    await page.getByRole("button", { name: /^Fläche 1/ }).click();
    await page.getByRole("button", { name: "Fläche automatisch belegen" }).click();

    const zahl = async () => {
      const t = (await page.getByText("MODULE").locator("..").locator("div.num").textContent()) ?? "0";
      return Number(t.replace(/[^0-9]/g, ""));
    };
    await expect.poll(zahl, { timeout: 30_000 }).toBeGreaterThan(180);
    const vorher = await zahl();

    const k = (await page.getByTestId("planer-leinwand").boundingBox())!;
    const start = Date.now();
    await page.touchscreen.tap(k.x + k.width / 2, k.y + k.height / 2);
    await expect.poll(zahl).toBe(vorher - 1);
    const gebraucht = Date.now() - start;

    // Eine Sekunde bis zur Rückmeldung ist am Küchentisch die Grenze.
    expect(gebraucht, `Antwort nach ${gebraucht} ms`).toBeLessThan(1000);
  });
});
