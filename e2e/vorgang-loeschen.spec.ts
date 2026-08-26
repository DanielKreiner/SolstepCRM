import { expect, test } from "@playwright/test";
import { COMPANY_A, DEMO, admin, login } from "./helpers";

/*
 * Vorgänge löschen.
 *
 * Mit einer Bremse: Sobald eine Rechnung dranhängt, wird nicht gelöscht.
 * Rechnungen sind aufzubewahren, und ein Beleg ohne Vorgang ist im
 * Zweifel nicht mehr erklärbar. Für erledigte Geschäfte gibt es „als
 * verloren markieren".
 */

const MARKE = "E2E-LOESCH";

async function aufraeumen(): Promise<void> {
  const db = admin();
  const { data: vs } = await db
    .from("vorgang")
    .select("id")
    .eq("company_id", COMPANY_A)
    .like("adresse", `${MARKE}%`);
  for (const v of vs ?? []) {
    await db.from("vorgang_dokument").delete().eq("vorgang_id", v.id);
    await db.from("vorgang").delete().eq("id", v.id);
  }
  await db.from("customer").delete().eq("company_id", COMPANY_A).like("name", `${MARKE}%`);
}

test.beforeEach(aufraeumen);
test.afterAll(aufraeumen);

/** Ein Vorgang mit Kunde, direkt in der Datenbank. */
async function vorgangAnlegen(suffix: string): Promise<{ id: string; nummer: string }> {
  const db = admin();
  const { data: kunde } = await db
    .from("customer")
    .insert({ company_id: COMPANY_A, type: "lead", name: `${MARKE} ${suffix}` })
    .select("id")
    .single();

  const { data: nr } = await db.rpc("next_number", {
    p_company: COMPANY_A,
    p_kind: "vorgang",
  });

  const { data: v } = await db
    .from("vorgang")
    .insert({
      company_id: COMPANY_A,
      customer_id: kunde!.id,
      number: nr as string,
      phase: "anfrage",
      adresse: `${MARKE}weg ${suffix}`,
    })
    .select("id, number")
    .single();

  return { id: v!.id as string, nummer: v!.number as string };
}

test("Ein Vorgang ohne Rechnung lässt sich löschen", async ({ page }) => {
  const { id, nummer } = await vorgangAnlegen("1");
  await login(page, DEMO.gf);
  await page.goto(`/vorgaenge/${id}`);

  await page.getByRole("button", { name: "Vorgang löschen" }).click();
  await expect(page.getByRole("heading", { name: /wirklich löschen/i })).toBeVisible();
  await page.getByRole("button", { name: "Endgültig löschen" }).click();

  /* Danach steht man in der Liste, mit der Meldung im Kopf. */
  await page.waitForURL(/\/vorgaenge\?weg=/, { timeout: 20_000 });
  await expect(page.getByRole("status")).toContainText(`${nummer} gelöscht`);

  const { data } = await admin().from("vorgang").select("id").eq("id", id).maybeSingle();
  expect(data, `${nummer} ist weg`).toBeNull();
});

test("Mit Rechnung bleibt er stehen — mit Begründung", async ({ page }) => {
  const { id } = await vorgangAnlegen("2");
  const db = admin();
  const { error } = await db.from("vorgang_dokument").insert({
    company_id: COMPANY_A,
    vorgang_id: id,
    typ: "schlussrechnung",
    nummer: `${MARKE}-R1`,
    dateiname: `${MARKE}-R1.pdf`,
    betrag_netto: 1000,
    betrag_brutto: 1200,
  });
  expect(error, "die Prüfrechnung muss stehen").toBeNull();

  await login(page, DEMO.gf);
  await page.goto(`/vorgaenge/${id}`);
  await page.getByRole("button", { name: "Vorgang löschen" }).click();
  await page.getByRole("button", { name: "Endgültig löschen" }).click();

  await expect(page.getByText(/Rechnungen sind aufzubewahren/)).toBeVisible({
    timeout: 20_000,
  });

  const { data } = await db.from("vorgang").select("id").eq("id", id).maybeSingle();
  expect(data, "der Vorgang steht noch").not.toBeNull();
});
