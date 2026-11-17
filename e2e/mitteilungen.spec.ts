import { expect, test } from "@playwright/test";
import { admin, COMPANY_A, DEMO, login } from "./helpers";

/*
 * Die Glocke in der Leiste.
 *
 * Sie war ein Knopf ohne Handler: rot gepunktet, mit einer Zahl daneben,
 * und beim Klick passierte nichts. Dazu zeigte die Zahl die Mitteilungen
 * des GANZEN Betriebs — ein Monteur sah 119 Hinweise, von denen ihn kaum
 * einer betraf, darunter abgelaufene Nachweise von Kollegen und
 * Mailfehler zu fremden Kunden.
 *
 * Geprüft wird deshalb dreierlei: dass die Liste aufgeht, dass eine neue
 * Mitteilung ohne Neuladen ankommt und den Browser meldet, und dass
 * niemand die Mitteilungen eines anderen sieht.
 */

test.describe.configure({ mode: "serial" });

const KENNUNG = `e2e-mitteilung-${Date.now()}`;
const angelegt: string[] = [];

async function userId(email: string): Promise<string> {
  const { data } = await admin()
    .from("app_user")
    .select("id")
    .eq("email", email)
    .single();
  return data!.id as string;
}

async function mitteilung(
  email: string,
  titel: string,
  text: string,
): Promise<string> {
  const { data, error } = await admin()
    .from("notification")
    .insert({
      company_id: COMPANY_A,
      user_id: await userId(email),
      kind: KENNUNG,
      title: titel,
      body: text,
      link: "/vorgaenge",
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  angelegt.push(data!.id as string);
  return data!.id as string;
}

test.afterAll(async () => {
  if (angelegt.length > 0) {
    await admin().from("notification").delete().in("id", angelegt);
  }
});

test("Die Glocke zeigt die eigenen Mitteilungen", async ({ page }) => {
  const titel = `${KENNUNG} Angebot angenommen`;
  await mitteilung(DEMO.gf, titel, "Der Kunde hat online zugestimmt.");

  await login(page, DEMO.gf);
  await page.goto("/cockpit");

  await page.getByRole("button", { name: /ungelesene Hinweise/ }).click();

  await expect(page.getByText(titel)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("Der Kunde hat online zugestimmt.")).toBeVisible();
});

test("Eine neue Mitteilung kommt ohne Neuladen an und meldet den Browser", async ({
  browser,
}) => {
  /*
   * Zwei Dinge muss der Kontext mitbringen.
   *
   * Erstens die Erlaubnis für Benachrichtigungen — ohne sie legt der
   * Code bewusst keine an.
   *
   * Zweitens ein verstecktes Fenster: Eine Benachrichtigung erscheint
   * nur, wenn die Anwendung NICHT im Vordergrund ist. In Playwright ist
   * die Seite immer sichtbar, deshalb wird visibilityState überschrieben.
   * Genau diese Bedingung ist der Grund, warum man den Fall von Hand
   * kaum prüfen kann — und warum es diesen Test gibt.
   */
  const kontext = await browser.newContext({ permissions: ["notifications"] });
  const page = await kontext.newPage();

  await page.addInitScript(() => {
    Object.defineProperty(document, "visibilityState", {
      get: () => "hidden",
      configurable: true,
    });

    const gemeldet: { title: string; body?: string }[] = [];
    (window as unknown as Record<string, unknown>).__gemeldet = gemeldet;

    class Attrappe {
      static permission = "granted";
      static requestPermission = async () => "granted";
      onclick: (() => void) | null = null;
      constructor(title: string, options?: { body?: string }) {
        gemeldet.push({ title, ...(options?.body ? { body: options.body } : {}) });
      }
      close() {}
    }
    (window as unknown as Record<string, unknown>).Notification = Attrappe;
  });

  await login(page, DEMO.gf);
  await page.goto("/cockpit");
  await expect(
    page.getByRole("button", { name: /ungelesene Hinweise|Keine neuen Hinweise/ }),
  ).toBeVisible();

  /*
   * Dem Kanal einen Moment geben. Er holt erst die Sitzung und meldet
   * sich dann an — ohne diese Reihenfolge lauscht er als Unbekannter
   * und bekommt nie etwas zu sehen.
   */
  await page.waitForTimeout(3000);

  const titel = `${KENNUNG} Zahlungseingang`;
  await mitteilung(DEMO.gf, titel, "4.820,00 Euro verbucht.");

  await expect
    .poll(
      async () =>
        await page.evaluate(
          () =>
            ((window as unknown as Record<string, unknown>)
              .__gemeldet as { title: string }[]).length,
        ),
      { timeout: 20_000, message: "Keine Browserbenachrichtigung ausgelöst" },
    )
    .toBeGreaterThan(0);

  const gemeldet = await page.evaluate(
    () =>
      (window as unknown as Record<string, unknown>).__gemeldet as {
        title: string;
        body?: string;
      }[],
  );
  expect(gemeldet.some((n) => n.title === titel)).toBe(true);

  /* Und in der Liste steht sie auch, ohne dass jemand neu geladen hat. */
  await page.getByRole("button", { name: /ungelesene Hinweise/ }).click();
  await expect(page.getByText(titel)).toBeVisible();

  await kontext.close();
});

test("Ein Monteur sieht die Mitteilungen der Geschäftsführung nicht", async () => {
  const geheim = `${KENNUNG} nur für die Geschäftsführung`;
  await mitteilung(DEMO.gf, geheim, "Lohnabrechnung liegt bereit.");

  /*
   * Gemessen wird an der API, nicht am Bildschirm: Was das UI nicht
   * zeigt, kann es trotzdem ausliefern. Vor 0075 hing `notification` an
   * der generischen Policy und prüfte nur die Firma — ein Monteur bekam
   * damit alle 137 Zeilen des Betriebs, inklusive abgelaufener Nachweise
   * von Kollegen und Mailfehlern zu fremden Kunden.
   */
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  const { access_token } = (await fetch(
    `${url}/auth/v1/token?grant_type=password`,
    {
      method: "POST",
      headers: { apikey: anon, "content-type": "application/json" },
      body: JSON.stringify({
        email: DEMO.monteur,
        password: process.env.SEED_PASSWORD,
      }),
    },
  ).then((r) => r.json())) as { access_token: string };

  const treffer = (await fetch(
    `${url}/rest/v1/notification?select=title&kind=eq.${KENNUNG}`,
    { headers: { apikey: anon, authorization: `Bearer ${access_token}` } },
  ).then((r) => r.json())) as unknown[];

  expect(
    treffer.length,
    "Der Monteur sieht Mitteilungen, die der Geschäftsführung gehören",
  ).toBe(0);
});
