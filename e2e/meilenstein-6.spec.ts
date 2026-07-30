import { expect, test } from "@playwright/test";
import { COMPANY_A, DEMO, admin, login } from "./helpers";

/*
 * Definition of Done Meilenstein 6 (CLAUDE.md Abschnitt 12):
 *   "Ruhezeitverletzung blockt Veröffentlichung bis zur Bestätigung"
 */

test.describe.configure({ mode: "serial" });

async function aufraeumen() {
  await admin().from("roster_publication").delete().eq("company_id", COMPANY_A);
}

test("Die Konfliktprüfung findet den Ruhezeitverstoß aus dem Seed", async ({
  page,
}) => {
  await aufraeumen();
  await login(page, DEMO.gf);
  await page.goto("/dispo");

  await expect(page.getByRole("heading", { name: "Einsatzplanung" })).toBeVisible();
  await expect(page.getByText("Ruhezeit").first()).toBeVisible();
  // 20:00 bis 05:00 sind neun Stunden statt elf.
  await expect(page.getByText(/Ruhezeit 9 statt 11 Stunden/)).toBeVisible();
});

test("Veröffentlichen wird ohne Bestätigung abgelehnt", async ({ page }) => {
  await aufraeumen();
  await login(page, DEMO.gf);
  await page.goto("/dispo");

  const form = page.locator("form", { hasText: "Veröffentlichen" });
  await form.getByRole("button", { name: "Dienstplan veröffentlichen" }).click();

  await expect(form.getByRole("alert")).toContainText("blockier");
  await expect(form.getByRole("alert")).toContainText("bestätigen");

  const { count } = await admin()
    .from("roster_publication")
    .select("id", { count: "exact", head: true })
    .eq("company_id", COMPANY_A);
  expect(count ?? 0).toBe(0);
});

test("Bestätigung ohne Begründung reicht nicht", async ({ page }) => {
  await aufraeumen();
  await login(page, DEMO.gf);
  await page.goto("/dispo");

  const form = page.locator("form", { hasText: "Veröffentlichen" });
  await form.getByRole("checkbox").check();

  // Das Begründungsfeld ist Pflicht — der Browser blockt schon das Absenden.
  const grund = form.getByLabel("Begründung");
  await expect(grund).toBeVisible();
  await expect(grund).toHaveAttribute("required", "");

  const { count } = await admin()
    .from("roster_publication")
    .select("id", { count: "exact", head: true })
    .eq("company_id", COMPANY_A);
  expect(count ?? 0).toBe(0);
});

test("Mit Bestätigung und Begründung wird veröffentlicht und protokolliert", async ({
  page,
}) => {
  await aufraeumen();
  await login(page, DEMO.gf);
  await page.goto("/dispo");

  const form = page.locator("form", { hasText: "Veröffentlichen" });
  await form.getByRole("checkbox").check();
  await form.getByLabel("Begründung").fill("Störungseinsatz, mit Team abgestimmt");
  await form.getByRole("button", { name: "Dienstplan veröffentlichen" }).click();

  await expect(form.getByRole("status")).toContainText("trotz");

  const { data } = await admin()
    .from("roster_publication")
    .select("iso_week, warnings_json, published_by")
    .eq("company_id", COMPANY_A)
    .single();

  expect(data).toBeTruthy();
  const w = data!.warnings_json as {
    konflikte: { code: string; severity: string }[];
    bestaetigt: { durch: string; grund: string } | null;
  };

  // Die Verstöße sind mitprotokolliert, nicht nur die Freigabe.
  expect(w.konflikte.some((c) => c.code === "ruhezeit")).toBe(true);
  expect(w.bestaetigt).toBeTruthy();
  expect(w.bestaetigt!.grund).toContain("Störungseinsatz");
  expect(w.bestaetigt!.durch).toBe("Michael Hofstätter");

  await expect(page.getByText("Trotz Verstößen freigegeben")).toBeVisible();
});

test("Ohne Verstöße geht die Veröffentlichung ohne Rückfrage", async ({
  page,
}) => {
  await aufraeumen();
  const db = admin();

  // Den Verstoß entschärfen: Dienstag früher beenden.
  const { data: termine } = await db
    .from("job_appointment")
    .select("id, starts_at, ends_at")
    .eq("company_id", COMPANY_A)
    .order("starts_at");

  const spaet = (termine ?? []).find((t) =>
    String(t.ends_at).includes("T18:00") || new Date(t.ends_at as string).getHours() >= 19,
  );
  const original = spaet ? String(spaet.ends_at) : null;

  if (spaet) {
    const neu = new Date(spaet.ends_at as string);
    neu.setHours(neu.getHours() - 5);
    await db
      .from("job_appointment")
      .update({ ends_at: neu.toISOString() })
      .eq("id", spaet.id);
  }

  await login(page, DEMO.gf);
  await page.goto("/dispo");

  const form = page.locator("form", { hasText: "Veröffentlichen" });
  await expect(form).toContainText("Keine blockierenden Verstöße");
  await form.getByRole("button", { name: "Dienstplan veröffentlichen" }).click();
  await expect(form.getByRole("status")).toContainText("veröffentlicht");

  if (spaet && original) {
    await db
      .from("job_appointment")
      .update({ ends_at: original })
      .eq("id", spaet.id);
  }
  await aufraeumen();
});

test("Ein Monteur darf nicht veröffentlichen", async ({ page }) => {
  await login(page, DEMO.monteur);
  await page.goto("/dispo");

  await expect(
    page.getByText("fehlt deiner Rolle das Schreibrecht"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Dienstplan veröffentlichen" }),
  ).toHaveCount(0);
});
