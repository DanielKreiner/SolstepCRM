import { expect, type Page, test } from "@playwright/test";
import { DEMO, login } from "./helpers";
import { belegen, dachSetzen, gewaehlteWattzahl, mehrOeffnen } from "./planer-helfer";

/*
 * Planer, Stufe 3 — Modulbelegung (Briefing 4).
 *
 * Gehört zur eigenen Planer-Suite: `pnpm test:e2e:planer`.
 * Geprüft wird vor allem die Kette Klick → Geometrie → Kennzahl: die
 * Leistung auf der Leiste muss aus derselben Modulzahl folgen, die im
 * Panel steht. Läuft das auseinander, stimmt eine Rechnung nicht.
 */

async function neuesProjekt(page: Page, name: string) {
  await page.goto("/planer/neu");
  await page.route("**/api/planer/adresse**", (r) =>
    r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ treffer: [{ name: `${name}, 4020 Linz`, lat: 48.30604, lon: 14.28583 }] }),
    }),
  );
  await page.getByLabel("Adresse suchen").fill(name);
  await page.getByRole("button", { name: new RegExp(name) }).click();
  await page.getByRole("button", { name: "Projekt anlegen" }).click();
  await page.waitForURL(/\/planer\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId("planer-leinwand")).toBeVisible();
  // Näher heran, sonst ist ein 14-m-Dach nur ein paar Bildpunkte gross.
  await page.getByRole("button", { name: "Näher heran" }).click();
  await page.getByRole("button", { name: "Näher heran" }).click();
}

/** Die Zahlen der schwebenden Kennzahlenleiste (links am Bildrand). */
async function kennzahlen(page: Page) {
  const werte = await page.locator("div.num.text-\\[17px\\]").allTextContents();
  return {
    dachflaeche: Number((werte[0] ?? "").replace(/[^0-9]/g, "")),
    module: Number(werte[1] ?? "0"),
    kwp: Number((werte[2] ?? "0").replace(",", ".")),
  };
}

