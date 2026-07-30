import { expect, test } from "@playwright/test";
import { COMPANY_A, DEMO, admin, login, stockOf } from "./helpers";

/*
 * Definition of Done Meilenstein 4 (CLAUDE.md Abschnitt 12):
 *   "Vorschlag aus Bedarf terminierter Aufträge + Mindestbestand,
 *    Mailversand an Lieferant"
 */

test.describe.configure({ mode: "serial" });

/*
 * Setzt Bestellungen und die daraus gebuchten Wareneingänge zurück.
 * Das Löschen der stock_move-Zeilen dreht den Bestand dank des
 * Reversal-Triggers aus Migration 0005 korrekt zurück — sonst würde jeder
 * Testlauf den Bestand dauerhaft nach oben schieben und der
 * Bestellvorschlag beim nächsten Mal andere Mengen rechnen.
 */
async function aufraeumen() {
  const db = admin();

  await db
    .from("stock_move")
    .delete()
    .eq("company_id", COMPANY_A)
    .like("note", "Wareneingang zur Bestellung%");

  const { data: orders } = await db
    .from("purchase_order")
    .select("id")
    .eq("company_id", COMPANY_A);
  for (const o of orders ?? []) {
    await db.from("purchase_order_item").delete().eq("purchase_order_id", o.id);
    await db.from("purchase_order").delete().eq("id", o.id);
  }
  await db
    .from("mail_outbox")
    .delete()
    .eq("company_id", COMPANY_A)
    .is("quote_id", null);
}

test("Der Vorschlag kennt Auftragsbedarf und Mindestbestand getrennt", async ({
  page,
}) => {
  await aufraeumen();
  await login(page, DEMO.lager);
  await page.goto("/lager/bestellungen");

  await expect(
    page.getByRole("heading", { name: "Bestellvorschlag" }),
  ).toBeVisible();

  await expect(page.locator("text=MOD-JAS-440").first()).toBeVisible();
  // Der Bedarf ist auftragsbezogen und nennt den Auftrag beim Namen.
  await expect(page.getByText("A-2026-0042").first()).toBeVisible();
  await expect(page.getByText("Auftrag + Mindest").first()).toBeVisible();

  /*
   * Von Hand nachgerechnet: 420 reserviert, 330 auf Lager, 120 Mindest.
   * Fehlmenge = 420 + 120 - 330 = 210. Ein Vorschlag, der nur die 90 für
   * den Auftrag bestellt, räumt das Lager leer.
   */
  await expect(page.getByLabel("Bestellmenge MOD-JAS-440")).toHaveValue("210");
  // 9 auf Lager, 12 reserviert, 6 Mindest -> 12 + 6 - 9 = 9
  await expect(page.getByLabel("Bestellmenge WR-FRO-10")).toHaveValue("9");

  // Der günstigere Lieferant gewinnt: 78,40 statt 82,50.
  await expect(page.getByText("Solarwerk Großhandel GmbH").first()).toBeVisible();
});

test("Ohne Termin am Auftrag entsteht kein Auftragsbedarf", async ({ page }) => {
  const db = admin();
  const { data: job } = await db
    .from("job")
    .select("id, scheduled_from")
    .eq("company_id", COMPANY_A)
    .eq("number", "A-2026-0042")
    .single();

  // Termin entfernen -> die Reservierungen dürfen nicht mehr zählen.
  await db.from("job").update({ scheduled_from: null }).eq("id", job!.id);

  await login(page, DEMO.lager);
  await page.goto("/lager/bestellungen");
  await expect(page.getByText("A-2026-0042")).toHaveCount(0);

  await db
    .from("job")
    .update({ scheduled_from: job!.scheduled_from })
    .eq("id", job!.id);
});

