import { deflateSync } from "node:zlib";
import { expect, type Page, test } from "@playwright/test";
import { DEMO, login } from "./helpers";
import { mehrOeffnen } from "./planer-helfer";

/*
 * Planer, Stufe 2 — Drohnenfoto und Kalibrierung (Briefing 2.3,
 * Abnahmetest 6).
 *
 * Gehört zur eigenen Planer-Suite: `pnpm test:e2e:planer`.
 */

/* ── Ein echtes, dekodierbares PNG ────────────────────────────────
 *
 * Kein Stub aus ein paar Bytes: die Oberfläche liest die Bildmasse mit
 * `new Image()` aus, bevor sie hochlädt. Ein nicht dekodierbares Bild
 * käme deshalb nie beim Server an, und der Test prüfte nichts.
 */
function crc32(daten: Buffer): number {
  let c = ~0;
  for (const b of daten) {
    c ^= b;
    for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function block(typ: string, inhalt: Buffer): Buffer {
  const kopf = Buffer.alloc(4);
  kopf.writeUInt32BE(inhalt.length, 0);
  const koerper = Buffer.concat([Buffer.from(typ, "ascii"), inhalt]);
  const pruef = Buffer.alloc(4);
  pruef.writeUInt32BE(crc32(koerper), 0);
  return Buffer.concat([kopf, koerper, pruef]);
}

function png(breite: number, hoehe: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(breite, 0);
  ihdr.writeUInt32BE(hoehe, 4);
  ihdr[8] = 8; // Bittiefe
  ihdr[9] = 2; // Truecolor
  const roh = Buffer.alloc(hoehe * (1 + breite * 3));
  for (let y = 0; y < hoehe; y++) {
    const zeile = y * (1 + breite * 3);
    roh[zeile] = 0; // Filter „keiner"
    for (let x = 0; x < breite; x++) {
      const p = zeile + 1 + x * 3;
      // Schachbrett, damit man auf dem Bild etwas erkennt.
      const hell = (Math.floor(x / 40) + Math.floor(y / 40)) % 2 === 0;
      roh[p] = hell ? 190 : 90;
      roh[p + 1] = hell ? 185 : 88;
      roh[p + 2] = hell ? 175 : 82;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    block("IHDR", ihdr),
    block("IDAT", deflateSync(roh)),
    block("IEND", Buffer.alloc(0)),
  ]);
}

const BREITE = 800;
const HOEHE = 600;

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
}

async function fotoHochladen(page: Page) {
  // Die Bildquelle steckt hinter „Mehr einstellen" — sie ist die Ausnahme.
  await mehrOeffnen(page);
  await page.getByLabel("Drohnenfoto hochladen").setInputFiles({
    name: "dach.png",
    mimeType: "image/png",
    buffer: png(BREITE, HOEHE),
  });
  // Nach dem Upload lädt die Seite neu, um die signierte Adresse zu holen.
  await expect(page.getByText("nicht kalibriert")).toBeVisible({ timeout: 25_000 });
}

/** Referenzstrecke ziehen und ihre wahre Länge angeben. */
async function kalibrieren(page: Page, knopf: RegExp, dx: number, dy: number, meter: string) {
  const werkzeug = page.getByRole("button", { name: knopf });
  await werkzeug.click();
  /*
   * Erst ziehen, wenn das Werkzeug wirklich aktiv ist. Direkt nach dem
   * Neuladen kann ein Klick die Schaltfläche treffen, bevor React sie
   * übernommen hat — dann schwenkt der Zug nur die Karte, und der Test
   * fällt sprunghaft aus.
   */
  await expect(werkzeug).toHaveAttribute("aria-pressed", "true");
  const k = (await page.getByTestId("planer-leinwand").boundingBox())!;
  const m = { x: k.x + k.width / 2, y: k.y + k.height / 2 };
  await page.mouse.move(m.x - dx / 2, m.y - dy / 2);
  await page.mouse.down();
  await page.mouse.move(m.x + dx / 2, m.y + dy / 2, { steps: 14 });
  await page.mouse.up();
  const feld = page.getByLabel(/Wahre Länge/);
  await expect(feld).toBeVisible();
  await feld.fill(meter);
  await feld.press("Enter");
}

test.describe("Planer — Drohnenfoto", () => {
  test("Foto ersetzt die Karte und gilt bis zur Kalibrierung als geschätzt", async ({ page }) => {
    await login(page, DEMO.buero);
    await neuesProjekt(page, "Fotoweg 1");

    // Vorher: Kartenanbieter, kein Foto.
    await expect(page.getByRole("button", { name: "Basemap" })).toBeVisible();

    await fotoHochladen(page);

    /*
     * Der Massstab ist jetzt geraten, und die Oberfläche sagt das auch —
     * ein geratener Massstab, der wie eine Messung aussieht, wäre
     * schlimmer als gar keiner.
     */
    await expect(page.getByText(/cm je Bildpunkt \(geschätzt\)/)).toBeVisible();
    await expect(page.getByTitle(/Längen sind geschätzt/)).toBeVisible();
    // Die Anbieterleiste ist weg: es gilt das Foto.
    await expect(page.getByRole("button", { name: "Basemap" })).toHaveCount(0);
  });

  test("Kalibrieren setzt den Massstab — Abnahmetest 6", async ({ page }) => {
    await login(page, DEMO.buero);
    await neuesProjekt(page, "Kalibrierweg 2");
    await fotoHochladen(page);

    /*
     * Vorläufig deckt das Bild 60 m ab, also 60/800 m je Bildpunkt =
     * 7,50 cm. Danach wird eine Strecke auf 8,00 m gesetzt; der Massstab
     * skaliert um genau das Verhältnis mit.
     */
    await expect(page.getByText("7,50 cm je Bildpunkt (geschätzt)")).toBeVisible();

    await kalibrieren(page, /^Kalibrieren$/, 300, 0, "8,00");

    await expect(page.getByText("kalibriert", { exact: true })).toBeVisible();
    const text = (await page.getByText(/cm je Bildpunkt/).textContent()) ?? "";
    expect(text).not.toContain("geschätzt");

    // Der neue Faktor muss kleiner sein: 300 Punkte sind nur 8 m, nicht 22.
    const cm = Number(text.replace(/[^0-9,]/g, "").replace(",", "."));
    expect(cm).toBeGreaterThan(0);
    expect(cm).toBeLessThan(7.5);
  });

  test("Gegenprobe deckt ein schräg aufgenommenes Foto auf", async ({ page }) => {
    await login(page, DEMO.buero);
    await neuesProjekt(page, "Schraegweg 3");
    await fotoHochladen(page);

    // Referenz: 300 Punkte waagrecht sind 8,00 m.
    await kalibrieren(page, /^Kalibrieren$/, 300, 0, "8,00");

    /*
     * Gegenprobe quer dazu: dieselbe Strecke in Punkten, aber der Nutzer
     * misst in Wirklichkeit 9,00 m. Das sind 12,5 % Abweichung — das
     * Foto ist nicht senkrecht aufgenommen.
     */
    await kalibrieren(page, /^Gegenprobe$/, 0, 300, "9,00");
    await expect(page.getByText(/Foto ist verzerrt/)).toBeVisible();
    await expect(page.getByText(/12,5 % Abweichung/)).toBeVisible();
  });

  test("Gegenprobe schweigt, wenn das Foto passt", async ({ page }) => {
    await login(page, DEMO.buero);
    await neuesProjekt(page, "Geradeweg 4");
    await fotoHochladen(page);

    await kalibrieren(page, /^Kalibrieren$/, 300, 0, "8,00");
    // Gleiche Punktzahl, gleiches Mass — kein Verzug.
    await kalibrieren(page, /^Gegenprobe$/, 0, 300, "8,00");
    await expect(page.getByText(/Gegenprobe stimmt/)).toBeVisible();
    await expect(page.getByText(/verzerrt/)).toHaveCount(0);
  });

  test("Foto entfernen bringt die Karte zurück", async ({ page }) => {
    await login(page, DEMO.buero);
    await neuesProjekt(page, "Zurueckweg 5");
    await fotoHochladen(page);

    await page.getByRole("button", { name: "Foto entfernen" }).click();
    await expect(page.getByRole("button", { name: "Basemap" })).toBeVisible({ timeout: 25_000 });
    await expect(page.getByText("nicht kalibriert")).toHaveCount(0);
  });

  test("Kalibrierung übersteht das Neuladen", async ({ page }) => {
    await login(page, DEMO.buero);
    await neuesProjekt(page, "Bestandweg 6");
    await fotoHochladen(page);
    await kalibrieren(page, /^Kalibrieren$/, 300, 0, "8,00");
    await expect(page.getByText("kalibriert", { exact: true })).toBeVisible();

    await page.reload();
    // Nach dem Neuladen ist „Mehr einstellen" wieder zu.
    await mehrOeffnen(page);
    await expect(page.getByText("kalibriert", { exact: true })).toBeVisible({ timeout: 25_000 });
    await expect(page.getByText(/geschätzt/)).toHaveCount(0);
  });
});
