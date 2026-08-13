import { expect, test } from "@playwright/test";
import { admin, COMPANY_A, DEMO, login } from "./helpers";
import { dachSetzen, modulWaehlen } from "./planer-helfer";

/*
 * Einzelnes Modul setzen (Wunsch vom 13.08.2026).
 *
 * Bisher gab es nur „Dach voll belegen" und danach das Wegtippen — wer
 * eine kleine Anlage plante, entfernte dreissig Module von Hand. Und:
 * Wohin ein Modul kommt, war vor dem Klick nicht zu sehen.
 */

const LINZ = { lat: 48.30604, lon: 14.28583 };

async function aufraeumen() {
  await admin().from("planer_projekt").delete().eq("company_id", COMPANY_A).like("name", "Setzen%");
}
test.beforeEach(aufraeumen);
test.afterAll(aufraeumen);

test.describe("Planer — einzelnes Modul", () => {
  test("Ein Klick setzt genau ein Modul, danach hört das Werkzeug auf", async ({ page }) => {
    await login(page, DEMO.gf);
    await page.goto("/planer/neu");
    await page.route("**/api/planer/adresse**", (r) =>
      r.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ treffer: [{ name: "Setzenweg 1, 4020 Linz", ...LINZ }] }),
      }),
    );
    await page.getByLabel("Adresse suchen").fill("Setzenweg 1");
    await page.getByRole("button", { name: /Setzenweg 1/ }).click();
    await page.getByLabel("Projektname").fill("Setzen");
    await page.getByRole("button", { name: "Projekt anlegen" }).click();
    await page.waitForURL(/\/planer\/[0-9a-f-]{36}$/);
    const id = page.url().split("/").pop()!;

    await dachSetzen(page, "Pultdach", "14", "9");
    await page.getByRole("button", { name: /^Fläche 1/ }).click();
    await page.getByRole("button", { name: /^2 Belegung/ }).click();
    await modulWaehlen(page);

    await page.getByRole("button", { name: "Modul einzeln setzen" }).click();

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

    /**
     * Wie viel Fläche das Canvas deckend füllt.
     *
     * Die Schwelle liegt über der Dachfüllung (28 % Deckkraft): Sonst
     * zählt das Dach selbst mit, und das Geistermodul darauf fällt in
     * der Summe nicht auf — genau daran ist die erste Messung
     * gescheitert.
     */
    const gefuellt = async () =>
      page.evaluate(() => {
        const c = document.querySelector<HTMLCanvasElement>(
          '[data-testid="planer-leinwand"] canvas',
        );
        const ctx = c?.getContext("2d");
        if (!c || !ctx) return -1;
        const d = ctx.getImageData(0, 0, c.width, c.height).data;
        let n = 0;
        for (let i = 3; i < d.length; i += 4) if (d[i]! > 120) n++;
        return n;
      });

    const k = (await page.getByTestId("planer-leinwand").boundingBox())!;
    const mitte = { x: k.x + k.width / 2, y: k.y + k.height / 2 };

    /*
     * Erst über die Fläche fahren: Das Geisterbild muss erscheinen,
     * bevor irgendetwas angelegt wird. Geprüft an den Bildpunkten —
     * es liegt auf dem Canvas, nicht im DOM.
     */
    const ohneGeist = await gefuellt();
    await page.mouse.move(mitte.x, mitte.y);
    await page.waitForTimeout(400);


    /*
     * Zwei Nachweise: der Zustand am Wurzelknoten und die Fläche auf dem
     * Canvas. Der Zustand allein sagte nur, dass gerechnet wurde —
     * gezeichnet sein muss es auch. Verglichen wird mit dem Bild VOR der
     * ersten Zeigerbewegung; ein fester Schwellwert hinge am Zoom.
     */
    await expect(page.getByTestId("planer-leinwand")).toHaveAttribute("data-geist", "passt");
    const mitGeist = await gefuellt();
    expect(mitGeist - ohneGeist, "Das Geistermodul deckt Fläche").toBeGreaterThan(300);

    expect(await modulzahl(), "noch nichts angelegt").toBe(0);

    // Klick: genau ein Modul.
    await page.mouse.click(mitte.x, mitte.y);
    await expect.poll(modulzahl, { timeout: 20_000 }).toBe(1);

    /*
     * Danach hört das Werkzeug auf (Wunsch vom 13.08.2026: „es soll dann
     * aufhören und nur die + zeigen, wo welche dazu passen"). Ein
     * zweiter Klick daneben legt also nichts an — das nächste Modul
     * kommt über das Pluszeichen an der Kante.
     */
    await expect(page.getByTestId("planer-leinwand")).not.toHaveAttribute("data-geist", /passt/);
    await page.mouse.click(mitte.x + 70, mitte.y);
    await page.waitForTimeout(1200);
    expect(await modulzahl(), "das Werkzeug hat nach dem ersten Modul aufgehört").toBe(1);

    // Und weit neben dem Dach passiert erst recht nichts.
    await page.mouse.click(k.x + 40, k.y + k.height - 40);
    await page.waitForTimeout(800);
    expect(await modulzahl()).toBe(1);
  });
});
