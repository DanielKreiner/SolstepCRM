import { expect, test } from "@playwright/test";
import { COMPANY_A, DEMO, admin, login, suchwahl } from "./helpers";

/*
 * Die Einsatzplanung konnte Einsätze anzeigen, zuordnen und freigeben —
 * nur nicht anlegen. Ein Auftrag im Pool "Nicht terminiert" war von hier
 * aus nicht in den Plan zu bekommen.
 *
 * Geprüft wird beides: dass ein Einsatz entsteht, und dass die
 * Ruhezeitregel schon beim Eintragen greift und nicht erst am Freitag
 * beim Veröffentlichen.
 */

test.describe.configure({ mode: "serial" });

const TITEL = "E2E-DISPO Montage";

/** Ein Montag weit genug in der Zukunft, damit nichts kollidiert. */
const MONTAG = "2027-03-01";

const zustand: { jobId?: string; jobLabel?: string; userId?: string; userName?: string } = {};

/*
 * Nach Zeitfenster aufräumen, nicht nach Bezeichnung: schlägt ein Lauf
 * mittendrin fehl, bleibt sonst ein Einsatz stehen, und der nächste Lauf
 * scheitert an einer Überschneidung, die er selbst hinterlassen hat.
 */
async function aufraeumen(): Promise<void> {
  const db = admin();
  await db
    .from("job_appointment")
    .delete()
    .gte("starts_at", "2027-02-25T00:00:00Z")
    .lte("starts_at", "2027-03-10T00:00:00Z");
}

test.beforeAll(async () => {
  await aufraeumen();
  const db = admin();

  const { data: job } = await db
    .from("job")
    .select("id, number, customer:customer_id ( name )")
    .eq("company_id", COMPANY_A)
    .order("number", { ascending: false })
    .limit(1)
    .single();

  zustand.jobId = job!.id as string;
  zustand.jobLabel = job!.number as string;

  const { data: user } = await db
    .from("app_user")
    .select("id, name")
    .eq("company_id", COMPANY_A)
    .eq("role", "monteur")
    .eq("active", true)
    .limit(1)
    .single();

  zustand.userId = user!.id as string;
  zustand.userName = user!.name as string;
});

test.afterAll(aufraeumen);

test("1 — Einsatz eintragen", async ({ page }) => {
  const db = admin();

  await login(page, DEMO.gf);
  await page.goto(`/dispo?woche=${MONTAG}`);

  await page.getByRole("button", { name: "Einsatz eintragen" }).click();

  await suchwahl(page, "Auftrag", zustand.jobLabel!);
  await suchwahl(page, "Wer", zustand.userName!);
  await page.getByLabel("Tag").fill(MONTAG);
  await page.getByLabel("Bezeichnung").fill(TITEL);
  await page.getByLabel("Von").fill("07:00");
  await page.getByLabel("Bis").fill("16:00");
  await page.getByRole("button", { name: "Eintragen" }).click();

  await expect(page.getByText("Einsatz eingetragen.")).toBeVisible({
    timeout: 20_000,
  });

  const { data } = await db
    .from("job_appointment")
    .select("id, job_id, user_id, starts_at, ends_at")
    .eq("title", TITEL)
    .single();

  expect(data!.job_id).toBe(zustand.jobId);
  expect(data!.user_id).toBe(zustand.userId);

  /*
   * 07:00 Wiener Zeit am 1. März ist Winterzeit, also 06:00 UTC. Die
   * Datenbank speichert UTC, die Anzeige rechnet zurück (CLAUDE.md 5.3).
   */
  expect(data!.starts_at).toContain("06:00:00");
});

test("2 — Der Einsatz steht im Wochenplan", async ({ page }) => {
  await login(page, DEMO.gf);
  await page.goto(`/dispo?woche=${MONTAG}`);

  await expect(page.getByText(zustand.userName!).first()).toBeVisible();
  await expect(page.getByText(TITEL).first()).toBeVisible({ timeout: 15_000 });
});

test("3 — Die Ruhezeit greift schon beim Eintragen", async ({ page }) => {
  const db = admin();

  await login(page, DEMO.gf);
  await page.goto(`/dispo?woche=${MONTAG}`);

  await page.getByRole("button", { name: "Einsatz eintragen" }).click();
  await suchwahl(page, "Auftrag", zustand.jobLabel!);
  await suchwahl(page, "Wer", zustand.userName!);
  // Am Folgetag um 04:00 — nach Feierabend 16:00 sind das 12 h … reicht.
  // Also 01:00: 9 Stunden Ruhe, das ist zu wenig.
  await page.getByLabel("Tag").fill("2027-03-02");
  await page.getByLabel("Bezeichnung").fill(`${TITEL} früh`);
  await page.getByLabel("Von").fill("01:00");
  await page.getByLabel("Bis").fill("06:00");
  await page.getByRole("button", { name: "Eintragen" }).click();

  await expect(page.getByText(/Ruhezeit 9 statt 11 Stunden/)).toBeVisible({
    timeout: 20_000,
  });

  // Nichts angelegt, solange nicht bewusst bestätigt wurde.
  const { count } = await db
    .from("job_appointment")
    .select("id", { count: "exact", head: true })
    .eq("title", `${TITEL} früh`);
  expect(count).toBe(0);

  // Mit Bestätigung geht es durch — der Betrieb muss im Notfall planen können.
  await page.getByRole("checkbox", { name: /Trotzdem eintragen/ }).check();
  await page.getByRole("button", { name: "Eintragen" }).click();

  await expect(page.getByText("Einsatz eingetragen.")).toBeVisible({
    timeout: 20_000,
  });

  /*
   * Der übergangene Einsatz steht dort, wo er im Formular stand — nicht
   * auf den Vorgabewerten. Eine abgelehnte Eingabe darf beim zweiten
   * Anlauf nichts anderes buchen als das, was auf dem Bildschirm steht.
   */
  const { data: uebergangen } = await db
    .from("job_appointment")
    .select("starts_at, ends_at")
    .eq("title", `${TITEL} früh`)
    .single();

  expect(uebergangen!.starts_at).toContain("2027-03-02T00:00:00");
  expect(uebergangen!.ends_at).toContain("2027-03-02T05:00:00");
});

test("4 — Ein Monteur trägt keine Einsätze ein", async ({ page }) => {
  await login(page, DEMO.monteur);
  const antwort = await page.goto(`/dispo?woche=${MONTAG}`);

  /*
   * Entweder ist der Screen für die Rolle gesperrt oder er ist lesend —
   * beides ist in Ordnung. Nicht in Ordnung wäre ein Eintragen-Knopf.
   */
  if ((antwort?.status() ?? 200) < 400) {
    await expect(
      page.getByRole("button", { name: "Einsatz eintragen" }),
    ).toHaveCount(0);
  }
});
