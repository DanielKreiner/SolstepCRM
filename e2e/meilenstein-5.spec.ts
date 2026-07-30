import { expect, test } from "@playwright/test";
import { COMPANY_A, DEMO, admin, login, stockOf } from "./helpers";

/*
 * Definition of Done Meilenstein 5 (CLAUDE.md Abschnitt 12):
 *   "Flugmodus-Test: 3 Buchungen offline, nach Reconnect vollständig
 *    und korrekt"
 */

test.describe.configure({ mode: "serial" });

async function monteurId(): Promise<string> {
  const { data } = await admin()
    .from("app_user")
    .select("id")
    .eq("email", DEMO.monteur)
    .single();
  return data!.id as string;
}

/*
 * Alles entfernen, was über die Warteschlange entstanden ist. Erkennbar an
 * client_uuid — die Seed-Daten haben keines. Der Reversal-Trigger aus 0005
 * dreht den Bestand dabei korrekt zurück, auch wenn ein vorheriger Lauf
 * mitten im Test abgebrochen ist.
 */
async function aufraeumen() {
  const db = admin();
  const uid = await monteurId();

  const { data: moves } = await db
    .from("stock_move")
    .select("id")
    .eq("company_id", COMPANY_A)
    .not("client_uuid", "is", null);
  for (const m of moves ?? []) {
    await db.from("stock_move").delete().eq("id", m.id);
  }

  await db
    .from("time_entry")
    .delete()
    .eq("company_id", COMPANY_A)
    .not("client_uuid", "is", null);
  await db
    .from("time_entry")
    .delete()
    .eq("user_id", uid)
    .in("status", ["running", "flagged"]);
}

test("Drei Buchungen im Flugmodus gehen nach dem Reconnect vollständig durch", async ({
  page,
  context,
}) => {
  await aufraeumen();
  const db = admin();

  const { data: article } = await db
    .from("article")
    .select("id, sku")
    .eq("company_id", COMPANY_A)
    .eq("sku", "KAB-SOL-6")
    .single();
  const vorher = await stockOf("KAB-SOL-6");

  await login(page, DEMO.monteur);

  /*
   * Der reale Ablauf: der Monteur hat die Seite offen, dann reißt das Netz
   * ab. Ein Seitenwechsel im Flugmodus setzt den ServiceWorker voraus, den
   * Next im Entwicklungsmodus nicht ausliefert — deshalb bleibt der Test auf
   * einer Seite und prüft das, worauf es ankommt: dass keine Buchung
   * verloren geht.
   */
  await page.goto("/m/material");
  await expect(page.getByRole("heading", { name: "Material" })).toBeVisible();

  // Artikel explizit wählen — die Vorauswahl ist der alphabetisch erste.
  await page.getByLabel("Artikel").selectOption(article!.id as string);
  await page.getByLabel("Auftrag", { exact: true }).selectOption("");

  await context.setOffline(true);

  const menge = page.getByLabel(/^Menge/);
  const buchen = page.getByRole("button", { name: "Buchen", exact: true });

  for (const m of ["12", "8", "5"]) {
    // Erst füllen, wenn das Formular vom vorigen Buchen zurückgesetzt ist —
    // sonst überschreibt der Reset die gerade eingegebene Menge.
    await expect(menge).toHaveValue("1");
    await menge.fill(m);
    await buchen.click();
    await expect(page.getByRole("status")).toContainText("erfasst");
  }

  // Der Banner zeigt die Warteschlange auch offline.
  const banner = page.getByTestId("offline-banner");
  await expect(banner).toContainText("Offline");
  await expect(banner).toContainText("3 Buchungen");

  // Offline darf nichts in der Datenbank stehen.
  expect(await stockOf("KAB-SOL-6")).toBe(vorher);

  // ---- Reconnect ----
  await context.setOffline(false);

  await expect
    .poll(async () => await stockOf("KAB-SOL-6"), { timeout: 30_000 })
    .toBe(vorher - 25);

  // Nur die Buchungen aus der Warteschlange — die Seed-Bewegungen desselben
  // Artikels haben kein client_uuid.
  const { data: moves } = await db
    .from("stock_move")
    .select("qty, kind, client_uuid")
    .eq("company_id", COMPANY_A)
    .eq("article_id", article!.id)
    .not("client_uuid", "is", null);

  // Drei getrennte Buchungen, jede mit eigener Idempotenzklammer.
  expect(moves).toHaveLength(3);
  expect(new Set((moves ?? []).map((m) => m.client_uuid)).size).toBe(3);
  expect(
    (moves ?? []).map((m) => Number(m.qty)).sort((a, b) => a - b),
  ).toEqual([5, 8, 12]);

  // Ist die Warteschlange leer und die Verbindung steht, verschwindet der
  // Banner ganz — er soll nicht als Dauerhinweis herumstehen.
  await expect(banner).toHaveCount(0, { timeout: 15_000 });

  for (const m of moves ?? []) {
    await db.from("stock_move").delete().eq("client_uuid", m.client_uuid);
  }
  expect(await stockOf("KAB-SOL-6")).toBe(vorher);
  await aufraeumen();
});

