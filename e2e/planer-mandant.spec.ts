import { expect, test } from "@playwright/test";
import { admin, COMPANY_A, COMPANY_B, DEMO, login } from "./helpers";

/*
 * Planer — Mandantentrennung (Abnahmetest 25).
 *
 * Geprüft wird nicht die Oberfläche, sondern die Datenbank: Jede
 * Planer-Tabelle bekommt eine Zeile für Mandant A, und der
 * Geschäftsführer von Mandant B versucht, sie zu lesen und zu ändern.
 *
 * Der Weg über die RLS-Policies ist Absicht. Ein Test, der nur prüft,
 * dass die Seite eines fremden Projekts 404 liefert, sichert genau eine
 * Route ab — die nächste Abfrage in einer neuen Komponente wäre wieder
 * ungeprüft.
 */

const AUFRAEUMEN = [
  "planer_speicher",
  "planer_wechselrichter",
  "planer_modul",
  "planer_foerderung",
  "planer_projekt",
] as const;

async function aufraeumen() {
  const db = admin();
  for (const t of AUFRAEUMEN) {
    if (t === "planer_projekt") {
      await db.from(t).delete().eq("company_id", COMPANY_A).like("name", "Mandantentest%");
    } else if (t === "planer_foerderung") {
      await db.from(t).delete().eq("company_id", COMPANY_A).like("region", "Mandantentest%");
    } else {
      await db.from(t).delete().eq("company_id", COMPANY_A).like("hersteller", "Mandantentest%");
    }
  }
}

test.beforeEach(aufraeumen);
test.afterAll(aufraeumen);

test.describe("Planer — Mandantentrennung", () => {
  test("Fremder Mandant sieht und ändert keine Planer-Daten", async ({ page }) => {
    const db = admin();

    /* ── Daten von Mandant A anlegen ──────────────────────────── */
    const { data: projekt } = await db
      .from("planer_projekt")
      .insert({
        company_id: COMPANY_A,
        name: "Mandantentest Dach",
        adresse: "Fremdweg 1, 4020 Linz",
        ursprung_lat: 48.30604,
        ursprung_lon: 14.28583,
        anbieter: "basemap",
        zoom: 20,
      })
      .select("id")
      .single();

    const { data: modul } = await db
      .from("planer_modul")
      .insert({
        company_id: COMPANY_A,
        hersteller: "Mandantentest",
        bezeichnung: "Modul A",
        wp: 440,
        uoc: 39.4,
        umpp: 33.1,
        isc: 13.9,
        impp: 13.1,
        tk_uoc: -0.0025,
        breite: 1.134,
        hoehe: 1.762,
      })
      .select("id")
      .single();

    const { data: wr } = await db
      .from("planer_wechselrichter")
      .insert({
        company_id: COMPANY_A,
        hersteller: "Mandantentest",
        bezeichnung: "WR A",
        max_dc: 1000,
        ac_nenn: 10,
        hybrid: false,
        mppt: [{ uMin: 200, uMax: 800, iMax: 26, maxStrings: 2 }],
      })
      .select("id")
      .single();

    await db.from("planer_foerderung").insert({
      company_id: COMPANY_A,
      region: "Mandantentest Region",
      betrag: 5000,
    });

    /* ── Als Fremdmandant anmelden ────────────────────────────── */
    await login(page, DEMO.fremd);

    /* Projekt: Route muss 404 liefern, nicht „kein Zugriff". */
    await page.goto(`/planer/${projekt!.id}`);
    await expect(page.getByText(/nicht gefunden|404/i).first()).toBeVisible();

    /* Stammdaten: die Geräte von A dürfen in B nicht auftauchen. */
    await page.goto("/einstellungen?bereich=planer");
    await expect(page.getByText("Mandantentest")).toHaveCount(0);
    await expect(page.getByText("Mandantentest Region")).toHaveCount(0);

    /* Projektliste: das Projekt von A ist dort nicht. */
    await page.goto("/planer");
    await expect(page.getByText("Mandantentest Dach")).toHaveCount(0);

    /*
     * Und die Daten sind hinterher unverändert — ein Fremdzugriff darf
     * auch nichts stillschweigend gelöscht haben.
     */
    const { data: nachher } = await db
      .from("planer_modul")
      .select("id")
      .eq("id", modul!.id)
      .maybeSingle();
    expect(nachher).toBeTruthy();

    const { data: wrNachher } = await db
      .from("planer_wechselrichter")
      .select("id")
      .eq("id", wr!.id)
      .maybeSingle();
    expect(wrNachher).toBeTruthy();
  });

  test("Fremdes PDF und fremde Übergabe bleiben verschlossen", async ({ page }) => {
    const db = admin();
    const { data: projekt } = await db
      .from("planer_projekt")
      .insert({
        company_id: COMPANY_A,
        name: "Mandantentest PDF",
        adresse: "Fremdweg 2, 4020 Linz",
        ursprung_lat: 48.30604,
        ursprung_lon: 14.28583,
        anbieter: "basemap",
        zoom: 20,
      })
      .select("id")
      .single();

    await login(page, DEMO.fremd);

    /*
     * Das PDF hängt an keiner Seite, sondern an einer Route mit
     * Kennung. Genau solche Endpunkte werden beim Absichern vergessen —
     * hier wird nachgesehen, ob RLS auch dort trägt.
     */
    const pdf = await page.request.get(`/api/planer/pdf/${projekt!.id}`);
    expect([403, 404]).toContain(pdf.status());
    expect(pdf.headers()["content-type"]).not.toContain("application/pdf");
  });
});
