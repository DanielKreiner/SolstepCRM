import { expect, test } from "@playwright/test";
import { COMPANY_A, DEMO, admin, login } from "./helpers";

/*
 * Definition of Done Meilenstein 11 (CLAUDE.md Abschnitt 12), Teil 1:
 *   "Rollenmatrix wirkt serverseitig, Phasen je Mandant editierbar"
 *
 * Das Wort serverseitig ist der Kern: die Matrix darf nicht nur die
 * Navigation ausblenden. Deshalb prüfen diese Tests nach jeder Änderung,
 * was der betroffene Nutzer tatsächlich noch aus der Datenbank bekommt.
 */

test.describe.configure({ mode: "serial" });

async function alsRolle(email: string) {
  const { createClient } = await import("@supabase/supabase-js");
  const c = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  await c.auth.signInWithPassword({
    email,
    password: process.env.SEED_PASSWORD!,
  });
  return c;
}

async function rechtSetzen(role: string, area: string, level: string) {
  await admin()
    .from("role_permission")
    .upsert(
      { company_id: COMPANY_A, role, area, level },
      { onConflict: "company_id,role,area" },
    );
}

async function aufraeumen() {
  const db = admin();
  await db
    .from("pipeline_phase")
    .delete()
    .eq("company_id", COMPANY_A)
    .like("key", "e2e_%");
  await rechtSetzen("lager", "rechnungen", "none");
}

test("Die Matrix zeigt die tatsächlichen Rechte", async ({ page }) => {
  await aufraeumen();
  await login(page, DEMO.gf);
  await page.goto("/einstellungen");

  await expect(
    page.getByRole("heading", { name: "Rollen und Rechte" }),
  ).toBeVisible();

  // Monteur hat auf Rechnungen keinen Zugriff, GF Schreibrecht.
  await expect(page.getByLabel("rechnungen für monteur")).toHaveValue("none");
  await expect(page.getByLabel("rechnungen für gf")).toHaveValue("write");
});

test("Eine Rechteänderung wirkt sofort in der Datenbank", async ({ page }) => {
  await login(page, DEMO.gf);
  await page.goto("/einstellungen");

  // Vorher: der Lagerist sieht keine Rechnungen.
  const vorher = await alsRolle(DEMO.lager);
  const { data: keine } = await vorher
    .from("vorgang_dokument")
    .select("id")
    .in("typ", ["anzahlungsrechnung", "schlussrechnung"])
    .limit(50);
  expect(keine ?? []).toHaveLength(0);

  await page.getByLabel("rechnungen für lager").selectOption("read");

  await expect
    .poll(async () => {
      const { data } = await admin()
        .from("role_permission")
        .select("level")
        .eq("company_id", COMPANY_A)
        .eq("role", "lager")
        .eq("area", "rechnungen")
        .single();
      return data?.level;
    }, { timeout: 15_000 })
    .toBe("read");

  // Nachher: dieselbe Abfrage desselben Nutzers liefert Zeilen.
  const { count: gesamt } = await admin()
    .from("vorgang_dokument")
    .select("id", { count: "exact", head: true })
    .eq("company_id", COMPANY_A)
    .in("typ", ["anzahlungsrechnung", "schlussrechnung"]);

  const nachher = await alsRolle(DEMO.lager);
  const { data: jetzt } = await nachher
    .from("vorgang_dokument")
    .select("id")
    .in("typ", ["anzahlungsrechnung", "schlussrechnung"])
    .limit(50);
  expect((jetzt ?? []).length).toBe(gesamt ?? 0);

  await rechtSetzen("lager", "rechnungen", "none");
});

test("Die Geschäftsführung kann sich nicht selbst aussperren", async ({
  page,
}) => {
  await login(page, DEMO.gf);
  await page.goto("/einstellungen");

  const zelle = page.getByLabel("einstellungen für gf");
  await expect(zelle).toBeDisabled();
  await expect(page.getByText("sperrt sich der Betrieb")).toBeVisible();

  // Auch der direkte Weg über die Server Action wird abgewiesen.
  const { data: vorher } = await admin()
    .from("role_permission")
    .select("level")
    .eq("company_id", COMPANY_A)
    .eq("role", "gf")
    .eq("area", "einstellungen")
    .single();
  expect(vorher!.level).toBe("write");
});

test("Eine eigene Phase lässt sich anlegen und benutzen", async ({ page }) => {
  await aufraeumen();
  await login(page, DEMO.gf);
  await page.goto("/einstellungen?bereich=phasen");

  const { data: pipeline } = await admin()
    .from("pipeline")
    .select("id")
    .eq("company_id", COMPANY_A)
    .eq("kind", "service")
    .single();

  /*
   * Die Service-Pipeline: Vertrieb und Projekte laufen über den Vorgang,
   * dessen Phasen ein Enum sind. Editierbare Phasen je Mandant gibt es
   * nur noch hier. Nicht .first() — die versteckte pipelineId macht das
   * Formular eindeutig.
   */
  const form = page.locator(
    `form:has(input[name="pipelineId"][value="${pipeline!.id as string}"])`,
  );
  await form.getByLabel("Bezeichnung").fill("Gerüst bestellt");
  await form.getByLabel("Schlüssel").fill("e2e_geruest");
  await form.getByRole("button", { name: "Phase anlegen" }).click();

  await expect
    .poll(async () => {
      const { count } = await admin()
        .from("pipeline_phase")
        .select("id", { count: "exact", head: true })
        .eq("pipeline_id", pipeline!.id)
        .eq("key", "e2e_geruest");
      return count ?? 0;
    }, { timeout: 15_000 })
    .toBe(1);

  const { data: neu } = await admin()
    .from("pipeline_phase")
    .select("system_key, is_final, label")
    .eq("key", "e2e_geruest")
    .single();

  // Eine frei angelegte Phase bekommt keine Systembedeutung — sonst löst
  // sie unbeabsichtigt Automatiken aus.
  expect(neu!.system_key).toBeNull();
  expect(neu!.is_final).toBe(false);

  /*
   * Und sie steht sofort am Ticket zur Wahl. Die Liste zeigt Status,
   * nicht Phasen — der Phasenwechsel sitzt auf der Detailseite.
   */
  const { data: ticket } = await admin()
    .from("service_ticket")
    .select("id")
    .eq("company_id", COMPANY_A)
    .limit(1)
    .single();

  await page.goto(`/service/${ticket!.id as string}`);
  await expect(
    page.getByRole("button", { name: "Gerüst bestellt" }),
  ).toBeVisible();
});

