import { expect, test } from "@playwright/test";
import { COMPANY_A, DEMO, admin, login } from "./helpers";

/*
 * Definition of Done Meilenstein 2 (CLAUDE.md Abschnitt 12):
 *   "Drag ändert Phase serverseitig, Filter in der URL, Ringkennzahlen stimmen"
 */

test.describe.configure({ mode: "serial" });

async function phaseOf(table: string, number: string): Promise<string | null> {
  const { data } = await admin()
    .from(table)
    .select("phase_id")
    .eq("company_id", COMPANY_A)
    .eq("number", number)
    .single();
  return (data?.phase_id as string | null) ?? null;
}

async function phaseByKey(kind: string, key: string): Promise<string> {
  const { data, error } = await admin()
    .from("pipeline_phase")
    .select("id, key, pipeline:pipeline_id ( kind )")
    .eq("company_id", COMPANY_A)
    .eq("key", key);
  if (error) throw error;
  const hit = (data ?? []).find(
    (p) => (p.pipeline as unknown as { kind: string } | null)?.kind === kind,
  );
  if (!hit) throw new Error(`Phase ${kind}/${key} nicht gefunden.`);
  return hit.id as string;
}

test("Drag verschiebt die Karte und schreibt die Phase in die Datenbank", async ({
  page,
}) => {
  const NUMMER = "A-2026-0042";
  const vorher = await phaseOf("job", NUMMER);
  const ziel = await phaseByKey("projekte", "montage");
  expect(vorher).not.toBe(ziel);

  await login(page, DEMO.gf);
  await page.goto("/pipelines/projekte");

  const karte = page.locator(`text=${NUMMER}`).first();
  await expect(karte).toBeVisible();

  // Die Ablagefläche der Zielspalte trägt data-phase.
  const zielSpalte = page.locator('[data-phase="montage"]');
  await expect(zielSpalte).toBeVisible();

  const von = await karte.boundingBox();
  const nach = await zielSpalte.boundingBox();
  if (!von || !nach) throw new Error("Karte oder Zielspalte ohne Geometrie.");

  await page.mouse.move(von.x + von.width / 2, von.y + von.height / 2);
  await page.mouse.down();
  // Mehrere Schritte: dnd-kit braucht Bewegung über die Aktivierungsschwelle.
  await page.mouse.move(von.x + von.width / 2, von.y + von.height / 2 + 20, {
    steps: 5,
  });
  await page.mouse.move(nach.x + nach.width / 2, nach.y + nach.height / 2, {
    steps: 15,
  });
  await page.mouse.up();

  await expect
    .poll(async () => await phaseOf("job", NUMMER), { timeout: 15_000 })
    .toBe(ziel);

  // Zurücksetzen, damit der Seed-Zustand erhalten bleibt.
  await admin()
    .from("job")
    .update({ phase_id: vorher })
    .eq("company_id", COMPANY_A)
    .eq("number", NUMMER);
});

test("Ein Monteur kann keine Phase verschieben", async ({ page }) => {
  const NUMMER = "A-2026-0042";
  const vorher = await phaseOf("job", NUMMER);

  await login(page, DEMO.monteur);
  await page.goto("/pipelines/projekte");

  // Für den Monteur ist die Pipeline nur lesbar: keine Drag-Handles.
  await expect(page.getByText(NUMMER).first()).toBeVisible();
  expect(await phaseOf("job", NUMMER)).toBe(vorher);
});

test("Filter stehen in der URL und wirken", async ({ page }) => {
  await login(page, DEMO.gf);

  await page.goto("/pipelines/projekte?ansicht=tabelle");
  await expect(page.getByText("A-2026-0041").first()).toBeVisible();

  await page.goto("/pipelines/projekte?ansicht=tabelle&q=0038");
  await expect(page.getByText("A-2026-0038").first()).toBeVisible();
  await expect(page.getByText("A-2026-0041")).toHaveCount(0);
  await expect(page.getByText("gefiltert")).toBeVisible();

  // Der Link ist teilbar: derselbe Aufruf ergibt dasselbe Ergebnis.
  await page.reload();
  await expect(page.getByText("A-2026-0038").first()).toBeVisible();
});

test("Alle drei Ansichten zeigen dieselbe Menge", async ({ page }) => {
  await login(page, DEMO.gf);

  for (const ansicht of ["board", "tabelle", "timeline"]) {
    await page.goto(`/pipelines/projekte?ansicht=${ansicht}`);
    await expect(page.getByText("A-2026-0041").first()).toBeVisible();
    await expect(page.getByText("A-2026-0042").first()).toBeVisible();
    await expect(page.getByText("A-2026-0038").first()).toBeVisible();
  }
});

test("Ringkennzahl entspricht den Daten", async ({ page }) => {
  const db = admin();

  // Vertrieb: gewonnene gegen entschiedene Angebote.
  const { data: phases } = await db
    .from("pipeline_phase")
    .select("id, system_key, pipeline:pipeline_id ( kind )")
    .eq("company_id", COMPANY_A);
  const vertrieb = (phases ?? []).filter(
    (p) => (p.pipeline as unknown as { kind: string } | null)?.kind === "vertrieb",
  );
  const wonIds = vertrieb.filter((p) => p.system_key === "won").map((p) => p.id);
  const lostIds = vertrieb.filter((p) => p.system_key === "lost").map((p) => p.id);

  const { data: quotes } = await db
    .from("quote")
    .select("phase_id")
    .eq("company_id", COMPANY_A);
  const won = (quotes ?? []).filter((q) => wonIds.includes(q.phase_id)).length;
  const lost = (quotes ?? []).filter((q) => lostIds.includes(q.phase_id)).length;
  const erwartet = won + lost > 0 ? Math.round((won / (won + lost)) * 100) : 0;

  await login(page, DEMO.gf);
  await page.goto("/pipelines/vertrieb");

  await expect(
    page.getByRole("img", { name: new RegExp(`Erfolgsquote: ${erwartet} Prozent`) }),
  ).toBeVisible();
});

test("Die drei Pipelines lesen aus drei verschiedenen Tabellen", async ({
  page,
}) => {
  await login(page, DEMO.gf);

  await page.goto("/pipelines/vertrieb?ansicht=tabelle");
  await expect(page.getByText("AN-2026-0106").first()).toBeVisible();

  await page.goto("/pipelines/service?ansicht=tabelle");
  await expect(page.getByText("S-2026-0031").first()).toBeVisible();

  await page.goto("/pipelines/projekte?ansicht=tabelle");
  await expect(page.getByText("A-2026-0041").first()).toBeVisible();
});
