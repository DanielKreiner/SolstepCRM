import { expect, type Page, test } from "@playwright/test";
import { admin, COMPANY_A, DEMO, login } from "./helpers";
import { belegen, dachSetzen, mehrOeffnen } from "./planer-helfer";

/*
 * Planer — was ein Schritt sperrt.
 *
 * Ein späterer Schritt fasst nicht mehr an, was ein früherer festgelegt
 * hat. Der teuerste Fehler in diesem Ablauf ist eine verrutschte
 * Dachkante, nachdem die Belegung steht: Die Module liegen noch da, die
 * Fläche stimmt nicht mehr, und niemand merkt es.
 */

const LINZ = { lat: 48.30604, lon: 14.28583 };

async function aufraeumen() {
  await admin().from("planer_projekt").delete().eq("company_id", COMPANY_A).like("name", "Phasen%");
}

test.beforeEach(aufraeumen);
test.afterAll(aufraeumen);

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
  await page.getByLabel("Projektname").fill(name);
  await page.getByRole("button", { name: "Projekt anlegen" }).click();
  await page.waitForURL(/\/planer\/[0-9a-f-]{36}$/);
  const id = page.url().split("/").pop()!;

  await page.getByRole("button", { name: "Näher heran" }).click();
  await dachSetzen(page, "Pultdach", "14", "9");
  await page.getByRole("button", { name: /^Fläche 1/ }).click();
  return id;
}

/**
 * Die Massangabe an der oberen Dachkante suchen und ihre Bildstelle
 * zurückgeben.
 *
 * Gesucht statt fest gewählt: Wo die Angabe sitzt, hängt vom
 * Kartenausschnitt ab. Ein fester Punkt könnte danebenliegen — der Test
 * wäre grün, ohne etwas gezeigt zu haben.
 */
async function sucheKante(page: Page): Promise<{ x: number; y: number }> {
  const kasten = (await page.getByTestId("planer-leinwand").boundingBox())!;
  const mitte = { x: kasten.x + kasten.width / 2, y: kasten.y + kasten.height / 2 };
  const feld = page.getByLabel("Kantenlänge in Metern");
  /*
   * Weiter gespannt als früher: Die Massangabe sitzt seit dem Umbau
   * AUSSERHALB der Fläche, ein Stück vor der Kante. Wie weit, hängt am
   * Zoom — deshalb wird gesucht statt gerechnet.
   */
  for (const dy of [-70, -80, -90, -100, -110, -120, -130, -140, -150, -60, -50]) {
    await page.mouse.click(mitte.x, mitte.y + dy);
    if (await feld.isVisible().catch(() => false)) {
      await page.keyboard.press("Escape");
      return { x: mitte.x, y: mitte.y + dy };
    }
  }
  throw new Error("Massangabe an der Kante nicht gefunden");
}

/** Die Eckpunkte der ersten Fläche aus dem gespeicherten Plan. */
async function punkte(id: string): Promise<string> {
  const { data } = await admin().from("planer_projekt").select("plan").eq("id", id).single();
  const plan = data!.plan as { flaechen: Array<{ punkte: unknown[] }> };
  return JSON.stringify(plan.flaechen[0]?.punkte ?? null);
}

