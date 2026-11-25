import { expect, test } from "@playwright/test";
import { grossesBild } from "./bilder";
import { admin, COMPANY_A, DEMO, login, portalToken } from "./helpers";

/*
 * Ein Foto in der Grösse eines Handyfotos kommt an.
 *
 * Gemeldet aus dem Onboarding: Der Kunde hat im Portal auf eine
 * Rückfrage mit einem Foto vom Zählerkasten geantwortet und statt einer
 * Bestätigung „Application error" gelesen.
 *
 * Die Ursache lag nicht im Portal. Eine Server Action nimmt ohne Angabe
 * höchstens 1 MB Rumpf; ein Handyfoto ist drei- bis fünfmal so gross.
 * Die Anfrage brach ab, bevor eigener Code sie sah — die Prüfung in
 * `pruefeDatei` lief nie, sie konnte nicht.
 *
 * Warum der bestehende Test das nicht fand: Er hängt ein 27 Byte grosses
 * JPEG an. Damit war die Strecke grün und die Grenze nie berührt. Dieser
 * Test arbeitet deshalb mit einem echten Bild über einem Megabyte, und
 * er prüft nicht die Dankesmeldung, sondern den Anhang in der Datenbank.
 *
 *   E2E_GF_MAIL=…  E2E_GF_PASSWORT=…  E2E_ZIELMANDANT=…  \
 *     npx playwright test e2e/anhang-groesse.spec.ts
 */

test.describe.configure({ mode: "serial" });

/** Das Bild einmal erzeugen — 1600×1200 ohne Kompression dauert kurz. */
const FOTO = grossesBild();

test("das Testbild ist wirklich grösser als die alte Grenze", () => {
  /*
   * Steht hier als erster Test, weil alles Weitere nichts beweist, wenn
   * das Bild zu klein ist. Ein Test, der aus Versehen am Fehler
   * vorbeiläuft, ist schlimmer als keiner.
   */
  expect(FOTO.byteLength).toBeGreaterThan(1024 * 1024);
});

test("der Kunde beantwortet eine Rückfrage mit einem Handyfoto", async ({
  page,
}) => {
  const db = admin();

  await login(page, DEMO.gf);

  /* Einen Vorgang des Demokunden nehmen und eine Rückfrage stellen. */
  const { data: vorgang } = await db
    .from("vorgang")
    .select("id, customer_id")
    .eq("company_id", COMPANY_A)
    .not("customer_id", "is", null)
    .limit(1)
    .single();

  expect(vorgang, "Kein Vorgang im Testmandanten").not.toBeNull();

  const titel = `E2E Zählerkasten ${Date.now()}`;
  const { data: anfrage, error: anfrageFehler } = await db
    .from("vorgang_anfrage")
    .insert({
      company_id: COMPANY_A,
      vorgang_id: vorgang!.id as string,
      titel,
      erklaerung: "Bitte senden Sie uns ein Foto.",
      foto_noetig: true,
      status: "offen",
    })
    .select("id")
    .single();

  /*
   * Fehler laut prüfen statt still weiterlaufen: Eine Einfügung mit
   * falschen Spalten gibt null zurück, und der Test wäre danach aus dem
   * falschen Grund grün.
   */
  expect(anfrageFehler, "Rückfrage liess sich nicht anlegen").toBeNull();

  const token = await portalToken(page, vorgang!.customer_id as string);

  try {
    await page.goto(`/portal/${token}/vorgang/${vorgang!.id as string}`);

    await page.getByLabel(/Foto \(nötig\)/).setInputFiles({
      name: "zaehlerkasten.png",
      mimeType: "image/png",
      buffer: FOTO,
    });

    /*
     * Auf die Verkleinerung warten: Sie läuft über Canvas und braucht
     * bei 1600×1200 einen Moment. Erst danach liegt die kleine Datei im
     * Feld — klickt der Test vorher, geht das Original raus.
     */
    await expect(page.getByText(/ausgewählt/)).toBeVisible({ timeout: 20_000 });

    await page.getByRole("button", { name: "Antwort senden" }).click();

    /*
     * Geprüft wird die Wirkung in der Datenbank, nicht eine Meldung: Mit
     * der Antwort fällt die Frage aus der Liste der offenen, das Formular
     * verschwindet und die Dankesmeldung mit ihm.
     */
    await expect
      .poll(
        async () => {
          const { data } = await db
            .from("vorgang_anhang")
            .select("id, groesse_bytes")
            .eq("anfrage_id", anfrage!.id as string);
          return data ?? [];
        },
        { timeout: 30_000 },
      )
      .toHaveLength(1);

    const { data: anhaenge } = await db
      .from("vorgang_anhang")
      .select("groesse_bytes, mime")
      .eq("anfrage_id", anfrage!.id as string);

    const anhang = anhaenge![0]!;

    /*
     * Der Kern: Das Bild ist angekommen, und es ist unterwegs kleiner
     * geworden. Käme es in Originalgrösse, wäre die Verkleinerung
     * ausgefallen und der Fehler nur noch durch die höhere Grenze
     * verdeckt — bis die Plattform bei viereinhalb Megabyte zuschlägt.
     */
    expect(Number(anhang.groesse_bytes)).toBeGreaterThan(0);
    expect(Number(anhang.groesse_bytes)).toBeLessThan(FOTO.byteLength);

    /* Und die Frage gilt als beantwortet. */
    const { data: stand } = await db
      .from("vorgang_anfrage")
      .select("status")
      .eq("id", anfrage!.id as string)
      .single();
    expect(stand!.status).toBe("beantwortet");
  } finally {
    await db
      .from("vorgang_anfrage")
      .delete()
      .eq("id", anfrage!.id as string);
  }
});

