import { expect, test } from "@playwright/test";
import { admin, COMPANY_A, DEMO, login } from "./helpers";

/*
 * Planer, Stufe 4 — Stammdaten pflegen (Briefing 5.1).
 *
 * Der Kern hier ist die Umrechnung des Temperaturkoeffizienten: das
 * Datenblatt nennt %/K, gerechnet wird mit dem Faktor je Kelvin. Ein
 * Faktor 100 daneben ergäbe Strings, die im Winter den Wechselrichter
 * überspannen — und niemand würde es merken.
 */

/*
 * Aufräumen vor jedem Test: die Stammdaten sind dauerhaft, und ohne
 * dieses Aufräumen sammelten sich mit jedem Lauf weitere gleichnamige
 * Geräte an — bis die Prüfungen an mehrdeutigen Treffern scheitern.
 */
test.beforeEach(async () => {
  const db = admin();
  for (const tabelle of ["planer_speicher", "planer_wechselrichter", "planer_modul"]) {
    await db.from(tabelle).delete().eq("company_id", COMPANY_A).like("hersteller", "Prüf%");
  }
});

test.describe("Planer — Stammdaten", () => {
  test("Modul anlegen, Temperaturkoeffizient wird richtig umgerechnet", async ({ page }) => {
    await login(page, DEMO.gf);
    await page.goto("/einstellungen?bereich=planer");
    await expect(page.getByRole("heading", { name: "Planer-Stammdaten" })).toBeVisible();

    await page.getByLabel("Hersteller").fill("Prüfhersteller");
    await page.getByLabel("Bezeichnung").fill("Testmodul 440");
    await page.getByLabel("Nennleistung (Wp)").fill("440");
    await page.getByLabel("Uoc (V)").fill("39,4");
    await page.getByLabel("Umpp (V)").fill("33,1");
    await page.getByLabel("Isc (A)").fill("13,9");
    await page.getByLabel("Impp (A)").fill("13,1");
    await page.getByLabel("Temp.-Koeff. Uoc (%/K)").fill("-0,25");
    await page.getByLabel("Breite (m)").fill("1,134");
    await page.getByLabel("Höhe (m)").fill("1,762");
    await page.getByRole("button", { name: "Hinzufügen" }).click();

    await expect(page.getByText(/Prüfhersteller Testmodul 440 gespeichert/)).toBeVisible();
    // In der Liste steht der Koeffizient wieder als %/K — nicht als 0,0025.
    await expect(page.getByText(/-0,250 %\/K/)).toBeVisible();
    await expect(page.getByText(/Uoc 39,4 V/)).toBeVisible();
  });

  test("Widersprüchliche Spannungen werden im Klartext abgelehnt", async ({ page }) => {
    await login(page, DEMO.gf);
    await page.goto("/einstellungen?bereich=planer");

    await page.getByLabel("Hersteller").fill("Prüfhersteller");
    await page.getByLabel("Bezeichnung").fill("Unsinn");
    await page.getByLabel("Nennleistung (Wp)").fill("400");
    // Umpp über Uoc — das gibt es nicht.
    await page.getByLabel("Uoc (V)").fill("30");
    await page.getByLabel("Umpp (V)").fill("35");
    await page.getByLabel("Isc (A)").fill("13");
    await page.getByLabel("Impp (A)").fill("12");
    await page.getByLabel("Temp.-Koeff. Uoc (%/K)").fill("-0,25");
    await page.getByLabel("Breite (m)").fill("1,1");
    await page.getByLabel("Höhe (m)").fill("1,7");
    await page.getByRole("button", { name: "Hinzufügen" }).click();

    await expect(page.getByText(/muss über der MPP-Spannung/)).toBeVisible();
  });

  test("Positiver Temperaturkoeffizient wird abgelehnt", async ({ page }) => {
    await login(page, DEMO.gf);
    await page.goto("/einstellungen?bereich=planer");

    await page.getByLabel("Hersteller").fill("Prüfhersteller");
    await page.getByLabel("Bezeichnung").fill("Vorzeichen");
    await page.getByLabel("Nennleistung (Wp)").fill("400");
    await page.getByLabel("Uoc (V)").fill("39");
    await page.getByLabel("Umpp (V)").fill("33");
    await page.getByLabel("Isc (A)").fill("13");
    await page.getByLabel("Impp (A)").fill("12");
    /*
     * Mit positivem Vorzeichen rechnete die Prüfung die Winterspannung
     * nach UNTEN und liesse zu lange Strings durch. Genau deshalb steht
     * die Grenze schon im Formular.
     */
    await page.getByLabel("Temp.-Koeff. Uoc (%/K)").fill("0,25");
    await page.getByLabel("Breite (m)").fill("1,1");
    await page.getByLabel("Höhe (m)").fill("1,7");
    await page.getByRole("button", { name: "Hinzufügen" }).click();

    await expect(page.getByText(/tkProzent|Too big|kleiner/i)).toBeVisible();
  });

  test("Wechselrichter mit zwei MPP-Trackern anlegen", async ({ page }) => {
    await login(page, DEMO.gf);
    await page.goto("/einstellungen?bereich=planer");
    await page.getByRole("button", { name: /^Wechselrichter \(/ }).click();

    await page.getByLabel("Hersteller").fill("Prüfhersteller");
    await page.getByLabel("Bezeichnung").fill("Test 10.0");
    await page.getByLabel("Max. DC-Spannung (V)").fill("1000");
    await page.getByLabel("AC-Nennleistung (kW)").fill("10");

    // Zweiten Tracker anlegen und anders belegen.
    await page.getByRole("button", { name: "+ Tracker" }).click();
    await expect(page.getByLabel("MPP von (V)")).toHaveCount(2);
    await page.getByLabel("MPP von (V)").nth(1).fill("160");
    await page.getByLabel("MPP bis (V)").nth(1).fill("900");

    await page.getByRole("button", { name: "Hinzufügen" }).click();
    await expect(page.getByText(/Test 10.0 gespeichert/)).toBeVisible();
    await expect(page.getByText(/2 MPPT/)).toBeVisible();
  });

  test("MPP-Fenster verkehrt herum wird abgelehnt", async ({ page }) => {
    await login(page, DEMO.gf);
    await page.goto("/einstellungen?bereich=planer");
    await page.getByRole("button", { name: /^Wechselrichter \(/ }).click();

    await page.getByLabel("Hersteller").fill("Prüfhersteller");
    await page.getByLabel("Bezeichnung").fill("Verkehrt");
    await page.getByLabel("Max. DC-Spannung (V)").fill("1000");
    await page.getByLabel("AC-Nennleistung (kW)").fill("10");
    await page.getByLabel("MPP von (V)").fill("800");
    await page.getByLabel("MPP bis (V)").fill("200");
    await page.getByRole("button", { name: "Hinzufügen" }).click();

    await expect(page.getByText(/untere Fenstergrenze muss unter der oberen/)).toBeVisible();
  });

  test("Speicher lässt sich einem Wechselrichter zuordnen", async ({ page }) => {
    await login(page, DEMO.gf);
    await page.goto("/einstellungen?bereich=planer");

    /*
     * Erst einen Wechselrichter anlegen: jeder Test räumt vorher auf,
     * also gibt es sonst nichts, dem der Speicher zugeordnet werden
     * könnte. Genau das ist auch der Zustand eines frischen Mandanten.
     */
    await page.getByRole("button", { name: /^Wechselrichter \(/ }).click();
    await page.getByRole("textbox", { name: "Hersteller" }).fill("Prüfhersteller");
    await page.getByLabel("Bezeichnung").fill("Speicher-WR");
    await page.getByLabel("Max. DC-Spannung (V)").fill("1000");
    await page.getByLabel("AC-Nennleistung (kW)").fill("10");
    await page.getByRole("button", { name: "Hinzufügen" }).click();
    await expect(page.getByText(/Speicher-WR gespeichert/)).toBeVisible();

    await page.getByRole("button", { name: /^Speicher \(/ }).click();
    await page.getByRole("textbox", { name: "Hersteller" }).fill("Prüfhersteller");
    await page.getByLabel("Bezeichnung").fill("Testspeicher 10");
    await page.getByLabel("Nutzbar (kWh)").fill("10");
    await page.getByLabel("Modulgrösse (kWh)").fill("5");

    // Der zuvor angelegte Wechselrichter muss zur Auswahl stehen.
    const wahl = page.getByRole("checkbox", { name: /Prüfhersteller/ }).first();
    await expect(wahl).toBeVisible();
    await wahl.check();

    await page.getByRole("button", { name: "Hinzufügen" }).click();
    await expect(page.getByText(/Testspeicher 10 gespeichert/)).toBeVisible();
    await expect(page.getByText(/1 WR/)).toBeVisible();
  });
});
