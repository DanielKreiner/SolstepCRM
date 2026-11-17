import { expect, test } from "@playwright/test";
import { admin, COMPANY_A } from "./helpers";

/*
 * Nummernkreise.
 *
 * Gemeldet aus dem Betrieb: "Nummernkreise kann man auch nicht anlegen."
 * Stimmte — der Bildschirm zeigte Zählerstände an und schrieb dazu,
 * das sei bewusst nicht editierbar. Für das SENKEN stimmt das, für das
 * ANHEBEN nicht, und genau das braucht jeder Betrieb, der aus einer
 * anderen Software kommt: Steht die Buchhaltung bei RE-2026-0312, darf
 * die erste Rechnung hier nicht RE-2026-0001 heissen.
 *
 * Braucht einen eigenen Zugang:
 *   E2E_GF_MAIL=…  E2E_GF_PASSWORT=…  E2E_ZIELMANDANT=…  \
 *     npx playwright test e2e/nummernkreise.spec.ts
 */

const MAIL = process.env.E2E_GF_MAIL;
const PASSWORT = process.env.E2E_GF_PASSWORT;
const JAHR = Number(
  new Intl.DateTimeFormat("de-AT", { timeZone: "Europe/Vienna", year: "numeric" })
    .format(new Date()),
);

test.describe.configure({ mode: "serial" });
test.skip(!MAIL || !PASSWORT, "E2E_GF_MAIL und E2E_GF_PASSWORT nicht gesetzt");

test.afterAll(async () => {
  const db = admin();
  await db
    .from("bestellung")
    .delete()
    .eq("company_id", COMPANY_A)
    .like("nummer", "B-%-0150");
  for (const kind of ["invoice", "purchase_order"]) {
    await db
      .from("doc_counter")
      .delete()
      .eq("company_id", COMPANY_A)
      .eq("kind", kind)
      .eq("year", JAHR);
  }
});

async function anmelden(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("E-Mail").fill(MAIL!);
  await page.getByLabel("Passwort").fill(PASSWORT!);
  await page.getByRole("button", { name: "Anmelden" }).click();
  await page.waitForURL(/\/cockpit/, { timeout: 20_000 });
}

/** Ein Formularblock, erkannt an seiner Überschrift. */
function block(page: import("@playwright/test").Page, label: string) {
  return page.locator("li").filter({ hasText: label }).first();
}

test("Die Rechnungsnummer lässt sich an die bisherige Buchhaltung anschliessen", async ({
  page,
}) => {
  await anmelden(page);
  await page.goto("/einstellungen?bereich=nummernkreise");

  const rechnungen = block(page, "Rechnungen");
  await expect(rechnungen).toContainText("noch keine vergeben");

  await rechnungen.getByLabel("Nächste Nummer").fill("313");
  await rechnungen.getByRole("button", { name: "Übernehmen" }).click();

  await expect(page.getByText(/bekommt die Nummer RE-\d{4}-0313/)).toBeVisible({
    timeout: 15_000,
  });

  /*
   * Gegen die Datenbank geprüft, und zwar auf 312: `next_number` zählt
   * vor der Ausgabe hoch, der Zähler steht also immer eins unter der
   * Nummer, die als Nächstes herauskommt. Genau hier vertut man sich.
   */
  const { data } = await admin()
    .from("doc_counter")
    .select("value")
    .eq("company_id", COMPANY_A)
    .eq("kind", "invoice")
    .eq("year", JAHR)
    .single();

  expect(Number(data?.value)).toBe(312);
});

test("Eine kleinere Nummer wird abgewiesen und die nächste freie genannt", async ({
  page,
}) => {
  await anmelden(page);
  await page.goto("/einstellungen?bereich=nummernkreise");

  const rechnungen = block(page, "Rechnungen");
  await rechnungen.getByLabel("Nächste Nummer").fill("100");
  await rechnungen.getByRole("button", { name: "Übernehmen" }).click();

  await expect(
    page.getByText(/bereits vergeben oder überholt.*nächste freie Nummer ist 313/s),
  ).toBeVisible({ timeout: 15_000 });

  /* Und der Zähler steht unverändert. */
  const { data } = await admin()
    .from("doc_counter")
    .select("value")
    .eq("company_id", COMPANY_A)
    .eq("kind", "invoice")
    .eq("year", JAHR)
    .single();
  expect(Number(data?.value)).toBe(312);
});

test("Auch ohne Zählerzeile zählen die Belege, die schon da sind", async ({
  page,
}) => {
  /*
   * Der gefährlichste Fall, und der Grund, warum die Prüfung nicht nur
   * den Zähler ansieht: Nach einer Übernahme kann die Zählerzeile
   * fehlen, während die Belege längst da sind. Wer sich dann allein auf
   * den Zähler verlässt, sieht eine Null und vergibt Nummern ein
   * zweites Mal.
   */
  const db = admin();
  await db
    .from("bestellung")
    .insert({ company_id: COMPANY_A, nummer: `B-${JAHR}-0150` });
  await db
    .from("doc_counter")
    .delete()
    .eq("company_id", COMPANY_A)
    .eq("kind", "purchase_order")
    .eq("year", JAHR);

  await anmelden(page);
  await page.goto("/einstellungen?bereich=nummernkreise");

  const bestellungen = block(page, "Bestellungen");
  await bestellungen.getByLabel("Nächste Nummer").fill("20");
  await bestellungen.getByRole("button", { name: "Übernehmen" }).click();

  await expect(
    page.getByText(/nächste freie Nummer ist 151/),
  ).toBeVisible({ timeout: 15_000 });

  /* 151 geht durch. */
  await bestellungen.getByLabel("Nächste Nummer").fill("151");
  await bestellungen.getByRole("button", { name: "Übernehmen" }).click();
  await expect(page.getByText(/bekommt die Nummer B-\d{4}-0151/)).toBeVisible({
    timeout: 15_000,
  });
});