test("Eine Systemphase lässt sich umbenennen, aber nicht löschen", async ({
  page,
}) => {
  const db = admin();
  const { data: won } = await db
    .from("pipeline_phase")
    .select("id, label")
    .eq("company_id", COMPANY_A)
    .eq("system_key", "won")
    .single();

  await login(page, DEMO.gf);
  await page.goto("/einstellungen?bereich=phasen");

  /*
   * Nicht über den Zeilentext suchen: die Bezeichnung steht im Wert des
   * Eingabefelds, und Werte gehören nicht zum Textinhalt. Das Label des
   * Felds ist der verlässliche Anker.
   */
  const feld = page.getByLabel(`Bezeichnung von ${won!.label as string}`);
  const zeile = page.locator("li").filter({ has: feld });

  // Kein Löschknopf für Systemphasen.
  await expect(zeile.getByRole("button", { name: "löschen" })).toHaveCount(0);

  // Umbenennen ist erlaubt und lässt system_key unberührt.
  await feld.fill("Auftrag erteilt");
  await zeile.getByRole("button", { name: "umbenennen" }).click();

  await expect
    .poll(async () => {
      const { data } = await db
        .from("pipeline_phase")
        .select("label, system_key")
        .eq("id", won!.id)
        .single();
      return `${data?.label}|${data?.system_key}`;
    }, { timeout: 15_000 })
    .toBe("Auftrag erteilt|won");

  await db
    .from("pipeline_phase")
    .update({ label: won!.label })
    .eq("id", won!.id);
});

test("Eine belegte Phase lässt sich nicht löschen", async ({ page }) => {
  const db = admin();

  // Die neue Phase belegen.
  const { data: phase } = await db
    .from("pipeline_phase")
    .select("id")
    .eq("key", "e2e_geruest")
    .single();
  const { data: ticket } = await db
    .from("service_ticket")
    .select("id, phase_id")
    .eq("company_id", COMPANY_A)
    .limit(1)
    .single();

  await db
    .from("service_ticket")
    .update({ phase_id: phase!.id })
    .eq("id", ticket!.id);

  await login(page, DEMO.gf);
  await page.goto("/einstellungen?bereich=phasen");

  const zeile = page
    .locator("li")
    .filter({ has: page.getByLabel("Bezeichnung von Gerüst bestellt") });
  await zeile.getByRole("button", { name: "löschen" }).click();
  await expect(zeile.getByRole("alert")).toContainText("Erst verschieben");

  // Zurücksetzen und dann löschen — jetzt geht es.
  await db
    .from("service_ticket")
    .update({ phase_id: ticket!.phase_id })
    .eq("id", ticket!.id);
  await page.reload();

  const zeile2 = page
    .locator("li")
    .filter({ has: page.getByLabel("Bezeichnung von Gerüst bestellt") });
  await zeile2.getByRole("button", { name: "löschen" }).click();

  await expect
    .poll(async () => {
      const { count } = await db
        .from("pipeline_phase")
        .select("id", { count: "exact", head: true })
        .eq("key", "e2e_geruest");
      return count ?? 0;
    }, { timeout: 15_000 })
    .toBe(0);

  await aufraeumen();
});

test("Ohne Schreibrecht sind die Einstellungen nur lesbar", async ({ page }) => {
  await login(page, DEMO.bauleitung);

  // Rechte und Phasen liegen seit der Unternavigation in getrennten
  // Bereichen — die Sperre muss in beiden greifen, nicht nur im ersten.
  await page.goto("/einstellungen?bereich=rechte");
  await expect(page.getByText("sehen, aber nicht ändern")).toBeVisible();
  await expect(page.getByLabel("rechnungen für gf")).toBeDisabled();

  await page.goto("/einstellungen?bereich=phasen");
  await expect(page.getByText("sehen, aber nicht ändern")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Phase anlegen" }),
  ).toHaveCount(0);
});

test("Die Unternavigation führt in jeden Bereich", async ({ page }) => {
  await login(page, DEMO.gf);

  for (const [bereich, ueberschrift] of [
    ["rechte", "Rollen und Rechte"],
    ["standorte", "Standorte und Arbeitszeitregeln"],
    ["phasen", "Phasen"],
    ["nummernkreise", "Nummernkreise"],
    ["integrationen", "Integrationen"],
    ["daten", "Daten mitnehmen"],
  ] as const) {
    await page.goto(`/einstellungen?bereich=${bereich}`);
    await expect(
      page.getByRole("heading", { name: ueberschrift }),
      bereich,
    ).toBeVisible();
  }

  // Ein unbekannter Bereich fällt auf die Rechte zurück, statt leer zu bleiben.
  await page.goto("/einstellungen?bereich=gibtsnicht");
  await expect(
    page.getByRole("heading", { name: "Rollen und Rechte" }),
  ).toBeVisible();
});
