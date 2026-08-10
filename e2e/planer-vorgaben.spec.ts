import { expect, test } from "@playwright/test";
import { admin, COMPANY_A, DEMO, login } from "./helpers";

/*
 * Planer — Rechenvorgaben und Fördersätze (Briefing 7).
 *
 * Was hier eingestellt wird, steht im nächsten Kundengespräch als
 * Vorbelegung auf dem Bildschirm. Der Test geht deshalb beide Wege:
 * einstellen — und nachsehen, ob es im Planer wirklich ankommt.
 */

test.beforeEach(async () => {
  await admin().from("planer_foerderung").delete().eq("company_id", COMPANY_A).like("region", "Prüfregion%");
});

/*
 * Die Vorgaben wieder auf den Seed-Stand bringen. Diese Tests stellen
 * Strompreis und Preisstaffel um — bliebe das stehen, hätte der
 * Demomandant danach dauerhaft einen 42-Cent-Strompreis und eine
 * einstufige Staffel, und wer die Anwendung ansieht, hielte das für die
 * Vorbelegung der Anwendung.
 */
test.afterAll(async () => {
  await admin()
    .from("planer_wirtschaft_vorgabe")
    .update({
      verlust_prozent: 14,
      steigerung: 0.02,
      strompreis: 0.28,
      verguetung: 0.08,
      speicher_eur_pro_kwh: 450,
      preisstaffel: [
        { ab_kwp: 0, eur_pro_kwp: 1750 },
        { ab_kwp: 10, eur_pro_kwp: 1450 },
        { ab_kwp: 20, eur_pro_kwp: 1250 },
        { ab_kwp: 30, eur_pro_kwp: 1100 },
      ],
    })
    .eq("company_id", COMPANY_A);
  await admin().from("planer_foerderung").delete().eq("company_id", COMPANY_A).like("region", "Prüfregion%");
});

/*
 * Auf der Einstellungsseite stehen mehrere Formulare nebeneinander.
 * „Speichern" und „Hinweis" gibt es deshalb mehrfach — jeder Zugriff
 * wird auf sein Formular eingegrenzt.
 */
function rechenform(page: import("@playwright/test").Page) {
  return page.locator("form").filter({ has: page.getByLabel(/^Systemverlust /) });
}

function foerderform(page: import("@playwright/test").Page) {
  return page.locator("form").filter({ has: page.getByLabel("Region") });
}

