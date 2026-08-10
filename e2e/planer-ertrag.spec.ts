import { expect, type Page, test } from "@playwright/test";
import { admin, COMPANY_A, DEMO, login } from "./helpers";

/*
 * Planer, Stufe 5 — Ertrag und Wirtschaftlichkeit
 * (Briefing 6 und 7, Abnahmetests 17 bis 19).
 *
 * Die Formeln selbst sind in lib/planer/wirtschaft.spec.ts von Hand
 * nachgerechnet und in lib/planer/ertrag.spec.ts gegen echte
 * PVGIS-Abfragen gehalten. Hier geht es darum, dass dieselben Zahlen
 * auch wirklich aus der Oberfläche kommen — und dass der Planer
 * weiterläuft, wenn PVGIS nicht antwortet.
 */

const LINZ = { lat: 48.30604, lon: 14.28583 };

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
  await page.getByRole("button", { name: "Projekt anlegen" }).click();
  await page.waitForURL(/\/planer\/[0-9a-f-]{36}$/);
  await page.getByRole("button", { name: "Näher heran" }).click();
  await page.getByRole("button", { name: "Näher heran" }).click();

  await page.getByRole("button", { name: /Standardform setzen/ }).click();
  await page.getByLabel("Länge (m)").fill("12");
  await page.getByLabel("Tiefe (m)").fill("8");
  await page.getByRole("button", { name: "In die Bildmitte setzen" }).click();
  await page.getByRole("button", { name: /^Fläche 1/ }).click();
  await page.getByRole("button", { name: "Fläche automatisch belegen" }).click();
  await expect(page.getByRole("button", { name: /^Feld 1/ })).toBeVisible();
}

/** Zahl aus einem Text wie „~1 438 €" oder „9,6 Jahre". */
function zahl(text: string | null): number {
  if (!text) return NaN;
  const treffer = text.replace(/[  \s]/g, "").match(/-?\d+(?:,\d+)?/);
  return treffer ? Number(treffer[0].replace(",", ".")) : NaN;
}

/*
 * Die drei Kernzahlen tragen ein `data-kennzahl`. Sie über ihre
 * Überschrift zu suchen war zu wackelig — „Ersparnis" steht auch im
 * Kurventitel, und ein Regex auf die ganze Kachel las die falsche Zahl.
 */
async function kennzahl(page: Page, name: "amortisation" | "ersparnis" | "autarkie"): Promise<number> {
  const feld = page.locator(`[data-kennzahl="${name}"]`);
  if ((await feld.count()) === 0) return NaN;
  return zahl(await feld.first().textContent());
}

async function zurWirtschaftlichkeit(page: Page) {
  await page.getByRole("button", { name: /^4 Ertrag/ }).click();
  await expect(page.getByRole("heading", { name: /Was die Anlage/ })).toBeVisible();
  // Auf den ersten Ertragswert warten (Debounce 800 ms plus Abruf).
  await expect
    .poll(async () => kennzahl(page, "ersparnis"), { timeout: 30_000 })
    .toBeGreaterThan(0);
}

/*
 * Die Geräte dieses Laufs wieder abräumen. Sie bleiben sonst in den
 * Stammdaten stehen und stören Tests, die dort etwas zählen — genau das
 * ist beim ersten Durchlauf passiert.
 */
test.afterAll(async () => {
  const db = admin();
  for (const tabelle of ["planer_speicher", "planer_wechselrichter"]) {
    await db.from(tabelle).delete().eq("company_id", COMPANY_A).like("hersteller", "Ertragstest%");
  }
});

