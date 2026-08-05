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

test("Ein leerer Tag sagt das, ein gebuchter zeigt die Person", async ({
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

  await login(page, DEMO.gf);
  await page.goto(`/zeiten?tab=heute&tag=${TAG}`);

  /*
   * Ein Tag ohne jede Buchung sagt das klar. Vor dem Umbau stand hier
   * die vollständige Mannschaft mit lauter Nullen — das war eine Wand
   * aus Zeilen ohne Aussage, in der niemand mehr las, wer wirklich fehlt.
   */
  await expect(page.getByTestId("heute-leer")).toBeVisible();

  await db.from("time_entry").insert({
    company_id: COMPANY_A,
    user_id: person!.id,
    kind: "work",
    started_at: `${TAG}T05:00:00Z`,
    ended_at: `${TAG}T13:00:00Z`,
    status: "booked",
  });

  await page.reload();
  await expect(page.getByTestId("heute-leer")).toHaveCount(0);
  await expect(
    page.getByTestId(`heute-person-${person!.id as string}`),
  ).toBeVisible();
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

  await expect(page.getByText("ohne Einsatz").first()).toBeVisible();
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

test("Ein Monteur kommt gar nicht erst in die Tagesansicht", async ({
  page,
}) => {
  /*
   * Migration 0008 hielt die Zeiten der Kollegen von ihm fern; seit dem
   * Navigationsumbau ist der Weg schon vorher zu — die Betriebs-App ist
   * für ihn gesperrt, er landet in seiner eigenen.
   */
  await login(page, DEMO.monteur);
  await page.goto(`/zeiten?tab=heute&tag=${TAG}`);

  await expect(page).toHaveURL(/\/m\/heute/, { timeout: 15_000 });
  await expect(page.getByText("Sabine Reiter")).toHaveCount(0);
});
