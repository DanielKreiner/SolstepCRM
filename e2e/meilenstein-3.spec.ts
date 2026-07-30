import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { COMPANY_A, DEMO, admin, login } from "./helpers";

/*
 * Definition of Done Meilenstein 3 (CLAUDE.md Abschnitt 12):
 *   "Annahme legt Auftrag an und erzeugt Aufgabe 'Termin fixieren'"
 *
 * Dazu der Import mit Vorschau-Diff und das PDF, weil beides zum
 * Meilenstein gehört.
 */

test.describe.configure({ mode: "serial" });

const FIXTURE = path.join(__dirname, "fixtures", "planung.json");

async function quoteIdOf(number: string): Promise<string> {
  const { data, error } = await admin()
    .from("quote")
    .select("id")
    .eq("company_id", COMPANY_A)
    .eq("number", number)
    .single();
  if (error) throw error;
  return data.id as string;
}

/**
 * Setzt das Testangebot vollständig zurück — inklusive Phase und
 * Annahmezustand. Ohne das läuft der zweite Durchlauf gegen ein bereits
 * angenommenes Angebot, und der Knopf heißt plötzlich anders.
 */
async function aufraeumen(quoteId: string) {
  const db = admin();
  const { data: jobs } = await db
    .from("job")
    .select("id")
    .eq("quote_id", quoteId);
  for (const j of jobs ?? []) {
    await db.from("job_checklist_item").delete().eq("job_id", j.id);
    await db.from("job").delete().eq("id", j.id);
  }
  await db.from("quote_item").delete().eq("quote_id", quoteId);
  await db.from("quote_event").delete().eq("quote_id", quoteId);
  await db.from("mail_outbox").delete().eq("quote_id", quoteId);

  const { data: phases } = await db
    .from("pipeline_phase")
    .select("id, key, pipeline:pipeline_id ( kind )")
    .eq("company_id", COMPANY_A);
  const neu = (phases ?? []).find(
    (p) =>
      p.key === "neu" &&
      (p.pipeline as unknown as { kind: string } | null)?.kind === "vertrieb",
  );

  await db
    .from("quote")
    .update({
      ...(neu ? { phase_id: neu.id } : {}),
      status: "draft",
      accepted_at: null,
      accepted_name: null,
      sent_at: null,
      net_total: 0,
      cost_total: 0,
      planner_ref: null,
      planner_payload: null,
    })
    .eq("id", quoteId);
}

test("Planungsimport ordnet zu und markiert Unzuordenbares", async ({ page }) => {
  const NUMMER = "AN-2026-0104";
  const quoteId = await quoteIdOf(NUMMER);
  await aufraeumen(quoteId);

  await login(page, DEMO.gf);
  await page.goto(`/angebote/${quoteId}`);

  await page
    .locator('input[type="file"]')
    .setInputFiles(FIXTURE);

  const form = page.locator("form", { hasText: "Planung importieren" });
  await form.getByRole("button", { name: "Importieren" }).click();

  // 5 von 7 Positionen haben eine bekannte SKU, 2 nicht.
  await expect(form.getByRole("status")).toContainText("5 Positionen erkannt");
  await expect(form.getByRole("status")).toContainText("2 nicht zuordenbar");

  const db = admin();
  const { data: items } = await db
    .from("quote_item")
    .select("pos, text, qty, unmatched, article_id")
    .eq("quote_id", quoteId)
    .order("pos");

  expect(items).toHaveLength(7);
  expect((items ?? []).filter((i) => i.unmatched)).toHaveLength(2);
  // Nicht zuordenbare Positionen gehen nicht verloren.
  expect(
    (items ?? []).some((i) => String(i.text).includes("Gerüst")),
  ).toBe(true);

  // Die Summen kommen aus den Positionen, nicht aus der Planungsdatei.
  const { data: quote } = await db
    .from("quote")
    .select("net_total, cost_total, planner_ref")
    .eq("id", quoteId)
    .single();

  /*
   * Von Hand nachgerechnet, damit der Test die Zahl nicht aus derselben
   * Quelle bezieht wie der Code:
   *   68 x 119,00 + 3 x 2740,00 + 1 x 5490,00 + 96 x 29,50 + 420 x 1,85
   *   + 4800,00 + 2350,00 (beide ohne Artikel, Preis aus der Planung)
   */
  expect(quote!.planner_ref).toBe("STEP-2026-88213");
  expect(Number(quote!.net_total)).toBeCloseTo(32561, 2);
  //   68 x 78,40 + 3 x 1980,00 + 1 x 4120,00 + 96 x 18,90 + 420 x 0,92
  expect(Number(quote!.cost_total)).toBeCloseTo(17592, 2);

  await expect(page.getByText("nicht zuordenbar").first()).toBeVisible();
});

test("Ein zweiter Import verdoppelt die Stückliste nicht", async ({ page }) => {
  const quoteId = await quoteIdOf("AN-2026-0104");

  await login(page, DEMO.gf);
  await page.goto(`/angebote/${quoteId}`);
  await page.locator('input[type="file"]').setInputFiles(FIXTURE);
  await page
    .locator("form", { hasText: "Planung importieren" })
    .getByRole("button", { name: "Importieren" })
    .click();
  await expect(page.getByRole("status").first()).toContainText("erkannt");

  const { count } = await admin()
    .from("quote_item")
    .select("id", { count: "exact", head: true })
    .eq("quote_id", quoteId);
  expect(count).toBe(7);
});

