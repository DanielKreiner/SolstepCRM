import { expect, test } from "@playwright/test";
import { admin, COMPANY_A, DEMO, login } from "./helpers";

/*
 * Die offenen Punkte beim Start (0078).
 *
 * Geprüft wird die Wirkung in der Datenbank und nicht eine Meldung auf
 * dem Bildschirm: Meldungen verschwinden, sobald die Oberfläche umbaut,
 * und der Punkt an dieser Funktion ist, dass die Antwort beim Mandanten
 * liegt und nicht in einem Mailpostfach.
 *
 *   E2E_GF_MAIL=…  E2E_GF_PASSWORT=…  \
 *     npx playwright test e2e/einrichtung-unterlagen.spec.ts
 */

test.describe.configure({ mode: "serial" });

const SEITE = "/einstellungen?bereich=einrichtung";

test.beforeAll(async () => {
  /*
   * Der Katalog muss da sein, sonst prüft der Test nichts. Die Migration
   * legt ihn für jeden bestehenden Mandanten an; ein neuer Testmandant
   * bekommt ihn über die Funktion.
   */
  const db = admin();
  const { count } = await db
    .from("einrichtung_punkt")
    .select("id", { count: "exact", head: true })
    .eq("company_id", COMPANY_A);

  if ((count ?? 0) === 0) {
    await db.rpc("seed_einrichtung_punkte", { p_company: COMPANY_A });
  }
});

test("eine Angabe wird gespeichert und als erledigt gezählt", async ({ page }) => {
  const db = admin();
  await login(page, DEMO.gf);

  /* Vorher zurücksetzen, damit der Test wiederholbar ist. */
  await db
    .from("einrichtung_punkt")
    .update({ wert: null, status: "offen", beantwortet_am: null, beantwortet_von: null })
    .eq("company_id", COMPANY_A)
    .eq("schluessel", "steuerberater-postfach");

  await page.goto(SEITE);

  const zeile = page.getByTestId("punkt-steuerberater-postfach");
  await expect(zeile).toBeVisible();
  /* Vor der Antwort steht der Punkt als zum Start nötig da. */
  await expect(zeile.getByText("zum Start nötig")).toBeVisible();

  const adresse = `belege+e2e${Date.now()}@kanzlei.example.com`;
  await zeile.locator('input[name="wert"]').fill(adresse);
  await zeile.getByRole("button", { name: "Speichern" }).click();

  await expect
    .poll(
      async () => {
        const { data } = await db
          .from("einrichtung_punkt")
          .select("wert, status, beantwortet_am, beantwortet_von")
          .eq("company_id", COMPANY_A)
          .eq("schluessel", "steuerberater-postfach")
          .single();
        return data;
      },
      { timeout: 15_000 },
    )
    .toMatchObject({ wert: adresse, status: "beantwortet" });

  /* Wer geantwortet hat, steht dabei — sonst fragt beim nächsten Mal
     wieder jemand im Büro herum. */
  const { data } = await db
    .from("einrichtung_punkt")
    .select("beantwortet_am, beantwortet_von")
    .eq("company_id", COMPANY_A)
    .eq("schluessel", "steuerberater-postfach")
    .single();
  expect(data!.beantwortet_am).not.toBeNull();
  expect(data!.beantwortet_von).not.toBeNull();

  await expect(zeile.getByText("erledigt")).toBeVisible();
});

test("eine Mehrfachauswahl kommt vollständig an", async ({ page }) => {
  /*
   * Mehrere Felder gleichen Namens — getAll() auf der Serverseite. Ein
   * Test dafür, weil ein einzelnes get() hier genau eine Rechnungsart
   * speichern würde und die anderen still verlieren.
   */
  const db = admin();
  await login(page, DEMO.gf);

  await db
    .from("einrichtung_punkt")
    .update({ wert: null, status: "offen" })
    .eq("company_id", COMPANY_A)
    .eq("schluessel", "rechnungsarten");

  await page.goto(SEITE);

  const zeile = page.getByTestId("punkt-rechnungsarten");
  await zeile.getByText("20 % Umsatzsteuer").click();
  await zeile.getByText("Bauleistung § 19").click();
  await zeile.getByRole("button", { name: "Speichern" }).click();

  await expect
    .poll(
      async () => {
        const { data } = await db
          .from("einrichtung_punkt")
          .select("wert")
          .eq("company_id", COMPANY_A)
          .eq("schluessel", "rechnungsarten")
          .single();
        return data?.wert ?? "";
      },
      { timeout: 15_000 },
    )
    .toContain("Bauleistung § 19");

  const { data } = await db
    .from("einrichtung_punkt")
    .select("wert")
    .eq("company_id", COMPANY_A)
    .eq("schluessel", "rechnungsarten")
    .single();
  expect(data!.wert).toContain("20 % Umsatzsteuer");
});

