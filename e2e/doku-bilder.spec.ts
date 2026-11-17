import { test } from "@playwright/test";
import { mkdirSync } from "node:fs";

/*
 * Die Bilder für die Dokumentation.
 *
 * Kein Test, sondern ein Werkzeug: Es faehrt die Bildschirme der Reihe
 * nach an und legt von jedem eine Aufnahme in docs/bilder ab.
 *
 * Warum ueber Playwright und nicht von Hand: Eine Dokumentation veraltet
 * an ihren Bildern zuerst. Ein Screenshot, den jemand einmal gemacht
 * hat, zeigt in drei Monaten eine Oberflaeche, die es nicht mehr gibt,
 * und niemand merkt es. So laeuft ein Befehl, und alle Bilder sind
 * wieder aktuell — in derselben Groesse, mit demselben Ausschnitt, ohne
 * Mauszeiger und ohne fremde Fenster im Bild.
 *
 * Ausfuehren:
 *   E2E_GF_MAIL=…  E2E_GF_PASSWORT=…  E2E_ZIELMANDANT=…  \
 *     npx playwright test e2e/doku-bilder.spec.ts
 */

const MAIL = process.env.E2E_GF_MAIL;
const PASSWORT = process.env.E2E_GF_PASSWORT;
const ORDNER = "docs/bilder";

/* Breit genug fuer die Seitenleiste plus Inhalt, ohne dass etwas umbricht. */
const BREITE = 1440;
const HOEHE = 900;

test.describe.configure({ mode: "serial" });
test.skip(!MAIL || !PASSWORT, "E2E_GF_MAIL und E2E_GF_PASSWORT nicht gesetzt");

type Aufnahme = {
  datei: string;
  pfad: string;
  /** Was vor der Aufnahme noch passieren muss. */
  vorher?: (page: import("@playwright/test").Page) => Promise<void>;
  ganzeSeite?: boolean;
};

const AUFNAHMEN: Aufnahme[] = [
  { datei: "01-anmeldung", pfad: "/login" },
  { datei: "02-einrichtung", pfad: "/einstellungen?bereich=einrichtung" },
  { datei: "03-firmendaten", pfad: "/einstellungen?bereich=firma" },
  { datei: "04-erscheinungsbild", pfad: "/einstellungen?bereich=erscheinungsbild" },
  { datei: "05-standorte", pfad: "/einstellungen?bereich=standorte" },
  { datei: "06-fahrzeuge", pfad: "/einstellungen?bereich=betriebsmittel" },
  { datei: "07-rollen", pfad: "/einstellungen?bereich=rechte" },
  { datei: "08-nummernkreise", pfad: "/einstellungen?bereich=nummernkreise" },
  { datei: "09-zeitregeln", pfad: "/einstellungen?bereich=zeit" },
  { datei: "10-planer-stammdaten", pfad: "/einstellungen?bereich=planer" },
  { datei: "11-integrationen", pfad: "/einstellungen?bereich=integrationen" },
  { datei: "12-daten-mitnehmen", pfad: "/einstellungen?bereich=daten" },
  { datei: "13-mitarbeiter", pfad: "/mitarbeiter" },
  {
    datei: "14-mitarbeiter-anlegen",
    pfad: "/mitarbeiter",
    vorher: async (page) => {
      await page.getByRole("button", { name: "Mitarbeiter anlegen" }).click();
      await page.waitForTimeout(600);
    },
  },
  { datei: "15-cockpit", pfad: "/cockpit" },
  { datei: "16-vorgaenge", pfad: "/vorgaenge" },
  { datei: "17-planung", pfad: "/planung" },
  { datei: "18-planer", pfad: "/planer" },
  { datei: "19-material", pfad: "/material" },
  { datei: "20-bestand", pfad: "/material/bestand" },
  { datei: "21-service", pfad: "/service" },
  { datei: "22-zeiten", pfad: "/zeiten" },
  { datei: "23-abwesenheiten", pfad: "/abwesenheiten" },
  { datei: "24-offene-posten", pfad: "/offene-posten" },
  { datei: "25-monteur-heute", pfad: "/m/heute" },
];

test("Bilder für die Dokumentation erzeugen", async ({ browser }) => {
  test.setTimeout(240_000);
  mkdirSync(ORDNER, { recursive: true });

  const kontext = await browser.newContext({
    viewport: { width: BREITE, height: HOEHE },
    deviceScaleFactor: 2,
    locale: "de-AT",
    timezoneId: "Europe/Vienna",
    colorScheme: "light",
  });
  const page = await kontext.newPage();

  /*
   * Erst das leere Anmeldefenster aufnehmen, danach anmelden — sonst
   * leitet die Seite weiter und das Bild zeigt das Cockpit.
   */
  await page.goto("/login");
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${ORDNER}/01-anmeldung.png` });

  await page.getByLabel("E-Mail").fill(MAIL!);
  await page.getByLabel("Passwort").fill(PASSWORT!);
  await page.getByRole("button", { name: "Anmelden" }).click();
  await page.waitForURL(/\/cockpit/, { timeout: 30_000 });

  for (const a of AUFNAHMEN.slice(1)) {
    await page.goto(a.pfad);
    /*
     * Kurz warten statt auf networkidle: Die Seiten laden Zahlen nach,
     * und die KPI-Werte zaehlen beim Erscheinen hoch (Abschnitt 9). Ein
     * Bild mitten im Hochzaehlen zeigt falsche Zahlen.
     */
    await page.waitForTimeout(1600);
    if (a.vorher) await a.vorher(page);
    await page.screenshot({
      path: `${ORDNER}/${a.datei}.png`,
      fullPage: a.ganzeSeite ?? false,
    });
    console.log(`  ${a.datei}.png`);
  }

  /* Die Monteur-App in Telefonbreite, so wie sie benutzt wird. */
  const telefon = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    locale: "de-AT",
    timezoneId: "Europe/Vienna",
    colorScheme: "light",
    storageState: await kontext.storageState(),
  });
  const handy = await telefon.newPage();
  for (const [datei, pfad] of [
    ["26-handy-heute", "/m/heute"],
    ["27-handy-stempeln", "/m/stempeln"],
    ["28-handy-material", "/m/material"],
  ] as const) {
    await handy.goto(pfad);
    await handy.waitForTimeout(1500);
    await handy.screenshot({ path: `${ORDNER}/${datei}.png` });
    console.log(`  ${datei}.png`);
  }

  await telefon.close();
  await kontext.close();
});
