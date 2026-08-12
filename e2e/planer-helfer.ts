import { expect, type Page } from "@playwright/test";

/*
 * Handgriffe, die in fast jedem Planer-Test vorkommen.
 *
 * Vorher standen sie in neun Dateien noch einmal. Als die Oberfläche
 * umgebaut wurde — „Standardform setzen" heisst jetzt „Dachform
 * setzen", die Formwahl ist eine Karte statt einer Auswahlliste —,
 * mussten alle neun einzeln nachgezogen werden. Ein Helfer, eine
 * Änderung.
 */

/** Dachform über den Assistenten setzen. */
export async function dachSetzen(
  page: Page,
  form: "Satteldach" | "Pultdach" | "Walmdach" | "Zeltdach" | "Flachdach",
  laenge?: string,
  tiefe?: string,
): Promise<void> {
  await page.getByRole("button", { name: /(Dachform|Weitere Form) setzen/ }).click();
  await page.getByRole("button", { name: form }).click();
  if (laenge) await page.getByLabel("Länge", { exact: true }).fill(laenge);
  if (tiefe) await page.getByLabel("Tiefe", { exact: true }).fill(tiefe);
  await page.getByRole("button", { name: "In die Bildmitte setzen" }).click();
}

/**
 * Zum Belegen wechseln, ein Modul wählen und das Dach voll belegen.
 *
 * Die Modulwahl gehört zum Ablauf: Ohne Modul kennt der Planer die
 * Rastermasse nicht, und der Knopf zum Belegen bleibt gesperrt.
 */
export async function belegen(page: Page): Promise<void> {
  const belegung = page.getByRole("button", { name: /^2 Belegung/ });
  if (await belegung.isEnabled().catch(() => false)) await belegung.click();
  await modulWaehlen(page);
  await page.getByRole("button", { name: /(Dach voll belegen|Restfläche belegen)/ }).click();
  await expect(page.getByRole("button", { name: /^Feld 1/ })).toBeVisible();
}

/** Das erste Modul aus dem Materialstamm wählen, falls noch keines gewählt ist. */
export async function modulWaehlen(page: Page): Promise<void> {
  const karten = page.getByTestId("modul-karte");
  if ((await karten.count()) === 0) return; // kein Modul im Materialstamm
  const gewaehlt = page.locator('[data-testid="modul-karte"][aria-pressed="true"]');
  if ((await gewaehlt.count()) > 0) return;
  await karten.first().click();
}

/**
 * Wattzahl des gewählten Moduls, aus der Karte im Panel gelesen.
 *
 * Nicht fest verdrahten: Welches Modul im Materialstamm zuerst steht,
 * hängt am Seed. Die Tests rechnen deshalb mit der Zahl, die auch der
 * Betrieb vor sich sieht.
 */
export async function gewaehlteWattzahl(page: Page): Promise<number> {
  const karte = page.locator('[data-testid="modul-karte"][aria-pressed="true"]');
  const text = (await karte.first().textContent()) ?? "";
  const treffer = text.match(/([\d.]+)\s*Wp/);
  return treffer ? Number(treffer[1]!.replace(".", "")) : 0;
}

/** Den Bereich „Mehr einstellen" aufklappen — dort liegt das Seltene. */
export async function mehrOeffnen(page: Page, titel = "Mehr einstellen"): Promise<void> {
  const knopf = page.getByRole("button", { name: titel, exact: true });
  if ((await knopf.getAttribute("aria-expanded")) === "true") return;
  await knopf.click();
}