test.describe("Planer — Ertrag und Wirtschaftlichkeit", () => {
  test("PVGIS-Wert kommt an, zweiter Aufruf aus dem Cache (Abnahmetest 17)", async ({ page }) => {
    await login(page, DEMO.gf);

    /*
     * Die Antworten des Route Handlers mitschneiden. Beim ersten Mal
     * kann der Wert schon im gemeinsamen Cache liegen — deshalb wird
     * nicht geprüft, dass der ERSTE Aufruf frisch ist, sondern dass ein
     * zweiter identischer Aufruf aus dem Cache kommt.
     */
    const antworten: Array<{ cache: boolean; quelle: string; spezifisch: number }> = [];
    page.on("response", async (r) => {
      if (!r.url().includes("/api/planer/ertrag")) return;
      try {
        antworten.push(await r.json());
      } catch {
        /* Antwort ohne JSON interessiert hier nicht. */
      }
    });

    await projektMitBelegung(page, "Sonnenweg 1");
    await zurWirtschaftlichkeit(page);

    expect(antworten.length, "Ertrag wurde abgefragt").toBeGreaterThan(0);
    const erste = antworten[0]!;
    // Ein Dach in Oberösterreich liegt zwischen 400 und 1.400 kWh/kWp.
    expect(erste.spezifisch).toBeGreaterThan(400);
    expect(erste.spezifisch).toBeLessThan(1400);

    // Neu laden fragt dieselbe Ausrichtung erneut — jetzt muss der Cache greifen.
    antworten.length = 0;
    await page.reload();
    await zurWirtschaftlichkeit(page);

    expect(antworten.length).toBeGreaterThan(0);
    expect(antworten.every((a) => a.cache === true), "zweiter Abruf aus dem Cache").toBe(true);
  });

  test("Der Server nimmt den Fallback, wenn PVGIS nichts liefert (Abnahmetest 17)", async ({
    page,
  }) => {
    await login(page, DEMO.gf);

    /*
     * Ein echter Ausfall, nicht nachgestellt: PVGIS antwortet für einen
     * Punkt im Pazifik mit „Location over the sea" und HTTP 400. Genau
     * dieser Pfad muss im Route Handler zum Fallback führen — und nicht
     * zu einem Fehler, der den Planer stehenlässt.
     *
     * Warum nicht einfach die PVGIS-Adresse im Browser blockieren: der
     * Aufruf läuft serverseitig. `page.route` sieht ihn gar nicht. Der
     * erste Anlauf dieses Tests hat genau das übersehen und deshalb
     * fälschlich einen gecachten Wert geprüft.
     */
    const antwort = await page.request.get(
      "/api/planer/ertrag?lat=0&lon=-140&azimut=180&neigung=30&verlust=14",
    );
    expect(antwort.status(), "kein Fehler trotz PVGIS-Absage").toBe(200);
    const daten = (await antwort.json()) as { quelle: string; spezifisch: number; monate: number[] };
    expect(daten.quelle).toBe("geschaetzt");
    expect(daten.spezifisch).toBeGreaterThan(0);
    expect(daten.monate).toHaveLength(12);
  });

  test("Ein geschätzter Ertrag wird als solcher ausgewiesen (Abnahmetest 17)", async ({ page }) => {
    await login(page, DEMO.gf);

    /*
     * Hier geht es um die Anzeige: Ein Schätzwert darf nie wie ein
     * Messwert aussehen. Die Antwort des eigenen Route Handlers wird
     * deshalb auf „geschaetzt" gesetzt — dass der Server diesen Fall
     * überhaupt richtig erzeugt, prüft der Test darüber.
     */
    await page.route("**/api/planer/ertrag**", (r) =>
      r.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          spezifisch: 980,
          monate: Array.from({ length: 12 }, () => 980 / 12),
          quelle: "geschaetzt",
          cache: false,
        }),
      }),
    );

    await projektMitBelegung(page, "Ausfallweg 2");
    await page.getByRole("button", { name: /^4 Ertrag/ }).click();

    await expect(page.getByText("Ertrag geschätzt")).toBeVisible({ timeout: 30_000 });
    // Und die Rechnung steht trotzdem da — der Planer bleibt benutzbar.
    expect(await kennzahl(page, "ersparnis")).toBeGreaterThan(0);
    await expect(page.getByText(/Break-even|jenseits von 20 Jahren/)).toBeVisible();
  });

  test("Speicher-Toggle verändert alles konsistent (Abnahmetest 18)", async ({ page }) => {
    await login(page, DEMO.gf);

    /*
     * Ein Hybridgerät mit Speicher anlegen — ohne Speicher gibt es
     * keinen Umschalter, und der Test hätte nichts zu prüfen.
     */
    const db = admin();
    await db.from("planer_speicher").delete().eq("company_id", COMPANY_A).like("hersteller", "Ertragstest%");
    await db.from("planer_wechselrichter").delete().eq("company_id", COMPANY_A).like("hersteller", "Ertragstest%");
    const { data: wr } = await db
      .from("planer_wechselrichter")
      .insert({
        company_id: COMPANY_A,
        hersteller: "Ertragstest",
        bezeichnung: "Hybrid 10",
        max_dc: 1000,
        ac_nenn: 10,
        hybrid: true,
        mppt: [{ uMin: 200, uMax: 800, iMax: 26, maxStrings: 2 }],
      })
      .select("id")
      .single();
    await db.from("planer_speicher").insert({
      company_id: COMPANY_A,
      hersteller: "Ertragstest",
      bezeichnung: "Akku 10",
      nutzbar_kwh: 10,
      kompatibel: [wr!.id],
    });

    await projektMitBelegung(page, "Speicherweg 3");

    await page.getByRole("button", { name: /^3 Technik/ }).click();
    const wahl = page.getByLabel("Wechselrichter", { exact: true });
    await wahl.selectOption(wr!.id);
    const speicherWahl = page.getByLabel("Speicher", { exact: true });
    const speicherWert = await speicherWahl
      .locator("option", { hasText: "Akku 10" })
      .first()
      .getAttribute("value");
    await speicherWahl.selectOption(speicherWert!);

    await zurWirtschaftlichkeit(page);

    const ohne = {
      autarkie: await kennzahl(page, "autarkie"),
      ersparnis: await kennzahl(page, "ersparnis"),
      preis: Number(await page.getByLabel("Anlagenpreis").inputValue()),
    };

    await page.getByRole("button", { name: /^mit Speicher/ }).click();
    await expect.poll(async () => Number(await page.getByLabel("Anlagenpreis").inputValue()))
      .toBeGreaterThan(ohne.preis);

    const mit = {
      autarkie: await kennzahl(page, "autarkie"),
      ersparnis: await kennzahl(page, "ersparnis"),
    };

    /*
     * Der Speicher hebt Autarkie und Ersparnis — und den Preis. Genau
     * diese drei zusammen machen den Umschalter ehrlich: wer nur die
     * Autarkie steigen lässt, verkauft einen Speicher, der sich nie
     * rechnet.
     */
    expect(mit.autarkie).toBeGreaterThan(ohne.autarkie);
    expect(mit.ersparnis).toBeGreaterThan(ohne.ersparnis);
  });

  test("Eingaben wirken auf die Rechnung und überstehen das Neuladen", async ({ page }) => {
    await login(page, DEMO.gf);
    await projektMitBelegung(page, "Rechenweg 4");
    await zurWirtschaftlichkeit(page);

    const vorher = await kennzahl(page, "ersparnis");

    // Höherer Strompreis heisst mehr Ersparnis — sonst rechnet da nichts.
    await page.getByLabel("Strompreis").fill("0.45");
    await expect.poll(async () => kennzahl(page, "ersparnis")).toBeGreaterThan(vorher);

    // Ein Chip setzt den Verbrauch und damit die Autarkie.
    await page.getByRole("button", { name: "4 Personen" }).click();
    await page.getByRole("button", { name: "+ Wärmepumpe" }).click();
    await expect(page.getByText("8 000 kWh")).toBeVisible();

    /*
     * Nicht auf „gesichert" warten: Der Stand steht schon vom
     * vorherigen Speichern auf „gesichert" und sagt nichts darüber, ob
     * DIESE Änderung durch ist. Der Test war damit im Einzellauf grün
     * und in der Suite rot — die klassische Form eines Rennens.
     *
     * Stattdessen wird gewartet, bis der Wert tatsächlich im
     * gespeicherten Plan steht.
     */
    const projektId = page.url().split("/").pop()!;
    await expect
      .poll(
        async () => {
          const { data } = await admin()
            .from("planer_projekt")
            .select("plan")
            .eq("id", projektId)
            .maybeSingle();
          const plan = data?.plan as { wirtschaft?: { strompreis?: number; verbrauchKwh?: number } } | null;
          return plan?.wirtschaft?.strompreis ?? null;
        },
        { timeout: 20_000 },
      )
      .toBe(0.45);

    await page.reload();
    await page.getByRole("button", { name: /^4 Ertrag/ }).click();

    await expect(page.getByLabel("Strompreis")).toHaveValue("0.45");
    await expect(page.getByText("8 000 kWh")).toBeVisible();
  });

  test("Ohne Module steht dort ein Satz statt einer erfundenen Zahl", async ({ page }) => {
    await login(page, DEMO.gf);
    await page.goto("/planer/neu");
    await page.route("**/api/planer/adresse**", (r) =>
      r.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ treffer: [{ name: "Leerweg 5, 4020 Linz", ...LINZ }] }),
      }),
    );
    await page.getByLabel("Adresse suchen").fill("Leerweg 5");
    await page.getByRole("button", { name: /Leerweg 5/ }).click();
    await page.getByRole("button", { name: "Projekt anlegen" }).click();
    await page.waitForURL(/\/planer\/[0-9a-f-]{36}$/);

    await page.getByRole("button", { name: /^4 Ertrag/ }).click();
    await expect(page.getByText(/Noch keine Module belegt/)).toBeVisible();
  });
});
