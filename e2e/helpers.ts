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

/**
 * Einen Vorgang über seine frühere Auftragsnummer finden.
 *
 * Die Tests hingen an Nummern wie A-2026-0042 aus dem Seed. Mit dem
 * Umbau trägt jeder Vorgang eine eigene Nummer, die alte steht in
 * alt_nummern. Der Umweg hält die Tests unabhängig davon, ob der Bestand
 * übernommen oder frisch geseedet wurde.
 */
export async function vorgangId(altNummer: string): Promise<string> {
  const { data, error } = await admin()
    .from("vorgang")
    .select("id, number, alt_nummern")
    .eq("company_id", COMPANY_A)
    .or(`number.eq.${altNummer},alt_nummern.like.%${altNummer}%`)
    .limit(1)
    .single();
  if (error) throw new Error(`Vorgang ${altNummer} nicht gefunden: ${error.message}`);
  return data.id as string;
}

export async function vorgangNummer(altNummer: string): Promise<string> {
  const { data, error } = await admin()
    .from("vorgang")
    .select("number, alt_nummern")
    .eq("company_id", COMPANY_A)
    .or(`number.eq.${altNummer},alt_nummern.like.%${altNummer}%`)
    .limit(1)
    .single();
  if (error) throw new Error(`Vorgang ${altNummer} nicht gefunden: ${error.message}`);
  return data.number as string;
}

/**
 * Iststunden eines Vorgangs.
 *
 * Direkt aus time_entry und nicht über v_vorgang_kpi: die View filtert
 * auf current_company_id() und can(). Der Service-Role-Client hat kein
 * JWT, bekäme also nichts zurück — die View ist für angemeldete Rollen
 * gebaut, nicht für Kontrollmessungen.
 */
export async function vorgangHours(altNummer: string): Promise<number> {
  const db = admin();
  const id = await vorgangId(altNummer);

  const { data, error } = await db
    .from("time_entry")
    .select("duration_min, kind, status")
    .eq("vorgang_id", id)
    .in("kind", ["work", "travel"])
    .in("status", ["booked", "approved"]);
  if (error) throw error;

  const min = (data ?? []).reduce((s, e) => s + Number(e.duration_min ?? 0), 0);
  return min / 60;
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
  /*
   * Der Zugang wird am Vorgang gepflegt, seit das CRM weg ist. Ein
   * beliebiger Vorgang dieses Kunden genügt — der Zugang gehört dem
   * Kunden und nicht dem einzelnen Vorgang.
   */
  const { data: v, error } = await admin()
    .from("vorgang")
    .select("id")
    .eq("company_id", COMPANY_A)
    .eq("customer_id", kundeId)
    .limit(1)
    .single();
  if (error) throw new Error(`Kein Vorgang für ${kundeId}: ${error.message}`);

  await page.goto(`/vorgaenge/${v.id as string}`);
  await page.getByRole("button", { name: "Kundenportal" }).click();

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