test.describe("Planer — Belegung", () => {
  test("Automatische Belegung füllt die Fläche, Leistung passt zur Modulzahl", async ({ page }) => {
    await login(page, DEMO.buero);
    await neuesProjekt(page, "Belegweg 1");
    await dachSetzen(page, "Pultdach", "14", "9");

    await page.getByRole("button", { name: /^Fläche 1/ }).click();
    await belegen(page);

    await expect.poll(async () => (await kennzahlen(page)).module).toBeGreaterThan(20);
    const k = await kennzahlen(page);

    /*
     * Die Leistung muss aus der Modulzahl folgen — mit der Wattzahl des
     * GEWÄHLTEN Moduls. Weichen die beiden Zahlen voneinander ab,
     * rechnet irgendwo etwas mit einem anderen Bestand.
     */
    const wp = await gewaehlteWattzahl(page);
    expect(wp, "ein Modul ist gewählt").toBeGreaterThan(100);
    expect(k.kwp).toBeCloseTo((k.module * wp) / 1000, 2);

    // Und die Belegung darf die Dachfläche nicht überschreiten.
    expect(k.module * 1.134 * 1.762).toBeLessThan(k.dachflaeche);
  });

  test("Ein Modul wegtippen senkt Zahl und Leistung um genau eines", async ({ page }) => {
    await login(page, DEMO.buero);
    await neuesProjekt(page, "Tippweg 2");
    await dachSetzen(page, "Pultdach", "14", "9");
    await page.getByRole("button", { name: /^Fläche 1/ }).click();
    await belegen(page);
    await expect.poll(async () => (await kennzahlen(page)).module).toBeGreaterThan(20);

    const vorher = await kennzahlen(page);

    // In die Mitte der Fläche tippen — dort liegt sicher ein Modul.
    const kasten = (await page.getByTestId("planer-leinwand").boundingBox())!;
    await page.mouse.click(kasten.x + kasten.width / 2, kasten.y + kasten.height / 2);

    await expect.poll(async () => (await kennzahlen(page)).module).toBe(vorher.module - 1);
    const nachher = await kennzahlen(page);
    const wp = await gewaehlteWattzahl(page);
    expect(nachher.kwp).toBeCloseTo(vorher.kwp - wp / 1000, 2);

    /*
     * Nochmal tippen holt es zurück: das Modul wurde abgeschaltet, nicht
     * gelöscht (Briefing 4.2).
     */
    await page.mouse.click(kasten.x + kasten.width / 2, kasten.y + kasten.height / 2);
    await expect.poll(async () => (await kennzahlen(page)).module).toBe(vorher.module);
  });

  test("Ein Hindernis kostet Module", async ({ page }) => {
    await login(page, DEMO.buero);
    await neuesProjekt(page, "Kaminweg 3");
    await dachSetzen(page, "Pultdach", "14", "9");
    await page.getByRole("button", { name: /^Fläche 1/ }).click();
    await belegen(page);
    await expect.poll(async () => (await kennzahlen(page)).module).toBeGreaterThan(20);
    const ohne = (await kennzahlen(page)).module;

    /*
     * Feld entfernen, Kamin setzen, neu belegen. Der Kamin gehört zum
     * Dach, also zurück in Schritt 1 — dort liegt das Werkzeug.
     */
    await page.getByRole("button", { name: /^Entfernen: Feld \d+$/ }).click();
    await page.getByRole("button", { name: /^1 Dach/ }).click();
    await page.getByRole("button", { name: /^Fläche 1/ }).click();
    await page.getByRole("button", { name: /Hindernis aufziehen/ }).click();
    const kasten = (await page.getByTestId("planer-leinwand").boundingBox())!;
    const m = { x: kasten.x + kasten.width / 2, y: kasten.y + kasten.height / 2 };
    await page.mouse.move(m.x - 40, m.y - 30);
    await page.mouse.down();
    await page.mouse.move(m.x + 40, m.y + 30, { steps: 10 });
    await page.mouse.up();
    await expect(page.getByText(/Hindernisse \(1\)/i)).toBeVisible();

    await belegen(page);
    await expect.poll(async () => (await kennzahlen(page)).module).toBeGreaterThan(0);
    expect((await kennzahlen(page)).module).toBeLessThan(ohne);
  });

  test("Flachdach bekommt Aufständerung und einen Reihenabstand gegen Winterschatten", async ({ page }) => {
    await login(page, DEMO.buero);
    await neuesProjekt(page, "Flachweg 4");
    await dachSetzen(page, "Flachdach", "20", "14");

    await page.getByRole("button", { name: /^Fläche 1/ }).click();
    await belegen(page);
    await expect.poll(async () => (await kennzahlen(page)).module).toBeGreaterThan(0);

    // Beim Flachdach steht das Modul auf einem Gestell — Süd, 15°.
    await mehrOeffnen(page, "Feineinstellung");
    await expect(page.getByLabel("Aufständerung")).toHaveValue("sued");
    await expect(page.getByLabel("Winkel", { exact: true })).toHaveValue("15");

    /*
     * Der vorgeschlagene Reihenabstand ist der Winterschatten:
     * 1,762 · sin(15°) / tan(90 − 48,31 − 23,44) = rund 1,36 m.
     * Er muss deutlich über dem Zeilenabstand eines Schrägdachs liegen.
     */
    const abstand = Number((await page.getByLabel("Reihenabstand", { exact: true }).inputValue()).replace(",", "."));
    expect(abstand).toBeGreaterThan(1.2);
    expect(abstand).toBeLessThan(1.6);
    // Und der Vorschlagsknopf steht daneben — mit derselben Zahl.
    await expect(page.getByRole("button", { name: /Reihenabstand vorschlagen/ })).toBeVisible();
  });

  test("Belegung übersteht das Neuladen", async ({ page }) => {
    await login(page, DEMO.buero);
    await neuesProjekt(page, "Bestandweg 5");
    await dachSetzen(page, "Pultdach", "14", "9");
    await page.getByRole("button", { name: /^Fläche 1/ }).click();
    await belegen(page);
    await expect.poll(async () => (await kennzahlen(page)).module).toBeGreaterThan(20);
    const vorher = await kennzahlen(page);

    await expect(page.getByText("gesichert")).toBeVisible({ timeout: 15_000 });
    await page.reload();
    await expect(page.getByTestId("planer-leinwand")).toBeVisible();
    await expect.poll(async () => (await kennzahlen(page)).module).toBe(vorher.module);
  });
});

