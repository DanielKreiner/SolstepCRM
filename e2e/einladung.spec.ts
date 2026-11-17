import { expect, test } from "@playwright/test";
import { admin, DEMO, login } from "./helpers";

/*
 * Der Zugangsweg eines neuen Mitarbeiters — von „Anlegen und einladen"
 * bis zur ersten Anmeldung.
 *
 * Dieser Test existiert wegen eines Fehlers, den keine Unit gefunden
 * hätte: Das Anlegen rief `inviteUserByEmail` auf, und damit verschickte
 * Supabase die Mail selbst. Beim Eingeladenen kam eine englische
 * Standardvorlage "You've been invited" vom Absender "Supabase Auth" an,
 * und der Knopf darin zeigte auf die Site-URL des Supabase-Projekts —
 * auf dem Entwicklungsstand also auf localhost:3000 des Empfängers, wo
 * nichts läuft. Angelegt war der Mitarbeiter, hinein kam er nie.
 *
 * Geprüft wird deshalb beides: dass die Mail aus dem eigenen Postausgang
 * stammt und auf diese Anwendung zeigt, und dass der Link den Zugang
 * tatsächlich öffnet. Eine Erfolgsmeldung im Formular beweist davon
 * nichts — die stand auch vorher da.
 */

test.describe.configure({ mode: "serial" });

const KENNUNG = `e2e-einladung-${Date.now()}`;
const ADRESSE = `${KENNUNG}@example.at`;
const PASSWORT = "Einladung!Probe2026";

let angelegteId: string | null = null;
let zugangsUrl = "";

test.afterAll(async () => {
  /*
   * Der Lauf legt ein echtes Konto in auth.users an. Bleibt es stehen,
   * ist die Adresse beim nächsten Lauf vergeben und der Test scheitert
   * an seinem eigenen Rückstand. app_user hängt per Fremdschlüssel daran
   * und geht mit.
   */
  if (angelegteId) await admin().auth.admin.deleteUser(angelegteId);
});

test("Die Einladung kommt aus dem eigenen Postausgang und zeigt in diese Anwendung", async ({
  page,
}) => {
  await login(page, DEMO.gf);
  await page.goto("/mitarbeiter");

  await page.getByRole("button", { name: "Mitarbeiter anlegen" }).click();
  await page.getByLabel("Name").fill("E2E Einladung");
  await page.getByLabel("E-Mail").fill(ADRESSE);
  await page.getByRole("button", { name: "Anlegen und einladen" }).click();

  /*
   * Auf die Rückmeldung des Formulars warten, nicht auf die Adresse in
   * der Tabelle: die stünde auch dann da, wenn das Anlegen mit „Diese
   * Adresse gehört bereits zu einem Mitarbeiter" abbricht.
   */
  await expect(page.getByText(/angelegt/)).toBeVisible({ timeout: 20_000 });

  const { data: nutzer } = await admin()
    .from("app_user")
    .select("id")
    .eq("email", ADRESSE)
    .maybeSingle();

  expect(nutzer, "Mitarbeiter wurde nicht angelegt").not.toBeNull();
  angelegteId = nutzer!.id as string;

  const { data: mail } = await admin()
    .from("mail_outbox")
    .select("subject, body_text, body_html, art, status")
    .contains("to_addrs", [ADRESSE])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  expect(mail, "Keine Einladungsmail im Postausgang").not.toBeNull();
  expect(mail!.art).toBe("zugang");

  /*
   * Deutsch, kein Gendern, kein fremder Absender — CLAUDE.md 10 und 6.1.
   * Die englische Standardvorlage ist am Satzanfang eindeutig erkennbar.
   */
  const text = mail!.body_text as string;
  expect(text).toContain("Guten Tag");
  expect(text).not.toContain("You've been invited");
  expect(text).not.toContain("Supabase");

  /*
   * Der Link muss in DIESE Anwendung führen. Vorher stand hier die
   * Verify-Adresse des Supabase-Projekts mit einem redirect_to, das aus
   * dem Dashboard kam und nicht aus dem Repo.
   */
  const treffer = text.match(/https?:\/\/[^\s]*\/einladung\?token=[^\s&]+&typ=invite/);
  expect(treffer, `Kein Einladungslink in der Mail:\n${text}`).not.toBeNull();
  expect(treffer![0]).not.toContain("supabase.co");

  zugangsUrl = treffer![0];
});

test("Mit dem Link aus der Mail vergibt der neue Mitarbeiter sein Passwort und ist drin", async ({
  page,
}) => {
  expect(zugangsUrl, "Der vorige Test hat keinen Link geliefert").not.toBe("");

  /*
   * Nur der Pfad: die Mail trägt NEXT_PUBLIC_APP_URL, der Testserver
   * läuft auf einem anderen Port. Geprüft wird der Weg, nicht die
   * Portnummer — die steht schon im Test darüber.
   */
  const pfad = zugangsUrl.slice(zugangsUrl.indexOf("/einladung"));

  await page.context().clearCookies();
  await page.goto(pfad);

  await expect(page).toHaveURL(/\/einladung\/passwort/);
  await expect(page.getByText(ADRESSE)).toBeVisible();

  await page.getByLabel("Neues Passwort").fill(PASSWORT);
  await page.getByLabel("Noch einmal").fill(PASSWORT);
  await page.getByRole("button", { name: "Passwort speichern" }).click();

  // Die Rolle entscheidet, wo es hingeht — Montage in die eigene App.
  await page.waitForURL(/\/m\/heute/, { timeout: 20_000 });

  /*
   * Und das Passwort gilt auch wirklich. Ohne diese zweite Anmeldung
   * bewiese der Test nur, dass die Sitzung aus dem Token besteht — nicht,
   * dass der Mitarbeiter morgen früh wieder hineinkommt.
   */
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("E-Mail").fill(ADRESSE);
  await page.getByLabel("Passwort").fill(PASSWORT);
  await page.getByRole("button", { name: "Anmelden" }).click();
  await page.waitForURL(/\/m\/heute/, { timeout: 20_000 });
});

test("Ein verbrauchter Link endet nicht im Nichts, sondern bei einem neuen", async ({
  page,
}) => {
  await page.context().clearCookies();
  await page.goto("/einladung?token=abgelaufen&typ=invite");

  await expect(page).toHaveURL(/\/login\?hinweis=link/);
  await expect(
    page.getByText("Der Link war nicht mehr gültig"),
  ).toBeVisible();

  await page.getByRole("link", { name: "Passwort vergessen" }).click();
  await expect(page).toHaveURL(/\/passwort-vergessen/);
});
