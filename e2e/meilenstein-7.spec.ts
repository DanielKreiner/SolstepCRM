import { expect, test } from "@playwright/test";
import { COMPANY_A, DEMO, admin, login } from "./helpers";

/*
 * Definition of Done Meilenstein 7 (CLAUDE.md Abschnitt 12):
 *   "Teilrechnungslogik Anzahlung/Montage/Schluss, Mahnstufen automatisch"
 */

test.describe.configure({ mode: "serial" });

const AUFTRAG = "A-2026-0038"; // Wert 15.200,00 netto

async function jobId(): Promise<string> {
  const { data } = await admin()
    .from("job")
    .select("id")
    .eq("company_id", COMPANY_A)
    .eq("number", AUFTRAG)
    .single();
  return data!.id as string;
}

async function aufraeumen() {
  const db = admin();
  await db.from("mail_outbox").delete().not("invoice_id", "is", null);
  await db.from("invoice").delete().eq("company_id", COMPANY_A);
  await db.from("job_run").delete().eq("kind", "dunning");
}

test("Anzahlung, Teilrechnung und Schlussrechnung gehen exakt auf", async ({
  page,
}) => {
  await aufraeumen();
  const id = await jobId();

  await login(page, DEMO.gf);
  await page.goto("/rechnungen");

  const form = page.locator("form", { hasText: "Rechnung erzeugen" });

  for (const [art, erwartet] of [
    ["deposit", 4560], // 30 % von 15.200
    ["partial", 6080], // 40 %
    ["final", 4560], // Rest
  ] as const) {
    await form.getByLabel("Auftrag").selectOption(id);
    await form.getByLabel("Art").selectOption(art);
    await form.getByRole("button", { name: "Rechnung erzeugen" }).click();
    await expect(form.getByRole("status")).toContainText(
      erwartet.toFixed(2).replace(".", "."),
    );
  }

  const { data } = await admin()
    .from("invoice")
    .select("kind, amount_net, vat_amount, status, number")
    .eq("job_id", id)
    .order("kind");

  expect(data).toHaveLength(3);

  const summe = (data ?? []).reduce((s, i) => s + Number(i.amount_net), 0);
  // Die Summe der Teilrechnungen trifft den Auftragswert auf den Cent.
  expect(Math.round(summe * 100) / 100).toBe(15200);

  // 20 Prozent USt. auf jede Position.
  for (const i of data ?? []) {
    expect(Number(i.vat_amount)).toBeCloseTo(Number(i.amount_net) * 0.2, 2);
    expect(String(i.number)).toMatch(/^RE-\d{4}-\d{4}$/);
  }
});

test("Dieselbe Rechnungsart gibt es nur einmal je Auftrag", async ({ page }) => {
  const id = await jobId();

  await login(page, DEMO.gf);
  await page.goto("/rechnungen");

  const form = page.locator("form", { hasText: "Rechnung erzeugen" });
  await form.getByLabel("Auftrag").selectOption(id);
  await form.getByLabel("Art").selectOption("deposit");
  await form.getByRole("button", { name: "Rechnung erzeugen" }).click();

  await expect(form.getByRole("alert")).toContainText("bereits eine Anzahlung");

  const { count } = await admin()
    .from("invoice")
    .select("id", { count: "exact", head: true })
    .eq("job_id", id);
  expect(count).toBe(3);
});

test("Storno statt Löschen", async ({ page }) => {
  const id = await jobId();
  const db = admin();

  const { data: rechnung } = await db
    .from("invoice")
    .select("id, number")
    .eq("job_id", id)
    .eq("kind", "partial")
    .single();

  await login(page, DEMO.gf);

  /*
   * Die Aktionen liegen seit dem Umbau im Detailpanel, nicht mehr an jeder
   * Zeile — so wie in der Vorlage. Welcher Beleg im Panel steht, sagt die
   * URL, deshalb wird er hier direkt angesteuert.
   */
  await page.goto(`/rechnungen?beleg=${rechnung!.id}`);
  await expect(
    page.getByRole("heading", { name: /^Teilrechnungen/ }),
  ).toBeVisible();

  await page.getByRole("button", { name: "stornieren" }).click();

  await expect
    .poll(async () => {
      const { data } = await db
        .from("invoice")
        .select("status")
        .eq("id", rechnung!.id)
        .single();
      return data?.status;
    })
    .toBe("cancelled");

  // Die Zeile bleibt bestehen — eine erzeugte Rechnung wird nicht gelöscht.
  const { count } = await db
    .from("invoice")
    .select("id", { count: "exact", head: true })
    .eq("id", rechnung!.id);
  expect(count).toBe(1);
});

test("Der Mahnlauf stuft automatisch hoch und schreibt eine Mail", async ({
  page,
}) => {
  await aufraeumen();
  const id = await jobId();
  const db = admin();

  // Eine versendete Rechnung, zehn Tage überfällig.
  const faellig = new Date();
  faellig.setDate(faellig.getDate() - 10);

  const { data: nummer } = await db.rpc("next_number", {
    p_company: COMPANY_A,
    p_kind: "invoice",
  });

  const { data: rechnung } = await db
    .from("invoice")
    .insert({
      company_id: COMPANY_A,
      job_id: id,
      number: nummer as string,
      kind: "final",
      amount_net: 15200,
      vat_amount: 3040,
      due_date: faellig.toISOString().slice(0, 10),
      status: "sent",
    })
    .select("id, number")
    .single();

  await login(page, DEMO.gf);

  // Ohne Geheimnis kein Zutritt.
  const ohne = await page.request.get("/api/cron/dunning");
  expect(ohne.status()).toBe(401);

  const secret = process.env.CRON_SECRET;
  expect(secret, "CRON_SECRET fehlt in .env.local").toBeTruthy();

  const lauf = await page.request.get("/api/cron/dunning", {
    headers: { authorization: `Bearer ${secret}` },
  });
  expect(lauf.status()).toBe(200);
  const ergebnis = await lauf.json();
  expect(ergebnis.gemahnt).toBe(1);

  const { data: nachher } = await db
    .from("invoice")
    .select("status, dunning_level, last_dunned_at")
    .eq("id", rechnung!.id)
    .single();

  // Zehn Tage überfällig heißt Stufe 1, nicht Stufe 2.
  expect(nachher!.status).toBe("overdue");
  expect(nachher!.dunning_level).toBe(1);
  expect(nachher!.last_dunned_at).toBeTruthy();

  const { data: mails } = await db
    .from("mail_outbox")
    .select("subject, invoice_id")
    .eq("invoice_id", rechnung!.id);
  expect(mails).toHaveLength(1);
  expect(String(mails![0]!.subject)).toContain("Zahlungserinnerung");
});

test("Ein zweiter Lauf am selben Tag mahnt nicht doppelt", async ({ page }) => {
  await login(page, DEMO.gf);
  const secret = process.env.CRON_SECRET;

  const zweiter = await page.request.get("/api/cron/dunning", {
    headers: { authorization: `Bearer ${secret}` },
  });
  expect(zweiter.status()).toBe(200);
  expect((await zweiter.json()).uebersprungen).toBe("bereits gelaufen");

  const { count } = await admin()
    .from("mail_outbox")
    .select("id", { count: "exact", head: true })
    .not("invoice_id", "is", null);
  expect(count).toBe(1);

  await aufraeumen();
});

test("Ohne Schreibrecht auf Rechnungen gibt es kein Formular", async ({
  page,
}) => {
  await login(page, DEMO.lager);
  await page.goto("/rechnungen");

  await expect(
    page.getByText("fehlt deiner Rolle das Schreibrecht"),
  ).toBeVisible();
});
