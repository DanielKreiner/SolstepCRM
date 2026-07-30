import { expect, test } from "@playwright/test";
import { COMPANY_A, DEMO, admin, login } from "./helpers";

/*
 * Definition of Done Meilenstein 10 (CLAUDE.md Abschnitt 12):
 *   "Jahresplaner, Resturlaub, Korrekturworkflow, E-Signatur-Status"
 *
 * Der Korrekturworkflow ist der harte Teil: CLAUDE.md 5.4 verlangt, dass
 * eine Korrektur nie überschreibt.
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

/*
 * Vollständig aufräumen, auch was aus einem abgebrochenen Lauf stammt.
 *
 * Wichtig: ein Ersatzeintrag erbt die Notiz des Originals. Nach der Notiz
 * allein zu löschen reicht deshalb nicht — ein Ersatz einer Seed-Buchung
 * bliebe stehen und würde die Iststunden des Auftrags dauerhaft verschieben.
 * Genau das ist einmal passiert und hat den Auftragstest aus Meilenstein 1
 * kippen lassen.
 */
async function aufraeumen() {
  const db = admin();
  await db.from("time_correction").delete().eq("company_id", COMPANY_A);
  await db.from("absence").delete().like("note", "E2E-M10%");
  await db
    .from("absence")
    .delete()
    .eq("company_id", COMPANY_A)
    .eq("kind", "sick");

  const { data: ersatz } = await db
    .from("time_entry")
    .select("id, replaces_id")
    .eq("company_id", COMPANY_A)
    .not("replaces_id", "is", null);

  for (const e of ersatz ?? []) {
    await db.from("time_entry").delete().eq("id", e.id);
    await db
      .from("time_entry")
      .update({ status: "booked" })
      .eq("id", e.replaces_id);
  }

  await db.from("time_entry").delete().like("note", "E2E-M10%");
}

test("Urlaub beantragen und der Resturlaub sinkt", async ({ page }) => {
  await aufraeumen();
  const db = admin();
  const uid = await userId(DEMO.bauleitung);

  await db.from("absence").delete().eq("user_id", uid);

  await login(page, DEMO.bauleitung);
  await page.goto("/abwesenheiten");

  const vorher = await page.getByText("Mein Resturlaub").locator("..").textContent();

  const form = page.locator("form", { hasText: "Abwesenheit eintragen" });
  await form.getByLabel("Art").selectOption("vacation");
  // Mo 05.10.2026 bis Fr 09.10.2026 = 5 Werktage
  await form.getByLabel("Von").fill("2026-10-05");
  await form.getByLabel("Bis").fill("2026-10-09");
  await form.getByLabel("Hinweis").fill("E2E-M10 Herbsturlaub");
  await form.getByRole("button", { name: "Eintragen" }).click();

  await expect(form.getByRole("status")).toContainText("eingereicht");

  const { data } = await db
    .from("absence")
    .select("status, from_date, to_date, kind")
    .eq("user_id", uid)
    .like("note", "E2E-M10%")
    .single();

  // Urlaub wird beantragt, nicht sofort genehmigt.
  expect(data!.status).toBe("requested");
  expect(data!.kind).toBe("vacation");

  // 38,5-Stunden-Kraft mit 25 Tagen Anspruch: nach 5 beantragten Tagen 20.
  await page.goto("/abwesenheiten?jahr=2026");
  await expect(page.getByText("20 Tage").first()).toBeVisible();
  expect(vorher).toBeTruthy();
});

test("Krankenstand gilt sofort und kennt keinen Grund", async ({ page }) => {
  const db = admin();
  const uid = await userId(DEMO.monteur);

  await login(page, DEMO.monteur);
  await page.goto("/abwesenheiten");

  const form = page.locator("form", { hasText: "Abwesenheit eintragen" });
  await form.getByLabel("Art").selectOption("sick");

  // Für Krankenstand gibt es kein Hinweisfeld.
  await expect(form.getByLabel("Hinweis")).toHaveCount(0);
  await expect(form.getByText("kein Grund erfasst")).toBeVisible();

  await form.getByLabel("Von").fill("2026-10-12");
  await form.getByLabel("Bis").fill("2026-10-13");
  await form.getByRole("button", { name: "Eintragen" }).click();
  await expect(form.getByRole("status")).toContainText("Krankenstand erfasst");

  const { data } = await db
    .from("absence")
    .select("status, kind, note")
    .eq("user_id", uid)
    .eq("kind", "sick")
    .single();

  expect(data!.status).toBe("approved");
  // Kein Freitext zum Krankheitsgrund — Art. 9 DSGVO.
  expect(data!.note).toBeNull();
});

test("Überschneidende Abwesenheiten werden abgewiesen", async ({ page }) => {
  await login(page, DEMO.monteur);
  await page.goto("/abwesenheiten");

  const form = page.locator("form", { hasText: "Abwesenheit eintragen" });
  await form.getByLabel("Art").selectOption("vacation");
  await form.getByLabel("Von").fill("2026-10-13");
  await form.getByLabel("Bis").fill("2026-10-15");
  await form.getByRole("button", { name: "Eintragen" }).click();

  await expect(form.getByRole("alert")).toContainText("Überschneidet sich");
});

