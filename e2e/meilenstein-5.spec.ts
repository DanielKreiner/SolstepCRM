import { expect, test } from "@playwright/test";
import { COMPANY_A, DEMO, admin, login } from "./helpers";

/*
 * Definition of Done Meilenstein 5 (CLAUDE.md Abschnitt 12):
 *   "Flugmodus-Test: 3 Buchungen offline, nach Reconnect vollständig
 *    und korrekt"
 */

test.describe.configure({ mode: "serial" });

const FLUG = "E2E-FLUGMODUS";

/** Alles, was dieser Test an Vorgang, Artikeln und Einsatz anlegt. */
async function beladungAufraeumen() {
  const db = admin();

  const { data: vs } = await db
    .from("vorgang")
    .select("id")
    .eq("company_id", COMPANY_A)
    .like("zaehlpunkt", `${FLUG}%`);

  for (const v of vs ?? []) {
    await db.from("lagerbewegung").delete().eq("vorgang_id", v.id);
    await db.from("vorgang_bedarf").delete().eq("vorgang_id", v.id);

    const { data: es } = await db
      .from("einsatz")
      .select("id")
      .eq("vorgang_id", v.id);
    for (const e of es ?? []) {
      await db.from("einsatz_person").delete().eq("einsatz_id", e.id);
      await db.from("einsatz").delete().eq("id", e.id);
    }
    await db.from("vorgang").delete().eq("id", v.id);
  }

  const { data: as } = await db
    .from("article")
    .select("id")
    .eq("company_id", COMPANY_A)
    .like("sku", `${FLUG}%`);
  for (const a of as ?? []) {
    await db.from("lagerbewegung").delete().eq("artikel_id", a.id);
    await db.from("article").delete().eq("id", a.id);
  }
}

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
  await beladungAufraeumen();
  const db = admin();

  /*
   * Der Monteur bucht sein Material seit dem Material-Briefing über die
   * Beladeliste und nicht mehr über ein freies Formular. Der Test prüft
   * dasselbe wie vorher — dass keine Buchung verloren geht —, nur eben
   * am echten Weg.
   */
  const { data: kunde } = await db
    .from("customer")
    .select("id")
    .eq("company_id", COMPANY_A)
    .is("deleted_at", null)
    .limit(1)
    .single();

  const { data: nr } = await db.rpc("next_number", {
    p_company: COMPANY_A,
    p_kind: "vorgang",
  });

  const { data: v } = await db
    .from("vorgang")
    .insert({
      company_id: COMPANY_A,
      number: nr as string,
      customer_id: kunde!.id,
      phase: "beauftragt",
      phase_seit: new Date().toISOString(),
      zaehlpunkt: FLUG,
    })
    .select("id")
    .single();

  /* Drei Artikel mit Bestand im Hauptlager — sonst steht nichts zu laden. */
  const { data: ort } = await db
    .from("lagerort")
    .select("id")
    .eq("company_id", COMPANY_A)
    .eq("art", "hauptlager")
    .single();

  const artikelIds: string[] = [];
  for (const i of [1, 2, 3]) {
    const { data: a } = await db
      .from("article")
      .insert({
        company_id: COMPANY_A,
        sku: `${FLUG}-${i}`,
        name: `Flugmodus-Artikel ${i}`,
        unit: "Stk",
        purchase_price: 10,
        sale_price: 20,
        vat_rate: 20,
        active: true,
        typ: "stueckliste",
      })
      .select("id")
      .single();
    artikelIds.push(a!.id as string);

    await db.from("lagerbewegung").insert({
      company_id: COMPANY_A,
      artikel_id: a!.id,
      typ: "rueckgabe_korrektur",
      nach_lagerort_id: ort!.id,
      menge: 50,
      notiz: `${FLUG} Anfangsbestand`,
    });

    await db.from("vorgang_bedarf").insert({
      company_id: COMPANY_A,
      vorgang_id: v!.id,
      artikel_id: a!.id,
      bezeichnung: `Flugmodus-Artikel ${i}`,
      menge: i * 2,
      einheit: "Stk",
      herkunft: "angebot",
      sort: i * 10,
    });
  }

  const uid = await monteurId();
  const von = new Date();
  von.setHours(7, 0, 0, 0);
  const bis = new Date(von);
  bis.setHours(16, 0, 0, 0);

  const { data: e } = await db
    .from("einsatz")
    .insert({
      company_id: COMPANY_A,
      art: "auftrag",
      vorgang_id: v!.id,
      von: von.toISOString(),
      bis: bis.toISOString(),
    })
    .select("id")
    .single();

  await db.from("einsatz_person").insert({
    company_id: COMPANY_A,
    einsatz_id: e!.id,
    user_id: uid,
  });

  await login(page, DEMO.monteur);
  await page.goto("/m/material");

  const block = page
    .locator("section")
    .filter({ hasText: "Flugmodus-Artikel 1" })
    .first();
  await expect(block.getByRole("heading", { name: "Zu laden" })).toBeVisible();

  await context.setOffline(true);

  /* Drei Haken im Flugmodus — je Zeile einer. */
  for (const i of [1, 2, 3]) {
    const zeile = block
      .locator("li")
      .filter({ hasText: `Flugmodus-Artikel ${i}` })
      .first();
    await zeile.getByRole("button", { name: "Geladen", exact: true }).click();
    await expect(
      zeile.getByRole("button", { name: /Geladen ✓/ }),
    ).toBeVisible();
  }

  const banner = page.getByTestId("offline-banner");
  await expect(banner).toContainText("Offline");
  await expect(banner).toContainText("3 Buchungen");

  /* Offline darf nichts in der Datenbank stehen. */
  const { count: offline } = await db
    .from("lagerbewegung")
    .select("id", { count: "exact", head: true })
    .eq("vorgang_id", v!.id);
  expect(offline ?? 0).toBe(0);

  // ---- Reconnect ----
  await context.setOffline(false);

  await expect
    .poll(
      async () => {
        const { count } = await db
          .from("lagerbewegung")
          .select("id", { count: "exact", head: true })
          .eq("vorgang_id", v!.id);
        return count ?? 0;
      },
      { timeout: 30_000 },
    )
    .toBe(3);

  const { data: gebucht } = await db
    .from("lagerbewegung")
    .select("menge, typ, client_uuid, created_by")
    .eq("vorgang_id", v!.id);

  expect((gebucht ?? []).every((b) => b.typ === "entnahme")).toBe(true);
  expect((gebucht ?? []).every((b) => b.created_by === uid)).toBe(true);
  /* Jede Buchung mit eigener Idempotenzklammer. */
  expect(new Set((gebucht ?? []).map((b) => b.client_uuid)).size).toBe(3);
  expect(
    (gebucht ?? []).map((b) => Number(b.menge)).sort((a, b) => a - b),
  ).toEqual([2, 4, 6]);

  await expect(banner).toHaveCount(0, { timeout: 15_000 });

  await beladungAufraeumen();
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
