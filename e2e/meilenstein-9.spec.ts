import { randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
import { COMPANY_A, DEMO, admin, login } from "./helpers";

/*
 * Definition of Done Meilenstein 9 (CLAUDE.md Abschnitt 12):
 *   "Aktivitäten laufen automatisch ein (Portal, Mail, Angebotsstatus)"
 *
 * Entscheidend ist das Wort automatisch: die Aktivitäten entstehen in der
 * Datenbank, nicht im Anwendungscode. Diese Tests schreiben deshalb direkt
 * in die Fachtabellen — käme der Eintrag aus einer Server Action, wäre er
 * hier nicht zu sehen.
 */

test.describe.configure({ mode: "serial" });

async function kunde(name: string): Promise<string> {
  const { data } = await admin()
    .from("customer")
    .select("id")
    .eq("company_id", COMPANY_A)
    .eq("name", name)
    .single();
  return data!.id as string;
}

async function aktivitaeten(customerId: string) {
  const { data } = await admin()
    .from("contact_activity")
    .select("kind, body, meta_json, created_at")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false });
  return data ?? [];
}

test("Ein versendetes Angebot erzeugt eine Aktivität", async () => {
  const db = admin();
  const customerId = await kunde("Familie Brandstätter");
  const vorher = (await aktivitaeten(customerId)).length;

  const { data: vorgang } = await db
    .from("vorgang")
    .select("id, number")
    .eq("company_id", COMPANY_A)
    .eq("customer_id", customerId)
    .limit(1)
    .single();

  // Direkt in die Fachtabelle — ohne Server Action.
  const { data: dok, error } = await db
    .from("vorgang_dokument")
    .insert({
      company_id: COMPANY_A,
      vorgang_id: vorgang!.id,
      typ: "angebot",
      dateiname: "e2e-m9.pdf",
      status: "versendet",
    })
    .select("id")
    .single();
  expect(error).toBeNull();

  const nachher = await aktivitaeten(customerId);
  expect(nachher.length).toBe(vorher + 1);
  expect(nachher[0]!.kind).toBe("quote");
  expect(String(nachher[0]!.body)).toContain("Angebot versendet");
  // Der Bezug wandert mit, sonst führt der Eintrag nirgendwohin.
  expect((nachher[0]!.meta_json as { vorgang_id?: string }).vorgang_id).toBe(
    vorgang!.id,
  );

  await db.from("vorgang_dokument").delete().eq("id", dok!.id);
});

test("Ein Serviceticket aus dem Portal erzeugt eine Portal-Aktivität", async () => {
  const db = admin();
  const customerId = await kunde("Tischlerei Aigner GmbH");
  const vorher = (await aktivitaeten(customerId)).length;

  const { data: nummer } = await db.rpc("next_number", {
    p_company: COMPANY_A,
    p_kind: "ticket",
  });

  await db.from("service_ticket").insert({
    company_id: COMPANY_A,
    customer_id: customerId,
    number: nummer as string,
    source: "portal",
    category: "frage",
    body: "E2E-M9 Frage zur Abrechnung des Überschussstroms.",
  });

  const nachher = await aktivitaeten(customerId);
  expect(nachher.length).toBe(vorher + 1);
  expect(nachher[0]!.kind).toBe("portal");
  expect(String(nachher[0]!.body)).toContain("E2E-M9");

  await db.from("service_ticket").delete().like("body", "E2E-M9%");
});