test("Bestellung anlegen und an den Lieferanten senden", async ({ page }) => {
  await aufraeumen();
  await login(page, DEMO.lager);
  await page.goto("/lager/bestellungen");

  await page.getByRole("button", { name: "Bestellung anlegen" }).click();
  await expect(page.getByRole("status").first()).toContainText("angelegt");

  const db = admin();
  const { data: order } = await db
    .from("purchase_order")
    .select("id, number, status, due_date")
    .eq("company_id", COMPANY_A)
    .single();

  expect(order!.status).toBe("draft");
  expect(String(order!.number)).toMatch(/^B-\d{4}-\d{4}$/);
  expect(order!.due_date).toBeTruthy();

  const { count } = await db
    .from("purchase_order_item")
    .select("id", { count: "exact", head: true })
    .eq("purchase_order_id", order!.id);
  expect(count ?? 0).toBeGreaterThan(0);

  // Senden legt die Mail in die Warteschlange, mit CSV-Anhang.
  // Auf die Erfolgsmeldung kann man nicht warten: sobald der Status nicht
  // mehr Entwurf ist, verschwindet das Formular mitsamt seiner Meldung.
  // Geprüft wird deshalb die Wirkung, nicht der Text.
  await page.reload();
  await page.getByRole("button", { name: "An Lieferant senden" }).first().click();

  await expect
    .poll(
      async () => {
        const { data } = await db
          .from("purchase_order")
          .select("status")
          .eq("id", order!.id)
          .single();
        return data?.status;
      },
      { timeout: 15_000 },
    )
    .toBe("open");

  const { data: mails } = await db
    .from("mail_outbox")
    .select("to_addrs, subject, attachments, status")
    .is("quote_id", null)
    .eq("company_id", COMPANY_A);

  expect(mails).toHaveLength(1);
  const mail = mails![0]!;
  expect(String(mail.subject)).toContain(String(order!.number));
  expect((mail.to_addrs as string[])[0]).toContain("@");

  const anhaenge = mail.attachments as { filename: string; mime: string }[];
  expect(anhaenge).toHaveLength(1);
  expect(anhaenge[0]!.mime).toBe("text/csv");
  expect(anhaenge[0]!.filename).toContain(String(order!.number));

  const { data: nachher } = await db
    .from("purchase_order")
    .select("status, sent_at")
    .eq("id", order!.id)
    .single();
  expect(nachher!.status).toBe("open");
  expect(nachher!.sent_at).toBeTruthy();
});

test("Wareneingang erhöht den Bestand und schließt die Bestellung", async ({
  page,
}) => {
  const db = admin();
  const { data: order } = await db
    .from("purchase_order")
    .select("id, number")
    .eq("company_id", COMPANY_A)
    .single();

  const { data: items } = await db
    .from("purchase_order_item")
    .select("id, qty, article:article_id ( sku )")
    .eq("purchase_order_id", order!.id);

  await login(page, DEMO.lager);
  await page.goto("/lager/bestellungen");

  for (const item of items ?? []) {
    const sku = (item.article as unknown as { sku: string }).sku;
    const vorher = await stockOf(sku);
    const erwartet = vorher + Number(item.qty);

    const zeile = page.locator("li", { hasText: sku }).first();
    await zeile.getByRole("button", { name: "Wareneingang" }).click();

    // Auch hier keine Meldung abwarten: die Zeile wird nach dem Buchen als
    // geliefert neu gerendert, das Formular verschwindet mitsamt Text.
    await expect
      .poll(async () => await stockOf(sku), { timeout: 15_000 })
      .toBe(erwartet);

    await page.reload();
  }

  const { data: nachher } = await db
    .from("purchase_order")
    .select("status")
    .eq("id", order!.id)
    .single();
  expect(nachher!.status).toBe("received");

  await aufraeumen();
});

test("Ein Monteur sieht keinen Bestellvorschlag zum Anlegen", async ({ page }) => {
  await login(page, DEMO.monteur);
  await page.goto("/lager/bestellungen");

  await expect(
    page.getByText("fehlt deiner Rolle das Schreibrecht"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Bestellung anlegen" }),
  ).toHaveCount(0);
});