test("der Monteur hängt ein Handyfoto an einen Checklistenpunkt", async ({
  page,
}) => {
  /*
   * Dieselbe Grenze traf die Aufnahme auf der Baustelle. Der Weg dorthin
   * ist ein anderer — eigenes Formular, eigene Server Action —, deshalb
   * ein eigener Test. Ein Fix an der gemeldeten Stelle allein wäre ein
   * halber gewesen.
   */
  const db = admin();
  await login(page, DEMO.gf);

  const { data: vorgang } = await db
    .from("vorgang")
    .select("id")
    .eq("company_id", COMPANY_A)
    .limit(1)
    .single();

  await page.goto(`/vorgaenge/${vorgang!.id as string}?tab=aufnahme`);

  const feld = page.locator('input[type="file"][name="anhang"]').first();
  if ((await feld.count()) === 0) {
    test.skip(true, "Kein Foto-Punkt in der Checkliste dieses Vorgangs");
    return;
  }

  await feld.setInputFiles({
    name: "dach.png",
    mimeType: "image/png",
    buffer: FOTO,
  });
  await expect(page.getByText(/ausgewählt/).first()).toBeVisible({
    timeout: 20_000,
  });

  const vorher = (
    await db
      .from("vorgang_anhang")
      .select("id", { count: "exact", head: true })
      .eq("vorgang_id", vorgang!.id as string)
  ).count;

  await page.getByRole("button", { name: "Speichern" }).first().click();

  await expect
    .poll(
      async () => {
        const { count } = await db
          .from("vorgang_anhang")
          .select("id", { count: "exact", head: true })
          .eq("vorgang_id", vorgang!.id as string);
        return count ?? 0;
      },
      { timeout: 30_000 },
    )
    .toBe((vorher ?? 0) + 1);
});

test("eine zu grosse Datei wird gemeldet und nicht abgeschickt", async ({
  page,
}) => {
  /*
   * Was sich nicht verkleinern lässt — eine lange PDF —, muss eine
   * Meldung bekommen. Vorher lief so eine Datei in denselben
   * Fehlerbildschirm, und der Benutzer wusste nicht, warum.
   */
  await login(page, DEMO.gf);

  const { data: vorgang } = await admin()
    .from("vorgang")
    .select("id")
    .eq("company_id", COMPANY_A)
    .limit(1)
    .single();

  await page.goto(`/vorgaenge/${vorgang!.id as string}?tab=kunde`);

  const feld = page.locator("#chat-anhang");
  if ((await feld.count()) === 0) {
    test.skip(true, "Kein Chatfeld auf diesem Bildschirm");
    return;
  }

  /* Eine PDF von fünf Megabyte: gültiger Kopf, danach Füllung. */
  const pdf = Buffer.concat([
    Buffer.from("%PDF-1.4\n", "ascii"),
    Buffer.alloc(5 * 1024 * 1024, 0x20),
  ]);

  await feld.setInputFiles({
    name: "lieferantenrechnung.pdf",
    mimeType: "application/pdf",
    buffer: pdf,
  });

  await expect(page.getByRole("alert").filter({ hasText: /zu gross/ })).toBeVisible({
    timeout: 20_000,
  });

  /*
   * Und das Feld ist leer. Bliebe die Datei darin, nähme das Abschicken
   * sie trotzdem mit — dann wäre die Meldung Kosmetik.
   */
  const anzahl = await feld.evaluate(
    (e) => (e as HTMLInputElement).files?.length ?? -1,
  );
  expect(anzahl).toBe(0);
});

test.afterAll(async () => {
  /*
   * Die Testanhänge wieder weg, damit der Mandant sauber bleibt. Die
   * Namen enden auf .jpg, weil das Verkleinern jedes Bild als JPEG
   * zurückgibt — die Endung im Test sagt nichts über die Ablage.
   */
  await admin()
    .from("vorgang_anhang")
    .delete()
    .eq("company_id", COMPANY_A)
    .in("dateiname", [
      "zaehlerkasten.jpg",
      "zaehlerkasten.png",
      "dach.jpg",
      "dach.png",
    ]);
});
