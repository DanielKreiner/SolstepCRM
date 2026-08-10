import { expect, type Page, test } from "@playwright/test";
import { DEMO, login } from "./helpers";

/*
 * Planer — Übernahme aus dem Lager (Briefing 5.1, 8.2).
 *
 * Die Geräte für die Auslegung stehen längst im Artikelstamm. Sie von
 * Hand ein zweites Mal einzutippen wäre nicht nur Arbeit, sondern eine
 * Fehlerquelle: zwei Wahrheiten über dieselbe Uoc.
 *
 * Zwei Dinge müssen hier halten, und beide sind beim ersten echten Lauf
 * gerissen:
 *
 *   1. Es muss überhaupt etwas ankommen. Der erste Anlauf meldete „0
 *      Module übernommen" — jeder Upsert scheiterte am partiellen Index,
 *      und die Action verschluckte den Fehler. Ein Test auf die blosse
 *      Anwesenheit des Berichts hätte das durchgewunken.
 *   2. Ein zweiter Lauf darf nichts verdoppeln. Die Übernahme wird
 *      wiederholt, sobald jemand einen Datenblattwert nachträgt.
 */

/** Anzahl aus einem Reiter wie „Module (11)". */
async function anzahl(page: Page, art: "Module" | "Wechselrichter" | "Speicher"): Promise<number> {
  const text = (await page.getByRole("button", { name: new RegExp(`^${art} \\(`) }).textContent()) ?? "";
  return Number(text.replace(/[^0-9]/g, "") || "0");
}

async function uebernehmen(page: Page): Promise<string> {
  await page.getByRole("button", { name: "Artikel übernehmen" }).click();
  const zeile = page.getByText(/Module · .* Wechselrichter · .* Speicher übernommen/);
  await expect(zeile).toBeVisible({ timeout: 60_000 });
  return (await zeile.textContent()) ?? "";
}

test.describe("Planer — Übernahme aus dem Lager", () => {
  test("übernimmt Geräte und meldet, wo Datenblattwerte fehlen", async ({ page }) => {
    await login(page, DEMO.gf);
    await page.goto("/einstellungen?bereich=planer");

    const bericht = await uebernehmen(page);

    /*
     * Nicht auf eine feste Zahl prüfen — der Artikelstamm wächst. Aber
     * „0 Module" ist der Fehlerfall von damals und muss auffallen.
     */
    const module = Number(bericht.match(/^(\d+) Module/)?.[1] ?? "0");
    expect(module, "Module aus dem Lager").toBeGreaterThan(0);

    // Ein Schreibfehler darf nie still bleiben.
    await expect(page.getByText(/Schreiben nach .* fehlgeschlagen/)).toHaveCount(0);

    /*
     * Die Liste unten muss die Geräte wirklich führen. Nicht „mehr als
     * vorher" prüfen — die Übernahme ist idempotent, bei einem zweiten
     * Lauf steigt die Zahl zu Recht nicht mehr. Gemessen wird deshalb
     * gegen den Bericht: was er meldet, muss auch dastehen.
     */
    await expect.poll(async () => anzahl(page, "Module")).toBeGreaterThanOrEqual(module);

    /*
     * Die Lückenliste ist der eigentliche Nutzen: sie sagt, welcher
     * Wert bei welchem Artikel fehlt. Im Bestand fehlt vor allem die
     * DC-Spannungsgrenze der Wechselrichter.
     */
    await expect(page.getByText(/fehlen Datenblattwerte/)).toBeVisible();
    await expect(page.getByText(/fehlt: .*DC-Spannung/).first()).toBeVisible();
  });

  test("ein zweiter Lauf verdoppelt nichts", async ({ page }) => {
    await login(page, DEMO.gf);
    await page.goto("/einstellungen?bereich=planer");

    await uebernehmen(page);
    await expect.poll(async () => anzahl(page, "Module")).toBeGreaterThan(0);
    const nachErstem = {
      module: await anzahl(page, "Module"),
      wr: await anzahl(page, "Wechselrichter"),
      speicher: await anzahl(page, "Speicher"),
    };

    await page.reload();
    await uebernehmen(page);
    /*
     * Warten, bis die Liste nach dem zweiten Lauf wirklich neu gerendert
     * ist — sonst prüfte der Vergleich denselben Zustand zweimal und
     * wäre auch bei Verdopplung grün.
     */
    await page.waitForTimeout(1500);

    expect(await anzahl(page, "Module")).toBe(nachErstem.module);
    expect(await anzahl(page, "Wechselrichter")).toBe(nachErstem.wr);
    expect(await anzahl(page, "Speicher")).toBe(nachErstem.speicher);
  });

  test("wer die Stammdaten nicht schreiben darf, sieht den Knopf nicht", async ({ page }) => {
    await login(page, DEMO.monteur);
    await page.goto("/einstellungen?bereich=planer");
    await expect(page.getByRole("button", { name: "Artikel übernehmen" })).toHaveCount(0);
  });
});
