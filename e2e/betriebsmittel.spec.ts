import { expect, test } from "@playwright/test";
import { admin, COMPANY_A } from "./helpers";

/*
 * Fahrzeuge und Lagerorte.
 *
 * Gemeldet aus dem Betrieb: "man kann doch nichts ändern wie
 * firmenfahrzeuge, lagerorte etc." Stimmte — beide Tabellen wurden
 * überall gelesen und nirgends geschrieben. Ein übernommener Mandant
 * behielt damit auf Dauer "Bus 1", "Bus 2" und "Pritsche" aus dem
 * Demobestand.
 *
 * Der Punkt, auf den es ankommt und den dieser Test misst: Ein Fahrzeug
 * IST ein Lagerort. Entsteht der Lagerort nicht mit, taucht das
 * Fahrzeug zwar in der Beladeliste auf, nimmt aber kein Material an —
 * und das merkt man erst auf der Baustelle.
 *
 * Braucht einen eigenen Zugang, damit er auch gegen einen Mandanten
 * ohne Demokonten laufen kann:
 *
 *   E2E_GF_MAIL=…  E2E_GF_PASSWORT=…  E2E_ZIELMANDANT=…  \
 *     npx playwright test e2e/betriebsmittel.spec.ts
 */

const MAIL = process.env.E2E_GF_MAIL;
const PASSWORT = process.env.E2E_GF_PASSWORT;
const KENNUNG = `E2E Bus ${Date.now()}`;

test.describe.configure({ mode: "serial" });
test.skip(!MAIL || !PASSWORT, "E2E_GF_MAIL und E2E_GF_PASSWORT nicht gesetzt");

test.afterAll(async () => {
  const db = admin();
  const { data } = await db
    .from("fahrzeug")
    .select("id")
    .eq("company_id", COMPANY_A)
    .like("name", "E2E Bus%");
  for (const f of data ?? []) {
    await db.from("lagerort").delete().eq("fahrzeug_id", f.id as string);
    await db.from("fahrzeug").delete().eq("id", f.id as string);
  }
});

async function anmelden(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("E-Mail").fill(MAIL!);
  await page.getByLabel("Passwort").fill(PASSWORT!);
  await page.getByRole("button", { name: "Anmelden" }).click();
  await page.waitForURL(/\/cockpit/, { timeout: 20_000 });
}

test("Ein neues Fahrzeug bekommt seinen Lagerort automatisch", async ({ page }) => {
  await anmelden(page);
  await page.goto("/einstellungen?bereich=betriebsmittel");

  const neu = page.locator("form").filter({ hasText: "Fahrzeug hinzufügen" });
  await neu.getByLabel("Bezeichnung").fill(KENNUNG);
  await neu.getByLabel("Kennzeichen").fill("NK-999ZZ");
  await neu.getByRole("button", { name: "Fahrzeug anlegen" }).click();

  await expect(page.getByText(`${KENNUNG} angelegt`)).toBeVisible({
    timeout: 15_000,
  });

  const { data: fahrzeug } = await admin()
    .from("fahrzeug")
    .select("id, kennzeichen, aktiv")
    .eq("company_id", COMPANY_A)
    .eq("name", KENNUNG)
    .single();

  expect(fahrzeug, "Fahrzeug fehlt in der Datenbank").not.toBeNull();
  expect(fahrzeug!.kennzeichen).toBe("NK-999ZZ");

  const { data: ort } = await admin()
    .from("lagerort")
    .select("name, art, aktiv")
    .eq("fahrzeug_id", fahrzeug!.id as string)
    .single();

  expect(ort, "Zum Fahrzeug fehlt der Lagerort").not.toBeNull();
  expect(ort!.art).toBe("fahrzeug");
  expect(ort!.name).toBe(KENNUNG);
});

test("Umbenennen zieht den Lagerort mit, Stilllegen auch", async ({ page }) => {
  await anmelden(page);
  await page.goto("/einstellungen?bereich=betriebsmittel");

  const { data: fahrzeug } = await admin()
    .from("fahrzeug")
    .select("id")
    .eq("company_id", COMPANY_A)
    .eq("name", KENNUNG)
    .single();

  const block = page.getByTestId(`fahrzeug-${fahrzeug!.id as string}`);
  await block.getByLabel("Bezeichnung").fill(`${KENNUNG} neu`);
  await block.getByLabel("Im Einsatz").selectOption("nein");
  await block.getByRole("button", { name: "Speichern" }).click();

  await expect(page.getByText("Fahrzeug stillgelegt")).toBeVisible({
    timeout: 15_000,
  });

  /*
   * Gegen die Datenbank geprüft, und zwar BEIDE Zeilen. Zwei
   * auseinanderlaufende Namen für dasselbe Fahrzeug sind im Lager die
   * sichere Fehlbuchung: Der Monteur sucht "Sprinter gross", die
   * Beladeliste nennt es noch "Bus 2".
   */
  await expect
    .poll(async () => {
      const { data } = await admin()
        .from("lagerort")
        .select("name, aktiv")
        .eq("fahrzeug_id", fahrzeug!.id as string)
        .single();
      return `${data?.name}|${data?.aktiv}`;
    }, { timeout: 10_000 })
    .toBe(`${KENNUNG} neu|false`);
});

test("Ein Fahrzeug mit gebuchtem Material wird nicht entfernt", async ({
  page,
}) => {
  const db = admin();

  const { data: fahrzeug } = await db
    .from("fahrzeug")
    .select("id")
    .eq("company_id", COMPANY_A)
    .eq("name", `${KENNUNG} neu`)
    .single();

  const { data: ort } = await db
    .from("lagerort")
    .select("id")
    .eq("fahrzeug_id", fahrzeug!.id as string)
    .single();

  const { data: artikel } = await db
    .from("article")
    .select("id")
    .eq("company_id", COMPANY_A)
    .limit(1)
    .single();

  const { data: bewegung, error: buchungsFehler } = await db
    .from("lagerbewegung")
    .insert({
      company_id: COMPANY_A,
      artikel_id: artikel!.id,
      nach_lagerort_id: ort!.id,
      menge: 1,
      typ: "wareneingang",
    })
    .select("id")
    .single();

  /*
   * Ohne diese Zeile prüft der Test nichts: Scheitert die Buchung still,
   * gibt es keine Bewegung, das Fahrzeug wird anstandslos entfernt, und
   * der Test wäre grün, ohne die Sperre je berührt zu haben.
   */
  expect(buchungsFehler, "Testbuchung fehlgeschlagen").toBeNull();

  try {
    await anmelden(page);
    await page.goto("/einstellungen?bereich=betriebsmittel");

    await page.getByTestId(`fahrzeug-entfernen-${fahrzeug!.id as string}`).click();

    await expect(
      page.getByText(/schon Material gebucht/),
    ).toBeVisible({ timeout: 15_000 });

    const { count } = await db
      .from("fahrzeug")
      .select("id", { count: "exact", head: true })
      .eq("id", fahrzeug!.id as string);
    expect(count).toBe(1);
  } finally {
    if (bewegung) await db.from("lagerbewegung").delete().eq("id", bewegung.id);
  }
});