test.describe("Planer — Schrittsperren", () => {
  test("Jeder Schritt zeigt nur seine Werkzeuge", async ({ page }) => {
    await login(page, DEMO.gf);
    await projektMitBelegung(page, "Phasen Werkzeuge");

    /*
     * Schritt 1 und 2 teilen sich das Panel: Dach und Belegung
     * entstehen im selben Durchgang. Deshalb hat Schritt 1 beides.
     * Gesperrt wird nach vorn — ab Schritt 2 bleibt das Dach, wie es
     * ist.
     */
    await expect(page.getByRole("button", { name: "Dachfläche zeichnen" })).toBeVisible();

    // Schritt 2: belegen — die Zeichenwerkzeuge sind weg.
    await page.getByRole("button", { name: /^2 Belegung/ }).click();
    await expect(page.getByRole("button", { name: "Dachfläche zeichnen" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Einzelnes Modul/ })).toBeVisible();

    /*
     * Schritt 3 verlangt Module — ohne sie gäbe es nichts auszulegen,
     * und der Schritt bleibt gesperrt.
     */
    await belegen(page);
    await page.getByRole("button", { name: /^3 Technik/ }).click();
    await expect(page.getByRole("button", { name: /Einzelnes Modul/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Module dem gewählten String/ })).toBeVisible();
  });

  test("In der Belegung ist die Kante nicht mehr zu bearbeiten", async ({ page }) => {
    await login(page, DEMO.gf);
    const id = await projektMitBelegung(page, "Phasen Kante");

    /*
     * Geprüft wird über die Massangabe an der Kante: Sie ist ein
     * eindeutig treffbares Ziel und dieselbe Trefferprüfung, die auch
     * Ecken und Kanten bedient. Ein Mauszug quer über die Fläche wäre
     * kein Beweis — er könnte die Kante schlicht verfehlen, und der
     * Test wäre grün, ohne etwas zu zeigen.
     */
    const obereKante = await sucheKante(page);

    // In Schritt 2 tut derselbe Klick nichts mehr.
    await page.getByRole("button", { name: /^2 Belegung/ }).click();
    await expect(page.getByText(/zurück zu Schritt 1/)).toBeVisible();
    await page.mouse.click(obereKante.x, obereKante.y);
    await expect(page.getByLabel("Kantenlänge in Metern")).toHaveCount(0);

    /*
     * Und auch ein Zug an derselben Kante bewegt nichts. Dass sich das
     * Eingabefeld nicht öffnet, ist nur die halbe Sperre — verschieben
     * liesse sich eine Kante auch ohne Feld, und genau das ist der
     * teure Fehler: eine verrutschte Traufe unter fertiger Belegung.
     */
    /*
     * Erst auf den gespeicherten Umriss warten. Ohne das läse der erste
     * Griff „null" — der Autosave läuft gedrosselt —, und der Vergleich
     * schlüge fehl, obwohl sich nichts bewegt hat.
     */
    await expect.poll(() => punkte(id), { timeout: 20_000 }).not.toBe("null");
    const vorher = await punkte(id);
    await page.mouse.move(obereKante.x, obereKante.y);
    await page.mouse.down();
    await page.mouse.move(obereKante.x, obereKante.y - 45, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(2500);
    expect(await punkte(id), "die Dachkante darf sich nicht bewegt haben").toBe(vorher);

    /*
     * Und zurück in Schritt 1 geht es wieder. Die Kante wird neu
     * gesucht: Der Zug oben hat die Karte geschwenkt — genau das darf er
     * ja —, also sitzt die Massangabe nicht mehr an derselben Bildstelle.
     */
    await page.getByRole("button", { name: /^1 Dach/ }).click();
    await page.getByRole("button", { name: /^Fläche 1/ }).click();
    const wieder = await sucheKante(page);
    await page.mouse.click(wieder.x, wieder.y);
    await expect(page.getByLabel("Kantenlänge in Metern")).toBeVisible();
  });

  test("In der Technik lässt sich die Belegung nicht mehr ändern", async ({ page }) => {
    await login(page, DEMO.gf);
    const id = await projektMitBelegung(page, "Phasen Module");

    await page.getByRole("button", { name: /^2 Belegung/ }).click();
    await belegen(page);
    await expect(page.getByRole("button", { name: /^Feld 1/ })).toBeVisible();

    const zahl = async () => {
      const { data } = await admin().from("planer_projekt").select("plan").eq("id", id).single();
      const plan = data!.plan as { gruppen: Array<{ aus: string[] }> };
      return plan.gruppen[0]?.aus.length ?? -1;
    };
    await expect.poll(zahl, { timeout: 20_000 }).toBeGreaterThanOrEqual(0);
    const vorher = await zahl();

    /*
     * In Schritt 3 auf ein Modul tippen. In der Belegung schaltete das
     * ein Modul ab; hier darf es nur die Karte betreffen.
     */
    await page.getByRole("button", { name: /^3 Technik/ }).click();
    const kasten = (await page.getByTestId("planer-leinwand").boundingBox())!;
    await page.mouse.click(kasten.x + kasten.width / 2, kasten.y + kasten.height / 2);
    await page.waitForTimeout(2500);

    expect(await zahl(), "kein Modul darf sich geändert haben").toBe(vorher);
  });

  test("Eine Modulgruppe lässt sich duplizieren", async ({ page }) => {
    await login(page, DEMO.gf);
    const id = await projektMitBelegung(page, "Phasen Kopie");

    await belegen(page);
    await expect(page.getByRole("button", { name: /^Feld 1/ })).toBeVisible();

    const gruppen = async () => {
      const { data } = await admin().from("planer_projekt").select("plan").eq("id", id).single();
      return (data!.plan as { gruppen: unknown[] }).gruppen.length;
    };
    await expect.poll(gruppen, { timeout: 20_000 }).toBe(1);

    /*
     * Erst Platz schaffen: Nach dem automatischen Belegen ist das Dach
     * voll, und eine Kopie hätte nirgends Platz — der Planer sagt das
     * dann auch, statt ein leeres Feld anzulegen. Der obere Griff nach
     * unten nimmt zwei Reihen weg.
     */
    const leinwand = page.getByTestId("planer-leinwand");
    const roh = await leinwand.getAttribute("data-gruppenrahmen");
    const kasten = (await leinwand.boundingBox())!;
    const [l, o, r] = roh!.split(",").map(Number) as [number, number, number, number];
    const oben = { x: kasten.x + (l + r) / 2, y: kasten.y + o };
    await page.mouse.move(oben.x, oben.y);
    await page.mouse.down();
    await page.mouse.move(oben.x, oben.y + 90, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(1500);

    await mehrOeffnen(page, "Feineinstellung");
    await page.getByRole("button", { name: "Feld duplizieren" }).click();
    await expect(page.getByRole("button", { name: /^Feld 1 Kopie/ })).toBeVisible();
    await expect.poll(gruppen, { timeout: 20_000 }).toBe(2);

    /*
     * Die Kopie muss Module tragen. Sie liegt um ihre eigene Breite
     * versetzt — landet sie neben dem Dach, wirft `nachfuehren` alles
     * heraus, und eine leere Gruppe wäre nutzlos.
     */
    const { data } = await admin().from("planer_projekt").select("plan").eq("id", id).single();
    const plan = data!.plan as {
      gruppen: Array<{
        name: string;
        reihen: number;
        spalten: number;
        aus?: string[];
        entfernt?: string[];
      }>;
    };
    const kopie = plan.gruppen.find((g) => g.name.includes("Kopie"))!;
    /*
     * Und sie trägt Module. Eine Kopie ohne Module ist kein Feld,
     * sondern Arbeit: Man muss sie erst suchen und wieder löschen.
     */
    const leer = new Set([...(kopie.aus ?? []), ...(kopie.entfernt ?? [])]);
    expect(kopie.reihen * kopie.spalten - leer.size).toBeGreaterThan(0);
  });
});
