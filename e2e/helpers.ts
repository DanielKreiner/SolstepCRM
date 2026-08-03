import { expect, type Locator, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const DEMO = {
  gf: "gf@hofstaetter.example.com",
  buero: "buero@hofstaetter.example.com",
  bauleitung: "bauleitung@hofstaetter.example.com",
  monteur: "monteur@hofstaetter.example.com",
  lager: "lager@hofstaetter.example.com",
  fremd: "gf@zweitbetrieb.example.com",
} as const;

/*
 * Der Service-Role-Client umgeht RLS und sieht beide Mandanten. Jede
 * Kontrollabfrage muss deshalb selbst auf den Demomandanten einschränken —
 * sonst greift man sich die gleichnamige Phase oder Auftragsnummer des
 * Fremdmandanten. Genau das ist hier einmal passiert.
 */
export const COMPANY_A = "11111111-1111-4111-8111-111111111111";
export const COMPANY_B = "22222222-2222-4222-8222-222222222222";

export function password(): string {
  const p = process.env.SEED_PASSWORD;
  if (!p) throw new Error("SEED_PASSWORD fehlt.");
  return p;
}

export async function login(page: Page, email: string): Promise<void> {
  await page.goto("/login");
  // Schon angemeldet? Dann leitet /login weiter und es gibt kein Formular.
  if (!page.url().includes("/login")) {
    await page.context().clearCookies();
    await page.goto("/login");
  }
  await page.getByLabel("E-Mail").fill(email);
  await page.getByLabel("Passwort").fill(password());
  await page.getByRole("button", { name: "Anmelden" }).click();
  await page.waitForURL("**/cockpit", { timeout: 20_000 });
}

/** Service-Role-Client für Kontrollmessungen am Datenbestand. */
export function admin(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

export async function stockOf(sku: string): Promise<number> {
  const { data, error } = await admin()
    .from("article")
    .select("stock")
    .eq("company_id", COMPANY_A)
    .eq("sku", sku)
    .single();
  if (error) throw error;
  return Number(data.stock);
}

export async function jobHours(number: string): Promise<number> {
  const db = admin();
  const { data: job, error: e1 } = await db
    .from("job")
    .select("id")
    .eq("company_id", COMPANY_A)
    .eq("number", number)
    .single();
  if (e1) throw e1;

  const { data, error } = await db
    .from("v_job_kpi")
    .select("hours_actual")
    .eq("job_id", job.id)
    .single();
  if (error) throw error;
  return Number(data.hours_actual);
}

/**
 * Portalzugang über die Oberfläche erzeugen und den Token zurückgeben.
 *
 * Hat der Kunde schon einen Zugang, steht im Linkkasten zunächst der alte
 * Link — der beim Erzeugen des neuen widerrufen wird. Deshalb wird auf
 * einen tatsächlich geänderten Wert gewartet und nicht nur darauf, dass
 * das Feld sichtbar ist.
 */
export async function portalToken(page: Page, kundeId: string): Promise<string> {
  await page.goto(`/crm?kunde=${kundeId}&bearbeiten=portal`);

  const feld = page.getByLabel("Portallink").first();
  const vorher = (await feld.count()) > 0 ? await feld.inputValue() : "";

  await page
    .getByRole("button", { name: /Zugang erzeugen|Neuen Link erzeugen/ })
    .click();

  await expect
    .poll(
      async () => {
        if ((await feld.count()) === 0) return vorher;
        return feld.inputValue();
      },
      { timeout: 20_000 },
    )
    .not.toBe(vorher);

  const link = await feld.inputValue();
  const token = link.split("/portal/")[1];
  if (!token) throw new Error(`Kein Token im Link: ${link}`);
  return token;
}

/**
 * Eine Suchauswahl bedienen: tippen und den Treffer anklicken.
 *
 * Die Klapplisten für Kunden, Artikel und Aufträge sind Suchfelder
 * geworden — ein <select> mit 3000 Artikeln ist nicht bedienbar.
 * `selectOption` greift dort nicht mehr, deshalb dieser Weg.
 *
 * `wurzel` grenzt auf ein Formular ein, wenn mehrere gleich benannte
 * Felder auf der Seite stehen.
 */
export async function suchwahl(
  wurzel: Page | Locator,
  label: string,
  text: string,
): Promise<void> {
  const feld = wurzel.getByRole("combobox", { name: label, exact: true });
  await feld.click();
  await feld.fill(text.slice(0, 30));

  const liste = wurzel.getByRole("listbox", { name: label });
  await liste.getByRole("option").filter({ hasText: text }).first().click();
}
