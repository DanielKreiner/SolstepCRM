import { expect, test } from "@playwright/test";
import { createHmac, randomBytes } from "node:crypto";
import { COMPANY_A, DEMO, admin, login, portalToken, suchwahl } from "./helpers";

/*
 * Der ganze Weg, einmal von vorn: Lead anlegen, Anlage pflegen, Angebot
 * bauen, Portalzugang erzeugen, Angebot im Portal ansehen und annehmen,
 * Auftrag terminieren.
 *
 * Kein Screen-für-Screen-Test, sondern der Ablauf, den ein Betrieb an
 * einem Vormittag geht. Genau dort fallen fehlende Felder auf — eine
 * Einzelprüfung je Seite hätte sie nie gefunden.
 */

test.describe.configure({ mode: "serial" });

const MARKE = "E2E-ABLAUF";

async function aufraeumen(): Promise<void> {
  const db = admin();

  const { data: kunden } = await db
    .from("customer")
    .select("id")
    .eq("company_id", COMPANY_A)
    .like("name", `${MARKE}%`);

  for (const k of kunden ?? []) {
    const { data: quotes } = await db
      .from("quote")
      .select("id")
      .eq("customer_id", k.id);
    for (const q of quotes ?? []) {
      await db.from("job").update({ quote_id: null }).eq("quote_id", q.id);
      await db.from("quote_item").delete().eq("quote_id", q.id);
      await db.from("quote_event").delete().eq("quote_id", q.id);
      await db.from("mail_outbox").delete().eq("quote_id", q.id);
      await db.from("quote").delete().eq("id", q.id);
    }
    const { data: jobs } = await db
      .from("job")
      .select("id")
      .eq("customer_id", k.id);
    for (const j of jobs ?? []) {
      await db.from("job_checklist_item").delete().eq("job_id", j.id);
      await db.from("job").delete().eq("id", j.id);
    }
    await db.from("portal_access").delete().eq("customer_id", k.id);
    await db.from("contact_activity").delete().eq("customer_id", k.id);
    await db.from("plant").delete().eq("customer_id", k.id);
    await db.from("customer").delete().eq("id", k.id);
  }
}

test.beforeAll(aufraeumen);
test.afterAll(aufraeumen);

/** Zustand zwischen den Schritten. Der Ablauf baut aufeinander auf. */
const zustand: {
  kundeId?: string;
  quoteId?: string;
  token?: string;
} = {};

