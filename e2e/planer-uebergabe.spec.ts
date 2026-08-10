import { expect, type Page, test } from "@playwright/test";
import { admin, COMPANY_A, DEMO, login } from "./helpers";

/*
 * Planer — Übergabe als Vorgang (Briefing 8.2).
 *
 * Hier verlässt die Planung den Planer: es entsteht ein Vorgang mit
 * Kunde, Adresse, Anlagengrösse und einer Bedarfsliste. Die geht in den
 * Einkauf, und was dort steht, bestellt jemand — deshalb prüft dieser
 * Test nicht nur, dass etwas passiert, sondern WAS in der Datenbank
 * landet.
 */

const LINZ = { lat: 48.30604, lon: 14.28583 };

/** Aufräumen: Vorgänge und Kunden dieses Laufs verschwinden wieder. */
async function aufraeumen() {
  const db = admin();
  const { data: vorgaenge } = await db
    .from("vorgang")
    .select("id")
    .eq("company_id", COMPANY_A)
    .like("adresse", "Übergabeweg%");
  for (const v of vorgaenge ?? []) {
    await db.from("vorgang_bedarf").delete().eq("vorgang_id", v.id);
    await db.from("vorgang").delete().eq("id", v.id);
  }
  await db.from("customer").delete().eq("company_id", COMPANY_A).like("name", "Prüfkunde%");
  for (const t of ["planer_speicher", "planer_wechselrichter", "planer_modul"]) {
    await db.from(t).delete().eq("company_id", COMPANY_A).like("hersteller", "Übergabetest%");
  }
}

test.beforeEach(aufraeumen);
test.afterAll(aufraeumen);

/** Geräte anlegen, eines MIT und eines OHNE Artikelreferenz. */
async function geraeteAnlegen() {
  const db = admin();
  const { data: artikel } = await db
    .from("article")
    .select("id")
    .eq("company_id", COMPANY_A)
    .limit(1)
    .single();

  const { data: modul } = await db
    .from("planer_modul")
    .insert({
      company_id: COMPANY_A,
      hersteller: "Übergabetest",
      bezeichnung: "Modul 440",
      wp: 440,
      uoc: 39.4,
      umpp: 33.1,
      isc: 13.9,
      impp: 13.1,
      tk_uoc: -0.0025,
      breite: 1.134,
      hoehe: 1.762,
      artikel_id: artikel!.id,
    })
    .select("id")
    .single();

  const { data: wr } = await db
    .from("planer_wechselrichter")
    .insert({
      company_id: COMPANY_A,
      hersteller: "Übergabetest",
      bezeichnung: "WR 10",
      max_dc: 1000,
      ac_nenn: 10,
      hybrid: false,
      mppt: [{ uMin: 200, uMax: 800, iMax: 26, maxStrings: 2 }],
      // Bewusst ohne Artikelreferenz — daraus muss eine Freitextposition
      // mit Hinweis werden.
      artikel_id: null,
    })
    .select("id")
    .single();

  return { modulId: modul!.id as string, wrId: wr!.id as string, artikelId: artikel!.id as string };
}

async function projektMitTechnik(page: Page, name: string, wrId: string, modulId: string) {
  await page.goto("/planer/neu");
  await page.route("**/api/planer/adresse**", (r) =>
    r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ treffer: [{ name: `${name}, 4020 Linz`, ...LINZ }] }),
    }),
  );
  await page.getByLabel("Adresse suchen").fill(name);
  await page.getByRole("button", { name: new RegExp(name) }).click();
  await page.getByRole("button", { name: "Projekt anlegen" }).click();
  await page.waitForURL(/\/planer\/[0-9a-f-]{36}$/);
  const projektId = page.url().split("/").pop()!;

  await page.getByRole("button", { name: "Näher heran" }).click();
  await page.getByRole("button", { name: "Näher heran" }).click();
  await page.getByRole("button", { name: /Standardform setzen/ }).click();
  await page.getByLabel("Länge (m)").fill("12");
  await page.getByLabel("Tiefe (m)").fill("8");
  await page.getByRole("button", { name: "In die Bildmitte setzen" }).click();
  await page.getByRole("button", { name: /^Fläche 1/ }).click();
  await page.getByRole("button", { name: "Fläche automatisch belegen" }).click();
  await expect(page.getByRole("button", { name: /^Feld 1/ })).toBeVisible();

  await page.getByRole("button", { name: /^3 Technik/ }).click();
  await page.getByLabel("Modul", { exact: true }).selectOption(modulId);
  await page.getByLabel("Wechselrichter", { exact: true }).selectOption(wrId);

  return projektId;
}