test("Einstempeln im Flugmodus läuft lokal weiter", async ({
  page,
  context,
}) => {
  await aufraeumen();
  const uid = await monteurId();

  await login(page, DEMO.monteur);
  await page.goto("/m/stempeln");
  await expect(page.getByText("Nicht eingestempelt")).toBeVisible();

  await context.setOffline(true);
  await page.getByRole("button", { name: "Einstempeln" }).click();

  // Die Uhr läuft, obwohl der Server nichts davon weiß.
  await expect(page.getByText("Läuft seit")).toBeVisible();
  await expect(page.getByTestId("offline-banner")).toContainText("Offline");

  await context.setOffline(false);

  await expect
    .poll(
      async () => {
        const { count } = await admin()
          .from("time_entry")
          .select("id", { count: "exact", head: true })
          .eq("user_id", uid)
          .eq("status", "running");
        return count ?? 0;
      },
      { timeout: 30_000 },
    )
    .toBe(1);

  await aufraeumen();
});

test("Dieselbe Buchung zweimal gesendet ergibt eine Zeile", async ({ page }) => {
  await aufraeumen();
  const uid = await monteurId();
  const db = admin();

  await login(page, DEMO.monteur);
  await page.goto("/m/stempeln");

  const clientUuid = "11111111-2222-4333-8444-555555555555";
  const clientTs = new Date().toISOString();

  const senden = () =>
    page.request.post("/api/m/sync", {
      data: {
        clientUuid,
        clientTs,
        kind: "time_start",
        payload: { jobId: null, kind: "work", note: "E2E-M5 Idempotenz" },
      },
    });

  const a = await senden();
  const b = await senden();
  expect(a.status()).toBe(200);
  expect(b.status()).toBe(200);

  const { count } = await db
    .from("time_entry")
    .select("id", { count: "exact", head: true })
    .eq("user_id", uid)
    .eq("client_uuid", clientUuid);
  expect(count).toBe(1);

  await db.from("time_entry").delete().eq("client_uuid", clientUuid);
});

test("Eine verstellte Uhr wird markiert, aber nicht verworfen", async ({
  page,
}) => {
  await aufraeumen();
  const db = admin();

  await login(page, DEMO.monteur);

  // Zwei Stunden in der Vergangenheit — weit über den 15 Minuten Toleranz.
  const schief = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
  const clientUuid = "22222222-3333-4444-8555-666666666666";

  const antwort = await page.request.post("/api/m/sync", {
    data: {
      clientUuid,
      clientTs: schief,
      kind: "time_start",
      payload: { jobId: null, kind: "work", note: "E2E-M5 Uhr" },
    },
  });
  expect(antwort.status()).toBe(200);
  expect((await antwort.json()).flagged).toBe(true);

  const { data } = await db
    .from("time_entry")
    .select("status, flagged_reason, started_at")
    .eq("client_uuid", clientUuid)
    .single();

  // Die Buchung existiert — eine falsch gestellte Uhr darf keine
  // Arbeitszeit verschlucken.
  expect(data!.status).toBe("flagged");
  expect(String(data!.flagged_reason)).toContain("weichen um");
  expect(new Date(data!.started_at as string).toISOString()).toBe(schief);

  await db.from("time_entry").delete().eq("client_uuid", clientUuid);
  await aufraeumen();
});

test("Ausstempeln ohne laufenden Eintrag wird sauber abgelehnt", async ({
  page,
}) => {
  await aufraeumen();
  await login(page, DEMO.monteur);

  const antwort = await page.request.post("/api/m/sync", {
    data: {
      clientUuid: "33333333-4444-4555-8666-777777777777",
      clientTs: new Date().toISOString(),
      kind: "time_stop",
      payload: {},
    },
  });

  expect(antwort.status()).toBe(409);
  expect((await antwort.json()).error).toContain("Kein laufender Eintrag");
});

test("Die Monteur-App ist auf 390 px bedienbar", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, DEMO.monteur);
  await page.goto("/m/heute");

  await expect(page.getByRole("heading", { name: "Heute" })).toBeVisible();

  // Kein horizontales Scrollen.
  const masse = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(masse.scroll).toBeLessThanOrEqual(masse.client);

  // Touchziele mindestens 56 px hoch.
  await page.goto("/m/stempeln");
  const knopf = page.getByRole("button", { name: /Ein-|Einstempeln/ });
  const box = await knopf.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(56);
});
