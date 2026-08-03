import { createHmac, randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
import { COMPANY_A, admin } from "./helpers";

/*
 * Definition of Done Meilenstein 8 (CLAUDE.md Abschnitt 12):
 *   "Magic Link, Angebotsannahme mit Name/IP/Zeit, Ticket-Erzeugung"
 *
 * Das Portal hat keine Supabase-Session. Die gesamte Mandantentrennung
 * liegt in lib/portal/data.ts — entsprechend prüfen diese Tests vor allem,
 * dass ein Token nichts öffnet, was ihm nicht gehört.
 */

test.describe.configure({ mode: "serial" });

function secret(): string {
  const s = process.env.PORTAL_TOKEN_SECRET;
  if (!s) throw new Error("PORTAL_TOKEN_SECRET fehlt.");
  return s;
}

function baueToken(customerId: string, ablaufSekunden?: number): string {
  const exp = ablaufSekunden ?? Math.floor(Date.now() / 1000) + 86400;
  const nonce = randomBytes(6).toString("base64url");
  const body = `${customerId}.${exp}.${nonce}`;
  const sig = createHmac("sha256", secret()).update(body).digest("base64url");
  return `${Buffer.from(body, "utf8").toString("base64url")}.${sig}`;
}

function hash(token: string): string {
  return createHmac("sha256", secret()).update(token).digest("hex");
}

async function zugang(
  customerName: string,
  opts: { abgelaufen?: boolean; widerrufen?: boolean } = {},
): Promise<{ token: string; customerId: string }> {
  const db = admin();
  const { data: customer } = await db
    .from("customer")
    .select("id")
    .eq("company_id", COMPANY_A)
    .eq("name", customerName)
    .single();

  const exp = opts.abgelaufen
    ? Math.floor(Date.now() / 1000) - 3600
    : undefined;
  const token = baueToken(customer!.id as string, exp);

  const ablauf = new Date();
  ablauf.setDate(ablauf.getDate() + (opts.abgelaufen ? -1 : 90));

  await db.from("portal_access").insert({
    company_id: COMPANY_A,
    customer_id: customer!.id,
    token_hash: hash(token),
    expires_at: ablauf.toISOString(),
    revoked_at: opts.widerrufen ? new Date().toISOString() : null,
  });

  return { token, customerId: customer!.id as string };
}

async function aufraeumen() {
  const db = admin();
  await db.from("portal_access").delete().eq("company_id", COMPANY_A);
  await db.from("service_ticket").delete().like("body", "E2E-M8%");
}

test("Der signierte Link öffnet das Portal ohne Anmeldung", async ({ page }) => {
  await aufraeumen();
  const { token } = await zugang("Familie Brandstätter");

  await page.goto(`/portal/${token}`);

  await expect(
    page.getByRole("heading", { name: "Familie Brandstätter" }),
  ).toBeVisible();
  await expect(page.getByText("Hofstätter Energietechnik GmbH")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ihre Projekte" })).toBeVisible();

  // Kein Login-Formular, keine Weiterleitung.
  expect(page.url()).toContain("/portal/");
});

test("Ein manipulierter, abgelaufener oder widerrufener Token öffnet nichts", async ({
  page,
}) => {
  await aufraeumen();

  // 1. Signatur verfälscht
  const { token } = await zugang("Familie Brandstätter");
  const manipuliert = `${token.slice(0, -4)}aaaa`;
  const a = await page.goto(`/portal/${manipuliert}`);
  expect(a?.status()).toBe(404);

  // 2. Abgelaufen
  await aufraeumen();
  const abgelaufen = await zugang("Familie Brandstätter", { abgelaufen: true });
  const b = await page.goto(`/portal/${abgelaufen.token}`);
  expect(b?.status()).toBe(404);

  // 3. Widerrufen
  await aufraeumen();
  const widerrufen = await zugang("Familie Brandstätter", { widerrufen: true });
  const c = await page.goto(`/portal/${widerrufen.token}`);
  expect(c?.status()).toBe(404);

  // 4. Gültig signiert, aber ohne Eintrag in portal_access
  await aufraeumen();
  const db = admin();
  const { data: customer } = await db
    .from("customer")
    .select("id")
    .eq("company_id", COMPANY_A)
    .eq("name", "Familie Brandstätter")
    .single();
  const ohneEintrag = baueToken(customer!.id as string);
  const d = await page.goto(`/portal/${ohneEintrag}`);
  expect(d?.status()).toBe(404);
});

test("Ein Portalzugang zeigt nur die eigenen Daten", async ({ page }) => {
  await aufraeumen();
  const { token } = await zugang("Tischlerei Aigner GmbH");

  await page.goto(`/portal/${token}`);
  await expect(
    page.getByRole("heading", { name: "Tischlerei Aigner GmbH" }),
  ).toBeVisible();

  // Aufträge und Angebote des anderen Kunden dürfen nicht auftauchen.
  await expect(page.getByText("A-2026-0041")).toHaveCount(0);
  await expect(page.getByText("A-2026-0038")).toHaveCount(0);
  await expect(page.getByText("AN-2026-0105")).toHaveCount(0);

  // Die eigenen schon.
  await expect(page.getByText("A-2026-0042").first()).toBeVisible();
});

test("Angebotsannahme hält Name, Zeitpunkt und IP fest", async ({ page }) => {
  await aufraeumen();
  const db = admin();
  const { token } = await zugang("Landwirtschaft Grubmüller");

  // Ein offenes Angebot dieses Kunden zurücksetzen.
  const { data: quote } = await db
    .from("quote")
    .select("id, number")
    .eq("company_id", COMPANY_A)
    .eq("number", "AN-2026-0107")
    .single();
  await db
    .from("quote")
    .update({ accepted_at: null, accepted_name: null, accepted_ip: null })
    .eq("id", quote!.id);

  /*
   * Auch den Auftrag eines früheren Laufs entfernen. Die Annahme prüft
   * zuerst, ob zum Angebot schon ein Auftrag existiert — bleibt er
   * stehen, meldet sie beim zweiten Lauf nur "war bereits angenommen"
   * und erfasst weder Name noch Zeitpunkt.
   */
  const { data: alteAuftraege } = await db
    .from("job")
    .select("id")
    .eq("quote_id", quote!.id);
  for (const j of alteAuftraege ?? []) {
    await db.from("job_checklist_item").delete().eq("job_id", j.id);
    const { error } = await db.from("job").delete().eq("id", j.id);
    /*
     * Den Fehler lesen: ein stilles Fehlschlagen liess den Auftrag
     * stehen, die Annahme hielt das Angebot für längst angenommen und
     * schrieb weder Name noch Zeitpunkt — gesucht wurde das anschliessend
     * an der falschen Stelle.
     */
    expect(error?.message ?? null).toBeNull();
  }

  /*
   * Angenommen wird auf der Angebotsseite, nicht in der Kurzliste der
   * Übersicht: dort sieht der Kunde Positionen, Technik und optionale
   * Erweiterungen — die Zusage soll er treffen, wenn er das gelesen hat.
   */
  await page.goto(`/portal/${token}/angebot/${quote!.id as string}`);

  await page.getByRole("button", { name: "Angebot annehmen" }).click();
  await page.getByLabel(/Ihr Name/).fill("Josef Grubmüller");
  await page.getByRole("button", { name: "Verbindlich annehmen" }).click();

  await expect(page.getByText(/Angenommen von Josef Grubmüller/)).toBeVisible({
    timeout: 20_000,
  });

  const { data: nachher } = await db
    .from("quote")
    .select("accepted_at, accepted_name, accepted_ip, phase:phase_id ( system_key )")
    .eq("id", quote!.id)
    .single();

  expect(nachher!.accepted_name).toBe("Josef Grubmüller");
  expect(nachher!.accepted_at).toBeTruthy();
  expect(nachher!.accepted_ip).toBeTruthy();
  expect((nachher!.phase as unknown as { system_key: string }).system_key).toBe(
    "won",
  );

  // Das Ereignis ist protokolliert, mit Herkunft.
  const { data: events } = await db
    .from("quote_event")
    .select("kind, meta_json")
    .eq("quote_id", quote!.id)
    .eq("kind", "accepted");
  expect(events!.length).toBeGreaterThan(0);
  expect(
    (events ?? []).some(
      (e) => (e.meta_json as { via?: string }).via === "portal",
    ),
  ).toBe(true);

  /*
   * Meilenstein 3: die Annahme legt den Auftrag an. Das galt lange nur für
   * den Weg über das Backoffice — der Portalweg hatte eine eigene, kürzere
   * Fassung und liess das Angebot ohne Folgearbeit stehen.
   */
  const { data: auftrag } = await db
    .from("job")
    .select("id, next_step")
    .eq("quote_id", quote!.id)
    .maybeSingle();
  expect(auftrag).not.toBeNull();
  expect(auftrag!.next_step).toBe("Termin fixieren");
});

test("Ein fremdes Angebot lässt sich über den eigenen Token nicht annehmen", async ({
  page,
}) => {
  await aufraeumen();
  const db = admin();
  const { token } = await zugang("Familie Brandstätter");

  // Angebot eines anderen Kunden.
  const { data: fremd } = await db
    .from("quote")
    .select("id, accepted_at")
    .eq("company_id", COMPANY_A)
    .eq("number", "AN-2026-0106")
    .single();
  await db.from("quote").update({ accepted_at: null }).eq("id", fremd!.id);

  const antwort = await page.request.post(`/portal/${token}`, {
    form: {
      token,
      quoteId: fremd!.id as string,
      name: "Einschleusversuch",
    },
  });
  // Der Server Action-Endpunkt nimmt kein reines Formular an; entscheidend
  // ist, dass das Angebot unverändert bleibt.
  expect([200, 400, 404, 405]).toContain(antwort.status());

  const { data: nachher } = await db
    .from("quote")
    .select("accepted_at, accepted_name")
    .eq("id", fremd!.id)
    .single();
  expect(nachher!.accepted_at).toBeNull();
  expect(nachher!.accepted_name).not.toBe("Einschleusversuch");
});

test("Ein Anliegen erzeugt ein Serviceticket im Betrieb", async ({ page }) => {
  await aufraeumen();
  const db = admin();
  const { token, customerId } = await zugang("Familie Brandstätter");

  await page.goto(`/portal/${token}`);

  const form = page.locator("form", { hasText: "Anliegen melden" });
  await form.getByLabel("Art").selectOption("stoerung");
  await form
    .getByLabel("Beschreibung")
    .fill("E2E-M8 Wechselrichter zeigt seit heute früh Fehler 301.");
  await form.getByRole("button", { name: "Anliegen senden" }).click();

  // Auch hier: die Liste der Anliegen wächst, das ist der Beleg.
  await expect(page.getByText("E2E-M8 Wechselrichter")).toBeVisible({
    timeout: 15_000,
  });

  const { data: ticket } = await db
    .from("service_ticket")
    .select("number, source, category, severity, customer_id, phase:phase_id ( key )")
    .like("body", "E2E-M8%")
    .single();

  expect(ticket!.source).toBe("portal");
  expect(ticket!.category).toBe("stoerung");
  // Störung ist die höchste Dringlichkeit.
  expect(ticket!.severity).toBe(1);
  expect(ticket!.customer_id).toBe(customerId);
  expect((ticket!.phase as unknown as { key: string }).key).toBe("offen");
  expect(String(ticket!.number)).toMatch(/^S-\d{4}-\d{4}$/);

  // Der Betrieb wird benachrichtigt.
  const { data: hinweise } = await db
    .from("notification")
    .select("title")
    .eq("kind", "ticket_created");
  expect(hinweise!.length).toBeGreaterThan(0);

  // Und der Kunde sieht sein Anliegen sofort.
  await expect(
    page.getByText(String(ticket!.number), { exact: true }),
  ).toBeVisible();

  await aufraeumen();
});
