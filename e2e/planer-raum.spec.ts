import { expect, test, type Page } from "@playwright/test";
import { admin, COMPANY_A, DEMO, login } from "./helpers";
import { belegen, dachSetzen } from "./planer-helfer";

/*
 * Die räumliche Ansicht als Arbeitsfläche (Wunsch vom 13.08.2026:
 * „reonic hat das dach die bilddaten von der karte genommen und man
 * kann in der 3D vorschau die Module belegen").
 *
 * Geprüft wird, was man am Bildschirm nicht sieht, ohne hinzusehen:
 * dass ein Tipp in der Perspektive dieselbe Belegung erzeugt wie in
 * der Draufsicht, und dass er sie auch wieder wegnimmt.
 */

const LINZ = { lat: 48.30604, lon: 14.28583 };

async function aufraeumen() {
  await admin().from("planer_projekt").delete().eq("company_id", COMPANY_A).like("name", "Raum%");
}
test.beforeEach(aufraeumen);
test.afterAll(aufraeumen);

async function neuesProjekt(page: Page): Promise<string> {
  await page.goto("/planer/neu");
  await page.route("**/api/planer/adresse**", (r) =>
    r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ treffer: [{ name: "Raumweg 1, 4020 Linz", ...LINZ }] }),
    }),
  );
  await page.getByLabel("Adresse suchen").fill("Raumweg 1");
  await page.getByRole("button", { name: /Raumweg 1/ }).click();
  await page.getByLabel("Projektname").fill("Raum");
  await page.getByRole("button", { name: "Projekt anlegen" }).click();
  await page.waitForURL(/\/planer\/[0-9a-f-]{36}$/);
  return page.url().split("/").pop()!;
}