test("Das PDF wird erzeugt und ist ein PDF", async ({ page }) => {
  const quoteId = await quoteIdOf("AN-2026-0104");
  await login(page, DEMO.gf);

  const antwort = await page.request.get(`/api/pdf/quote/${quoteId}`);
  expect(antwort.status()).toBe(200);
  expect(antwort.headers()["content-type"]).toContain("application/pdf");

  const body = await antwort.body();
  expect(body.byteLength).toBeGreaterThan(2000);
  expect(body.subarray(0, 5).toString()).toBe("%PDF-");
});

test("Versand legt einen Ausgangseintrag an, statt direkt zu senden", async ({
  page,
}) => {
  const quoteId = await quoteIdOf("AN-2026-0104");
  await admin().from("mail_outbox").delete().eq("quote_id", quoteId);

  await login(page, DEMO.gf);
  await page.goto(`/angebote/${quoteId}`);

  const form = page.locator("form", { hasText: "Angebot senden" });
  await form.getByRole("button", { name: "In die Warteschlange" }).click();
  await expect(form.getByRole("status")).toContainText("Warteschlange");

  const { data } = await admin()
    .from("mail_outbox")
    .select("status, to_addrs, subject")
    .eq("quote_id", quoteId);

  expect(data).toHaveLength(1);
  expect(data![0]!.status).toBe("queued");
  expect(String(data![0]!.subject)).toContain("AN-2026-0104");
});

test("Annahme legt den Auftrag an und setzt die Aufgabe Termin fixieren", async ({
  page,
}) => {
  const NUMMER = "AN-2026-0104";
  const quoteId = await quoteIdOf(NUMMER);
  const db = admin();

  await login(page, DEMO.gf);
  await page.goto(`/angebote/${quoteId}`);

  const form = page.locator("form", { hasText: "Annahme erfassen" });
  await form.getByLabel("Angenommen durch").fill("Josef Grubmüller");
  await form
    .getByRole("button", { name: /Annahme erfassen|Erneut prüfen/ })
    .click();

  await expect(form.getByRole("status")).toContainText("Auftrag");

  const { data: job } = await db
    .from("job")
    .select("id, number, next_step, value_net, phase:phase_id ( key )")
    .eq("quote_id", quoteId)
    .single();

  expect(job).toBeTruthy();
  expect(job!.next_step).toBe("Termin fixieren");
  expect((job!.phase as unknown as { key: string }).key).toBe("beauftragt");

  const { data: checklist } = await db
    .from("job_checklist_item")
    .select("label, done")
    .eq("job_id", job!.id);

  expect(checklist).toHaveLength(1);
  expect(checklist![0]!.label).toBe("Termin fixieren");
  expect(checklist![0]!.done).toBe(false);

  // Das Angebot ist gewonnen — der Trigger aus 0006 zieht den Status nach.
  const { data: quote } = await db
    .from("quote")
    .select("status, accepted_name, accepted_at, phase:phase_id ( system_key )")
    .eq("id", quoteId)
    .single();

  expect(quote!.status).toBe("accepted");
  expect(quote!.accepted_name).toBe("Josef Grubmüller");
  expect((quote!.phase as unknown as { system_key: string }).system_key).toBe(
    "won",
  );
});

test("Zweimal annehmen erzeugt keinen zweiten Auftrag", async ({ page }) => {
  const quoteId = await quoteIdOf("AN-2026-0104");

  await login(page, DEMO.gf);
  await page.goto(`/angebote/${quoteId}`);

  const form = page.locator("form", { hasText: "Annahme erfassen" });
  await form.getByLabel("Angenommen durch").fill("Josef Grubmüller");
  await form.getByRole("button", { name: /Annahme erfassen|Erneut prüfen/ }).click();
  await expect(form.getByRole("status")).toContainText("bereits angenommen");

  const { count } = await admin()
    .from("job")
    .select("id", { count: "exact", head: true })
    .eq("quote_id", quoteId);
  expect(count).toBe(1);

  await aufraeumen(quoteId);
});

test("Ohne Schreibrecht auf Angebote gibt es keine Aktionen", async ({ page }) => {
  const quoteId = await quoteIdOf("AN-2026-0106");

  await login(page, DEMO.monteur);
  await page.goto(`/angebote/${quoteId}`);

  await expect(
    page.getByText("fehlt deiner Rolle das Schreibrecht"),
  ).toBeVisible();
  await expect(
    page.locator("form", { hasText: "Annahme erfassen" }),
  ).toHaveCount(0);
});

// Die Fixture soll gültig bleiben, auch wenn niemand sie liest.
test("Die Testplanung ist gültiges JSON", () => {
  const raw = JSON.parse(readFileSync(FIXTURE, "utf8")) as {
    positionen: unknown[];
  };
  expect(raw.positionen).toHaveLength(7);
});