test("ein Punkt lässt sich als nicht nötig vermerken und wieder öffnen", async ({
  page,
}) => {
  /*
   * Ohne diesen Weg bleibt die Liste für immer unvollständig, weil ein
   * Betrieb eben keine Ausfuhrrechnungen schreibt — und dann schaut
   * niemand mehr hin.
   */
  const db = admin();
  await login(page, DEMO.gf);
  await page.goto(SEITE);

  const zeile = page.getByTestId("punkt-artikelgruppen");
  await zeile.getByRole("button", { name: "betrifft uns nicht" }).click();

  await expect
    .poll(
      async () => {
        const { data } = await db
          .from("einrichtung_punkt")
          .select("status")
          .eq("company_id", COMPANY_A)
          .eq("schluessel", "artikelgruppen")
          .single();
        return data?.status;
      },
      { timeout: 15_000 },
    )
    .toBe("entfaellt");

  await page.reload();
  await page
    .getByTestId("punkt-artikelgruppen")
    .getByRole("button", { name: "doch wieder offen" })
    .click();

  await expect
    .poll(
      async () => {
        const { data } = await db
          .from("einrichtung_punkt")
          .select("status")
          .eq("company_id", COMPANY_A)
          .eq("schluessel", "artikelgruppen")
          .single();
        return data?.status;
      },
      { timeout: 15_000 },
    )
    .toBe("offen");
});

test("eine Datei über vier Megabyte kommt an", async ({ page }) => {
  /*
   * Die Grösse ist der Punkt. Eine Server Action nimmt rund vier
   * Megabyte; ein gescannter Kundenstamm oder eine Lieferantenrechnung
   * hat mehr, und die Anfrage bricht ab, bevor eigener Code sie sieht.
   * Deshalb geht dieser Upload direkt in den Speicher — und deshalb
   * arbeitet der Test mit einer Datei, die über der alten Grenze liegt.
   */
  const db = admin();
  await login(page, DEMO.gf);

  const { data: punkt } = await db
    .from("einrichtung_punkt")
    .select("id")
    .eq("company_id", COMPANY_A)
    .eq("schluessel", "kundenstamm")
    .single();

  await page.goto(SEITE);

  const zeile = page.getByTestId("punkt-kundenstamm");

  /* Ein CSV mit fünf Megabyte, Inhalt egal — gezählt wird die Grösse. */
  const zeilen = ["nummer;name;ort"];
  while (zeilen.join("\n").length < 5 * 1024 * 1024) {
    zeilen.push(`2${zeilen.length};Beispiel GmbH ${zeilen.length};Aspang Markt`);
  }
  const inhalt = Buffer.from(zeilen.join("\n"), "utf8");
  expect(inhalt.byteLength).toBeGreaterThan(4 * 1024 * 1024);

  const name = `e2e-kundenstamm-${Date.now()}.csv`;
  await zeile.locator('input[type="file"]').setInputFiles({
    name,
    mimeType: "text/csv",
    buffer: inhalt,
  });

  await expect
    .poll(
      async () => {
        const { data } = await db
          .from("einrichtung_datei")
          .select("dateiname, groesse_bytes, storage_path")
          .eq("punkt_id", punkt!.id as string)
          .eq("dateiname", name);
        return data ?? [];
      },
      { timeout: 60_000 },
    )
    .toHaveLength(1);

  const { data: dateien } = await db
    .from("einrichtung_datei")
    .select("id, groesse_bytes, storage_path")
    .eq("punkt_id", punkt!.id as string)
    .eq("dateiname", name);

  const datei = dateien![0]!;
  /* Vollständig angekommen, nicht abgeschnitten. */
  expect(Number(datei.groesse_bytes)).toBe(inhalt.byteLength);
  /* Und im eigenen Mandantenordner, nach dem Pfadschema aus CLAUDE.md 4.4. */
  expect(datei.storage_path as string).toMatch(
    new RegExp(`^${COMPANY_A}/einrichtung/${punkt!.id as string}/`),
  );

  /* Mit der ersten Datei gilt der Punkt als erledigt. */
  const { data: stand } = await db
    .from("einrichtung_punkt")
    .select("status")
    .eq("id", punkt!.id as string)
    .single();
  expect(stand!.status).toBe("beantwortet");

  /* Aufräumen: Zeile und Datei. */
  await db.storage.from("documents").remove([datei.storage_path as string]);
  await db.from("einrichtung_datei").delete().eq("id", datei.id as string);
  await db
    .from("einrichtung_punkt")
    .update({ status: "offen", beantwortet_am: null, beantwortet_von: null })
    .eq("id", punkt!.id as string);
});

test("ein Monteur kann die Liste lesen, aber nicht beantworten", async ({ page }) => {
  /*
   * Die Rechteprüfung sitzt in der Policy, nicht in der Oberfläche
   * (CLAUDE.md 11). Der Bildschirm zeigt hier nur, dass er sich daran
   * hält — ein Formular, das speichern will und es nicht darf, ist
   * schlimmer als keines.
   */
  await login(page, DEMO.monteur);
  const antwort = await page.goto(SEITE);

  /*
   * Je nach Rollenmatrix endet der Weg schon vor der Seite. Beides ist
   * richtig, nur beantworten darf er nicht.
   */
  if (antwort && antwort.status() >= 400) return;
  if (!page.url().includes("/einstellungen")) return;

  await expect(page.getByRole("button", { name: "Speichern" })).toHaveCount(0);
});
