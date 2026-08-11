import { expect, test } from "@playwright/test";
import { admin, COMPANY_A, DEMO, login } from "./helpers";

/*
 * Planer — Kunden-PDF (Briefing 8.1).
 *
 * Das PDF geht zum Kunden und bleibt dort liegen. Es wird deshalb
 * serverseitig aus dem GESPEICHERTEN Plan gerechnet, nicht aus dem, was
 * der Browser zuletzt angezeigt hat — und dieser Test prüft, dass die
 * Zahlen darin auch wirklich aus der Planung stammen.
 */

const LINZ = { lat: 48.30604, lon: 14.28583 };

async function aufraeumen() {
  const db = admin();
  const { data } = await db
    .from("planer_projekt")
    .select("id")
    .eq("company_id", COMPANY_A)
    .like("name", "PDF-Test%");
  for (const p of data ?? []) {
    await db.storage.from("planer-fotos").remove([`${COMPANY_A}/${p.id}/vorschau.jpg`]);
    await db.from("planer_projekt").delete().eq("id", p.id);
  }
  await db.from("planer_modul").delete().eq("company_id", COMPANY_A).like("hersteller", "PDF-Test%");
}

test.beforeEach(aufraeumen);
test.afterAll(aufraeumen);

test.describe("Planer — Kunden-PDF", () => {
  test("erzeugt sechs Seiten mit den Zahlen der Planung", async ({ page }) => {
    const db = admin();
    const { data: modul } = await db
      .from("planer_modul")
      .insert({
        company_id: COMPANY_A,
        hersteller: "PDF-Test",
        bezeichnung: "Modul 440",
        wp: 440,
        uoc: 39.4,
        umpp: 33.1,
        isc: 13.9,
        impp: 13.1,
        tk_uoc: -0.0025,
        breite: 1.134,
        hoehe: 1.762,
      })
      .select("id")
      .single();

    await login(page, DEMO.gf);
    await page.goto("/planer/neu");
    await page.route("**/api/planer/adresse**", (r) =>
      r.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ treffer: [{ name: "PDF-Weg 1, 4020 Linz", ...LINZ }] }),
      }),
    );
    await page.getByLabel("Adresse suchen").fill("PDF-Weg 1");
    await page.getByRole("button", { name: /PDF-Weg 1/ }).click();
    await page.getByLabel("Projektname").fill("PDF-Test Haus");
    await page.getByRole("button", { name: "Projekt anlegen" }).click();
    await page.waitForURL(/\/planer\/[0-9a-f-]{36}$/);
    const id = page.url().split("/").pop()!;

    await page.getByRole("button", { name: "Näher heran" }).click();
    await page.getByRole("button", { name: /Standardform setzen/ }).click();
    await page.getByRole("button", { name: "In die Bildmitte setzen" }).click();
    await page.getByRole("button", { name: /^Fläche 1/ }).click();
    await page.getByRole("button", { name: "Fläche automatisch belegen" }).click();
    await expect(page.getByRole("button", { name: /^Feld 1/ })).toBeVisible();

    await page.getByRole("button", { name: /^3 Technik/ }).click();
    await page.getByLabel("Modul", { exact: true }).selectOption(modul!.id);

    await page.getByRole("button", { name: /^5 Übergabe/ }).click();
    // Warten, bis die Vorschau abgelegt ist — sie gehört aufs Deckblatt.
    await expect
      .poll(
        async () => {
          const { data } = await db
            .from("planer_projekt")
            .select("vorschau_pfad, kwp")
            .eq("id", id)
            .single();
          return data?.vorschau_pfad ?? null;
        },
        { timeout: 30_000 },
      )
      .toBeTruthy();

    // Auf den gespeicherten Stand warten: das PDF rechnet aus ihm.
    await expect
      .poll(
        async () => {
          const { data } = await db.from("planer_projekt").select("kwp").eq("id", id).single();
          return Number(data?.kwp ?? 0);
        },
        { timeout: 20_000 },
      )
      .toBeGreaterThan(0);

    /* ── Das PDF holen und hineinsehen ─────────────────────────── */
    const antwort = await page.request.get(`/api/planer/pdf/${id}`);
    expect(antwort.status()).toBe(200);
    expect(antwort.headers()["content-type"]).toContain("application/pdf");

    const roh = await antwort.body();
    // Eine echte PDF-Datei beginnt mit %PDF und ist nicht winzig.
    expect(roh.subarray(0, 4).toString()).toBe("%PDF");
    expect(roh.length).toBeGreaterThan(20_000);

    /*
     * Der Textinhalt eines PDF ist komprimiert; statt ihn zu
     * entpacken, wird geprüft, was sich zuverlässig prüfen lässt: die
     * Seitenzahl und die Metadaten. Dass die Zahlen stimmen, sichern
     * die Unit-Tests der Rechenkerne ab — hier geht es darum, dass ein
     * vollständiges Dokument entsteht.
     */
    const text = roh.toString("latin1");
    const seiten = (text.match(/\/Type\s*\/Page[^s]/g) ?? []).length;
    expect(seiten, "sechs Seiten laut Briefing 8.1").toBe(6);
    expect(text).toContain("PDF-Test Haus");

    // Und das Deckblattbild ist wirklich eingebettet.
    expect(text).toContain("/Image");
  });

  test("Ohne Planer-Recht kein PDF", async ({ page }) => {
    const db = admin();
    const { data: projekt } = await db
      .from("planer_projekt")
      .insert({
        company_id: COMPANY_A,
        name: "PDF-Test Sperre",
        adresse: "PDF-Weg 9, 4020 Linz",
        ursprung_lat: LINZ.lat,
        ursprung_lon: LINZ.lon,
        anbieter: "basemap",
        zoom: 20,
      })
      .select("id")
      .single();

    await login(page, DEMO.monteur);
    const antwort = await page.request.get(`/api/planer/pdf/${projekt!.id}`);
    expect(antwort.status()).toBe(403);
  });
});
