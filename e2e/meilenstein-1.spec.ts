import { expect, test } from "@playwright/test";
import {
  COMPANY_A,
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



/*
 * Nachgetragen wird seit dem Zeiten-Umbau auf einen Einsatz, nicht auf
 * einen Vorgang. Das ist die Kernentscheidung des Briefings: eine Zeit
 * ohne Einsatz gehört niemandem. Der Vorgangsbezug kommt vom Einsatz mit
 * — deshalb braucht jeder dieser Tests zuerst einen Einsatz von heute.
 */
async function einsatzHeute(auftrag: string): Promise<string> {
  const db = admin();
  const id = await vorgangId(auftrag);
  const heute = new Date().toISOString().slice(0, 10);

  const { data: person } = await db
    .from("app_user")
    .select("id")
    .eq("email", DEMO.bauleitung)
    .single();

  const { data: e } = await db
    .from("einsatz")
    .insert({
      company_id: COMPANY_A,
      art: "auftrag",
      vorgang_id: id,
      titel: "E2E Meilenstein 1",
      von: `${heute}T04:00:00Z`,
      bis: `${heute}T15:00:00Z`,
    })
    .select("id")
    .single();

  await db.from("einsatz_person").insert({
    company_id: COMPANY_A,
    einsatz_id: e!.id,
    user_id: person!.id,
  });

  return e!.id as string;
}

async function einsatzWeg(einsatzId: string): Promise<void> {
  const db = admin();
  await db.from("time_entry").delete().eq("einsatz_id", einsatzId);
  await db.from("einsatz_person").delete().eq("einsatz_id", einsatzId);
  await db.from("einsatz").delete().eq("id", einsatzId);
}

test("Zeitbuchung mit Auftragsbezug erhöht die Iststunden des Auftrags", async ({
  page,
}) => {
  const AUFTRAG = "A-2026-0042";
  const vorher = await vorgangHours(AUFTRAG);
  const id = await vorgangId(AUFTRAG);
  const einsatzId = await einsatzHeute(AUFTRAG);

  try {
    await login(page, DEMO.bauleitung);
    await page.goto("/zeiten");

    /*
     * Nachgetragen wird für den Monteur, nicht für die eigene Person:
     * die Bauleitung hat im Demo-Datenbestand schon eine Buchung von
     * heute, und die Überschneidungsprüfung würde jede zweite abweisen.
     */
    const { data: person } = await admin()
      .from("app_user")
      .select("id")
      .eq("email", DEMO.monteur)
      .single();

    await page.getByTestId("nacherfassen-person").selectOption(person!.id as string);
    await page.getByTestId("nacherfassen-einsatz").selectOption(einsatzId);
    await page.getByTestId("nacherfassen-von").fill("06:00");
    await page.getByTestId("nacherfassen-bis").fill("09:30");
    await page.getByTestId("nacherfassen-speichern").click();

    await expect(page.getByRole("status").first()).toContainText("nachgetragen", {
      timeout: 15_000,
    });

    // 06:00–09:30 = 3,5 Stunden
    const nachher = await vorgangHours(AUFTRAG);
    expect(nachher - vorher).toBeCloseTo(3.5, 2);

    /*
     * Und die Buchung hängt am richtigen Vorgang — die Zahl allein
     * könnte auch von einer Buchung ohne Bezug stammen.
     */
    const { data: gebucht } = await admin()
      .from("time_entry")
      .select("vorgang_id")
      .eq("einsatz_id", einsatzId)
      .single();
    expect(gebucht!.vorgang_id).toBe(id);
  } finally {
    await einsatzWeg(einsatzId);
  }
});

test("Verdrehte Zeiten werden abgewiesen und nicht gespeichert", async ({
  page,
}) => {
  const AUFTRAG = "A-2026-0042";
  const einsatzId = await einsatzHeute(AUFTRAG);

  try {
    await login(page, DEMO.bauleitung);
    await page.goto("/zeiten");

    /*
     * Nachgetragen wird für den Monteur, nicht für die eigene Person:
     * die Bauleitung hat im Demo-Datenbestand schon eine Buchung von
     * heute, und die Überschneidungsprüfung würde jede zweite abweisen.
     */
    const { data: person } = await admin()
      .from("app_user")
      .select("id")
      .eq("email", DEMO.monteur)
      .single();

    await page.getByTestId("nacherfassen-person").selectOption(person!.id as string);
    await page.getByTestId("nacherfassen-einsatz").selectOption(einsatzId);
    await page.getByTestId("nacherfassen-von").fill("10:00");
    await page.getByTestId("nacherfassen-bis").fill("09:00");
    await page.getByTestId("nacherfassen-speichern").click();

    await expect(page.getByRole("alert").first()).toContainText("nach dem Beginn", {
      timeout: 15_000,
    });

    const { count } = await admin()
      .from("time_entry")
      .select("id", { count: "exact", head: true })
      .eq("einsatz_id", einsatzId);
    expect(count ?? 0).toBe(0);
  } finally {
    await einsatzWeg(einsatzId);
  }
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
