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

/*
 * Die drei Phasen-Tests sind entfallen.
 *
 * Der Bereich "Einstellungen → Phasen" wurde auf Wunsch gestrichen: der
 * Vorgang führt seine Phasen als Enum, und die einzige Pipeline mit
 * editierbaren Phasen war der Service. Damit gibt es keine Oberfläche
 * mehr, die pipeline_phase pflegt — pflegbare Phasen je Mandant
 * (CLAUDE.md 5.1a) sind aktuell nicht umgesetzt. Tabelle und Regeln
 * (system_key steuert Automatiken, Systemphasen sind nicht löschbar)
 * stehen unverändert in der Datenbank, falls der Bereich zurückkommt.
 */

test("Ohne Schreibrecht sind die Einstellungen nur lesbar", async ({ page }) => {
  await login(page, DEMO.bauleitung);

  // Rechte und Standorte liegen seit der Unternavigation in getrennten
  // Bereichen — die Sperre muss in beiden greifen, nicht nur im ersten.
  await page.goto("/einstellungen?bereich=rechte");
  await expect(page.getByText("sehen, aber nicht ändern")).toBeVisible();
  await expect(page.getByLabel("rechnungen für gf")).toBeDisabled();

  await page.goto("/einstellungen?bereich=standorte");
  await expect(page.getByText("sehen, aber nicht ändern")).toBeVisible();
});

test("Die Unternavigation führt in jeden Bereich", async ({ page }) => {
  await login(page, DEMO.gf);

  for (const [bereich, ueberschrift] of [
    ["rechte", "Rollen und Rechte"],
    ["standorte", "Standorte und Arbeitszeitregeln"],
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
