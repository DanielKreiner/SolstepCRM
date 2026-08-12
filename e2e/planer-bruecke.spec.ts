import { expect, test } from "@playwright/test";
import { admin, COMPANY_A, DEMO, login } from "./helpers";

/*
 * Vorgang → Planung → Angebot (Wunsch vom 13.08.2026).
 *
 * Der Weg lief bisher nur in eine Richtung: Aus einer fertigen Planung
 * liess sich ein Vorgang machen. Wer im Vorgang sass und die Anlage
 * erst plante, musste die Verbindung von Hand herstellen — sie entstand
 * dabei gar nicht, und die Geräte tippte jemand ein zweites Mal ins
 * Angebot.
 */

async function aufraeumen() {
  const db = admin();
  const { data } = await db
    .from("vorgang")
    .select("id")
    .eq("company_id", COMPANY_A)
    .eq("adresse", "Brückenweg 5");
  for (const v of data ?? []) {
    await db.from("planer_projekt").delete().eq("vorgang_id", v.id as string);
    await db.from("vorgang_position").delete().eq("vorgang_id", v.id as string);
    await db.from("vorgang").delete().eq("id", v.id as string);
  }
  await db.from("customer").delete().eq("company_id", COMPANY_A).eq("name", "Brückenkunde");
}

test.beforeEach(aufraeumen);
test.afterAll(aufraeumen);

test.describe("Vorgang — Planung und Angebot", () => {
  test("Planung im Vorgang anlegen und ihre Geräte ins Angebot holen", async ({ page }) => {
    const db = admin();

    const { data: kunde } = await db
      .from("customer")
      .insert({ company_id: COMPANY_A, name: "Brückenkunde", type: "customer" })
      .select("id")
      .single();

    const { data: vorgang } = await db
      .from("vorgang")
      .insert({
        company_id: COMPANY_A,
        customer_id: kunde!.id,
        number: `V-BR-${Date.now().toString().slice(-6)}`,
        phase: "angebot",
        adresse: "Brückenweg 5",
        plz: "4020",
        ort: "Linz",
      })
      .select("id")
      .single();

    await login(page, DEMO.gf);
    // Die Planung steht im Angebotsreiter — dort kommt ihr Nutzen an.
    await page.goto(`/vorgaenge/${vorgang!.id}?tab=angebot`);

    /* ── Ohne Planung: der Vorgang bietet sie an, zwingt aber nicht ── */
    /*
     * Auf die Karte im Angebotsreiter eingegrenzt: „Planung öffnen"
     * steht auch im Seitenkopf, damit man von jedem Reiter dorthin
     * kommt.
     */
    const karte = page.locator("section", { has: page.getByRole("heading", { name: "Planung", exact: true }) });
    await expect(karte).toBeVisible();
    await expect(page.getByText(/Für einen Tausch oder eine Reparatur/)).toBeVisible();

    await karte.getByRole("button", { name: "Planung anlegen" }).click();

    /* ── Danach hängt sie am Vorgang, in beide Richtungen ────────── */
    await expect
      .poll(
        async () => {
          const { data } = await db
            .from("planer_projekt")
            .select("id")
            .eq("vorgang_id", vorgang!.id)
            .maybeSingle();
          return data?.id ?? null;
        },
        { timeout: 20_000 },
      )
      .not.toBeNull();

    const { data: projekt } = await db
      .from("planer_projekt")
      .select("id")
      .eq("vorgang_id", vorgang!.id)
      .single();

    await expect(karte.getByRole("link", { name: "Planung öffnen" })).toBeVisible();

    /* ── Eine Planung mit Modul und Wechselrichter hinterlegen ───── */
    const { data: modul } = await db
      .from("planer_modul")
      .select("id, artikel_id")
      .not("artikel_id", "is", null)
      .limit(1)
      .maybeSingle();
    const { data: wr } = await db
      .from("planer_wechselrichter")
      .select("id, artikel_id")
      .not("artikel_id", "is", null)
      .limit(1)
      .maybeSingle();
    test.skip(!modul || !wr, "Im Stamm liegt kein Gerät mit Artikelbezug.");

    await db
      .from("planer_projekt")
      .update({
        plan: {
          version: 1,
          flaechen: [
            {
              id: "f1",
              name: "Fläche 1",
              punkte: [
                { x: -7, y: -4.5 },
                { x: 7, y: -4.5 },
                { x: 7, y: 4.5 },
                { x: -7, y: 4.5 },
              ],
              neigung: 30,
              azimut: 180,
              traufe: 0,
              randabstand: 0.3,
              hindernisse: [],
            },
          ],
          gruppen: [
            {
              id: "g1",
              name: "Feld 1",
              flaeche: "f1",
              typ: { breite: 1.134, hoehe: 1.762, wp: 440, bezeichnung: "Modul" },
              ausrichtung: "hoch",
              reihenabstand: 0.02,
              spaltenabstand: 0.02,
              winkel: 0,
              anker: { x: -6.5, y: -4 },
              spalten: 4,
              reihen: 2,
              aufstaenderung: null,
              aus: [],
              entfernt: [],
              frei: {},
            },
          ],
          strings: [],
          technik: { modul: modul!.id, wechselrichter: wr!.id, speicher: null },
        },
      })
      .eq("id", projekt!.id);

    /* ── Geräte ins Angebot ──────────────────────────────────────── */
    await page.goto(`/vorgaenge/${vorgang!.id}?tab=angebot`);
    await page.getByRole("button", { name: "Geräte ins Angebot übernehmen" }).click();

    await expect
      .poll(
        async () => {
          const { data } = await db
            .from("vorgang_position")
            .select("id")
            .eq("vorgang_id", vorgang!.id);
          return data?.length ?? 0;
        },
        { timeout: 20_000 },
      )
      .toBeGreaterThan(1);

    const { data: positionen } = await db
      .from("vorgang_position")
      .select("bezeichnung, menge, ep_netto, article_id")
      .eq("vorgang_id", vorgang!.id);

    /*
     * Acht Module aus der Belegung, ein Wechselrichter — und der Preis
     * kommt aus dem Artikelstamm, nicht aus der Planung. Ein Angebot
     * mit 0 € wäre schlimmer als gar keines.
     */
    const modulzeile = (positionen ?? []).find((p) => Number(p.menge) === 8);
    expect(modulzeile, "Modulposition mit acht Stück").toBeTruthy();
    expect(Number(modulzeile!.ep_netto), "Preis aus dem Artikelstamm").toBeGreaterThan(0);
    expect(modulzeile!.article_id, "mit Artikelbezug").not.toBeNull();

    /* ── Zweiter Klick legt nichts doppelt an ────────────────────── */
    const vorher = (positionen ?? []).length;
    await page.getByRole("button", { name: "Geräte ins Angebot übernehmen" }).click();
    await expect(page.getByText(/stehen schon im Angebot|standen schon drin/)).toBeVisible();
    const { data: nachher } = await db
      .from("vorgang_position")
      .select("id")
      .eq("vorgang_id", vorgang!.id);
    expect(nachher?.length ?? 0).toBe(vorher);
  });
});