test("Der Jahresplaner zeigt die Abwesenheit als Balken", async ({ page }) => {
  await login(page, DEMO.gf);
  await page.goto("/abwesenheiten?jahr=2026");

  await expect(page.getByRole("heading", { name: "Jahresplaner" })).toBeVisible();
  await expect(page.getByTitle(/12\. Okt: Krankenstand/)).toBeVisible();
  await expect(page.getByTitle(/5\. Okt: Urlaub/)).toBeVisible();
});

test("Eine genehmigte Korrektur überschreibt nicht, sondern ersetzt", async ({
  page,
}) => {
  await aufraeumen();
  const db = admin();
  const uid = await userId(DEMO.bauleitung);

  // Eine Buchung, die korrigiert werden soll.
  const heute = new Date();
  const tag = `${heute.getFullYear()}-${String(heute.getMonth() + 1).padStart(2, "0")}-${String(heute.getDate()).padStart(2, "0")}`;

  const { data: original } = await db
    .from("time_entry")
    .insert({
      company_id: COMPANY_A,
      user_id: uid,
      kind: "work",
      started_at: `${tag}T05:00:00.000Z`,
      ended_at: `${tag}T13:00:00.000Z`,
      note: "E2E-M10 Original",
      status: "booked",
    })
    .select("id, duration_min")
    .single();

  expect(original!.duration_min).toBe(480);

  await login(page, DEMO.bauleitung);
  await page.goto("/stundenkonto");

  const eintrag = page.locator(`li[data-entry="${original!.id}"]`);
  await eintrag.getByLabel("Ende").fill("17:00");
  await eintrag
    .getByLabel("Begründung")
    .fill("E2E-M10 Ausstempeln vergessen");
  await eintrag.getByRole("button", { name: "Korrektur beantragen" }).click();

  await expect(page.getByText("Korrektur beantragt")).toBeVisible();

  const { data: korrektur } = await db
    .from("time_correction")
    .select("id, status, time_entry_id")
    .like("reason", "E2E-M10%")
    .single();
  expect(korrektur!.status).toBe("requested");
  // Der Antrag muss an genau dieser Buchung hängen — sonst korrigiert der
  // Test unbemerkt eine Seed-Buchung.
  expect(korrektur!.time_entry_id).toBe(original!.id);

  // Genehmigen — die Bauleitung darf zeiterfassung schreiben.
  await page.reload();
  const karte = page.locator("li", { hasText: "E2E-M10 Ausstempeln" });
  await karte.getByRole("button", { name: "genehmigen" }).click();

  await expect
    .poll(async () => {
      const { data } = await db
        .from("time_correction")
        .select("status")
        .eq("id", korrektur!.id)
        .single();
      return data?.status;
    }, { timeout: 15_000 })
    .toBe("approved");

  // Der alte Eintrag existiert weiter, als ersetzt.
  const { data: alt } = await db
    .from("time_entry")
    .select("status, duration_min")
    .eq("id", original!.id)
    .single();
  expect(alt!.status).toBe("replaced");
  expect(alt!.duration_min).toBe(480);

  // Der neue Eintrag zeigt auf den alten.
  const { data: neu } = await db
    .from("time_entry")
    .select("status, duration_min, replaces_id")
    .eq("replaces_id", original!.id)
    .single();
  expect(neu!.status).toBe("approved");
  expect(neu!.replaces_id).toBe(original!.id);
  // 05:00 bis 17:00 Wiener Zeit im Sommer = 07:00 bis 19:00 lokal
  expect(Number(neu!.duration_min)).toBeGreaterThan(480);

  await db.from("time_entry").delete().eq("replaces_id", original!.id);
  await db.from("time_entry").delete().eq("id", original!.id);
  await aufraeumen();
});

test("Eine abgelehnte Korrektur lässt die Buchung unverändert", async ({
  page,
}) => {
  await aufraeumen();
  const db = admin();
  const uid = await userId(DEMO.bauleitung);
  const heute = new Date();
  const tag = `${heute.getFullYear()}-${String(heute.getMonth() + 1).padStart(2, "0")}-${String(heute.getDate()).padStart(2, "0")}`;

  const { data: original } = await db
    .from("time_entry")
    .insert({
      company_id: COMPANY_A,
      user_id: uid,
      kind: "work",
      started_at: `${tag}T05:00:00.000Z`,
      ended_at: `${tag}T13:00:00.000Z`,
      note: "E2E-M10 Bleibt",
      status: "booked",
    })
    .select("id")
    .single();

  await db.from("time_correction").insert({
    company_id: COMPANY_A,
    time_entry_id: original!.id,
    user_id: uid,
    requested_change_json: {
      started_at: `${tag}T05:00:00.000Z`,
      ended_at: `${tag}T20:00:00.000Z`,
    },
    reason: "E2E-M10 Wird abgelehnt",
  });

  await login(page, DEMO.bauleitung);
  await page.goto("/stundenkonto");

  const karte = page.locator("li", { hasText: "E2E-M10 Wird abgelehnt" });
  await karte.getByRole("button", { name: "ablehnen" }).click();

  await expect
    .poll(async () => {
      const { data } = await db
        .from("time_entry")
        .select("status")
        .eq("id", original!.id)
        .single();
      return data?.status;
    }, { timeout: 15_000 })
    .toBe("booked");

  // Kein Ersatzeintrag entstanden.
  const { count } = await db
    .from("time_entry")
    .select("id", { count: "exact", head: true })
    .eq("replaces_id", original!.id);
  expect(count ?? 0).toBe(0);

  await db.from("time_entry").delete().eq("id", original!.id);
  await aufraeumen();
});
