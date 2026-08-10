import { expect, type Page, test } from "@playwright/test";
import { admin, COMPANY_A, DEMO, login } from "./helpers";

/*
 * Planer, Stufe 4 — Technik: Geräte wählen, Strings bilden, prüfen
 * (Briefing 5.2 bis 5.4).
 *
 * Das ist der Durchstich: Stammdaten anlegen, Dach belegen, String
 * malen — und die Prüfung sagt in einem Satz, ob es hält. Die Formeln
 * selbst sind in lib/planer/elektrik.spec.ts gegen die Testvektoren des
 * Briefings abgesichert; hier geht es darum, dass dieselben Zahlen
 * wirklich aus der Oberfläche ankommen.
 */

/** Modul der Testvektoren: Uoc 39,4 V, tk −0,25 %/K, Umpp 33,1 V. */
const MODUL = {
  hersteller: "Technikprüfung",
  bezeichnung: "Vektormodul",
  wp: "440",
  uoc: "39,4",
  umpp: "33,1",
  isc: "13,9",
  impp: "13,1",
  tk: "-0,25",
  breite: "1,134",
  hoehe: "1,762",
};

test.beforeEach(async () => {
  const db = admin();
  for (const tabelle of ["planer_speicher", "planer_wechselrichter", "planer_modul"]) {
    await db.from(tabelle).delete().eq("company_id", COMPANY_A).like("hersteller", "Technikprüfung%");
  }
});

