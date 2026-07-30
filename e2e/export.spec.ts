import { unzipSync, strFromU8 } from "fflate";
import { expect, test } from "@playwright/test";
import { COMPANY_A, DEMO, admin, login } from "./helpers";

/*
 * Selfservice-Export (CLAUDE.md 12.a "Exit").
 *
 * Zwei Dinge müssen stimmen, sonst ist der Export wertlos oder gefährlich:
 * er muss vollständig sein, und er darf keine Geheimnisse enthalten.
 */

test.describe.configure({ mode: "serial" });

test("Nur die Geschäftsführung darf exportieren", async ({ page }) => {
  for (const rolle of [DEMO.bauleitung, DEMO.lager, DEMO.monteur]) {
    // Cookies leeren: sonst leitet /login beim zweiten Durchlauf sofort
    // aufs Cockpit weiter, und das Formular fehlt.
    await page.context().clearCookies();
    await login(page, rolle);
    const antwort = await page.request.get("/api/export/tenant");
    expect(antwort.status(), rolle).toBe(403);
    const koerper = await antwort.json();
    expect(String(koerper.error)).toContain("Geschäftsführung");
  }
});

test("Der Export ist ein lesbares ZIP mit allen Tabellen", async ({ page }) => {
  await login(page, DEMO.gf);

  const antwort = await page.request.get("/api/export/tenant");
  expect(antwort.status()).toBe(200);
  expect(antwort.headers()["content-type"]).toContain("application/zip");
  expect(antwort.headers()["content-disposition"]).toContain("export-");

  const archiv = unzipSync(new Uint8Array(await antwort.body()));
  const namen = Object.keys(archiv);

  // Erklärung liegt bei.
  expect(namen).toContain("LIESMICH.txt");
  const liesmich = strFromU8(archiv["LIESMICH.txt"]!);
  expect(liesmich).toContain("Hofstätter");
  expect(liesmich).toContain("Trennzeichen Semikolon");

  // Die zentralen Tabellen sind dabei.
  for (const t of [
    "company",
    "customer",
    "job",
    "time_entry",
    "invoice",
    "article",
    "stock_move",
  ]) {
    expect(namen, `${t} fehlt`).toContain(`daten/${t}.csv`);
  }
});

test("Der Export enthält die tatsächlichen Daten", async ({ page }) => {
  await login(page, DEMO.gf);
  const antwort = await page.request.get("/api/export/tenant");
  const archiv = unzipSync(new Uint8Array(await antwort.body()));

  const { count: auftraege } = await admin()
    .from("job")
    .select("id", { count: "exact", head: true })
    .eq("company_id", COMPANY_A);

  const roh = archiv["daten/job.csv"]!;
  const csv = strFromU8(roh);
  const zeilen = csv.trim().split("\r\n");
  // Kopfzeile plus eine Zeile je Auftrag.
  expect(zeilen.length - 1).toBe(auftraege ?? 0);
  expect(csv).toContain("A-2026-0041");

  /*
   * BOM an den Rohbytes prüfen, nicht am dekodierten String: TextDecoder
   * entfernt ihn beim Dekodieren. Der BOM muss aber in der Datei stehen,
   * sonst zerlegt Excel unter Windows die Umlaute.
   */
  expect([roh[0], roh[1], roh[2]]).toEqual([0xef, 0xbb, 0xbf]);
});

test("Der Export enthält keine Daten des Fremdmandanten", async ({ page }) => {
  await login(page, DEMO.gf);
  const antwort = await page.request.get("/api/export/tenant");
  const archiv = unzipSync(new Uint8Array(await antwort.body()));

  const alles = Object.entries(archiv)
    .filter(([name]) => name.endsWith(".csv"))
    .map(([, inhalt]) => strFromU8(inhalt))
    .join("\n");

  expect(alles).not.toContain("Zweitbetrieb Solar");
  expect(alles).not.toContain("Musterkunde Süd");
  expect(alles).not.toContain("22222222-2222-4222-8222-222222222222");
});

test("Der Export enthält keine Geheimnisse", async ({ page }) => {
  const db = admin();

  // Ein Postfach mit verschlüsselten Zugangsdaten und ein Portalzugang.
  await db
    .from("mail_account")
    .update({ secret_enc: Buffer.from("nicht-exportieren").toString("hex") })
    .eq("company_id", COMPANY_A);

  await login(page, DEMO.gf);
  const antwort = await page.request.get("/api/export/tenant");
  const archiv = unzipSync(new Uint8Array(await antwort.body()));

  const namen = Object.keys(archiv);
  // Weder Postfachzugänge noch Portaltokens sind überhaupt im Export.
  expect(namen).not.toContain("daten/mail_account.csv");
  expect(namen).not.toContain("daten/portal_access.csv");

  const alles = Object.entries(archiv)
    .filter(([name]) => name.endsWith(".csv"))
    .map(([, inhalt]) => strFromU8(inhalt))
    .join("\n");

  expect(alles).not.toContain("secret_enc");
  expect(alles).not.toContain("token_hash");
});

test("Zwei Exporte liefern denselben Datenstand", async ({ page }) => {
  /*
   * Nicht das ganze Archiv vergleichen: LIESMICH.txt trägt den
   * Erstellungszeitpunkt, und das soll es auch. Verglichen wird, worauf es
   * ankommt — die Datendateien müssen bei unverändertem Bestand Byte für
   * Byte gleich sein. Sonst wäre nicht nachvollziehbar, ob sich zwischen
   * zwei Exporten etwas geändert hat.
   */
  await login(page, DEMO.gf);

  const a = unzipSync(
    new Uint8Array(await (await page.request.get("/api/export/tenant")).body()),
  );
  const b = unzipSync(
    new Uint8Array(await (await page.request.get("/api/export/tenant")).body()),
  );

  const daten = (archiv: Record<string, Uint8Array>) =>
    Object.keys(archiv)
      .filter((n) => n.startsWith("daten/"))
      .sort();

  expect(daten(a)).toEqual(daten(b));

  for (const name of daten(a)) {
    expect(
      Buffer.compare(Buffer.from(a[name]!), Buffer.from(b[name]!)),
      `${name} unterscheidet sich`,
    ).toBe(0);
  }
});
