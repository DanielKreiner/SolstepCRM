import { expect, test } from "@playwright/test";
import { COMPANY_A, DEMO, admin, login } from "./helpers";

/*
 * Die Zeiterfassung zeigt seit dem Umbau eine Zeile JE PERSON mit Kommt,
 * Pause, Ist, Soll, Differenz — nicht mehr eine Liste einzelner Buchungen.
 *
 * Das ist die Ansicht, in der ein Büro morgens sieht, wer fehlt. Eine Liste
 * von Buchungen beantwortet diese Frage nicht, und genau deshalb steht hier
 * ein Test: die Umstellung darf nicht unbemerkt zurückfallen.
 */

test.describe.configure({ mode: "serial" });

const TAG = "2026-06-15"; // Montag, weit weg vom Seed-Zeitraum

async function aufraeumen(): Promise<void> {
  const db = admin();
  await db
    .from("time_entry")
    .delete()
    .eq("company_id", COMPANY_A)
    .gte("started_at", `${TAG}T00:00:00Z`)
    .lt("started_at", `${TAG}T23:59:59Z`);
}

test.afterAll(aufraeumen);

test("Die Tagesansicht zeigt jede aktive Person, auch ohne Buchung", async ({
  page,
}) => {
  await aufraeumen();
  await login(page, DEMO.gf);
  await page.goto(`/zeiten?tab=heute&tag=${TAG}`);

  const db = admin();
  const { data: leute } = await db
    .from("app_user")
    .select("name")
    .eq("company_id", COMPANY_A)
    .eq("active", true);

  // Jede aktive Person steht in der Tabelle — auch wer nichts gebucht hat.
  for (const p of leute ?? []) {
    await expect(
      page.getByText(p.name as string, { exact: true }).first(),
      p.name as string,
    ).toBeVisible();
  }

  await expect(page.getByText("niemand eingestempelt")).toBeVisible();
});

test("Eine Buchung ohne Auftrag wird zur Prüfung markiert", async ({ page }) => {
  await aufraeumen();
  const db = admin();

  const { data: person } = await db
    .from("app_user")
    .select("id, name")
    .eq("company_id", COMPANY_A)
    .eq("email", DEMO.monteur)
    .single();

  await db.from("time_entry").insert({
    company_id: COMPANY_A,
    user_id: person!.id,
    vorgang_id: null,
    kind: "work",
    started_at: `${TAG}T05:00:00Z`,
    ended_at: `${TAG}T13:00:00Z`,
    status: "booked",
  });

  await login(page, DEMO.gf);
  await page.goto(`/zeiten?tab=heute&tag=${TAG}`);

  await expect(page.getByText("keine Zuordnung").first()).toBeVisible();
  await expect(
    page.getByText("Buchung ohne Auftragszuordnung").first(),
  ).toBeVisible();
});

test("Über zehn Stunden ohne Pause gilt als unplausibel", async ({ page }) => {
  await aufraeumen();
  const db = admin();

  const { data: person } = await db
    .from("app_user")
    .select("id")
    .eq("company_id", COMPANY_A)
    .eq("email", DEMO.monteur)
    .single();

  const { data: vorgang } = await db
    .from("vorgang")
    .select("id")
    .eq("company_id", COMPANY_A)
    .limit(1)
    .single();

  // 11 Stunden am Stück, keine Pausenbuchung.
  await db.from("time_entry").insert({
    company_id: COMPANY_A,
    user_id: person!.id,
    vorgang_id: vorgang!.id,
    kind: "work",
    started_at: `${TAG}T04:00:00Z`,
    ended_at: `${TAG}T15:00:00Z`,
    status: "booked",
  });

  await login(page, DEMO.gf);
  await page.goto(`/zeiten?tab=heute&tag=${TAG}`);

  await expect(page.getByText("unplausibel").first()).toBeVisible();
  await expect(page.getByText("über 10 Stunden ohne Pause")).toBeVisible();
});

test("Mit gebuchter Pause ist derselbe Tag nicht mehr unplausibel", async ({
  page,
}) => {
  await aufraeumen();
  const db = admin();

  const { data: person } = await db
    .from("app_user")
    .select("id")
    .eq("company_id", COMPANY_A)
    .eq("email", DEMO.monteur)
    .single();

  const { data: vorgang } = await db
    .from("vorgang")
    .select("id")
    .eq("company_id", COMPANY_A)
    .limit(1)
    .single();

  await db.from("time_entry").insert([
    {
      company_id: COMPANY_A,
      user_id: person!.id,
      vorgang_id: vorgang!.id,
      kind: "work",
      started_at: `${TAG}T04:00:00Z`,
      ended_at: `${TAG}T15:00:00Z`,
      status: "booked",
    },
    {
      company_id: COMPANY_A,
      user_id: person!.id,
      vorgang_id: vorgang!.id,
      kind: "break",
      started_at: `${TAG}T10:00:00Z`,
      ended_at: `${TAG}T10:30:00Z`,
      status: "booked",
    },
  ]);

  await login(page, DEMO.gf);
  await page.goto(`/zeiten?tab=heute&tag=${TAG}`);

  await expect(page.getByText("über 10 Stunden ohne Pause")).toHaveCount(0);
});

test("Ein Monteur sieht in der Tagesansicht nur sich selbst", async ({
  page,
}) => {
  // Migration 0008: die Zeiten der Kollegen gehen ihn nichts an.
  await login(page, DEMO.monteur);
  await page.goto(`/zeiten?tab=heute&tag=${TAG}`);

  await expect(page.getByText("Michael Hofstätter")).toHaveCount(0);
  await expect(page.getByText("Sabine Reiter")).toHaveCount(0);
});
