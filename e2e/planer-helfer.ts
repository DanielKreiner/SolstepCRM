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
export async function belegen(page: Page, aufbau?: string): Promise<void> {
  const belegung = page.getByRole("button", { name: /^2 Belegung/ });
  if (await belegung.isEnabled().catch(() => false)) await belegung.click();
  await modulWaehlen(page);
  await page.getByRole("button", { name: /(Dach voll belegen|Restfläche belegen)/ }).click();
  await expect(page.getByRole("button", { name: /^Feld 1/ })).toBeVisible();

  /*
   * Auf dem Flachdach liegt zuerst Ost/West — die übliche Bauform.
   * Wer etwas anderes prüfen will, stellt danach um; die drei Arten
   * stehen als Knopfreihe unter dem Feld. Bei einem geneigten Dach gibt
   * es sie nicht, dann tut der Parameter nichts.
   */
  if (!aufbau) return;
  const wahl = page.getByRole("button", { name: aufbau, exact: false });
  if (await wahl.isVisible().catch(() => false)) await wahl.click();
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

/**
 * Ein Vieleck zeichnen: Ecken antippen, erste Ecke schliesst.
 *
 * Seit dem 13.08.2026 entstehen Sperrzonen und Gauben so — wie eine
 * Dachfläche und nicht mehr als aufgezogenes Rechteck. Die Punkte sind
 * Abstände zu einem Bezugspunkt, meist der Bildmitte.
 */
export async function vieleck(
  page: Page,
  bezug: { x: number; y: number },
  ecken: Array<[number, number]>,
): Promise<void> {
  for (const [dx, dy] of ecken) {
    await page.mouse.click(bezug.x + dx, bezug.y + dy);
    await page.waitForTimeout(120);
  }
  // Auf die erste Ecke tippen schliesst die Form.
  const [dx, dy] = ecken[0]!;
  await page.mouse.click(bezug.x + dx, bezug.y + dy);
  await page.waitForTimeout(200);
}