async function stammdatenAnlegen(page: Page, maxDc: string, uMin = "200", uMax = "800") {
  await page.goto("/einstellungen?bereich=planer");

  await page.getByRole("textbox", { name: "Hersteller" }).fill(MODUL.hersteller);
  await page.getByLabel("Bezeichnung").fill(MODUL.bezeichnung);
  await page.getByLabel("Nennleistung (Wp)").fill(MODUL.wp);
  await page.getByLabel("Uoc (V)").fill(MODUL.uoc);
  await page.getByLabel("Umpp (V)").fill(MODUL.umpp);
  await page.getByLabel("Isc (A)").fill(MODUL.isc);
  await page.getByLabel("Impp (A)").fill(MODUL.impp);
  await page.getByLabel("Temp.-Koeff. Uoc (%/K)").fill(MODUL.tk);
  await page.getByLabel("Breite (m)").fill(MODUL.breite);
  await page.getByLabel("Höhe (m)").fill(MODUL.hoehe);
  await page.getByRole("button", { name: "Hinzufügen" }).click();
  await expect(page.getByText(/Vektormodul gespeichert/)).toBeVisible();

  await page.getByRole("button", { name: /^Wechselrichter \(/ }).click();
  await page.getByRole("textbox", { name: "Hersteller" }).fill(MODUL.hersteller);
  await page.getByLabel("Bezeichnung").fill("Vektor-WR");
  await page.getByLabel("Max. DC-Spannung (V)").fill(maxDc);
  await page.getByLabel("AC-Nennleistung (kW)").fill("10");
  await page.getByLabel("MPP von (V)").fill(uMin);
  await page.getByLabel("MPP bis (V)").fill(uMax);
  await page.getByLabel("Max. Strom (A)").fill("26");
  await page.getByRole("button", { name: "Hinzufügen" }).click();
  await expect(page.getByText(/Vektor-WR gespeichert/)).toBeVisible();
}

async function projektMitBelegung(page: Page, name: string) {
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
  await page.getByRole("button", { name: "Näher heran" }).click();
  await page.getByRole("button", { name: "Näher heran" }).click();

  await page.getByRole("button", { name: /Standardform setzen/ }).click();
  await page.getByLabel("Form").selectOption("pult");
  await page.getByLabel("Länge (m)").fill("14");
  await page.getByLabel("Tiefe (m)").fill("9");
  await page.getByRole("button", { name: "In die Bildmitte setzen" }).click();
  await page.getByRole("button", { name: /^Fläche 1/ }).click();
  await page.getByRole("button", { name: "Fläche automatisch belegen" }).click();
  // Auf die Gruppe warten, nicht auf „Belegung" — das Wort steht auch
  // an der Phasenleiste und wäre mehrdeutig.
  await expect(page.getByRole("button", { name: /^Feld 1/ })).toBeVisible();
}

/**
 * Modulzahl des ersten Strings.
 *
 * Bewusst aus dem Zählfeld, nicht aus dem Text der ganzen Zeile: dort
 * steht „String 1" direkt vor „0 Module", und ein Regex auf Ziffern las
 * daraus „10". Der Test war damit grün, obwohl nichts zugeordnet war.
 */
async function stringModule(page: Page): Promise<number> {
  const feld = page.getByRole("button", { name: /^String 1/ }).locator("span.num").first();
  const text = (await feld.textContent()) ?? "";
  return Number(text.replace(/[^0-9]/g, "") || "0");
}

/** In die Technik-Phase wechseln und die Geräte wählen. */
async function technikWaehlen(page: Page) {
  await page.getByRole("button", { name: /^3 Technik/ }).click();
  await expect(page.getByRole("heading", { name: "Technik" })).toBeVisible();
  /*
   * Namentlich wählen, nicht über den Index: in den Stammdaten stehen
   * auch Geräte aus früheren Läufen, und ein Index träfe irgendeines.
   * Genau daran ist dieser Test zuerst gescheitert — er prüfte einen
   * fremden Wechselrichter mit ganz anderer DC-Grenze.
   */
  await waehleGeraet(page, "Modul", "Vektormodul");
  await waehleGeraet(page, "Wechselrichter", "Vektor-WR");
}

async function waehleGeraet(page: Page, feld: string, name: string) {
  const auswahl = page.getByLabel(feld, { exact: true });
  const wert = await auswahl.locator("option", { hasText: name }).first().getAttribute("value");
  expect(wert, `Gerät ${name} in ${feld}`).toBeTruthy();
  await auswahl.selectOption(wert!);
  await expect(auswahl).toHaveValue(wert!);
}

test.describe("Planer — Technik", () => {
  test("Ohne Geräte sagt das Panel, was fehlt", async ({ page }) => {
    await login(page, DEMO.gf);
    await projektMitBelegung(page, "Technikweg 1");
    await page.getByRole("button", { name: /^3 Technik/ }).click();

    await expect(page.getByText(/Für die Prüfung fehlen noch/)).toBeVisible();
    // Ohne String ist das Werkzeug gesperrt.
    await expect(page.getByRole("button", { name: /Module dem gewählten String/ })).toBeDisabled();
  });

  test("String malen, Prüfung meldet zu wenige Module und dann grün", async ({ page }) => {
    await login(page, DEMO.gf);
    await stammdatenAnlegen(page, "1000");
    await projektMitBelegung(page, "Stringweg 2");
    await technikWaehlen(page);

    // Solange kein Modul zugeordnet ist, hält der Hinweis die Prüfung auf.
    await expect(page.getByText(/Module ohne String/)).toBeVisible();

    await page.getByRole("button", { name: "String anlegen" }).click();
    await expect(page.getByText(/^String 1$/)).toBeVisible();

    const malen = page.getByRole("button", { name: /Module dem gewählten String/ });
    await expect(malen).toBeEnabled();
    await malen.click();

    /*
     * Über eine Zeile Module fahren. Wie viele es werden, hängt vom
     * Kartenausschnitt ab — geprüft wird deshalb nicht die Anzahl,
     * sondern dass die Prüfung mit derselben Zahl rechnet, die im Panel
     * steht.
     */
    const k = (await page.getByTestId("planer-leinwand").boundingBox())!;
    const y = k.y + k.height / 2;
    await page.mouse.move(k.x + k.width / 2 - 120, y);
    await page.mouse.down();
    await page.mouse.move(k.x + k.width / 2 + 120, y, { steps: 25 });
    await page.mouse.up();

    await expect.poll(async () => stringModule(page)).toBeGreaterThan(0);
    const anzahl = await stringModule(page);

    /*
     * Bei diesem Modul beginnt das MPP-Fenster bei 200 V, ein Modul
     * liefert 33,1 V — unter 7 Modulen muss die Prüfung „mindestens 7"
     * verlangen, darüber darf sie das nicht mehr tun.
     */
    const text = (await page.getByRole("heading", { name: /Elektrisch/ }).locator("..").locator("..").textContent()) ?? "";
    if (anzahl < 7) {
      expect(text).toContain("mindestens 7 Module");
    } else {
      expect(text).not.toContain("mindestens 7 Module");
    }
  });

  test("Zu lange Strings werden mit Höchstzahl abgelehnt", async ({ page }) => {
    await login(page, DEMO.gf);
    // Enge DC-Grenze: schon wenige Module reissen sie.
    await stammdatenAnlegen(page, "300", "50", "800");
    await projektMitBelegung(page, "Grenzweg 3");
    await technikWaehlen(page);

    await page.getByRole("button", { name: "String anlegen" }).click();
    await page.getByRole("button", { name: /Module dem gewählten String/ }).click();

    /*
     * Zwei Reihen malen: bei 300 V Grenze und 42,85 V je Modul sind
     * sieben erlaubt. Eine Reihe allein trifft je nach Ausschnitt
     * womöglich weniger — dann liefe der Test grün, ohne die Grenze
     * überhaupt berührt zu haben.
     */
    const k = (await page.getByTestId("planer-leinwand").boundingBox())!;
    const mx = k.x + k.width / 2;
    for (const dy of [0, -26]) {
      await page.mouse.move(mx - 110, k.y + k.height / 2 + dy);
      await page.mouse.down();
      await page.mouse.move(mx + 110, k.y + k.height / 2 + dy, { steps: 30 });
      await page.mouse.up();
    }

    await expect.poll(async () => stringModule(page)).toBeGreaterThan(7);

    /*
     * Uoc_kalt = 42,85 V, Grenze 300 V → höchstens 7 Module. Eine ganze
     * Reihe hat mehr, also muss der Satz mit der Höchstzahl kommen.
     */
    await expect(page.getByText(/überschreitet die max\. DC-Spannung/)).toBeVisible();
    await expect(page.getByText(/maximal 7 Module/)).toBeVisible();
  });

  test("Speicher wird nur zu passenden Wechselrichtern angeboten", async ({ page }) => {
    await login(page, DEMO.gf);
    await stammdatenAnlegen(page, "1000");
    await projektMitBelegung(page, "Speicherweg 4");
    await technikWaehlen(page);

    /*
     * Der angelegte Wechselrichter ist kein Hybridgerät — dann gibt es
     * gar keine Speicherauswahl, sondern den Grund dafür.
     */
    await expect(page.getByLabel("Speicher")).toHaveCount(0);
    await expect(page.getByText(/kein Hybridgerät/)).toBeVisible();
  });

  test("Technikwahl übersteht das Neuladen", async ({ page }) => {
    await login(page, DEMO.gf);
    await stammdatenAnlegen(page, "1000");
    await projektMitBelegung(page, "Bestandweg 5");
    await technikWaehlen(page);
    await page.getByRole("button", { name: "String anlegen" }).click();

    await expect(page.getByText("gesichert")).toBeVisible({ timeout: 15_000 });
    await page.reload();
    await page.getByRole("button", { name: /^3 Technik/ }).click();

    await expect(page.getByLabel("Modul", { exact: true })).toHaveValue(/.+/);
    await expect(page.getByText(/^String 1$/)).toBeVisible();
  });
});
