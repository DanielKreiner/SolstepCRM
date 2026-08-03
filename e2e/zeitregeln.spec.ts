import { expect, test } from "@playwright/test";
import { COMPANY_A, DEMO, admin, login, suchwahl } from "./helpers";

/*
 * Rundung und Pausenautomatik. Die Rechnung selbst ist in
 * lib/rules/zeitregeln.spec.ts geprüft — hier geht es darum, dass die
 * eingestellten Regeln beim Buchen tatsächlich greifen und im Saldo
 * ankommen.
 */

test.describe.configure({ mode: "serial" });

const TAG = "2027-04-12";
const NOTIZ = "E2E-ZEIT";

const zustand: { userId?: string; userName?: string; jobLabel?: string } = {};

/** Ausgangszustand: keine Rundung, Pause ab 6 h mit 30 Minuten. */
const STANDARD = {
  rundungMin: 0,
  pauseAbMin: 360,
  pauseAbzugMin: 30,
  abendAb: "18:00",
  nachtAb: "22:00",
  nachtBis: "06:00",
  zuschlagAbendPct: 25,
  zuschlagNachtPct: 50,
  zuschlagSamstagPct: 50,
  zuschlagSonntagPct: 100,
  zuschlagFeiertagPct: 100,
};

async function aufraeumen(): Promise<void> {
  const db = admin();
  await db.from("time_entry").delete().like("note", `${NOTIZ}%`);
  await db
    .from("company")
    .update({ time_settings: STANDARD })
    .eq("id", COMPANY_A);
}

test.beforeAll(async () => {
  await aufraeumen();
  const db = admin();

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

  const { data: vorgang } = await db
    .from("vorgang")
    .select("number")
    .eq("company_id", COMPANY_A)
    .order("number", { ascending: false })
    .limit(1)
    .single();
  zustand.jobLabel = vorgang!.number as string;
});

test.afterAll(aufraeumen);

async function buche(
  page: import("@playwright/test").Page,
  von: string,
  bis: string,
  notiz: string,
): Promise<void> {
  // Der Tag steckt in der Adresse, nicht im Formular — die Seite zeigt
  // immer genau einen Tag, und der Link darauf soll teilbar sein.
  await page.goto(`/zeiterfassung?tag=${TAG}`);
  await page.getByLabel("Person").selectOption(zustand.userId!);
  await page.getByLabel("Beginn").fill(von);
  await page.getByLabel("Ende").fill(bis);
  await suchwahl(page, "Vorgang", zustand.jobLabel!);
  await page.getByLabel("Notiz").fill(notiz);
  await page.getByRole("button", { name: "Buchung anlegen" }).click();
}

test("1 — Die Einstellungen sind erreichbar und speichern", async ({ page }) => {
  const db = admin();
  await login(page, DEMO.gf);
  await page.goto("/einstellungen?bereich=zeit");

  await expect(
    page.getByRole("heading", { name: "Erfassen und Runden" }),
  ).toBeVisible();

  await page.getByLabel("Rundung je Buchung").fill("15");
  await page.getByRole("button", { name: "Zeitregeln speichern" }).click();

  await expect(page.getByText(/auf 15 Minuten gerundet/)).toBeVisible({
    timeout: 20_000,
  });

  const { data } = await db
    .from("company")
    .select("time_settings")
    .eq("id", COMPANY_A)
    .single();
  expect((data!.time_settings as { rundungMin: number }).rundungMin).toBe(15);
});

test("2 — Die Rundung greift beim Buchen", async ({ page }) => {
  const db = admin();
  await login(page, DEMO.gf);

  // 07:00 bis 11:07 sind 247 Minuten — kaufmännisch auf 15er: 240.
  await buche(page, "07:00", "11:07", `${NOTIZ} gerundet`);

  await expect(page.getByText(/gerundet\./)).toBeVisible({ timeout: 20_000 });

  const { data } = await db
    .from("time_entry")
    .select("duration_min, auto_break_min, started_at")
    .eq("note", `${NOTIZ} gerundet`)
    .single();

  expect(data!.duration_min).toBe(240);
  // Der Beginn bleibt, wo er war — gerundet wird das Ende.
  expect(data!.started_at).toContain("05:00:00");
  // Unter sechs Stunden: kein Pausenabzug.
  expect(data!.auto_break_min).toBe(0);
});

test("3 — Ab sechs Stunden zieht die Pause automatisch ab", async ({ page }) => {
  const db = admin();
  await login(page, DEMO.gf);

  // 12:00 bis 20:00 sind 480 Minuten, glatt — nur der Pausenabzug greift.
  await buche(page, "12:00", "20:00", `${NOTIZ} lang`);

  await expect(page.getByText(/30 Minuten Pause abgezogen/)).toBeVisible({
    timeout: 20_000,
  });

  const { data } = await db
    .from("time_entry")
    .select("duration_min, auto_break_min")
    .eq("note", `${NOTIZ} lang`)
    .single();

  /*
   * Die erfasste Dauer bleibt unangetastet — der Eintrag zeigt, was
   * gestempelt wurde. Abgezogen wird im Saldo (CLAUDE.md 5.4: eine
   * Korrektur überschreibt nie).
   */
  expect(data!.duration_min).toBe(480);
  expect(data!.auto_break_min).toBe(30);
});

test("4 — Der Abzug kommt im Saldo an", async () => {
  const db = admin();

  const { data: saldo } = await db
    .from("v_time_balance")
    .select("actual_min")
    .eq("user_id", zustand.userId!)
    .single();

  const { data: eintraege } = await db
    .from("time_entry")
    .select("duration_min, auto_break_min, kind, status")
    .eq("user_id", zustand.userId!)
    .in("status", ["booked", "approved"]);

  const erwartet = (eintraege ?? [])
    .filter((e) => ["work", "travel", "training"].includes(e.kind as string))
    .reduce(
      (s, e) => s + Number(e.duration_min ?? 0) - Number(e.auto_break_min ?? 0),
      0,
    );

  expect(Number(saldo!.actual_min)).toBe(erwartet);
});

test("5 — Ohne Rundung bleibt die Minute stehen", async ({ page }) => {
  const db = admin();
  await db
    .from("company")
    .update({ time_settings: { ...STANDARD, rundungMin: 0 } })
    .eq("id", COMPANY_A);

  await login(page, DEMO.gf);
  await buche(page, "06:00", "06:07", `${NOTIZ} genau`);

  await expect(page.getByText(/Buchung gespeichert/)).toBeVisible({
    timeout: 20_000,
  });

  const { data } = await db
    .from("time_entry")
    .select("duration_min")
    .eq("note", `${NOTIZ} genau`)
    .single();

  expect(data!.duration_min).toBe(7);
});
