import { expect, test } from "@playwright/test";
import {
  DEMO,
  admin,
  login,
  stockOf,
  suchwahl,
  vorgangHours,
  vorgangId,
  vorgangNummer,
} from "./helpers";

/*
 * Definition of Done Meilenstein 1 (CLAUDE.md Abschnitt 12):
 *   "Zeitbuchung mit Auftragsbezug erzeugt korrekten Saldo,
 *    Materialentnahme senkt Bestand"
 *
 * Beides wird über die Oberfläche ausgelöst und in der Datenbank nachgemessen —
 * nicht am DOM abgelesen. Ein Screen, der die richtige Zahl anzeigt, aber
 * nichts speichert, muss durchfallen.
 */

test.describe.configure({ mode: "serial" });



test("Zeitbuchung mit Auftragsbezug erhöht die Iststunden des Auftrags", async ({
  page,
}) => {
  const AUFTRAG = "A-2026-0042";
  const vorher = await vorgangHours(AUFTRAG);
  const id = await vorgangId(AUFTRAG);

  await login(page, DEMO.bauleitung);
  await page.goto("/zeiten");

  const form = page.locator("form", { hasText: "Buchung anlegen" });
  await form.getByLabel("Beginn").fill("06:00");
  await form.getByLabel("Ende").fill("09:30");
  await suchwahl(form, "Vorgang", await vorgangNummer(AUFTRAG));
  await form.getByLabel("Notiz").fill("E2E Meilenstein 1");
  await form.getByRole("button", { name: /Buchung anlegen/ }).click();

  await expect(form.getByRole("status")).toContainText("Buchung gespeichert");

  // 06:00–09:30 = 3,5 Stunden
  const nachher = await vorgangHours(AUFTRAG);
  expect(nachher - vorher).toBeCloseTo(3.5, 2);

  /*
   * Und die Buchung hängt am richtigen Vorgang — die Zahl allein könnte
   * auch von einer Buchung ohne Bezug stammen.
   */
  const { data: gebucht } = await admin()
    .from("time_entry")
    .select("vorgang_id")
    .eq("note", "E2E Meilenstein 1")
    .single();
  expect(gebucht!.vorgang_id).toBe(id);

  await admin().from("time_entry").delete().eq("note", "E2E Meilenstein 1");
});

test("Verdrehte Zeiten werden abgewiesen und nicht gespeichert", async ({
  page,
}) => {
  const AUFTRAG = "A-2026-0042";

  await login(page, DEMO.bauleitung);
  await page.goto("/zeiten");

  const form = page.locator("form", { hasText: "Buchung anlegen" });
  await form.getByLabel("Beginn").fill("10:00");
  await form.getByLabel("Ende").fill("09:00");
  await suchwahl(form, "Vorgang", await vorgangNummer(AUFTRAG));
  await form.getByLabel("Notiz").fill("E2E verdreht");
  await form.getByRole("button", { name: /Buchung anlegen/ }).click();

  await expect(form.getByRole("alert")).toContainText("nach dem Beginn");

  const { count } = await admin()
    .from("time_entry")
    .select("id", { count: "exact", head: true })
    .eq("note", "E2E verdreht");
  expect(count ?? 0).toBe(0);
});

test("Materialentnahme senkt den Bestand, Rückgabe hebt sie auf", async ({
  page,
}) => {
  const SKU = "KAB-SOL-6";
  const vorher = await stockOf(SKU);

  await login(page, DEMO.lager);
  await page.goto("/lager");

  const form = page.locator("form", { hasText: "Material buchen" });
  await suchwahl(form, "Artikel", SKU);
  await form.getByLabel("Art", { exact: true }).selectOption("out");
  await form.getByLabel(/^Menge/).fill("25");
  await form.getByLabel("Notiz").fill("E2E Entnahme");
  await form.getByRole("button", { name: "Buchen" }).click();

  await expect(form.getByRole("status")).toContainText("Entnahme gebucht");
  expect(await stockOf(SKU)).toBe(vorher - 25);

  await suchwahl(form, "Artikel", SKU);
  await form.getByLabel("Art", { exact: true }).selectOption("return");
  await form.getByLabel(/^Menge/).fill("25");
  await form.getByLabel("Notiz").fill("E2E Rückgabe");
  await form.getByRole("button", { name: "Buchen" }).click();

  await expect(form.getByRole("status")).toContainText("Rückgabe gebucht");
  expect(await stockOf(SKU)).toBe(vorher);

  await admin().from("stock_move").delete().like("note", "E2E %");
});

test("Materialentnahme auf einen Vorgang erhöht dessen Materialkosten", async ({
  page,
}) => {
  const AUFTRAG = "A-2026-0042";
  const db = admin();
  const id = await vorgangId(AUFTRAG);
  const artSku = "MOD-JAS-440";

  /*
   * Gerechnet wird hier selbst und nicht über v_vorgang_kpi: die View
   * hängt an current_company_id() und liefert dem Service-Role-Client
   * nichts. Die Formel ist dieselbe wie dort.
   */
  const kosten = async (): Promise<number> => {
    const { data } = await db
      .from("stock_move")
      .select("qty, kind, article:article_id ( purchase_price )")
      .eq("vorgang_id", id)
      .in("kind", ["out", "return"]);
    return (data ?? []).reduce((s, m) => {
      const preis = Number(
        (m.article as unknown as { purchase_price: string } | null)
          ?.purchase_price ?? 0,
      );
      return s + (m.kind === "out" ? 1 : -1) * Number(m.qty) * preis;
    }, 0);
  };

  const vor = await kosten();

  await login(page, DEMO.lager);
  await page.goto("/lager");

  const form = page.locator("form", { hasText: "Material buchen" });
  await suchwahl(form, "Artikel", artSku);
  await form.getByLabel("Art", { exact: true }).selectOption("out");
  await form.getByLabel(/^Menge/).fill("10");
  await suchwahl(form, "Vorgang", await vorgangNummer(AUFTRAG));
  await form.getByLabel("Notiz").fill("E2E Auftragsmaterial");
  await form.getByRole("button", { name: "Buchen" }).click();
  await expect(form.getByRole("status")).toContainText("Entnahme gebucht");

  const nach = await kosten();

  // 10 Stück zu 78,40 EUR Einkaufspreis
  expect(nach - vor).toBeCloseTo(784, 2);

  await db.from("stock_move").delete().eq("note", "E2E Auftragsmaterial");
});

test("Monteur sieht das Lager, darf aber nicht buchen", async ({ page }) => {
  await login(page, DEMO.monteur);
  await page.goto("/lager");

  await expect(
    page.getByText("fehlt deiner Rolle das Schreibrecht"),
  ).toBeVisible();
  await expect(
    page.locator("form", { hasText: "Material buchen" }),
  ).toHaveCount(0);
});