test("1 — Lead anlegen", async ({ page }) => {
  const db = admin();
  await login(page, DEMO.gf);
  await page.goto("/crm");

  await page.getByRole("button", { name: "Kunde anlegen", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill(`${MARKE} Familie Weber`);
  await page.getByLabel("Ansprechpartner").fill("Katrin Weber");
  await page.getByLabel("E-Mail").fill("weber@example.com");
  await page.getByLabel("Adresse").fill("Rosenweg 8");
  await page.getByLabel("PLZ").fill("4020");
  await page.getByLabel("Ort").fill("Linz");
  await page.getByLabel("Herkunft").fill("Empfehlung");
  await page.getByRole("button", { name: "Anlegen", exact: true }).click();

  await expect(page.getByText("angelegt")).toBeVisible({ timeout: 15_000 });

  const { data } = await db
    .from("customer")
    .select("id, type, contact_person, zip")
    .eq("company_id", COMPANY_A)
    .like("name", `${MARKE}%`)
    .single();

  expect(data!.type).toBe("lead");
  expect(data!.contact_person).toBe("Katrin Weber");
  expect(data!.zip).toBe("4020");
  zustand.kundeId = data!.id as string;
});

test("2 — Anlage mit Zählpunkt pflegen", async ({ page }) => {
  const db = admin();
  await login(page, DEMO.gf);
  await page.goto(`/crm?kunde=${zustand.kundeId}&bearbeiten=anlage`);

  await page.getByLabel("Leistung in kWp").fill("9.84");
  await page.getByLabel("Speicher in kWh").fill("10");
  await page.getByLabel("Module").fill("24 × JA Solar 445 W");
  await page.getByLabel("Wechselrichter").fill("Fronius Symo GEN24 10.0");
  await page.getByLabel("Zählpunkt").fill("AT0030000000000000000012345678");
  await page.getByRole("button", { name: "Anlegen", exact: true }).click();

  await expect(page.getByText("Anlage gespeichert")).toBeVisible({
    timeout: 15_000,
  });

  const { data } = await db
    .from("plant")
    .select("kwp, storage_kwh, meter_point, inverter")
    .eq("customer_id", zustand.kundeId!)
    .single();

  expect(Number(data!.kwp)).toBe(9.84);
  expect(Number(data!.storage_kwh)).toBe(10);
  expect(data!.meter_point).toBe("AT0030000000000000000012345678");
});

test("3 — Angebot mit Paket, Option und Leistung bauen", async ({ page }) => {
  const db = admin();
  await login(page, DEMO.gf);
  await page.goto("/angebote/neu");

  await suchwahl(page, "Kunde", `${MARKE} Familie Weber`);
  await page.getByRole("button", { name: "Freie Position", exact: true }).click();
  await page.getByLabel("Bezeichnung Position 1").fill(`${MARKE} PV-Anlage 9,84 kWp`);
  await page.getByLabel("Menge Position 1").fill("1");
  await page.getByLabel("Einkauf Position 1").fill("11000");
  await page.getByLabel("Verkauf Position 1").fill("16800");

  await page.getByRole("button", { name: "Angebot anlegen", exact: true }).click();
  await page.waitForURL(/\/angebote\/[0-9a-f-]{36}$/, { timeout: 20_000 });

  const { data: angebot } = await db
    .from("quote")
    .select("id, number, net_total, price_display")
    .eq("customer_id", zustand.kundeId!)
    .single();

  expect(Number(angebot!.net_total)).toBe(16800);
  expect(angebot!.price_display).toBe("positionen");
  zustand.quoteId = angebot!.id as string;

  /*
   * Die weiteren Positionsarten direkt setzen. Über die Oberfläche wäre
   * das derselbe Weg, nur langsamer — geprüft wird hier, dass die
   * Angebotsseite sie richtig darstellt, nicht das Formular.
   *
   * Beide Zeilen tragen dieselben Schlüssel: PostgREST macht aus einem
   * fehlenden Feld in einem Stapel NULL statt Default.
   */
  const { error: einfuegen } = await db.from("quote_item").insert([
    {
      company_id: COMPANY_A,
      quote_id: angebot!.id,
      pos: 20,
      kind: "option",
      text: "Wallbox 11 kW",
      description: "Ladepunkt für das E-Auto, dreiphasig, mit Lastmanagement.",
      manufacturer: "go-e",
      qty: 1,
      unit: "Stk",
      purchase_price: 480,
      sale_price: 890,
      vat_rate: 20,
      optional_selected: false,
    },
    {
      company_id: COMPANY_A,
      quote_id: angebot!.id,
      pos: 30,
      kind: "leistung",
      text: "Netzanmeldung und Inbetriebnahme",
      description:
        "Anmeldung beim Netzbetreiber, Zählertausch koordinieren, Inbetriebnahme durch einen konzessionierten Elektriker.",
      manufacturer: null,
      qty: 1,
      unit: "Stk",
      purchase_price: 0,
      sale_price: 0,
      vat_rate: 20,
      optional_selected: false,
    },
  ]);

  expect(einfuegen?.message ?? null).toBeNull();
});

test("4 — Portalzugang erzeugen", async ({ page }) => {
  await login(page, DEMO.gf);
  zustand.token = await portalToken(page, zustand.kundeId!);
  expect(zustand.token.length).toBeGreaterThan(40);
});

test("5 — Der Kunde sieht sein Angebot mit allem drin", async ({ page }) => {
  await page.context().clearCookies();
  await page.goto(`/portal/${zustand.token}/angebot/${zustand.quoteId}`);

  // Anrede und Anlage
  await expect(
    page.getByRole("heading", { name: "Ihr persönliches Angebot" }),
  ).toBeVisible();
  await expect(page.getByText("Katrin Weber").first()).toBeVisible();
  // Deutsche Schreibweise — der Kunde liest 9,84 und nicht 9.84.
  await expect(page.getByText("9,84 kWp").first()).toBeVisible();

  // Die drei Positionsarten
  await expect(page.getByText(`${MARKE} PV-Anlage 9,84 kWp`)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Bei uns inklusive" })).toBeVisible();
  await expect(
    page.getByText("Netzanmeldung und Inbetriebnahme", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Optionale Erweiterungen" }),
  ).toBeVisible();
  await expect(page.getByText("Wallbox 11 kW")).toBeVisible();

  // Gesamtsumme ohne die Option: 16800 netto + 20 % = 20160
  await expect(page.getByText("€ 20.160,00").first()).toBeVisible();
});

test("6 — Die Option ändert den Gesamtpreis", async ({ page }) => {
  const db = admin();
  await page.context().clearCookies();
  await page.goto(`/portal/${zustand.token}/angebot/${zustand.quoteId}`);

  await page.getByRole("checkbox", { name: /Wallbox 11 kW dazubuchen/ }).click();

  await expect
    .poll(
      async () => {
        const { data } = await db
          .from("quote_item")
          .select("optional_selected")
          .eq("quote_id", zustand.quoteId!)
          .eq("kind", "option")
          .single();
        return data?.optional_selected;
      },
      { timeout: 15_000 },
    )
    .toBe(true);

  // 16800 + 890 = 17690 netto, brutto 21228
  await expect(page.getByText("€ 21.228,00").first()).toBeVisible({
    timeout: 15_000,
  });
});

test("7 — Nur Gesamtpreis zeigen blendet die Einzelpreise aus", async ({
  page,
}) => {
  const db = admin();
  await db
    .from("quote")
    .update({ price_display: "gesamt" })
    .eq("id", zustand.quoteId!);

  await page.context().clearCookies();
  await page.goto(`/portal/${zustand.token}/angebot/${zustand.quoteId}`);

  /*
   * Die Positionskarte trägt keinen Preis mehr. Die Summenaufstellung
   * bleibt — sonst könnte der Kunde die Erweiterung nicht bewerten, und
   * ohne Netto und Umsatzsteuer wäre das Angebot kein Angebot.
   */
  const karte = page.getByRole("article").filter({ hasText: MARKE });
  await expect(karte).toHaveCount(1);
  await expect(karte).not.toContainText("€");
  await expect(page.getByText("€ 21.228,00").first()).toBeVisible();

  await db
    .from("quote")
    .update({ price_display: "positionen" })
    .eq("id", zustand.quoteId!);
});

test("8 — Annahme legt den Auftrag an", async ({ page }) => {
  const db = admin();
  await page.context().clearCookies();
  await page.goto(`/portal/${zustand.token}/angebot/${zustand.quoteId}`);

  await page.getByRole("button", { name: "Angebot annehmen" }).click();
  await page.getByLabel(/Ihr Name/).fill("Katrin Weber");
  await page.getByRole("button", { name: "Verbindlich annehmen" }).click();

  await expect
    .poll(
      async () => {
        const { data } = await db
          .from("quote")
          .select("accepted_at, accepted_name")
          .eq("id", zustand.quoteId!)
          .single();
        return data?.accepted_name;
      },
      { timeout: 20_000 },
    )
    .toBe("Katrin Weber");

  const { data: auftrag } = await db
    .from("job")
    .select("id, number, next_step, value_net")
    .eq("quote_id", zustand.quoteId!)
    .single();

  expect(auftrag!.number).toMatch(/^A-\d{4}-\d{4}$/);
  expect(auftrag!.next_step).toBe("Termin fixieren");

  /*
   * Die im Portal dazugebuchte Wallbox muss im Auftragswert stehen —
   * sonst verkauft der Betrieb 890 €, die nirgends auftauchen.
   */
  expect(Number(auftrag!.value_net)).toBe(17690);

  const { data: aufgabe } = await db
    .from("job_checklist_item")
    .select("label")
    .eq("job_id", auftrag!.id)
    .single();
  expect(aufgabe!.label).toBe("Termin fixieren");
});

test("9 — Auftrag terminieren", async ({ page }) => {
  const db = admin();
  const { data: auftrag } = await db
    .from("job")
    .select("id")
    .eq("quote_id", zustand.quoteId!)
    .single();

  await login(page, DEMO.gf);
  await page.goto(`/auftraege/${auftrag!.id}?bearbeiten=1`);

  await page.getByLabel("Termin von").fill("2026-09-14T07:00");
  await page.getByLabel("Termin bis").fill("2026-09-16T16:00");
  await page.getByLabel("Baustellenadresse").fill("Rosenweg 8");
  await page.getByRole("button", { name: "Speichern", exact: true }).click();

  await expect(page.getByText("Gespeichert.")).toBeVisible({ timeout: 15_000 });

  await expect
    .poll(async () => {
      const { data } = await db
        .from("job")
        .select("scheduled_from")
        .eq("id", auftrag!.id)
        .single();
      return data?.scheduled_from !== null;
    })
    .toBe(true);
});

test("10 — Ein fremder Token öffnet dieses Angebot nicht", async ({ page }) => {
  const secret = process.env.PORTAL_TOKEN_SECRET!;
  const db = admin();

  const { data: fremder } = await db
    .from("customer")
    .select("id")
    .eq("company_id", COMPANY_A)
    .neq("id", zustand.kundeId!)
    .is("deleted_at", null)
    .limit(1)
    .single();

  const exp = Math.floor(Date.now() / 1000) + 86400;
  const body = `${fremder!.id as string}.${exp}.${randomBytes(6).toString("base64url")}`;
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  const token = `${Buffer.from(body, "utf8").toString("base64url")}.${sig}`;

  await db.from("portal_access").insert({
    company_id: COMPANY_A,
    customer_id: fremder!.id,
    token_hash: createHmac("sha256", secret).update(token).digest("hex"),
    expires_at: new Date(exp * 1000).toISOString(),
  });

  await page.context().clearCookies();
  const antwort = await page.goto(
    `/portal/${token}/angebot/${zustand.quoteId}`,
  );
  expect(antwort?.status()).toBe(404);

  await db.from("portal_access").delete().eq("customer_id", fremder!.id);
});
