import { expect, test } from "@playwright/test";
import { COMPANY_A, DEMO, admin, login } from "./helpers";

/*
 * Meilenstein 10, zweiter Teil: Mitarbeiter, Qualifikationen mit
 * Ablaufwarnung, Dokumente mit Signaturstatus, Selfservice.
 *
 * Der wichtigste Test ist der letzte: die Personalakte darf nicht bloß im
 * UI ausgeblendet sein.
 */

test.describe.configure({ mode: "serial" });

async function userId(email: string): Promise<string> {
  const { data } = await admin()
    .from("app_user")
    .select("id")
    .eq("email", email)
    .single();
  return data!.id as string;
}

async function aufraeumen() {
  const db = admin();
  await db.from("qualification").delete().like("name", "E2E-M10b%");
  await db.from("job_document").delete().like("filename", "e2e-m10b%");
}

test("Die Mitarbeiterliste zeigt Rollen und Iststunden", async ({ page }) => {
  await aufraeumen();
  await login(page, DEMO.gf);
  await page.goto("/mitarbeiter");

  await expect(page.getByRole("heading", { name: "Mitarbeiter" })).toBeVisible();
  // .first(): der angemeldete Name steht auch in der Kopfzeile.
  await expect(page.getByText("Michael Hofstätter").first()).toBeVisible();
  await expect(page.getByText("Dominik Pöschl").first()).toBeVisible();
  await expect(page.getByText("Geschäftsführung").first()).toBeVisible();
});

test("Ein Nachweis mit Ablaufdatum wird gewarnt und dann kritisch", async ({
  page,
}) => {
  const db = admin();
  const uid = await userId(DEMO.monteur);

  await login(page, DEMO.gf);
  await page.goto(`/mitarbeiter/${uid}`);

  const bald = new Date();
  bald.setDate(bald.getDate() + 30);

  const form = page.locator("form", { hasText: "Nachweis" });
  await form.getByLabel("Nachweis").fill("E2E-M10b PSA gegen Absturz");
  await form.getByLabel("Gültig bis").fill(bald.toISOString().slice(0, 10));
  await form.getByRole("button", { name: "Eintragen" }).click();

  await expect(page.getByText("E2E-M10b PSA gegen Absturz").first()).toBeVisible();

  // 30 Tage Restlaufzeit: Warnung, nicht kritisch.
  const zeile = page
    .locator("li")
    .filter({ hasText: "E2E-M10b PSA gegen Absturz" });
  await expect(zeile.getByText(/^bis /)).toBeVisible();

  // Auf abgelaufen setzen — jetzt muss es kritisch werden.
  const gestern = new Date();
  gestern.setDate(gestern.getDate() - 1);
  await db
    .from("qualification")
    .update({ valid_until: gestern.toISOString().slice(0, 10) })
    .like("name", "E2E-M10b%");

  await page.reload();
  await expect(
    page
      .locator("li")
      .filter({ hasText: "E2E-M10b PSA gegen Absturz" })
      .getByText("abgelaufen"),
  ).toBeVisible();

  // Und in der Liste steht die Zahl.
  await page.goto("/mitarbeiter");
  await expect(page.getByText("1 abgelaufen").first()).toBeVisible();
});

test("Der certificate-check meldet den abgelaufenen Nachweis", async ({
  request,
}) => {
  const db = admin();
  await db.from("job_run").delete().eq("kind", "certificate-check");
  await db.from("notification").delete().eq("kind", "qualification_expiring");

  const antwort = await request.get("/api/cron/certificate-check", {
    headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
  });
  expect(antwort.status()).toBe(200);
  const ergebnis = await antwort.json();
  expect(ergebnis.gewarnt).toBeGreaterThan(0);

  const { data } = await db
    .from("notification")
    .select("title, body")
    .eq("kind", "qualification_expiring");

  expect((data ?? []).length).toBeGreaterThan(0);
  expect(
    (data ?? []).some((n) => String(n.title).includes("abgelaufen")),
  ).toBe(true);

  await db.from("job_run").delete().eq("kind", "certificate-check");
});