test.describe("Planer — Vorgaben", () => {
  test("Rechenvorgaben speichern und im Planer wiederfinden", async ({ page }) => {
    await login(page, DEMO.gf);
    await page.goto("/einstellungen?bereich=planer");

    await page.getByLabel(/^Strompreis /).fill("0.42");
    await page.getByLabel(/^Einspeisevergütung /).fill("0.05");
    await page.getByLabel(/^Systemverlust /).fill("12");
    await rechenform(page).getByRole("button", { name: "Rechenvorgaben speichern" }).click();
    await expect(page.getByText("Rechenvorgaben gespeichert.")).toBeVisible();

    // Neu laden: die Werte müssen stehenbleiben, nicht auf Standard zurück.
    await page.reload();
    await expect(page.getByLabel(/^Strompreis /)).toHaveValue("0.42");
    await expect(page.getByLabel(/^Systemverlust /)).toHaveValue("12");

    /*
     * Und jetzt der eigentliche Punkt: Der Planer muss mit genau diesen
     * Zahlen anfangen. Eine Einstellung, die nirgends ankommt, ist
     * schlimmer als keine — man verlässt sich darauf.
     */
    await page.goto("/planer/neu");
    await page.route("**/api/planer/adresse**", (r) =>
      r.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ treffer: [{ name: "Vorgabeweg 1, 4020 Linz", lat: 48.30604, lon: 14.28583 }] }),
      }),
    );
    await page.getByLabel("Adresse suchen").fill("Vorgabeweg 1");
    await page.getByRole("button", { name: /Vorgabeweg 1/ }).click();
    await page.getByRole("button", { name: "Projekt anlegen" }).click();
    await page.waitForURL(/\/planer\/[0-9a-f-]{36}$/);
    await page.getByRole("button", { name: /^4 Ertrag/ }).click();

    await expect(page.getByLabel("Strompreis")).toHaveValue("0.42");
    await expect(page.getByLabel("Einspeisung")).toHaveValue("0.05");
  });

  test("Preisstaffel bestimmt den vorgeschlagenen Anlagenpreis", async ({ page }) => {
    await login(page, DEMO.gf);
    await page.goto("/einstellungen?bereich=planer");

    // Eine Stufe mit rundem Preis, damit der Vorschlag nachrechenbar ist.
    await page.getByLabel("Untergrenze Stufe 1 (kWp)").fill("0");
    await page.getByLabel("Preis Stufe 1 (€/kWp)").fill("2000");
    await rechenform(page).getByRole("button", { name: "Rechenvorgaben speichern" }).click();
    await expect(page.getByText("Rechenvorgaben gespeichert.")).toBeVisible();

    await page.goto("/planer/neu");
    await page.route("**/api/planer/adresse**", (r) =>
      r.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ treffer: [{ name: "Staffelweg 2, 4020 Linz", lat: 48.30604, lon: 14.28583 }] }),
      }),
    );
    await page.getByLabel("Adresse suchen").fill("Staffelweg 2");
    await page.getByRole("button", { name: /Staffelweg 2/ }).click();
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

    // kWp aus der Kennzahlenleiste ablesen und gegenrechnen.
    const kwpText = (await page.getByText("KWP").locator("..").locator("div.num").textContent()) ?? "";
    const kwp = Number(kwpText.replace(",", "."));
    expect(kwp).toBeGreaterThan(0);

    await page.getByRole("button", { name: /^4 Ertrag/ }).click();
    const preis = Number(await page.getByLabel("Anlagenpreis").inputValue());
    expect(preis).toBe(Math.round(kwp * 2000));
  });

  test("Fördersatz anlegen, im Planer wählen, wieder entfernen", async ({ page }) => {
    await login(page, DEMO.gf);
    await page.goto("/einstellungen?bereich=planer");

    const form = foerderform(page);
    await form.getByLabel("Region").fill("Prüfregion Nord");
    await form.getByLabel("Betrag (€)").fill("2500");
    await form.getByLabel("Hinweis").fill("Stand 08/2026, vor dem Angebot prüfen");
    await form.getByRole("button", { name: "Fördersatz eintragen" }).click();
    await expect(page.getByText("Prüfregion Nord gespeichert.")).toBeVisible();

    await page.goto("/planer/neu");
    await page.route("**/api/planer/adresse**", (r) =>
      r.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ treffer: [{ name: "Förderweg 3, 4020 Linz", lat: 48.30604, lon: 14.28583 }] }),
      }),
    );
    await page.getByLabel("Adresse suchen").fill("Förderweg 3");
    await page.getByRole("button", { name: /Förderweg 3/ }).click();
    await page.getByRole("button", { name: "Projekt anlegen" }).click();
    await page.waitForURL(/\/planer\/[0-9a-f-]{36}$/);
    await page.getByRole("button", { name: /^4 Ertrag/ }).click();

    // Vor der Wahl steht keine Förderung an.
    await expect(page.getByLabel("Förderung")).toHaveValue("0");
    await page.getByRole("button", { name: "Prüfregion Nord" }).click();
    await expect(page.getByLabel("Förderung")).toHaveValue("2500");
    await expect(page.getByText("Stand 08/2026, vor dem Angebot prüfen")).toBeVisible();

    await page.goto("/einstellungen?bereich=planer");
    await page
      .locator("li", { hasText: "Prüfregion Nord" })
      .getByRole("button", { name: "entfernen" })
      .click();
    await expect(page.getByText("Prüfregion Nord entfernt.")).toBeVisible();
  });

  test("Ein getippter Förderbetrag bleibt beim Regionswechsel stehen (Abnahmetest 19)", async ({
    page,
  }) => {
    const db = admin();
    await db.from("planer_foerderung").insert([
      { company_id: COMPANY_A, region: "Prüfregion A", betrag: 1000, hinweis: null },
      { company_id: COMPANY_A, region: "Prüfregion B", betrag: 3000, hinweis: null },
    ]);

    await login(page, DEMO.gf);
    await page.goto("/planer/neu");
    await page.route("**/api/planer/adresse**", (r) =>
      r.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ treffer: [{ name: "Wechselweg 4, 4020 Linz", lat: 48.30604, lon: 14.28583 }] }),
      }),
    );
    await page.getByLabel("Adresse suchen").fill("Wechselweg 4");
    await page.getByRole("button", { name: /Wechselweg 4/ }).click();
    await page.getByRole("button", { name: "Projekt anlegen" }).click();
    await page.waitForURL(/\/planer\/[0-9a-f-]{36}$/);
    await page.getByRole("button", { name: /^4 Ertrag/ }).click();

    await page.getByRole("button", { name: "Prüfregion A" }).click();
    await expect(page.getByLabel("Förderung")).toHaveValue("1000");

    // Von Hand überschreiben.
    await page.getByLabel("Förderung").fill("1750");

    /*
     * Jetzt die Region wechseln. Der eingetippte Betrag muss stehen
     * bleiben — er kam vom Kunden, nicht aus der Tabelle. Ein Hinweis
     * sagt, was für die neue Region hinterlegt wäre.
     */
    await page.getByRole("button", { name: "Prüfregion B" }).click();
    await expect(page.getByLabel("Förderung")).toHaveValue("1750");
    await expect(page.getByText(/Für Prüfregion B hinterlegt/)).toBeVisible();

    // Und ein Klick auf den Hinweis übernimmt ihn doch.
    await page.getByRole("button", { name: "3 000 €" }).click();
    await expect(page.getByLabel("Förderung")).toHaveValue("3000");
  });
});
