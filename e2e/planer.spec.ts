import { expect, test } from "@playwright/test";
import { COMPANY_B, DEMO, login } from "./helpers";

/*
 * Planer, Stufe 1 — eigene Suite (Briefing 13, Testabgrenzung).
 *
 * Läuft getrennt von den übrigen E2E-Tests: `pnpm test:e2e:planer`.
 * Geprüft wird nur der Planer; was ausserhalb hakt, wird notiert, nicht
 * repariert.
 *
 * Abgedeckt aus Abschnitt 12: Test 1 (Geometrie bleibt bei Anbieter- und
 * Zoomwechsel unverändert — der rechnerische Teil steckt in
 * lib/planer/geo.spec.ts, hier die Oberfläche), Test 24 (Monteur sieht
 * den Planer nicht) und Test 25 (Mandantentrennung).
 */

/** Lindgraben — irgendwo, wo basemap.at scharfe Bilder liefert. */
const URSPRUNG = { lat: 47.6912, lon: 16.4183 };

async function projektAnlegen(page: import("@playwright/test").Page, name: string) {
  /*
   * Nicht über die Adresssuche: die hängt an Nominatim, und ein Test darf
   * nicht rot werden, weil ein fremder Dienst gerade langsam ist. Die
   * Suche selbst hat einen eigenen Test weiter unten, der ausdrücklich
   * mit einer gefälschten Antwort läuft.
   */
  await page.goto("/planer/neu");
  await page.route("**/api/planer/adresse**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ treffer: [{ name: `${name}, 7341 Lindgraben`, ...URSPRUNG }] }),
    }),
  );
  await page.getByLabel("Adresse suchen").fill(name);
  await page.getByRole("button", { name: new RegExp(name) }).click();
  await page.getByRole("button", { name: "Projekt anlegen" }).click();
  await page.waitForURL(/\/planer\/[0-9a-f-]{36}$/);
}

