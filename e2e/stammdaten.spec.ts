import { expect, test } from "@playwright/test";
import { COMPANY_A, DEMO, admin, login } from "./helpers";

/*
 * Anlegen, Ändern, Löschen der Stammdaten.
 *
 * Bis hierher war das System lesend: Zeiten und Material liessen sich
 * buchen, aber weder ein Kunde noch ein Auftrag noch ein Artikel liess sich
 * anlegen. Ein ERP, in dem man nichts anlegen kann, ist keins — deshalb
 * prüfen diese Tests nicht die Optik, sondern ob der Datensatz danach
 * wirklich in der Datenbank steht.
 */

test.describe.configure({ mode: "serial" });

const MARKE = "E2E-STAMM";

async function aufraeumen(): Promise<void> {
  const db = admin();

  await db.from("article").delete().eq("company_id", COMPANY_A).like("sku", `${MARKE}%`);
  await db.from("plant").delete().eq("company_id", COMPANY_A).like("modules", `${MARKE}%`);
  await db.from("customer").delete().eq("company_id", COMPANY_A).like("name", `${MARKE}%`);
}

test.beforeAll(aufraeumen);
test.afterAll(aufraeumen);

test("Kunde anlegen, ändern und archivieren", async ({ page }) => {
  const db = admin();
  await login(page, DEMO.gf);
  await page.goto("/crm");

  await page.getByRole("button", { name: "Kunde anlegen" }).click();
  await page.getByLabel("Name", { exact: true }).fill(`${MARKE} Fam. Testner`);
  await page.getByLabel("Ort").fill("Eisenstadt");
  await page.getByLabel("E-Mail").fill("testner@example.com");
  await page.getByRole("button", { name: "Anlegen" }).click();

  await expect(page.getByText("angelegt")).toBeVisible({ timeout: 15_000 });

  const { data: angelegt } = await db
    .from("customer")
    .select("id, name, city, email, type")
    .eq("company_id", COMPANY_A)
    .like("name", `${MARKE}%`)
    .single();

  expect(angelegt!.city).toBe("Eisenstadt");
  expect(angelegt!.email).toBe("testner@example.com");
  expect(angelegt!.type).toBe("lead");

  // --- Ändern ---
  await page.goto(`/crm?kunde=${angelegt!.id}&bearbeiten=stammdaten`);
  await page.getByLabel("Ort").fill("Oberpullendorf");
  await page.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByText("Gespeichert.")).toBeVisible({ timeout: 15_000 });

  await expect
    .poll(async () => {
      const { data } = await db
        .from("customer")
        .select("city")
        .eq("id", angelegt!.id)
        .single();
      return data?.city;
    })
    .toBe("Oberpullendorf");

  /*
   * Archivieren: geprüft wird die Datenbank, nicht der Toast. Der Toast
   * verschwindet, deleted_at bleibt — und nur das zählt.
   */
  page.on("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "Archivieren" }).click();

  await expect
    .poll(
      async () => {
        const { data } = await db
          .from("customer")
          .select("deleted_at")
          .eq("id", angelegt!.id)
          .single();
        return data?.deleted_at !== null;
      },
      { timeout: 15_000 },
    )
    .toBe(true);
});

