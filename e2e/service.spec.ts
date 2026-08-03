import { expect, test } from "@playwright/test";
import { COMPANY_A, DEMO, admin, login, portalToken } from "./helpers";

/*
 * Ein Anliegen aus dem Kundenportal muss im Betrieb ankommen und
 * beantwortbar sein. Vorher lag es in der Datenbank und sonst nirgends.
 */

test.describe.configure({ mode: "serial" });

const MARKE = "E2E-SERVICE";

const zustand: {
  kundeId?: string;
  token?: string;
  ticketId?: string;
  nummer?: string;
} = {};

async function aufraeumen(): Promise<void> {
  const db = admin();
  const { data: tickets } = await db
    .from("service_ticket")
    .select("id")
    .eq("company_id", COMPANY_A)
    .like("body", `${MARKE}%`);

  for (const t of tickets ?? []) {
    await db.from("service_message").delete().eq("ticket_id", t.id);
    await db.from("service_ticket").delete().eq("id", t.id);
  }
  await db.from("notification").delete().like("body", `${MARKE}%`);
}

test.beforeAll(async () => {
  await aufraeumen();
  const db = admin();
  const { data: kunde } = await db
    .from("customer")
    .select("id")
    .eq("company_id", COMPANY_A)
    .is("deleted_at", null)
    .limit(1)
    .single();
  zustand.kundeId = kunde!.id as string;
});

test.afterAll(aufraeumen);

test("1 — Der Kunde meldet ein Anliegen über das Portal", async ({ page }) => {
  const db = admin();

  await login(page, DEMO.gf);
  zustand.token = await portalToken(page, zustand.kundeId!);

  await page.context().clearCookies();
  await page.goto(`/portal/${zustand.token}`);

  await page.getByLabel("Art", { exact: true }).selectOption("frage");
  await page
    .getByLabel("Beschreibung", { exact: true })
    .fill(`${MARKE} Wann kommt der Zählertausch?`);
  await page.getByRole("button", { name: "Anliegen senden" }).click();

  await expect
    .poll(
      async () => {
        const { data } = await db
          .from("service_ticket")
          .select("id")
          .eq("company_id", COMPANY_A)
          .like("body", `${MARKE}%`)
          .maybeSingle();
        return data?.id ?? null;
      },
      { timeout: 20_000 },
    )
    .not.toBeNull();

  const { data } = await db
    .from("service_ticket")
    .select("id, number")
    .like("body", `${MARKE}%`)
    .single();
  zustand.ticketId = data!.id as string;
  zustand.nummer = data!.number as string;
});

test("2 — Das Anliegen steht in der Serviceliste und wartet auf Antwort", async ({
  page,
}) => {
  await login(page, DEMO.gf);
  await page.goto("/service?status=wartend");

  await expect(page.getByText(`${MARKE} Wann kommt der Zählertausch?`)).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText("wartet auf Antwort").first()).toBeVisible();
});

test("3 — Die interne Notiz bleibt intern", async ({ page }) => {
  const db = admin();
  await login(page, DEMO.gf);
  await page.goto(`/service/${zustand.ticketId}`);

  await page.getByRole("switch", { name: "Interne Notiz" }).click();
  await page
    .getByLabel(/Interne Notiz/)
    .fill("Netzbetreiber hat noch keinen Termin genannt.");
  await page.getByRole("button", { name: "Notiz speichern" }).click();

  await expect(page.getByText("Notiz gespeichert.")).toBeVisible({
    timeout: 15_000,
  });

  // Im Backoffice sichtbar …
  await expect(page.getByText("Netzbetreiber hat noch keinen")).toBeVisible();

  // … im Portal nicht.
  await page.context().clearCookies();
  await page.goto(`/portal/${zustand.token}`);
  await expect(page.getByText("Netzbetreiber hat noch keinen")).toHaveCount(0);

  const { data } = await db
    .from("service_ticket")
    .select("status")
    .eq("id", zustand.ticketId!)
    .single();
  // Eine interne Notiz ist keine Antwort — der Status bleibt offen.
  expect(data!.status).toBe("offen");
});

test("4 — Die Antwort erreicht den Kunden", async ({ page }) => {
  const db = admin();
  await login(page, DEMO.gf);
  await page.goto(`/service/${zustand.ticketId}`);

  await page
    .getByLabel("Antwort an den Kunden")
    .fill("Der Zählertausch ist für die 38. Kalenderwoche angemeldet.");
  await page.getByRole("button", { name: "Antwort senden" }).click();

  await expect(page.getByText(/Antwort gespeichert/)).toBeVisible({
    timeout: 15_000,
  });

  await expect
    .poll(async () => {
      const { data } = await db
        .from("service_ticket")
        .select("status")
        .eq("id", zustand.ticketId!)
        .single();
      return data?.status;
    })
    .toBe("diagnose");

  await page.context().clearCookies();
  await page.goto(`/portal/${zustand.token}`);
  await expect(page.getByText("38. Kalenderwoche")).toBeVisible();
});

test("5 — Der Kunde fragt nach, das Ticket wartet wieder", async ({ page }) => {
  await page.context().clearCookies();
  await page.goto(`/portal/${zustand.token}`);

  /*
   * Der Kunde hat mehrere Anliegen. Ohne Eingrenzung auf das eigene
   * trifft .first() das oberste — und "Senden" ohne exact trifft sogar
   * den Knopf "Anliegen senden" des Meldeformulars darüber.
   */
  const nummer = zustand.nummer!;
  await page
    .getByLabel(`Nachricht zu Anliegen ${nummer}`)
    .fill("Muss jemand zu Hause sein?");
  await page
    .locator("form")
    .filter({ has: page.getByLabel(`Nachricht zu Anliegen ${nummer}`) })
    .getByRole("button", { name: "Senden", exact: true })
    .click();

  await expect(page.getByText("Ihre Nachricht ist angekommen.")).toBeVisible({
    timeout: 15_000,
  });

  const seite = page;
  await seite.context().clearCookies();
  await login(seite, DEMO.gf);
  await seite.goto("/service?status=wartend");
  await expect(seite.getByText("Muss jemand zu Hause sein?")).toHaveCount(0);
  await expect(
    seite.getByText(`${MARKE} Wann kommt der Zählertausch?`),
  ).toBeVisible({ timeout: 15_000 });
});

test("6 — Ein fremder Kunde sieht das Anliegen nicht", async ({ page }) => {
  const db = admin();
  const { data: fremd } = await db
    .from("customer")
    .select("id")
    .eq("company_id", COMPANY_A)
    .neq("id", zustand.kundeId!)
    .is("deleted_at", null)
    .limit(1)
    .single();

  await login(page, DEMO.gf);
  const fremdToken = await portalToken(page, fremd!.id as string);

  await page.context().clearCookies();
  await page.goto(`/portal/${fremdToken}`);
  await expect(page.getByText("38. Kalenderwoche")).toHaveCount(0);
  await expect(
    page.getByText(`${MARKE} Wann kommt der Zählertausch?`),
  ).toHaveCount(0);

  await db.from("portal_access").delete().eq("customer_id", fremd!.id);
});