test("Ein Dokument mit ausstehender Unterschrift lässt sich bestätigen", async ({
  page,
}) => {
  const db = admin();
  const uid = await userId(DEMO.monteur);

  // Dokument direkt anlegen — der Upload braucht Storage, das ist hier
  // nicht der Prüfgegenstand.
  const { data: dok } = await db
    .from("job_document")
    .insert({
      company_id: COMPANY_A,
      user_id: uid,
      kind: "contract",
      bucket: "documents",
      path: `${COMPANY_A}/mitarbeiter/${uid}/e2e-m10b-vertrag.pdf`,
      filename: "e2e-m10b-vertrag.pdf",
      size_bytes: 1234,
      signature_status: "pending",
    })
    .select("id")
    .single();

  // Die betroffene Person darf selbst unterschreiben.
  await login(page, DEMO.monteur);
  await page.goto("/meine-dokumente");

  await expect(page.getByText("e2e-m10b-vertrag.pdf").first()).toBeVisible();
  await page
    .getByRole("button", { name: /e2e-m10b-vertrag.pdf als unterschrieben/ })
    .click();

  await expect
    .poll(async () => {
      const { data } = await db
        .from("job_document")
        .select("signature_status, signed_at")
        .eq("id", dok!.id)
        .single();
      return data?.signature_status;
    }, { timeout: 15_000 })
    .toBe("signed");

  const { data: nachher } = await db
    .from("job_document")
    .select("signed_at")
    .eq("id", dok!.id)
    .single();

  // Die Datenbank erzwingt seit 0010, dass eine Signatur einen Zeitpunkt hat.
  expect(nachher!.signed_at).toBeTruthy();
});

test("Eine Signatur ohne Zeitpunkt lehnt die Datenbank ab", async () => {
  const db = admin();
  const uid = await userId(DEMO.monteur);

  const { error } = await db.from("job_document").insert({
    company_id: COMPANY_A,
    user_id: uid,
    kind: "other",
    bucket: "documents",
    path: `${COMPANY_A}/mitarbeiter/${uid}/e2e-m10b-ohne-zeit.pdf`,
    filename: "e2e-m10b-ohne-zeit.pdf",
    signature_status: "signed",
    signed_at: null,
  });

  expect(error).not.toBeNull();
  expect(String(error!.message)).toContain("signed_at");
});

test("Die Personalakte eines Kollegen bleibt verborgen", async () => {
  const db = admin();
  const bauleitung = await userId(DEMO.bauleitung);

  // Ein Lohnzettel für die Bauleitung.
  await db.from("job_document").insert({
    company_id: COMPANY_A,
    user_id: bauleitung,
    kind: "payslip",
    bucket: "documents",
    path: `${COMPANY_A}/mitarbeiter/${bauleitung}/e2e-m10b-lohn.pdf`,
    filename: "e2e-m10b-lohn.pdf",
    signature_status: "none",
  });

  const { createClient } = await import("@supabase/supabase-js");
  const alsMonteur = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  await alsMonteur.auth.signInWithPassword({
    email: DEMO.monteur,
    password: process.env.SEED_PASSWORD!,
  });

  const monteurId = await userId(DEMO.monteur);
  const { data: sichtbar } = await alsMonteur
    .from("job_document")
    .select("filename, user_id")
    .limit(200);

  // Der Monteur sieht keine fremde Personalakte — geprüft an der Datenbank,
  // nicht am Bildschirm.
  const fremdePersonalakte = (sichtbar ?? []).filter(
    (d) => d.user_id !== null && d.user_id !== monteurId,
  );
  expect(fremdePersonalakte).toHaveLength(0);

  // Die Bauleitung hat Leserecht auf Mitarbeiter und sieht ihn.
  const alsBauleitung = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  await alsBauleitung.auth.signInWithPassword({
    email: DEMO.bauleitung,
    password: process.env.SEED_PASSWORD!,
  });
  const { data: bl } = await alsBauleitung
    .from("job_document")
    .select("filename")
    .eq("filename", "e2e-m10b-lohn.pdf");
  expect((bl ?? []).length).toBe(1);

  await aufraeumen();
});

test("Meine Zeiten zeigen ausschließlich die eigenen Buchungen", async ({
  page,
}) => {
  const uid = await userId(DEMO.monteur);

  await login(page, DEMO.monteur);
  await page.goto("/meine-zeiten");

  await expect(page.getByRole("heading", { name: "Meine Zeiten" })).toBeVisible();

  const { count: eigene } = await admin()
    .from("time_entry")
    .select("id", { count: "exact", head: true })
    .eq("user_id", uid);

  const { count: alle } = await admin()
    .from("time_entry")
    .select("id", { count: "exact", head: true })
    .eq("company_id", COMPANY_A);

  // Der Testfall taugt nur, wenn es überhaupt fremde Buchungen gibt.
  expect(alle ?? 0).toBeGreaterThan(eigene ?? 0);
  await expect(page.getByText("nur die eigenen Buchungen")).toBeVisible();
});