test("Ein Kunde mit laufendem Vorgang lässt sich nicht archivieren", async ({
  page,
}) => {
  const db = admin();

  const { data: offener } = await db
    .from("vorgang")
    .select("customer_id, number, phase")
    .eq("company_id", COMPANY_A)
    .not("phase", "in", "(abschluss,verloren)")
    .limit(1)
    .maybeSingle();

  expect(offener, "Seed hat keinen offenen Vorgang").toBeTruthy();

  await login(page, DEMO.gf);
  await page.goto(
    `/crm?kunde=${offener!.customer_id as string}&bearbeiten=stammdaten`,
  );

  page.on("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "Archivieren" }).click();

  await expect(page.getByText(/Es laufen noch \d+ Vorgänge/)).toBeVisible({
    timeout: 15_000,
  });
});

test("Artikel anlegen — Bestand bleibt null, weil er aus Bewegungen entsteht", async ({
  page,
}) => {
  const db = admin();
  await login(page, DEMO.gf);
  await page.goto("/lager");

  await page.getByRole("button", { name: "Artikel anlegen" }).click();
  await page.getByLabel("Artikelnummer").fill(`${MARKE}-001`);
  await page.getByLabel("Bezeichnung").fill("Testschiene 2 m");
  await page.getByLabel("Einkaufspreis netto").fill("19.90");
  await page.getByLabel("Mindestbestand").fill("10");
  await page.getByRole("button", { name: "Artikel anlegen" }).last().click();

  await expect(page.getByText("angelegt")).toBeVisible({ timeout: 15_000 });

  const { data: artikel } = await db
    .from("article")
    .select("id, sku, stock, min_stock, purchase_price, active")
    .eq("company_id", COMPANY_A)
    .eq("sku", `${MARKE}-001`)
    .single();

  expect(Number(artikel!.stock)).toBe(0);
  expect(Number(artikel!.min_stock)).toBe(10);
  expect(Number(artikel!.purchase_price)).toBe(19.9);
  expect(artikel!.active).toBe(true);
});

test("Eine doppelte Artikelnummer wird abgewiesen", async ({ page }) => {
  await login(page, DEMO.gf);
  await page.goto("/lager");

  await page.getByRole("button", { name: "Artikel anlegen" }).click();
  await page.getByLabel("Artikelnummer").fill(`${MARKE}-001`);
  await page.getByLabel("Bezeichnung").fill("Nochmal dieselbe Nummer");
  await page.getByRole("button", { name: "Artikel anlegen" }).last().click();

  await expect(page.getByText(/gibt es schon/)).toBeVisible({ timeout: 15_000 });
});

test("Ohne Schreibrecht gibt es keine Anlegen-Knöpfe", async ({ page }) => {
  await login(page, DEMO.monteur);

  await page.goto("/crm");
  await expect(page.getByRole("button", { name: "Kunde anlegen" })).toHaveCount(0);

  await page.goto("/lager");
  await expect(page.getByRole("button", { name: "Artikel anlegen" })).toHaveCount(
    0,
  );
});

test("Portalzugang erzeugen, benutzen und widerrufen", async ({ page }) => {
  const db = admin();

  const { data: kunde } = await db
    .from("customer")
    .select("id, name")
    .eq("company_id", COMPANY_A)
    .is("deleted_at", null)
    .limit(1)
    .single();

  // Vorherige Zugänge dieses Kunden aus dem Weg räumen.
  await db.from("portal_access").delete().eq("customer_id", kunde!.id);

  await login(page, DEMO.gf);
  await page.goto(`/crm?kunde=${kunde!.id}&bearbeiten=portal`);

  await page.getByRole("button", { name: "Zugang erzeugen" }).click();

  /*
   * Der Link steht an zwei Stellen: im Portal-Panel und in der
   * Kundenübersicht. Das ist gewollt — man soll ihn sehen, ohne den Reiter
   * zu wechseln. Der Test nimmt den ersten.
   */
  const linkFeld = page.getByLabel("Portallink").first();
  await expect(linkFeld).toBeVisible({ timeout: 15_000 });

  const link = await linkFeld.inputValue();
  const token = link.split("/portal/")[1]!;
  expect(token.length).toBeGreaterThan(40);

  /*
   * Der Klartext-Token darf nirgends gespeichert sein — nur sein Hash.
   * Ein Datenbankleck soll keine Kundenzugänge preisgeben.
   */
  const { data: zugang } = await db
    .from("portal_access")
    .select("token_hash, revoked_at")
    .eq("customer_id", kunde!.id)
    .is("revoked_at", null)
    .single();
  expect(zugang!.token_hash).not.toContain(token);

  // Der Link öffnet das Portal ohne Anmeldung.
  await page.context().clearCookies();
  await page.goto(`/portal/${token}`);
  await expect(
    page.getByRole("heading", { name: kunde!.name as string }),
  ).toBeVisible();

  // --- Widerrufen ---
  await login(page, DEMO.gf);
  await page.goto(`/crm?kunde=${kunde!.id}&bearbeiten=portal`);
  page.on("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "Widerrufen" }).click();

  await expect
    .poll(
      async () => {
        const { data } = await db
          .from("portal_access")
          .select("revoked_at")
          .eq("customer_id", kunde!.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .single();
        return data?.revoked_at !== null;
      },
      { timeout: 15_000 },
    )
    .toBe(true);

  // Danach öffnet der Link nichts mehr.
  await page.context().clearCookies();
  const antwort = await page.goto(`/portal/${token}`);
  expect(antwort?.status()).toBe(404);
});

test("Ein Monteur kann keinen Portalzugang erzeugen", async ({ page }) => {
  const db = admin();
  const { data: kunde } = await db
    .from("customer")
    .select("id")
    .eq("company_id", COMPANY_A)
    .is("deleted_at", null)
    .limit(1)
    .single();

  await login(page, DEMO.monteur);
  await page.goto(`/crm?kunde=${kunde!.id}&bearbeiten=portal`);

  // Ohne CRM-Schreibrecht gibt es den Reiter gar nicht.
  await expect(page.getByRole("button", { name: "Zugang erzeugen" })).toHaveCount(
    0,
  );
});