test.describe("Planer — Gruppe umformen", () => {
  /** Fläche anlegen, belegen und die Gruppe auswählen. */
  async function belegt(page: Page, name: string) {
    await login(page, DEMO.buero);
    await neuesProjekt(page, name);
    await dachSetzen(page, "Pultdach", "14", "9");
    await page.getByRole("button", { name: /^Fläche 1/ }).click();
    await belegen(page);
    await expect.poll(async () => (await kennzahlen(page)).module).toBeGreaterThan(20);
    // Die Auto-Belegung wählt die neue Gruppe schon aus.
    await expect(page.getByRole("button", { name: /^Feld 1/ })).toBeVisible();
  }

  /** Griffposition der gewählten Gruppe, in Seitenkoordinaten. */
  async function griff(
    page: Page,
    welcher: "oben" | "unten" | "links" | "rechts" | "drehen" | "verschieben",
  ) {
    const leinwand = page.getByTestId("planer-leinwand");
    const kasten = (await leinwand.boundingBox())!;
    const roh = await leinwand.getAttribute("data-gruppenrahmen");
    expect(roh, "Rahmen der gewählten Gruppe").not.toBeNull();
    const [l, o, r, u] = roh!.split(",").map(Number) as [number, number, number, number];
    const mx = kasten.x + (l + r) / 2;
    const my = kasten.y + (o + u) / 2;
    if (welcher === "oben") return { x: mx, y: kasten.y + o };
    if (welcher === "unten") return { x: mx, y: kasten.y + u };
    if (welcher === "links") return { x: kasten.x + l, y: my };
    if (welcher === "rechts") return { x: kasten.x + r, y: my };
    /*
     * Verschieben und Drehen sitzen als Symbolpaar über dem Rahmen —
     * dieselben Stellen wie in `griffe()`. Weichen sie voneinander ab,
     * zieht der Test ins Leere und wäre trotzdem grün.
     */
    if (welcher === "verschieben") return { x: mx - 16, y: kasten.y + o - 26 };
    return { x: mx + 16, y: kasten.y + o - 26 };
  }

  test("Am oberen Griff ziehen verkleinert und vergrössert die Gruppe", async ({ page }) => {
    await belegt(page, "Griffweg 6");
    const vorher = (await kennzahlen(page)).module;
    const oben = await griff(page, "oben");

    /*
     * Der obere Griff nach UNTEN gezogen nimmt Reihen weg. Ein Zug über
     * gut eine Reihenhöhe muss die Modulzahl messbar senken — und zwar
     * um ein Vielfaches der Spaltenzahl, nicht um einzelne Module.
     */
    await page.mouse.move(oben.x, oben.y);
    await page.mouse.down();
    await page.mouse.move(oben.x, oben.y + 60, { steps: 12 });
    await page.mouse.up();
    await expect.poll(async () => (await kennzahlen(page)).module).toBeLessThan(vorher);
    const weniger = (await kennzahlen(page)).module;

    // Und wieder hinauf: die Reihen kommen zurück.
    const oben2 = await griff(page, "oben");
    await page.mouse.move(oben2.x, oben2.y);
    await page.mouse.down();
    await page.mouse.move(oben2.x, oben2.y - 60, { steps: 12 });
    await page.mouse.up();
    await expect.poll(async () => (await kennzahlen(page)).module).toBeGreaterThan(weniger);
  });

  test("Am Drehgriff ziehen dreht das Raster", async ({ page }) => {
    await belegt(page, "Drehweg 10");
    await mehrOeffnen(page, "Feineinstellung");
    await expect(page.getByLabel("Drehung", { exact: true })).toHaveValue("0");

    const dreh = await griff(page, "drehen");
    const mitte = await griff(page, "links");
    // Weit zur Seite ziehen — das ergibt einen deutlichen Winkel.
    await page.mouse.move(dreh.x, dreh.y);
    await page.mouse.down();
    await page.mouse.move(dreh.x + 160, mitte.y, { steps: 14 });
    await page.mouse.up();

    const winkel = Number((await page.getByLabel("Drehung", { exact: true }).inputValue()).replace(",", "."));
    expect(Math.abs(winkel)).toBeGreaterThan(10);
  });

  test("Am Verschiebe-Symbol ziehen bewegt die Gruppe, ohne ein Modul zu schalten", async ({
    page,
  }) => {
    await belegt(page, "Schiebeweg 12");
    const vorher = (await kennzahlen(page)).module;

    /*
     * Ein kurzer Tipp auf das Symbol darf nichts schalten. In der Fläche
     * entscheidet die Wegstrecke zwischen Tippen (Modul ab) und Ziehen
     * (Gruppe bewegen) — am Symbol gibt es kein Modul darunter, und ein
     * verschwundenes Modul wäre hier reiner Schaden.
     */
    const symbol = await griff(page, "verschieben");
    await page.mouse.click(symbol.x, symbol.y);
    await page.waitForTimeout(600);
    expect((await kennzahlen(page)).module, "ein Tipp aufs Symbol schaltet nichts").toBe(vorher);

    /*
     * Und der Zug bewegt wirklich. Gemessen am Rahmen, nicht an der
     * Modulzahl: Innerhalb des Dachs bleibt die Zahl gleich — genau das
     * soll sie —, also wäre sie kein Beweis für die Bewegung.
     */
    const leinwand = page.getByTestId("planer-leinwand");
    const rahmenVorher = await leinwand.getAttribute("data-gruppenrahmen");
    await page.mouse.move(symbol.x, symbol.y);
    await page.mouse.down();
    await page.mouse.move(symbol.x + 40, symbol.y + 12, { steps: 10 });
    await page.mouse.up();
    await expect
      .poll(async () => leinwand.getAttribute("data-gruppenrahmen"), { timeout: 10_000 })
      .not.toBe(rahmenVorher);
  });

  test("Modul-Werkzeug und Teilen brauchen eine gewählte Gruppe", async ({ page }) => {
    await login(page, DEMO.buero);
    await neuesProjekt(page, "Sperrweg 7");
    await dachSetzen(page, "Pultdach", "14", "9");

    // Ohne Gruppe: beide Werkzeuge gesperrt, mit Grund im Tooltip.
    const modul = page.getByRole("button", { name: /Einzelnes Modul/ });
    const teilen = page.getByRole("button", { name: /Teil der Gruppe/ });
    await expect(modul).toBeDisabled();
    await expect(teilen).toBeDisabled();
    await expect(modul).toHaveAttribute("title", /Modulgruppe auswählen/);

    await page.getByRole("button", { name: /^Fläche 1/ }).click();
    await belegen(page);
    await expect(modul).toBeEnabled();
    await expect(teilen).toBeEnabled();

    /*
     * Und der Hinweis auf der Fläche muss zum Werkzeug passen. Die
     * Texthängen an einer verschachtelten Bedingung — dort war schon
     * einmal der Gegenproben-Text beim Modul-Werkzeug gelandet.
     */
    await modul.click();
    await expect(page.getByText("Modul versetzen", { exact: true })).toBeVisible();
    await expect(page.getByText(/aus dem Raster ziehen/)).toBeVisible();

    await teilen.click();
    await expect(page.getByText("Gruppe teilen")).toBeVisible();
    await expect(page.getByText(/Rechteck über einen Teil der Gruppe/)).toBeVisible();
  });

  test("Gruppe teilen erzeugt eine zweite Gruppe ohne Module zu verlieren", async ({ page }) => {
    await belegt(page, "Teilweg 8");
    const vorher = (await kennzahlen(page)).module;

    await page.getByRole("button", { name: /Teil der Gruppe/ }).click();
    const k = (await page.getByTestId("planer-leinwand").boundingBox())!;
    const m = { x: k.x + k.width / 2, y: k.y + k.height / 2 };

    // Linke Hälfte der Belegung aufziehen.
    await page.mouse.move(m.x - 150, m.y - 60);
    await page.mouse.down();
    await page.mouse.move(m.x - 20, m.y + 60, { steps: 12 });
    await page.mouse.up();

    // Zwei Gruppen — und zusammen weiterhin dieselbe Modulzahl.
    await expect(page.getByRole("button", { name: /^Feld 2/ })).toBeVisible();
    expect((await kennzahlen(page)).module).toBe(vorher);
  });

  test("Einzelmodul frei ziehen und wieder ins Raster holen", async ({ page }) => {
    await belegt(page, "Freiweg 9");
    const vorher = (await kennzahlen(page)).module;

    await page.getByRole("button", { name: /Einzelnes Modul/ }).click();
    const k = (await page.getByTestId("planer-leinwand").boundingBox())!;
    const m = { x: k.x + k.width / 2, y: k.y + k.height / 2 };

    // Modul aus der Mitte weit zur Seite ziehen.
    await page.mouse.move(m.x, m.y);
    await page.mouse.down();
    await page.mouse.move(m.x + 90, m.y - 70, { steps: 12 });
    await page.mouse.up();

    /*
     * Frei gesetzt heisst nicht gelöscht: die Modulzahl bleibt gleich.
     * Nur die Position ändert sich.
     */
    await expect(page.getByText("gesichert")).toBeVisible({ timeout: 15_000 });
    expect((await kennzahlen(page)).module).toBe(vorher);

    // Antippen holt es zurück — die Zahl bleibt ebenfalls gleich.
    await page.mouse.click(m.x + 90, m.y - 70);
    expect((await kennzahlen(page)).module).toBe(vorher);
  });
});
