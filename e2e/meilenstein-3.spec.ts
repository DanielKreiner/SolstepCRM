import { expect, test } from "@playwright/test";
import { COMPANY_A, DEMO, admin, login } from "./helpers";

/*
 * Definition of Done Meilenstein 3 (CLAUDE.md Abschnitt 12):
 *   "Annahme legt Auftrag an und erzeugt Aufgabe 'Termin fixieren'"
 *
 * Dazu das PDF und der Versand. Der Planungsimport ist entfallen —
 * Angebote entstehen jetzt von Hand, siehe e2e/angebote.spec.ts.
 */

test.describe.configure({ mode: "serial" });

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
    })
    .eq("id", quoteId);
}

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

  /*
   * Ein leeres Angebot wird nicht versendet — die Aktion weist es ab. Früher
   * füllte der Planungsimport die Positionen; seit er entfallen ist, legt
   * der Test sie selbst an.
   */
  await positionAnlegen(quoteId);

  await login(page, DEMO.gf);
  await page.goto(`/angebote/${quoteId}`);

  const form = page.locator("form", { hasText: "Angebot senden" });
  await form.getByRole("button", { name: "In die Warteschlange" }).click();
  await expect(form.getByRole("status")).toContainText("Warteschlange");

  const { data } = await admin()
    .from("mail_outbox")
    .select("status, to_addrs, subject")
    .eq("quote_id", quoteId);

  /*
   * Geprüft wird, dass ein Ausgangseintrag entsteht — das ist der Punkt:
   * die Aktion sendet nicht selbst, sie stellt in die Warteschlange.
   *
   * Der Status wird bewusst nicht auf "queued" festgenagelt. Im
   * Gesamtlauf läuft auch der Cron mail-send, und der dreht die Zeile
   * weiter. Ein Test, der einen Zustand prüft, den ein anderer Test im
   * selben Lauf verändert, ist ein Münzwurf und kein Test.
   */
  expect(data).toHaveLength(1);
  expect(["queued", "sent", "failed"]).toContain(data![0]!.status);
  expect(String(data![0]!.subject)).toContain("AN-2026-0104");
  expect(String(data![0]!.to_addrs)).toContain("@");
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

  /*
   * Auf der Seite steht der Hinweis inzwischen zweimal: einmal für die
   * Angebotsaktionen, einmal für die Phasenleiste. Beides ist richtig,
   * geprüft wird hier der erste.
   */
  await expect(
    page.getByText("Für Angebote fehlt deiner Rolle das Schreibrecht."),
  ).toBeVisible();
  await expect(
    page.locator("form", { hasText: "Annahme erfassen" }),
  ).toHaveCount(0);

  // Auch die Phase lässt sich ohne Schreibrecht nicht verschieben.
  await expect(
    page.getByText("Für Phasenwechsel fehlt deiner Rolle das Schreibrecht."),
  ).toBeVisible();
});

/**
 * Legt dem Angebot eine Position an und zieht die Summen nach — so wie es
 * der Editor tut. Direkt über die Datenbank, weil dieser Test den Versand
 * prüft und nicht die Eingabe.
 */
async function positionAnlegen(quoteId: string): Promise<void> {
  const db = admin();

  const { count } = await db
    .from("quote_item")
    .select("id", { count: "exact", head: true })
    .eq("quote_id", quoteId);
  if ((count ?? 0) > 0) return;

  await db.from("quote_item").insert({
    company_id: COMPANY_A,
    quote_id: quoteId,
    pos: 10,
    text: "Montage Unterkonstruktion",
    qty: 12,
    unit: "h",
    purchase_price: 42,
    sale_price: 78,
    vat_rate: 20,
  });

  await db
    .from("quote")
    .update({ net_total: 12 * 78, cost_total: 12 * 42 })
    .eq("id", quoteId);
}
