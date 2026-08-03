import { expect, test } from "@playwright/test";
import { COMPANY_A, COMPANY_B, DEMO, admin, login } from "./helpers";

/*
 * Mitarbeiter anlegen war der letzte Stammdatensatz ohne Anlageweg: die
 * Liste zeigte fünf Personen aus dem Seed und bot keine Möglichkeit, eine
 * sechste dazuzunehmen.
 *
 * Der heikle Teil ist nicht das Formular, sondern app_metadata: dort
 * stehen company_id und role, und daran hängt die gesamte
 * Mandantentrennung. Genau das wird hier geprüft.
 */

test.describe.configure({ mode: "serial" });

const MAIL = "e2e-neu@hofstaetter.example.com";

async function aufraeumen(): Promise<void> {
  const db = admin();

  const { data: zeile } = await db
    .from("app_user")
    .select("id")
    .eq("email", MAIL)
    .maybeSingle();

  if (zeile) {
    await db.from("app_user").delete().eq("id", zeile.id);
    await db.auth.admin.deleteUser(zeile.id as string);
    return;
  }

  // Auch ein Konto ohne app_user-Zeile muss weg, sonst blockiert es.
  const { data: liste } = await db.auth.admin.listUsers({ perPage: 200 });
  const konto = liste?.users.find((u) => u.email === MAIL);
  if (konto) await db.auth.admin.deleteUser(konto.id);
}

test.beforeAll(aufraeumen);
test.afterAll(aufraeumen);

test("1 — Die Geschäftsführung legt einen Monteur an", async ({ page }) => {
  const db = admin();

  await login(page, DEMO.gf);
  await page.goto("/mitarbeiter");

  await page.getByRole("button", { name: "Mitarbeiter anlegen" }).click();
  await page.getByLabel("Name", { exact: true }).fill("E2E Neuzugang");
  await page.getByLabel("E-Mail").fill(MAIL);
  await page.getByLabel("Rolle").selectOption("monteur");
  await page.getByLabel("Wochenstunden").fill("38.5");
  await page.getByLabel("Urlaubstage pro Jahr").fill("25");
  await page.getByLabel("Stundenkosten").fill("34.50");
  await page.getByRole("button", { name: "Anlegen und einladen" }).click();

  await expect(page.getByText(/E2E Neuzugang angelegt/)).toBeVisible({
    timeout: 30_000,
  });

  const { data } = await db
    .from("app_user")
    .select("id, company_id, role, weekly_hours, hourly_cost, active")
    .eq("email", MAIL)
    .single();

  expect(data!.company_id).toBe(COMPANY_A);
  expect(data!.role).toBe("monteur");
  expect(Number(data!.hourly_cost)).toBe(34.5);
  expect(data!.active).toBe(true);

  /*
   * Der entscheidende Punkt: company_id und role stehen in app_metadata,
   * nicht in user_metadata. user_metadata ist vom Client änderbar — läge
   * die Zuordnung dort, könnte sich jeder Nutzer zum Mandanten seiner
   * Wahl und zur Geschäftsführung machen.
   */
  const { data: konto } = await db.auth.admin.getUserById(data!.id as string);
  expect(konto.user?.app_metadata.company_id).toBe(COMPANY_A);
  expect(konto.user?.app_metadata.role).toBe("monteur");
  expect(konto.user?.user_metadata.company_id).toBeUndefined();
  expect(konto.user?.user_metadata.role).toBeUndefined();
});

test("2 — Dieselbe Adresse ein zweites Mal geht nicht", async ({ page }) => {
  await login(page, DEMO.gf);
  await page.goto("/mitarbeiter");

  await page.getByRole("button", { name: "Mitarbeiter anlegen" }).click();
  await page.getByLabel("Name", { exact: true }).fill("E2E Doppelt");
  await page.getByLabel("E-Mail").fill(MAIL);
  await page.getByRole("button", { name: "Anlegen und einladen" }).click();

  await expect(page.getByText(/bereits zu einem Mitarbeiter/)).toBeVisible({
    timeout: 30_000,
  });
});

test("3 — Das Büro legt niemanden an und vergibt keine Rollen", async ({
  page,
}) => {
  const db = admin();
  const { data: person } = await db
    .from("app_user")
    .select("id")
    .eq("email", MAIL)
    .single();

  await login(page, DEMO.buero);
  await page.goto("/mitarbeiter");
  await expect(
    page.getByRole("button", { name: "Mitarbeiter anlegen" }),
  ).toHaveCount(0);

  /*
   * Das Büro hat auf "mitarbeiter" nur Leserecht. Es sieht die Personalakte,
   * bekommt aber weder das Stammdatenformular noch den Austrittsknopf —
   * und damit auch keine Möglichkeit, Rollen zu vergeben.
   */
  await page.goto(`/mitarbeiter/${person!.id}`);
  await expect(page.getByText("E2E Neuzugang").first()).toBeVisible();
  await expect(page.getByLabel("Rolle")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Als ausgetreten vermerken" }),
  ).toHaveCount(0);
});

test("4 — Die Rolle ändert sich in app_user und in app_metadata", async ({
  page,
}) => {
  const db = admin();
  const { data: person } = await db
    .from("app_user")
    .select("id")
    .eq("email", MAIL)
    .single();

  await login(page, DEMO.gf);
  await page.goto(`/mitarbeiter/${person!.id}`);

  await page.getByLabel("Rolle").selectOption("lager");
  await page.getByRole("button", { name: "Speichern", exact: true }).click();

  await expect(page.getByText(/Gespeichert/)).toBeVisible({ timeout: 20_000 });

  const { data: nachher } = await db
    .from("app_user")
    .select("role")
    .eq("id", person!.id)
    .single();
  expect(nachher!.role).toBe("lager");

  /*
   * Die Rolle steht doppelt: in app_user für die Anzeige, in app_metadata
   * für RLS. Wird nur das erste gesetzt, sieht der Betrieb die neue Rolle
   * und die Datenbank die alte — die Rechte bleiben die alten.
   */
  const { data: konto } = await db.auth.admin.getUserById(person!.id as string);
  expect(konto.user?.app_metadata.role).toBe("lager");
  expect(konto.user?.app_metadata.company_id).toBe(COMPANY_A);
  expect(konto.user?.app_metadata.company_id).not.toBe(COMPANY_B);
});

test("5 — Austritt löscht nichts", async ({ page }) => {
  const db = admin();
  const { data: person } = await db
    .from("app_user")
    .select("id")
    .eq("email", MAIL)
    .single();

  await login(page, DEMO.gf);
  await page.goto(`/mitarbeiter/${person!.id}`);

  // Die Aktion fragt über window.confirm nach; Playwright lehnt sonst ab.
  page.on("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "Als ausgetreten vermerken" })
    .click();

  await expect(
    page.getByRole("status").filter({ hasText: "ausgetreten vermerkt" }),
  ).toBeVisible({ timeout: 20_000 });

  const { data: nachher } = await db
    .from("app_user")
    .select("id, active, name")
    .eq("id", person!.id)
    .single();

  expect(nachher!.active).toBe(false);
  expect(nachher!.name).toBe("E2E Neuzugang");
});