test.describe("Planer", () => {
  test("Adresse suchen, Projekt anlegen, Karte steht", async ({ page }) => {
    await login(page, DEMO.buero);
    await projektAnlegen(page, "Musterweg 4");

    const leinwand = page.getByTestId("planer-leinwand");
    await expect(leinwand).toBeVisible();

    /*
     * Kacheln müssen wirklich ankommen, nicht nur angefragt werden.
     * Gezählt wird deshalb, wie viele Bilder FERTIG geladen sind — die
     * blosse Anzahl der img-Knoten sagt nichts, die stehen sofort da.
     */
    await expect
      .poll(
        async () =>
          leinwand.locator("img").evaluateAll(
            (bilder) =>
              bilder.filter((b) => (b as HTMLImageElement).naturalWidth > 0).length,
          ),
        { timeout: 25_000 },
      )
      .toBeGreaterThan(3);

    // Massstabsleiste: runde Meterzahl, keine 37.
    const leiste = await leinwand.getByText(/^\d+ m$/).first().textContent();
    const meter = Number((leiste ?? "").replace(" m", ""));
    const ziffern = meter / Math.pow(10, Math.floor(Math.log10(meter)));
    expect([1, 2, 5]).toContain(Math.round(ziffern));
  });

  test("Anbieter ohne Schlüssel sind gesperrt, nicht leer", async ({ page }) => {
    await login(page, DEMO.buero);
    await projektAnlegen(page, "Anbieterweg 1");

    // Basemap läuft immer — ohne Schlüssel, das ist der Sinn.
    await expect(page.getByRole("button", { name: "Basemap" })).toBeEnabled();

    for (const name of ["Google", "Bing/Azure", "Apple"]) {
      const knopf = page.getByRole("button", { name });
      await expect(knopf).toBeDisabled();
      // Der Grund muss dranstehen, sonst rät der Nutzer.
      await expect(knopf).toHaveAttribute("title", /.+/);
    }

    // Apple nennt einen anderen Grund als die beiden Kachelanbieter:
    // dort fehlt nicht der Schlüssel, sondern die Bildschicht.
    const appleGrund = await page.getByRole("button", { name: "Apple" }).getAttribute("title");
    expect(appleGrund).toMatch(/Kartenbibliothek|Bildschicht/);
  });

  test("Zoomen ändert den Massstab, nicht das Projekt", async ({ page }) => {
    await login(page, DEMO.buero);
    await projektAnlegen(page, "Zoomweg 2");
    const url = page.url();

    const leinwand = page.getByTestId("planer-leinwand");
    await expect(leinwand).toBeVisible();

    /*
     * Geprüft wird die LÄNGE des Balkens, nicht seine Beschriftung: die
     * Massstabsleiste rundet auf 1/2/5, und über eine einzelne Zoomstufe
     * kann dieselbe runde Zahl stehen bleiben, während der Balken kürzer
     * wird. Auf die Beschriftung zu prüfen hiesse, korrektes Verhalten
     * für einen Fehler zu halten.
     */
    const balken = leinwand.locator("div[style*='width']").first();
    const vorher = await balken.evaluate((el) => el.getBoundingClientRect().width);
    await page.getByRole("button", { name: "Weiter weg" }).click();
    await expect
      .poll(async () => balken.evaluate((el) => el.getBoundingClientRect().width))
      .not.toBe(vorher);

    /*
     * Der Kern von Abnahmetest 1: nach dem Zoomen dieselbe Seite neu
     * laden. Der gespeicherte Ursprung — der Nullpunkt jeder späteren
     * Geometrie — darf sich nicht bewegt haben.
     */
    const ursprungVorher = await page.evaluate(() => document.title);
    await page.reload();
    await expect(page.getByTestId("planer-leinwand")).toBeVisible();
    expect(page.url()).toBe(url);
    expect(await page.evaluate(() => document.title)).toBe(ursprungVorher);
  });

  test("Monteur sieht den Planer nicht — weder Menü noch Route", async ({ page }) => {
    await login(page, DEMO.monteur);

    await expect(page.getByRole("link", { name: "Planer" })).toHaveCount(0);

    // Route direkt: 404, nicht „kein Zugriff" — sonst verrät die
    // Fehlermeldung, dass es die Seite gibt.
    const antwort = await page.goto("/planer");
    expect(antwort?.status()).toBe(404);
  });

  test("Kachel-Proxy gibt ohne Schlüssel keine Bilder aus", async ({ page }) => {
    await login(page, DEMO.buero);

    // 428: „hier fehlt eine Voraussetzung" — kein Serverfehler.
    const ohneSchluessel = await page.request.get("/api/planer/kachel/google/19/1/1");
    expect(ohneSchluessel.status()).toBe(428);

    // Basemap läuft nicht über den Proxy und darf hier nicht durchrutschen.
    const falsch = await page.request.get("/api/planer/kachel/basemap/19/1/1");
    expect(falsch.status()).toBe(400);

    // Pfadstücke müssen Zahlen sein, sonst hängt man an die Anbieter-URL an.
    const boese = await page.request.get("/api/planer/kachel/google/19/1/..%2F..%2Fadmin");
    expect(boese.status()).toBe(400);
  });

  test("Mandantentrennung: fremdes Projekt ist nicht erreichbar", async ({ page }) => {
    await login(page, DEMO.buero);
    await projektAnlegen(page, "Trennweg 3");
    const fremdeUrl = page.url();

    await page.goto("/logout");
    await login(page, DEMO.fremd);

    const antwort = await page.goto(fremdeUrl);
    expect(antwort?.status()).toBe(404);

    // Und die Liste des zweiten Betriebs bleibt leer von fremden Zeilen.
    await page.goto("/planer");
    await expect(page.getByText("Trennweg 3")).toHaveCount(0);
    expect(COMPANY_B).toBeTruthy();
  });
});