test.describe("Planer — räumliche Ansicht", () => {
  test("Ein Tipp auf das Dach setzt ein Modul, ein Tipp darauf nimmt es weg", async ({ page }) => {
    await login(page, DEMO.gf);
    const id = await neuesProjekt(page);

    await dachSetzen(page, "Pultdach", "14", "9");
    await page.getByRole("button", { name: /^Fläche 1/ }).click();

    // Nicht `module`: In Next.js ist der Name gesperrt.
    const modulzahl = async () => {
      const { data } = await admin().from("planer_projekt").select("plan").eq("id", id).single();
      const plan = data!.plan as {
        gruppen: Array<{ reihen: number; spalten: number; aus?: string[]; entfernt?: string[] }>;
      };
      return plan.gruppen.reduce(
        (n, g) => n + g.reihen * g.spalten - new Set([...(g.aus ?? []), ...(g.entfernt ?? [])]).size,
        0,
      );
    };

    /*
     * Der Umschalter trägt den Namen des aktuellen Zustands: Solange
     * die Draufsicht läuft, steht „2D" darauf.
     */
    await page.getByRole("button", { name: "2D", exact: true }).click();
    const raum = page.getByTestId("planer-3d");
    await expect(raum).toBeVisible();

    // Erst schauen — ein Tipp darf nichts anlegen.
    const k = (await raum.boundingBox())!;
    const mitte = { x: k.x + k.width / 2, y: k.y + k.height / 2 };
    await page.mouse.click(mitte.x, mitte.y);
    await page.waitForTimeout(800);
    expect(await modulzahl(), "im Ansehen-Modus wird nichts gesetzt").toBe(0);

    await page.getByRole("button", { name: "Belegen", exact: true }).click();

    /*
     * Der Blick steht schräg auf das Haus, die Dachfläche liegt also
     * nicht in der Bildmitte. Erst mit dem Zeiger suchen, bis das
     * Geistermodul „passt" meldet — dann erst klicken. Vorher wurde
     * blind an sechs Stellen geklickt; das ging alleine gut und fiel
     * im ganzen Durchlauf um, wenn die Szene noch nicht stand.
     */
    let ziel: { x: number; y: number } | null = null;
    for (let i = 0; i < 60 && !ziel; i++) {
      const x = mitte.x + ((i % 5) - 2) * 55;
      const y = mitte.y + (Math.floor(i / 5) % 5) * 30 - 60;
      await page.mouse.move(x, y);
      await page.waitForTimeout(140);
      if ((await raum.getAttribute("data-geist")) === "passt") ziel = { x, y };
    }
    expect(ziel, "irgendwo auf dem Dach zeigt die Vorschau ein passendes Modul").not.toBeNull();

    await page.mouse.click(ziel!.x, ziel!.y);
    await expect.poll(modulzahl, { timeout: 20_000 }).toBe(1);
    const gesetzt = await modulzahl();

    expect(gesetzt, "ein Tipp in der Perspektive legt ein Modul an").toBe(1);

    /*
     * Und der nächste Tipp daneben baut an DASSELBE Feld an
     * (Beschwerde vom 13.08.2026: „dann ist immer ein eigenes Feld").
     * Gesucht wird wieder über die Vorschau, nicht geraten.
     */
    let zweites: { x: number; y: number } | null = null;
    for (let i = 0; i < 40 && !zweites; i++) {
      const x = ziel!.x + ((i % 4) - 2) * 22;
      const y = ziel!.y + (Math.floor(i / 4) - 3) * 16;
      await page.mouse.move(x, y);
      await page.waitForTimeout(120);
      if ((await raum.getAttribute("data-geist")) === "passt") zweites = { x, y };
    }
    expect(zweites, "neben dem Modul zeigt die Vorschau den nächsten Platz").not.toBeNull();

    await page.mouse.click(zweites!.x, zweites!.y);
    await expect.poll(modulzahl, { timeout: 20_000 }).toBe(2);

    const { data: nachher } = await admin()
      .from("planer_projekt")
      .select("plan")
      .eq("id", id)
      .single();
    const plan = nachher!.plan as { gruppen: Array<{ id: string }> };
    expect(plan.gruppen, "beide Module hängen an einem Feld").toHaveLength(1);
  });

  test("In der Perspektive lässt sich ein Modul einem String zuschlagen", async ({ page }) => {
    await login(page, DEMO.gf);
    const id = await neuesProjekt(page);

    await dachSetzen(page, "Pultdach", "14", "9");
    await page.getByRole("button", { name: /^Fläche 1/ }).click();
    await belegen(page);

    await page.getByRole("button", { name: /^3 Technik/ }).click();
    await page.getByRole("button", { name: "String anlegen" }).click();

    await page.getByRole("button", { name: "2D", exact: true }).click();
    const raum = page.getByTestId("planer-3d");
    await expect(raum).toBeVisible();
    await page.getByRole("button", { name: "Strings", exact: true }).click();

    const k = (await raum.boundingBox())!;
    const mitte = { x: k.x + k.width / 2, y: k.y + k.height / 2 };

    const imStrang = async () => {
      const { data } = await admin().from("planer_projekt").select("plan").eq("id", id).single();
      const plan = data!.plan as { strings: Array<{ module: string[] }> };
      return plan.strings[0]?.module.length ?? 0;
    };
    expect(await imStrang()).toBe(0);

    /*
     * Auf ein Modul tippen. Wo eines liegt, hängt am Kamerawinkel —
     * deshalb ein paar Stellen probieren, bis der String wächst.
     */
    for (let i = 0; i < 25 && (await imStrang()) === 0; i++) {
      await page.mouse.click(mitte.x + ((i % 5) - 2) * 40, mitte.y + (Math.floor(i / 5) - 2) * 26);
      await page.waitForTimeout(350);
    }
    expect(await imStrang(), "ein Tipp legt das Modul in den String").toBeGreaterThan(0);
  });

  test("Strings werden auf Knopfdruck verlegt", async ({ page }) => {
    await login(page, DEMO.gf);
    const id = await neuesProjekt(page);

    await dachSetzen(page, "Pultdach", "14", "9");
    await page.getByRole("button", { name: /^Fläche 1/ }).click();
    await belegen(page);

    await page.getByRole("button", { name: /^3 Technik/ }).click();
    await page.getByLabel("Wechselrichter").selectOption({ index: 1 });
    await page.getByRole("button", { name: "Strings automatisch verlegen" }).click();

    await expect
      .poll(
        async () => {
          const { data } = await admin()
            .from("planer_projekt")
            .select("plan")
            .eq("id", id)
            .single();
          const plan = data!.plan as { strings: Array<{ module: string[]; mppt: number }> };
          return plan.strings;
        },
        { timeout: 20_000 },
      )
      .not.toHaveLength(0);

    const { data } = await admin().from("planer_projekt").select("plan").eq("id", id).single();
    const plan = data!.plan as {
      strings: Array<{ module: string[]; mppt: number }>;
      gruppen: Array<{ reihen: number; spalten: number; aus?: string[]; entfernt?: string[] }>;
    };

    const belegteModule = plan.gruppen.reduce(
      (n, g) => n + g.reihen * g.spalten - new Set([...(g.aus ?? []), ...(g.entfernt ?? [])]).size,
      0,
    );
    const verlegt = plan.strings.reduce((n, s) => n + s.module.length, 0);
    expect(verlegt, "jedes belegte Modul hängt an einem String").toBe(belegteModule);

    // Und die Längen liegen um höchstens eins auseinander.
    const laengen = plan.strings.map((s) => s.module.length);
    expect(Math.max(...laengen) - Math.min(...laengen)).toBeLessThanOrEqual(1);

    // Keine Dopplung: Ein Modul hängt an genau einem String.
    const alle = plan.strings.flatMap((s) => s.module);
    expect(new Set(alle).size).toBe(alle.length);
  });
});

/*
 * Der Kachelproxy.
 *
 * Er lag lange falsch, ohne aufzufallen: Die Prüfung liess höchstens
 * dreistellige Kachelindizes zu, echte haben bei Stufe 19 sechs. Damit
 * antwortete er auf JEDE echte Kachel mit „Ungültige Kachel" — Google
 * und Azure lieferten im ganzen Planer kein Bild, und weil die
 * Voreinstellung basemap.at direkt lädt, sah man es nie.
 */
test.describe("Planer — Kachelproxy", () => {
  test("nimmt echte Kachelindizes an und weist unmögliche ab", async ({ page }) => {
    await login(page, DEMO.gf);
    await page.goto("/planer");

    const antwort = async (pfad: string) =>
      page.evaluate(async (p) => (await fetch(p)).status, pfad);

    // Stufe 19, sechsstellig — das ist der Normalfall auf einem Dach.
    expect(await antwort("/api/planer/kachel/basemap/19/281655/181240")).not.toBe(400);
    // Zu grosser Index für die Stufe: kann es nicht geben.
    expect(await antwort("/api/planer/kachel/basemap/10/999999/1")).toBe(400);
    // Kein Anbieter.
    expect(await antwort("/api/planer/kachel/erfunden/19/281655/181240")).toBe(400);
  });
});