test("Eine zugeordnete Mail erscheint beim Kunden", async () => {
  const db = admin();
  const customerId = await kunde("Familie Brandstätter");
  const vorher = (await aktivitaeten(customerId)).length;

  const { data: account } = await db
    .from("mail_account")
    .select("id")
    .eq("company_id", COMPANY_A)
    .single();

  // Erst ohne Zuordnung — das darf nichts auslösen.
  const { data: mail } = await db
    .from("mail_message")
    .insert({
      company_id: COMPANY_A,
      mail_account_id: account!.id,
      direction: "in",
      message_id: `e2e-m9-${randomBytes(4).toString("hex")}@example.com`,
      subject: "E2E-M9 Rückfrage zum Termin",
      from_addr: "kunde@example.at",
    })
    .select("id")
    .single();

  expect((await aktivitaeten(customerId)).length).toBe(vorher);

  // Jetzt zuordnen.
  await db
    .from("mail_message")
    .update({ customer_id: customerId, assigned_by: "address" })
    .eq("id", mail!.id);

  const nachher = await aktivitaeten(customerId);
  expect(nachher.length).toBe(vorher + 1);
  expect(nachher[0]!.kind).toBe("mail");
  expect(String(nachher[0]!.body)).toContain("Mail erhalten");
  expect(String(nachher[0]!.body)).toContain("E2E-M9");

  // Ein weiteres Update ohne Zuordnungswechsel darf nicht doppelt zählen.
  await db
    .from("mail_message")
    .update({ subject: "E2E-M9 geändert" })
    .eq("id", mail!.id);
  expect((await aktivitaeten(customerId)).length).toBe(vorher + 1);

  await db.from("mail_message").delete().eq("id", mail!.id);
});

test("Ein Phasenwechsel am Vorgang landet im Zeitstrahl", async () => {
  const db = admin();
  const customerId = await kunde("Tischlerei Aigner GmbH");
  const vorher = (await aktivitaeten(customerId)).length;

  const { data: vorgang } = await db
    .from("vorgang")
    .select("id, phase")
    .eq("company_id", COMPANY_A)
    .eq("customer_id", customerId)
    .limit(1)
    .single();

  const ziel = vorgang!.phase === "montage" ? "beauftragt" : "montage";
  await db.from("vorgang").update({ phase: ziel }).eq("id", vorgang!.id);

  const nachher = await aktivitaeten(customerId);
  expect(nachher.length).toBe(vorher + 1);
  expect(nachher[0]!.kind).toBe("system");
  expect(String(nachher[0]!.body)).toContain(
    ziel === "montage" ? "Montage terminiert" : "Auftrag erteilt",
  );

  // Zurücksetzen; das erzeugt eine weitere Aktivität, das ist gewollt.
  await db
    .from("vorgang")
    .update({ phase: vorgang!.phase })
    .eq("id", vorgang!.id);
});

test("Der Kundenzeitstrahl zeigt die Aktivitäten im Backoffice", async ({
  page,
}) => {
  const customerId = await kunde("Familie Brandstätter");

  await login(page, DEMO.gf);

  /*
   * Der Kundenzeitstrahl steht am Vorgang, seit das CRM weg ist. Über
   * das Board mit Kundenfilter führt der Weg hinein — geprüft wird, dass
   * er dort ankommt und die Aktivitäten trägt.
   */
  await page.goto(`/vorgaenge?kunde=${customerId}`);
  await expect(page.getByText(/^Nur /).first()).toBeVisible({ timeout: 15_000 });

  const { data: vorgang } = await admin()
    .from("vorgang")
    .select("id")
    .eq("company_id", COMPANY_A)
    .eq("customer_id", customerId)
    .limit(1)
    .single();

  await page.goto(`/vorgaenge/${vorgang!.id}?tab=kunde`);
  await page.getByRole("button", { name: /^Historie/ }).click();

  const eintraege = await aktivitaeten(customerId);
  expect(eintraege.length).toBeGreaterThan(0);
  await expect(
    page.getByText(String(eintraege[0]!.body).slice(0, 40)).first(),
  ).toBeVisible({ timeout: 15_000 });
});

test("Die Serviceliste zeigt die Tickets", async ({ page }) => {
  await login(page, DEMO.gf);
  await page.goto("/service");

  await expect(page.getByText("S-2026-0031").first()).toBeVisible();
});

test("Aktivitäten bleiben im eigenen Mandanten", async () => {
  const db = admin();
  const eigen = await kunde("Familie Brandstätter");

  const { data: fremd } = await db
    .from("customer")
    .select("id")
    .eq("company_id", "22222222-2222-4222-8222-222222222222")
    .limit(1)
    .single();

  const { data: alle } = await db
    .from("contact_activity")
    .select("company_id, customer_id")
    .eq("customer_id", eigen);

  expect((alle ?? []).length).toBeGreaterThan(0);
  expect(
    (alle ?? []).every((a) => a.company_id === COMPANY_A),
  ).toBe(true);
  expect((alle ?? []).some((a) => a.customer_id === fremd!.id)).toBe(false);
});
