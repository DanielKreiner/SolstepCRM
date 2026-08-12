import { expect, test } from "@playwright/test";
import { admin, COMPANY_A, DEMO, login } from "./helpers";
import { belegen, dachSetzen } from "./planer-helfer";

/*
 * Planer — Verschattung (BRIEFING-planer-3d.md, Stufe 3D-3).
 *
 * Die Geometrie ist in lib/planer/verschattung.spec.ts gegen
 * nachgerechnete Fälle geprüft. Hier geht es darum, dass ein gesetzter
 * Baum wirklich im Ertrag ankommt — ein Schattenwurf, der nur gezeichnet
 * wird, wäre schlimmer als keiner: Er suggeriert eine Rechnung, die
 * nicht stattfindet.
 */

const LINZ = { lat: 48.30604, lon: 14.28583 };

async function aufraeumen() {
  await admin().from("planer_projekt").delete().eq("company_id", COMPANY_A).like("name", "Schatten%");
}

test.beforeEach(aufraeumen);
test.afterAll(aufraeumen);

test.describe("Planer — Verschattung", () => {
  test("Ein Baum südlich senkt den Ertrag und wird ausgewiesen", async ({ page }) => {
    await login(page, DEMO.gf);
    await page.goto("/planer/neu");
    await page.route("**/api/planer/adresse**", (r) =>
      r.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ treffer: [{ name: "Schattenweg 1, 4020 Linz", ...LINZ }] }),
      }),
    );
    await page.getByLabel("Adresse suchen").fill("Schattenweg 1");
    await page.getByRole("button", { name: /Schattenweg 1/ }).click();
    await page.getByLabel("Projektname").fill("Schatten");
    await page.getByRole("button", { name: "Projekt anlegen" }).click();
    await page.waitForURL(/\/planer\/[0-9a-f-]{36}$/);
    const id = page.url().split("/").pop()!;

    await page.getByRole("button", { name: "Näher heran" }).click();
    await dachSetzen(page, "Pultdach", "14", "9");
    await page.getByRole("button", { name: /^Fläche 1/ }).click();
    await belegen(page);
    await expect(page.getByRole("button", { name: /^Feld 1/ })).toBeVisible();

    /** Jahresertrag aus der Kennzahlenleiste. */
    const ertrag = async () => {
      const t =
        (await page.getByText(/^KWH\/JAHR/).locator("..").locator("div.num").textContent()) ?? "";
      return Number(t.replace(/[^0-9]/g, "") || "0");
    };
    await expect.poll(ertrag, { timeout: 30_000 }).toBeGreaterThan(0);
    const vorher = await ertrag();

    /*
     * Anzahl und mittlere Helligkeit der Modulpunkte auf der Leinwand.
     *
     * Gemessen wird am Bild, nicht an einer Zahl im Panel: Eine Kennzahl
     * allein liesse offen, ob am Dach überhaupt etwas zu sehen ist — und
     * genau darauf schaut der Kunde am Tisch. Ein exakter Farbvergleich
     * scheidet aus, weil die Modulfläche halb durchsichtig über dem
     * Luftbild liegt und damit jedes Modul eine andere Mischfarbe hat.
     */
    const modulPunkte = () =>
      page.evaluate(() => {
        const c = document.querySelector<HTMLCanvasElement>(
          '[data-testid="planer-leinwand"] canvas',
        );
        const ctx = c?.getContext("2d");
        if (!c || !ctx) return { anzahl: -1, helligkeit: -1 };
        const d = ctx.getImageData(0, 0, c.width, c.height).data;
        let anzahl = 0;
        let summe = 0;
        for (let i = 0; i < d.length; i += 4) {
          const [r, g, b, a] = [d[i]!, d[i + 1]!, d[i + 2]!, d[i + 3]!];
          /*
           * Modulfläche: deckend, dunkel und BLAUstichig — b über g. Die
           * Bedingung „b über r" allein genügt nicht: Die Baumkrone ist
           * grün (33,66,60) und erfüllt sie ebenfalls. Der erste Anlauf
           * zählte sie mit, und weil sie heller ist als ein Modul, STIEG
           * die gemessene Helligkeit durch den Schatten.
           */
          if (a > 200 && b > g + 5 && b > r + 15 && b < 110 && r < 70) {
            anzahl++;
            summe += 0.2126 * r + 0.7152 * g + 0.0722 * b;
          }
        }
        return { anzahl, helligkeit: anzahl > 0 ? summe / anzahl : 0 };
      });
    const vorherPunkte = await modulPunkte();
    expect(vorherPunkte.anzahl, "Die Module müssen gezeichnet sein").toBeGreaterThan(500);

    // Ohne Objekte gibt es keine Schatten-Kennzahl.
    await expect(page.getByText("SCHATTEN", { exact: true })).toHaveCount(0);

    /*
     * Einen sehr hohen Baum unmittelbar südlich des Dachs setzen. Über
     * die Datenbank, nicht über die Karte: Die Lage muss exakt stimmen,
     * damit der Test aussagekräftig ist — ein Klick träfe je nach
     * Ausschnitt eine andere Stelle.
     */
    const { data } = await admin().from("planer_projekt").select("plan").eq("id", id).single();
    const plan = data!.plan as Record<string, unknown>;
    await admin()
      .from("planer_projekt")
      .update({
        plan: {
          ...plan,
          objekte: [
            {
              id: "o1",
              art: "baum",
              name: "Fichte",
              hoehe: 25,
              mitte: { x: 0, y: -8 },
              radius: 8,
            },
          ],
        },
      })
      .eq("id", id);

    await page.reload();
    await expect.poll(ertrag, { timeout: 30_000 }).toBeGreaterThan(0);

    // Der Verlust steht jetzt in der Leiste.
    await expect(page.getByText("SCHATTEN", { exact: true })).toBeVisible();
    const nachher = await ertrag();
    expect(nachher, "Der Baum muss Ertrag kosten").toBeLessThan(vorher);

    /*
     * Und zwar spürbar, aber nicht vollständig: Ein verschattetes Modul
     * liefert weiter diffuses Licht.
     */
    expect(nachher).toBeGreaterThan(vorher * 0.2);

    /*
     * Und die Module sind eingefärbt: Ein 25 m hoher Baum mit 8 m Krone
     * unmittelbar südlich verschattet praktisch das ganze Feld, also muss
     * die Modulfläche deutlich dunkler geworden sein.
     */
    await expect
      .poll(async () => (await modulPunkte()).helligkeit, { timeout: 20_000 })
      .toBeLessThan(vorherPunkte.helligkeit - 5);
  });

  test("Das PDF rechnet mit demselben Schatten wie der Bildschirm", async ({ page }) => {
    /*
     * Das PDF entsteht serverseitig aus dem gespeicherten Plan. Bis
     * Stufe 3D-3 rechnete es den Ertrag OHNE Verschattung: Auf dem
     * Bildschirm stand der geminderte Wert, auf dem Blatt beim Kunden
     * der ungeminderte.
     *
     * Was dieser Test zeigt und was nicht: Er prüft, dass die
     * Verschattungsrechnung im PDF-Weg durchläuft und ein vollständiges
     * Dokument entsteht — der Weg, auf dem ein fehlender Längengrad oder
     * ein leeres Modulfeld einen Serverfehler gäbe. Die ZAHL im PDF
     * lässt sich nicht nachlesen: Der Text ist komprimiert und mit
     * Teilschriften kodiert. Dass sie stimmt, hängt daran, dass beide
     * Seiten dieselbe Funktion aufrufen — geprüft in
     * `lib/planer/verschattung.spec.ts`.
     */
    await login(page, DEMO.gf);
    await page.goto("/planer/neu");
    await page.route("**/api/planer/adresse**", (r) =>
      r.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ treffer: [{ name: "Schattenweg 3, 4020 Linz", ...LINZ }] }),
      }),
    );
    await page.getByLabel("Adresse suchen").fill("Schattenweg 3");
    await page.getByRole("button", { name: /Schattenweg 3/ }).click();
    await page.getByLabel("Projektname").fill("Schatten PDF");
    await page.getByRole("button", { name: "Projekt anlegen" }).click();
    await page.waitForURL(/\/planer\/[0-9a-f-]{36}$/);
    const id = page.url().split("/").pop()!;

    await page.getByRole("button", { name: "Näher heran" }).click();
    await dachSetzen(page, "Satteldach");
    await page.getByRole("button", { name: /^Fläche 1/ }).click();
    await belegen(page);
    await expect(page.getByRole("button", { name: /^Feld 1/ })).toBeVisible();

    const gespeichert = () =>
      admin().from("planer_projekt").select("plan, kwp").eq("id", id).single();
    await expect
      .poll(async () => Number((await gespeichert()).data?.kwp ?? 0), { timeout: 20_000 })
      .toBeGreaterThan(0);

    // Ohne Baum: das PDF muss ein vollständiges Dokument sein.
    const ohne = await page.request.get(`/api/planer/pdf/${id}`);
    expect(ohne.status()).toBe(200);
    const ohneGross = (await ohne.body()).length;
    expect(ohneGross).toBeGreaterThan(20_000);

    // Baum setzen und dasselbe PDF erneut holen.
    const { data } = await gespeichert();
    await admin()
      .from("planer_projekt")
      .update({
        plan: {
          ...(data!.plan as Record<string, unknown>),
          objekte: [
            { id: "o1", art: "baum", name: "Fichte", hoehe: 25, mitte: { x: 0, y: -7 }, radius: 8 },
          ],
        },
      })
      .eq("id", id);

    const mit = await page.request.get(`/api/planer/pdf/${id}`);
    expect(mit.status(), "das PDF darf am Baum nicht scheitern").toBe(200);
    const roh = await mit.body();
    expect(roh.subarray(0, 4).toString()).toBe("%PDF");
    const seiten = (roh.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
    expect(seiten, "sechs Seiten wie ohne Baum").toBe(6);
  });

  test("Der Baum ist auch in der räumlichen Ansicht kein Fehler", async ({ page }) => {
    const fehler: string[] = [];
    page.on("pageerror", (e) => fehler.push(e.message));

    await login(page, DEMO.gf);
    await page.goto("/planer/neu");
    await page.route("**/api/planer/adresse**", (r) =>
      r.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ treffer: [{ name: "Schattenweg 2, 4020 Linz", ...LINZ }] }),
      }),
    );
    await page.getByLabel("Adresse suchen").fill("Schattenweg 2");
    await page.getByRole("button", { name: /Schattenweg 2/ }).click();
    await page.getByLabel("Projektname").fill("Schatten 3D");
    await page.getByRole("button", { name: "Projekt anlegen" }).click();
    await page.waitForURL(/\/planer\/[0-9a-f-]{36}$/);

    await dachSetzen(page, "Satteldach");

    // Baum mit dem Werkzeug setzen.
    await page.getByRole("button", { name: /Baum setzen/ }).click();
    const k = (await page.getByTestId("planer-leinwand").boundingBox())!;
    await page.mouse.click(k.x + k.width / 2, k.y + k.height / 2 + 120);

    /*
     * Auf den gespeicherten Stand warten. Der Autosave läuft gedrosselt;
     * eine feste Wartezeit wäre entweder zu kurz oder verschenkte Zeit.
     * `objekte` kann fehlen, solange nie eines gesetzt wurde — der
     * Vorgabewert des Schemas greift beim Lesen, nicht in der Ablage.
     */
    const projektId = page.url().split("/").pop()!;
    await expect
      .poll(
        async () => {
          const { data } = await admin()
            .from("planer_projekt")
            .select("plan")
            .eq("id", projektId)
            .single();
          const plan = data!.plan as { objekte?: unknown[] };
          return plan.objekte?.length ?? 0;
        },
        { timeout: 20_000 },
      )
      .toBe(1);

    /*
     * Der Baum steht jetzt im Panel und ist dort zu bemassen. Bis Stufe
     * 3D-3 verwies der Kommentar im Werkzeug auf ein Panel, das es nicht
     * gab: Jeder Baum blieb bei 10 m Höhe und 3 m Krone — eine alte
     * Fichte und ein Zierapfel kosteten dasselbe.
     */
    await page.getByRole("button", { name: "Schattenwerfer (1)", exact: true }).click();
    await page.getByLabel("Höhe", { exact: true }).fill("18");
    await page.getByLabel("Krone", { exact: true }).fill("5");
    await expect
      .poll(
        async () => {
          const { data } = await admin()
            .from("planer_projekt")
            .select("plan")
            .eq("id", projektId)
            .single();
          const plan = data!.plan as { objekte?: Array<{ hoehe: number; radius: number }> };
          const o = plan.objekte?.[0];
          return o ? `${o.hoehe}/${o.radius}` : "";
        },
        { timeout: 20_000 },
      )
      .toBe("18/5");

    await page.getByRole("button", { name: "2D", exact: true }).click();
    await expect(page.getByTestId("planer-3d")).toBeVisible();
    await page.waitForTimeout(2000);
    expect(fehler, `Fehler in der Seite: ${fehler.join(" | ")}`).toHaveLength(0);

    // Und wieder weg: Ein gesetzter Baum muss auch zurücknehmbar sein.
    await page.getByRole("button", { name: "3D", exact: true }).click();
    // Genau dieser Baum, nicht „Gruppe entfernen" daneben.
    await page.getByRole("button", { name: "Entfernen: Baum 1", exact: true }).click();
    await expect(page.getByRole("button", { name: /Schattenwerfer/ })).toHaveCount(0);
  });
});