test.describe("Planer — Übergabe als Vorgang", () => {
  test("legt Vorgang, Kunde und Bedarfsliste an", async ({ page }) => {
    const { wrId, modulId, artikelId } = await geraeteAnlegen();
    await login(page, DEMO.gf);
    const projektId = await projektMitTechnik(page, "Übergabeweg 1", wrId, modulId);

    await page.getByRole("button", { name: /^5 Übergabe/ }).click();
    await page.getByRole("button", { name: "Als Vorgang übernehmen" }).click();

    // Der Dialog zeigt erst, was entstehen würde.
    await expect(page.getByRole("heading", { name: "Als Vorgang übernehmen" })).toBeVisible();
    await expect(page.getByText(/Modul 440/)).toBeVisible();
    await expect(page.getByText(/Übergabetest WR 10/)).toBeVisible();
    // Der Wechselrichter hat keine Artikelreferenz — das muss dranstehen.
    await expect(page.getByText("Artikel zuordnen")).toBeVisible();

    await page.getByLabel("Kunde").fill("Prüfkunde Neu");
    await page.getByRole("button", { name: "Vorgang anlegen" }).click();
    // Auf den Link zum neuen Vorgang warten, nicht auf ein Wort: „wird
    // neu angelegt" steht schon als Hinweis unter dem Kundenfeld.
    await expect(page.getByRole("link", { name: "Vorgang öffnen" })).toBeVisible({
      timeout: 20_000,
    });

    /*
     * Und jetzt nachsehen, was wirklich in der Datenbank steht. Eine
     * Erfolgsmeldung allein sagt nichts — die Bedarfsliste geht in den
     * Einkauf.
     */
    const db = admin();
    const { data: projekt } = await db
      .from("planer_projekt")
      .select("status, vorgang_id")
      .eq("id", projektId)
      .single();
    expect(projekt!.status).toBe("uebergeben");
    expect(projekt!.vorgang_id).toBeTruthy();

    const { data: vorgang } = await db
      .from("vorgang")
      .select("number, phase, kwp, adresse, customer_id")
      .eq("id", projekt!.vorgang_id!)
      .single();
    expect(vorgang!.phase).toBe("anfrage");
    expect(Number(vorgang!.kwp)).toBeGreaterThan(0);
    expect(vorgang!.adresse).toContain("Übergabeweg 1");

    const { data: kunde } = await db
      .from("customer")
      .select("name")
      .eq("id", vorgang!.customer_id)
      .single();
    expect(kunde!.name).toBe("Prüfkunde Neu");

    const { data: bedarf } = await db
      .from("vorgang_bedarf")
      .select("bezeichnung, menge, artikel_id, herkunft, notiz")
      .eq("vorgang_id", projekt!.vorgang_id!);

    expect(bedarf!.length).toBeGreaterThanOrEqual(2);
    const modulPos = bedarf!.find((b) => b.bezeichnung.includes("440"))!;
    expect(modulPos.artikel_id).toBe(artikelId);
    expect(Number(modulPos.menge)).toBeGreaterThan(0);
    expect(modulPos.herkunft).toBe("planer");

    const wrPos = bedarf!.find((b) => b.bezeichnung.includes("WR 10"))!;
    // Ohne Artikelreferenz: Freitext plus Hinweis, kein geratener Artikel.
    expect(wrPos.artikel_id).toBeNull();
    expect(wrPos.notiz).toContain("Artikel zuordnen");

    /*
     * Der Verweis läuft in beide Richtungen: aus dem Vorgang muss die
     * Planung erreichbar sein, ohne sie in der Projektliste zu suchen.
     */
    await page.goto(`/vorgaenge/${projekt!.vorgang_id}`);
    const zurueck = page.getByRole("link", { name: "Planung öffnen" });
    await expect(zurueck).toBeVisible();
    await zurueck.click();
    await page.waitForURL(`**/planer/${projektId}`);
  });

  test("erneute Übergabe gleicht ab, statt zu überschreiben", async ({ page }) => {
    const { wrId, modulId } = await geraeteAnlegen();
    await login(page, DEMO.gf);
    const projektId = await projektMitTechnik(page, "Übergabeweg 2", wrId, modulId);

    await page.getByRole("button", { name: /^5 Übergabe/ }).click();
    await page.getByRole("button", { name: "Als Vorgang übernehmen" }).click();
    await page.getByLabel("Kunde").fill("Prüfkunde Zwei");
    await page.getByRole("button", { name: "Vorgang anlegen" }).click();
    await expect(page.getByRole("link", { name: "Vorgang öffnen" })).toBeVisible({
      timeout: 20_000,
    });

    const db = admin();
    const { data: projekt } = await db
      .from("planer_projekt")
      .select("vorgang_id")
      .eq("id", projektId)
      .single();
    const vorgangId = projekt!.vorgang_id as string;

    /*
     * Im Material wird eine Position von Hand ergänzt und eine
     * umbenannt. Beides muss die zweite Übergabe unangetastet lassen —
     * die Bedarfsliste gehört dem Betrieb.
     */
    await db.from("vorgang_bedarf").insert({
      company_id: COMPANY_A,
      vorgang_id: vorgangId,
      bezeichnung: "Gerüst 3 Tage",
      menge: 1,
      einheit: "Pau",
      herkunft: "manuell",
    });
    const { data: modulPos } = await db
      .from("vorgang_bedarf")
      .select("id")
      .eq("vorgang_id", vorgangId)
      .like("bezeichnung", "%440%")
      .single();
    await db
      .from("vorgang_bedarf")
      .update({ bezeichnung: "Modul 440 (Charge Mai)" })
      .eq("id", modulPos!.id);

    /*
     * Die Menge im Material verstellen — als hätte sich die Planung
     * geändert. Das ist präziser als eine neue Belegung: es prüft genau
     * den Abgleich, ohne von der Zahl der Module abzuhängen, die je
     * nach Kartenausschnitt aufs Dach passen.
     */
    await db.from("vorgang_bedarf").update({ menge: 4 }).eq("id", modulPos!.id);

    await page.reload();
    await page.getByRole("button", { name: /^5 Übergabe/ }).click();
    await page.getByRole("button", { name: "Als Vorgang übernehmen" }).click();

    /*
     * Der Dialog muss den bestehenden Vorgang erkennen und abgleichen.
     * Die umbenannte Position darf NICHT als „neu" auftauchen — sonst
     * stünde das Modul zweimal in der Bestellung.
     */
    await expect(page.getByRole("heading", { name: /^Abgleich mit/ })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText("Menge geändert")).toBeVisible();
    await expect(page.getByText("Gerüst 3 Tage")).toHaveCount(0);

    await page.getByRole("button", { name: /Änderung.* übernehmen/ }).click();
    await expect(page.getByText(/Bedarfsliste aktualisiert/)).toBeVisible({ timeout: 20_000 });

    const { data: nachher } = await db
      .from("vorgang_bedarf")
      .select("bezeichnung, menge, herkunft")
      .eq("vorgang_id", vorgangId);

    // Die Handposition ist noch da und der Name blieb, wie er war.
    expect(nachher!.some((b) => b.bezeichnung === "Gerüst 3 Tage")).toBe(true);
    expect(nachher!.some((b) => b.bezeichnung.includes("Charge Mai"))).toBe(true);
    // Das Modul steht genau einmal drin — nicht zweimal, weil es
    // umbenannt wurde.
    const modulZeilen = nachher!.filter((b) => b.bezeichnung.includes("440"));
    expect(modulZeilen).toHaveLength(1);
    // Und die Menge wurde auf den Planungsstand zurückgezogen.
    expect(Number(modulZeilen[0]!.menge)).toBeGreaterThan(4);
  });

  test("Mit Leserecht gibt es den Knopf nicht", async ({ page }) => {
    /*
     * In den Demodaten darf jede Rolle mit Planer-Zugriff auch
     * schreiben. Das Leserecht ist trotzdem einstellbar — und genau
     * dieser Zustand gehört geprüft, sonst fällt erst beim Kunden auf,
     * dass ein Nur-Leser Vorgänge anlegen kann.
     *
     * Das Recht wird deshalb für diesen Test umgestellt und danach
     * wieder zurückgesetzt.
     */
    const db = admin();
    const { data: projekt } = await db
      .from("planer_projekt")
      .insert({
        company_id: COMPANY_A,
        name: "Rechteprüfung",
        adresse: "Übergabeweg 9, 4020 Linz",
        ursprung_lat: LINZ.lat,
        ursprung_lon: LINZ.lon,
        anbieter: "basemap",
        zoom: 20,
      })
      .select("id")
      .single();

    await db
      .from("role_permission")
      .update({ level: "read" })
      .eq("company_id", COMPANY_A)
      .eq("area", "planer")
      .eq("role", "bauleitung");

    try {
      await login(page, DEMO.bauleitung);
      await page.goto(`/planer/${projekt!.id}`);
      await page.getByRole("button", { name: /^5 Übergabe/ }).click();

      await expect(page.getByRole("heading", { name: "Übergabe" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Als Vorgang übernehmen" })).toHaveCount(0);
    } finally {
      await db
        .from("role_permission")
        .update({ level: "write" })
        .eq("company_id", COMPANY_A)
        .eq("area", "planer")
        .eq("role", "bauleitung");
      await db.from("planer_projekt").delete().eq("id", projekt!.id);
    }
  });
});
