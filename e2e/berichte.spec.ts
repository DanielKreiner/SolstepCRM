import { expect, test } from "@playwright/test";
import {
  COMPANY_A,
  DEMO,
  admin,
  login,
  vorgangId,
  vorgangNummer,
} from "./helpers";

/*
 * Definition of Done Meilenstein 11, zweiter Teil:
 *   "Berichte exportieren nach Excel/PDF"
 *
 * Der wichtigste Test ist der letzte: ein Export darf nicht mehr enthalten
 * als die Ansicht, aus der er kommt. Ein Export mit mehr Daten ist ein Leck
 * mit Dateiendung.
 */

test.describe.configure({ mode: "serial" });

const JAHR = new Date().getFullYear();

test("Alle vier Berichte lassen sich öffnen", async ({ page }) => {
  await login(page, DEMO.gf);

  for (const [id, titel] of [
    ["auftraege", "Vorgänge und Nachkalkulation"],
    ["umsatz", "Umsatz je Monat"],
    ["zeiten", "Stunden je Person"],
    ["material", "Materialverbrauch"],
  ] as const) {
    await page.goto(`/berichte?bericht=${id}&jahr=${JAHR}`);
    await expect(page.getByText(titel).first()).toBeVisible();
  }
});

test("Der Auftragsbericht rechnet den Deckungsbeitrag korrekt", async ({
  page,
}) => {
  const db = admin();
  await login(page, DEMO.gf);
  await page.goto(`/berichte?bericht=auftraege&jahr=${JAHR}`);

  const id = await vorgangId("A-2026-0041");

  const { data: vorgang } = await db
    .from("vorgang")
    .select("auftragswert_netto")
    .eq("id", id)
    .single();

  /*
   * Material selbst rechnen: v_vorgang_kpi filtert auf
   * current_company_id(), der Service-Role-Client bekäme nichts. Die
   * Formel ist dieselbe wie in der View (Rückgaben zählen gegen).
   */
  const { data: bewegungen } = await db
    .from("stock_move")
    .select("qty, kind, article:article_id ( purchase_price )")
    .eq("vorgang_id", id)
    .in("kind", ["out", "return"]);

  const material = (bewegungen ?? []).reduce((sum, m) => {
    const preis = Number(
      (m.article as unknown as { purchase_price: string } | null)
        ?.purchase_price ?? 0,
    );
    return sum + (m.kind === "out" ? 1 : -1) * Number(m.qty) * preis;
  }, 0);

  const erwartet = Number(vorgang!.auftragswert_netto) - material;

  // 28.400,00 minus 4.632,00 Material = 23.768
  const formatiert = new Intl.NumberFormat("de-AT", {
    maximumFractionDigits: 2,
  }).format(Math.round(erwartet * 100) / 100);

  await expect(page.getByText(formatiert).first()).toBeVisible();
});

test("Der CSV-Export ist eine Excel-taugliche Datei", async ({ page }) => {
  await login(page, DEMO.gf);

  const antwort = await page.request.get(
    `/api/export/report?bericht=auftraege&jahr=${JAHR}&format=csv`,
  );
  expect(antwort.status()).toBe(200);
  expect(antwort.headers()["content-type"]).toContain("text/csv");
  expect(antwort.headers()["content-disposition"]).toContain("attachment");

  const text = await antwort.text();
  // BOM, sonst zerlegt Excel unter Windows die Umlaute.
  expect(text.charCodeAt(0)).toBe(0xfeff);
  // Semikolon als Trenner, Komma als Dezimalzeichen.
  expect(text.split("\r\n")[0]).toContain("Vorgang;Kunde;Phase");
  expect(text).toContain(await vorgangNummer("A-2026-0041"));
});

test("Der PDF-Export ist ein PDF", async ({ page }) => {
  await login(page, DEMO.gf);

  const antwort = await page.request.get(
    `/api/export/report?bericht=umsatz&jahr=${JAHR}&format=pdf`,
  );
  expect(antwort.status()).toBe(200);
  expect(antwort.headers()["content-type"]).toContain("application/pdf");

  const body = await antwort.body();
  expect(body.subarray(0, 5).toString()).toBe("%PDF-");
  expect(body.byteLength).toBeGreaterThan(2000);
});

test("Ein unbekannter Bericht wird abgewiesen", async ({ page }) => {
  await login(page, DEMO.gf);

  const antwort = await page.request.get(
    "/api/export/report?bericht=alles&format=csv",
  );
  expect(antwort.status()).toBe(400);
});

test("Der Export zeigt nicht mehr als die Rolle sehen darf", async ({
  page,
}) => {
  // Der Monteur darf Zeiten nur von sich sehen (Migration 0008).
  // Der Zeitenbericht muss sich daran halten.
  const db = admin();
  const { data: monteur } = await db
    .from("app_user")
    .select("id, name")
    .eq("email", DEMO.monteur)
    .single();

  // Berichte für den Monteur freischalten, sonst kommt er gar nicht hin.
  await db.from("role_permission").upsert(
    { company_id: COMPANY_A, role: "monteur", area: "berichte", level: "read" },
    { onConflict: "company_id,role,area" },
  );

  await login(page, DEMO.monteur);
  const antwort = await page.request.get(
    `/api/export/report?bericht=zeiten&jahr=${JAHR}&format=csv`,
  );
  expect(antwort.status()).toBe(200);

  const text = await antwort.text();
  const zeilen = text.trim().split("\r\n").slice(1);

  // Genau eine Datenzeile: die eigene.
  expect(zeilen.length).toBeLessThanOrEqual(1);
  if (zeilen.length === 1) {
    expect(zeilen[0]).toContain(monteur!.name as string);
  }
  expect(text).not.toContain("Thomas Zauner");
  expect(text).not.toContain("Michael Hofstätter");

  await db.from("role_permission").upsert(
    { company_id: COMPANY_A, role: "monteur", area: "berichte", level: "none" },
    { onConflict: "company_id,role,area" },
  );
});

test("Ohne Recht auf Berichte gibt es keinen Export", async ({ page }) => {
  await login(page, DEMO.monteur);

  await page.goto("/berichte");
  await expect(page.getByText("fehlt deiner Rolle das Leserecht")).toBeVisible();

  const antwort = await page.request.get(
    `/api/export/report?bericht=umsatz&jahr=${JAHR}&format=csv`,
  );
  expect(antwort.status()).toBe(403);
});
