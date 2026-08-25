import { expect, test } from "@playwright/test";
import { COMPANY_A, DEMO, admin, login } from "./helpers";

/*
 * Die Uhrzeit eines Einsatzes.
 *
 * Ein Einsatz von 11 bis 14 Uhr stand nach dem Speichern als 13 bis 16
 * Uhr in der Tafel: die Serveraktion las die eingetragene Wanduhrzeit in
 * der Zeitzone des Servers — auf Vercel UTC —, während der Browser sie
 * in Wiener Zeit meinte. Auf dem Entwicklungsrechner fiel das nie auf,
 * weil dort beide Zonen gleich sind.
 *
 * Der Test prüft deshalb nicht die Anzeige allein, sondern den
 * gespeicherten Zeitpunkt in UTC. Nur der zeigt den Fehler.
 */

test.describe.configure({ mode: "serial" });

const TITEL = "E2E-ZEIT-STOERUNG";
/* Ein Montag weit in der Zukunft — die Woche gehört sonst niemandem. */
const TAG = "2027-05-10";

async function aufraeumen(): Promise<void> {
  const db = admin();
  const { data } = await db.from("einsatz").select("id").like("titel", `${TITEL}%`);
  for (const e of data ?? []) {
    await db.from("einsatz_person").delete().eq("einsatz_id", e.id);
    await db.from("einsatz").delete().eq("id", e.id);
  }
}

const zustand: { name?: string } = {};

test.beforeAll(async () => {
  await aufraeumen();
  const db = admin();
  const { data } = await db
    .from("app_user")
    .select("name")
    .eq("company_id", COMPANY_A)
    .eq("role", "monteur")
    .eq("active", true)
    .order("name")
    .limit(1)
    .single();
  zustand.name = data!.name as string;
});
test.afterAll(aufraeumen);

test("Einsatz von 11 bis 14 Uhr wird als 11 bis 14 Uhr gespeichert", async ({
  page,
}) => {
  await login(page, DEMO.gf);
  await page.goto(`/planung?woche=${TAG}`);

  await page.getByRole("button", { name: "Einsatz anlegen" }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  await dialog.getByRole("radio", { name: "Service" }).check({ force: true });
  await dialog.getByLabel("Bezeichnung").fill(TITEL);
  await dialog.getByRole("checkbox", { name: zustand.name! }).check();
  await dialog.getByLabel("Tag", { exact: true }).fill(TAG);
  await dialog.getByLabel("Von", { exact: true }).fill("11:00");
  await dialog.getByLabel("Bis", { exact: true }).fill("14:00");

  // Der Klartext unter den Feldern sagt vorab, was gespeichert wird.
  await expect(dialog.getByText("11:00 bis 14:00 Uhr")).toBeVisible();

  await dialog.getByRole("button", { name: "Einsatz anlegen" }).click();
  await expect(dialog).toBeHidden();

  const db = admin();
  const { data: einsatz } = await db
    .from("einsatz")
    .select("von, bis")
    .eq("company_id", COMPANY_A)
    .eq("titel", TITEL)
    .single();

  /* Mai, also Sommerzeit: 11:00 Wien sind 09:00 UTC. */
  expect(new Date(einsatz!.von as string).toISOString()).toBe(
    "2027-05-10T09:00:00.000Z",
  );
  expect(new Date(einsatz!.bis as string).toISOString()).toBe(
    "2027-05-10T12:00:00.000Z",
  );

  // Und in der Tafel steht wieder dieselbe Uhrzeit.
  await expect(page.getByText("11:00–14:00").first()).toBeVisible();

  /*
   * Beim Öffnen zum Bearbeiten muss dieselbe Uhrzeit wieder in den
   * Feldern stehen. Sonst verschiebt sich der Einsatz bei jedem
   * Speichern ein Stück weiter.
   */
  await page.getByText(TITEL).first().click();
  const wieder = page.getByRole("dialog");
  await expect(wieder.getByLabel("Tag", { exact: true })).toHaveValue(TAG);
  await expect(wieder.getByLabel("Von", { exact: true })).toHaveValue("11:00");
  await expect(wieder.getByLabel("Bis", { exact: true })).toHaveValue("14:00");
});
