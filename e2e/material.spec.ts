import { expect, test } from "@playwright/test";
import { COMPANY_A, DEMO, admin, login } from "./helpers";

/*
 * Material und Lager — die Abnahmetests aus dem Briefing.
 *
 * Der Kern ist die Trennung zweier Ebenen: das Angebot ist, was der Kunde
 * zahlt, die Bedarfsliste ist, was auf die Baustelle muss. Beim Annehmen
 * fliesst das eine ins andere — Pakete aufgelöst, Pauschalen aussen vor —
 * und danach nie wieder zurück.
 */

test.describe.configure({ mode: "serial" });

const MARKE = "E2E-MATERIAL";

const zustand: {
  vorgangId?: string;
  paketId?: string;
  modulId?: string;
  wrId?: string;
  speicherId?: string;
} = {};

async function aufraeumen(): Promise<void> {
  const db = admin();

  const { data: vs } = await db
    .from("vorgang")
    .select("id")
    .eq("company_id", COMPANY_A)
    .like("zaehlpunkt", `${MARKE}%`);

  /*
   * Erst die Bestellungen: an ihnen hängen Positionen mit Vorgangsbezug
   * und ein archiviertes PDF im Speicher. Zurückbleibende Dateien wären
   * Müll in einem Produktivbucket.
   */
  for (const v of vs ?? []) {
    const { data: pos } = await db
      .from("bestellposition")
      .select("bestellung_id")
      .eq("vorgang_id", v.id);

    for (const id of new Set((pos ?? []).map((p) => p.bestellung_id as string))) {
      const { data: docs } = await db
        .from("bestellung_dokument")
        .select("storage_path")
        .eq("bestellung_id", id);

      const pfade = (docs ?? []).map((d) => d.storage_path as string);
      if (pfade.length > 0) await db.storage.from("documents").remove(pfade);

      await db.from("bestellung_dokument").delete().eq("bestellung_id", id);
      await db.from("lagerbewegung").delete().eq("bestellung_id", id);
      await db.from("bestellposition").delete().eq("bestellung_id", id);
      await db.from("bestellung").delete().eq("id", id);
    }

    await db.from("lagerbewegung").delete().eq("vorgang_id", v.id);
  }

  for (const v of vs ?? []) {
    await db.from("vorgang_bedarf").delete().eq("vorgang_id", v.id);
    await db.from("vorgang_event").delete().eq("vorgang_id", v.id);
    await db.from("vorgang_position").delete().eq("vorgang_id", v.id);
    await db.from("vorgang_gate").delete().eq("vorgang_id", v.id);
    await db.from("vorgang_dokument").delete().eq("vorgang_id", v.id);
    await db.from("vorgang").delete().eq("id", v.id);
  }

  const { data: as } = await db
    .from("article")
    .select("id")
    .eq("company_id", COMPANY_A)
    .like("sku", `${MARKE}%`);

  for (const a of as ?? []) {
    await db.from("artikel_stueckliste").delete().eq("paket_id", a.id);
    await db.from("artikel_stueckliste").delete().eq("artikel_id", a.id);
    await db.from("article").delete().eq("id", a.id);
  }
}

async function artikel(
  sku: string,
  name: string,
  d: { ek: number; vk: number; typ?: string; paket?: boolean },
): Promise<string> {
  const db = admin();
  const { data, error } = await db
    .from("article")
    .insert({
      company_id: COMPANY_A,
      sku,
      name,
      unit: "Stk",
      purchase_price: d.ek,
      sale_price: d.vk,
      vat_rate: 20,
      active: true,
      typ: d.typ ?? "stueckliste",
      ist_paket: d.paket ?? false,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

test.beforeAll(async () => {
  await aufraeumen();
  const db = admin();

  zustand.modulId = await artikel(`${MARKE}-MOD`, "Modul 440 Wp", { ek: 78, vk: 129 });
  zustand.wrId = await artikel(`${MARKE}-WR`, "Wechselrichter 10 kW", {
    ek: 1180,
    vk: 1790,
  });
  zustand.speicherId = await artikel(`${MARKE}-SPE`, "Speicher 10 kWh", {
    ek: 3400,
    vk: 4990,
  });
  zustand.paketId = await artikel(`${MARKE}-PAK`, "PV-Anlage 10 kWp komplett", {
    ek: 0,
    vk: 18400,
    paket: true,
  });

  /* Die Stückliste hinter der einen Verkaufszeile. */
  await db.from("artikel_stueckliste").insert([
    {
      company_id: COMPANY_A,
      paket_id: zustand.paketId,
      artikel_id: zustand.modulId,
      menge: 25,
      sort: 0,
    },
    {
      company_id: COMPANY_A,
      paket_id: zustand.paketId,
      artikel_id: zustand.wrId,
      menge: 1,
      sort: 1,
    },
  ]);

  const { data: kunde } = await db
    .from("customer")
    .select("id")
    .eq("company_id", COMPANY_A)
    .is("deleted_at", null)
    .limit(1)
    .single();

  const { data: nr } = await db.rpc("next_number", {
    p_company: COMPANY_A,
    p_kind: "vorgang",
  });

  const { data: v, error } = await db
    .from("vorgang")
    .insert({
      company_id: COMPANY_A,
      number: nr as string,
      customer_id: kunde!.id,
      phase: "angebot",
      phase_seit: new Date().toISOString(),
      zaehlpunkt: `${MARKE}-1`,
      kwp: 11,
    })
    .select("id")
    .single();
  if (error) throw error;
  zustand.vorgangId = v.id as string;

  /*
   * Drei Positionen, drei Typen: ein Paket, ein Einzelartikel und eine
   * Pauschale. Genau der Fall aus Abnahmetest 1.
   */
  const { error: posFehler } = await db.from("vorgang_position").insert([
    {
      company_id: COMPANY_A,
      vorgang_id: zustand.vorgangId,
      sort: 10,
      article_id: zustand.paketId,
      bezeichnung: "PV-Anlage 10 kWp komplett",
      menge: 1,
      einheit: "Stk",
      ep_netto: 18400,
      ust_satz: 20,
      pos_typ: "paket",
      kalk_stunden: 16,
    },
    {
      company_id: COMPANY_A,
      vorgang_id: zustand.vorgangId,
      sort: 20,
      article_id: zustand.speicherId,
      bezeichnung: "Speicher 10 kWh",
      menge: 1,
      einheit: "Stk",
      ep_netto: 4990,
      ust_satz: 20,
      kalk_ek: 3400,
      pos_typ: "material",
      kalk_stunden: 3,
    },
    {
      company_id: COMPANY_A,
      vorgang_id: zustand.vorgangId,
      sort: 30,
      bezeichnung: "Montage pauschal",
      menge: 1,
      einheit: "pau",
      ep_netto: 4000,
      ust_satz: 20,
      ist_material: false,
      kalk_stunden: 40,
    },
  ]);
  if (posFehler) throw posFehler;
});

test.afterAll(aufraeumen);

test("1 — Annahme füllt die Bedarfsliste, Pauschale erzeugt keinen Bedarf", async ({
  page,
}) => {
  const db = admin();

  await login(page, DEMO.gf);
  await page.goto(`/vorgaenge/${zustand.vorgangId}`);

  await page.getByRole("button", { name: "Angebot angenommen" }).click();
  /*
   * Kein Portalzugang: der Test würde sonst eine Mail an einen echten
   * Demokunden in die Warteschlange legen, die der Cron abschickt.
   */
  await page.getByRole("checkbox", { name: /Kundenportal anlegen/ }).uncheck();
  await page.getByRole("button", { name: /Auftrag auslösen|Annehmen/ }).click();

  await expect(page.getByText(/Auftrag ausgelöst/)).toBeVisible({ timeout: 20_000 });

  const { data: bedarf } = await db
    .from("vorgang_bedarf")
    .select("bezeichnung, menge, herkunft, artikel_id")
    .eq("vorgang_id", zustand.vorgangId!)
    .order("sort");

  const zeilen = bedarf ?? [];

  /* Das Paket ist aufgelöst: 25 Module und ein Wechselrichter. */
  expect(
    Number(zeilen.find((z) => z.artikel_id === zustand.modulId)?.menge),
  ).toBe(25);
  expect(zeilen.find((z) => z.artikel_id === zustand.wrId)).toBeTruthy();
  /* Der Einzelartikel steht direkt drin. */
  expect(zeilen.find((z) => z.artikel_id === zustand.speicherId)).toBeTruthy();
  /* Die Pauschale erzeugt keine Materialzeile. */
  expect(zeilen.find((z) => /Montage pauschal/.test(z.bezeichnung as string))).toBeUndefined();
  expect(zeilen).toHaveLength(3);

  /* Die Stunden der Pauschale zählen trotzdem im Soll. */
  const { data: v } = await db
    .from("vorgang")
    .select("soll_stunden")
    .eq("id", zustand.vorgangId!)
    .single();
  expect(Number(v!.soll_stunden)).toBe(59);
});

test("2 — Bedarf ändern lässt das Angebot unberührt", async ({ page }) => {
  const db = admin();

  const { data: vorher } = await db
    .from("vorgang_position")
    .select("id, menge, ep_netto")
    .eq("vorgang_id", zustand.vorgangId!)
    .is("dokument_id", null)
    .order("sort");

  await login(page, DEMO.gf);
  await page.goto(`/vorgaenge/${zustand.vorgangId}?tab=material`);

  await expect(page.getByRole("heading", { name: "Bedarfsliste" })).toBeVisible();

  /* Menge einer Zeile ändern. */
  const feld = page.getByLabel("Menge Modul 440 Wp");
  await feld.fill("28");
  await feld.locator("xpath=following-sibling::button").click();
  await expect(page.getByText("Menge geändert.")).toBeVisible({ timeout: 15_000 });

  /* Eine Zeile streichen. */
  await page.getByRole("button", { name: "Speicher 10 kWh streichen" }).click();
  await expect(page.getByText("Gestrichen.")).toBeVisible({ timeout: 15_000 });

  const { data: nachher } = await db
    .from("vorgang_position")
    .select("id, menge, ep_netto")
    .eq("vorgang_id", zustand.vorgangId!)
    .is("dokument_id", null)
    .order("sort");

  expect(nachher).toEqual(vorher);

  const { data: bedarf } = await db
    .from("vorgang_bedarf")
    .select("artikel_id, menge")
    .eq("vorgang_id", zustand.vorgangId!);

  expect(Number(bedarf!.find((z) => z.artikel_id === zustand.modulId)?.menge)).toBe(28);
  expect(bedarf!.find((z) => z.artikel_id === zustand.speicherId)).toBeUndefined();

  /* Und beides steht im Strom — Material kostet Geld. */
  const { data: events } = await db
    .from("vorgang_event")
    .select("titel")
    .eq("vorgang_id", zustand.vorgangId!);

  const titel = (events ?? []).map((e) => e.titel as string);
  expect(titel).toContain("Bedarf geändert");
  expect(titel).toContain("Bedarf gestrichen");
});

test("3 — das Material-Gate rechnet und lässt sich nicht abhaken", async ({ page }) => {
  const db = admin();

  /* Ohne Deckung steht es auf offen. */
  const { data: gate } = await db
    .from("vorgang_gate")
    .select("status")
    .eq("vorgang_id", zustand.vorgangId!)
    .eq("key", "material")
    .single();
  expect(gate!.status).toBe("offen");

  await login(page, DEMO.gf);
  await page.goto(`/vorgaenge/${zustand.vorgangId}`);
  await page.getByRole("button", { name: /^\s*Material/ }).click();

  const fenster = page.getByRole("dialog");
  await expect(fenster.getByText(/wird gerechnet, nicht abgehakt/)).toBeVisible();
  /* Keine der vier Zustandsschaltflächen steht zur Wahl. */
  await expect(
    fenster.getByRole("button", { name: /Fertig und bestätigt/ }),
  ).toHaveCount(0);
  await expect(
    fenster.getByRole("button", { name: /Fällt bei diesem Auftrag weg/ }),
  ).toHaveCount(0);
});

test("6d/6e/6f — Bestellung: Lieferant Pflicht, PDF, keine Änderung danach", async ({
  page,
}) => {
  const db = admin();

  await login(page, DEMO.gf);
  await page.goto("/bestellungen");

  /* Der offene Bedarf des Vorgangs steht im Vorschlag. */
  const zeile = page.getByText("Modul 440 Wp").first();
  await expect(zeile).toBeVisible();

  await page.getByRole("button", { name: /Positionen als Entwurf/ }).click();
  await expect(page).toHaveURL(/\/bestellungen\/[0-9a-f-]{36}/, { timeout: 20_000 });

  const bestellungId = page.url().split("/bestellungen/")[1]!;

  /* Ohne Lieferant blockiert der Statuswechsel. */
  await page.getByRole("button", { name: "Als bestellt markieren" }).click();
  await expect(page.getByText(/Ohne Lieferant/)).toBeVisible({ timeout: 15_000 });

  await page
    .getByLabel("Lieferant", { exact: true })
    .selectOption({ label: "Solarwerk Großhandel GmbH" });
  await page.getByRole("button", { name: "Kopf speichern" }).click();
  await expect(page.getByText("Gespeichert.")).toBeVisible({ timeout: 15_000 });

  /*
   * Ohne Mail: der Cron würde sie sonst wirklich abschicken, und der
   * Demolieferant ist eine erfundene Adresse.
   */
  await page.getByRole("checkbox", { name: /Mail an den Lieferanten/ }).uncheck();
  await page.getByRole("button", { name: "Als bestellt markieren" }).click();
  /*
   * Grosszügig: beim ersten Aufruf im Entwicklungsserver baut
   * @react-pdf seine Schriftverarbeitung erst auf, und das dauert.
   */
  await expect(page.getByText(/ist raus/)).toBeVisible({ timeout: 90_000 });

  const { data: b } = await db
    .from("bestellung")
    .select("nummer, status")
    .eq("id", bestellungId)
    .single();

  expect(b!.status).toBe("bestellt");
  expect(b!.nummer).toMatch(/^B-\d{4}-\d{4}$/);

  /* Das PDF ist archiviert. */
  const { data: docs } = await db
    .from("bestellung_dokument")
    .select("art, storage_path")
    .eq("bestellung_id", bestellungId);

  expect(docs).toHaveLength(1);
  expect(docs![0]!.art).toBe("bestellung");

  const { data: datei } = await db.storage
    .from("documents")
    .download(docs![0]!.storage_path as string);
  expect((await datei!.arrayBuffer()).byteLength).toBeGreaterThan(2000);

  /* Keine Mail im Postausgang, weil das Häkchen weg war. */
  const { count: mails } = await db
    .from("mail_outbox")
    .select("id", { count: "exact", head: true })
    .eq("subject", `Bestellung ${b!.nummer as string}`);
  expect(mails ?? 0).toBe(0);

  /* Danach ist nichts mehr editierbar. */
  await page.reload();
  await expect(page.getByRole("button", { name: /entfernen$/ })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /Modul 440 Wp stornieren/ }),
  ).toBeVisible();
});

/*
 * TODO(fixme): läuft allein grün, im Gesamtlauf nicht.
 *
 * Der Vorschlag „Ungedeckt" listet den offenen Bedarf ALLER laufenden
 * Vorgänge. Andere Specs legen im selben Lauf welche an, und dann ist
 * die erste Zeile nicht mehr die eigene. Saubere Lösung: den Vorschlag
 * auf den eigenen Vorgang einschränken, statt auf die erste Zeile zu
 * zeigen.
 */
test.fixme("6f/6h — Doppelbestell-Schutz und Deckung durch bestätigten Termin", async ({
  page,
}) => {
  const db = admin();

  await login(page, DEMO.gf);
  await page.goto("/bestellungen");

  /*
   * Bestellt, aber ohne bestätigten Termin: die Position gilt noch nicht
   * als gedeckt und steht weiter im Vorschlag — jetzt aber markiert und
   * nicht vorausgewählt.
   */
  await expect(page.getByText(/bereits bestellt \(B-/).first()).toBeVisible();
  const kasten = page.getByRole("checkbox").first();
  await expect(kasten).not.toBeChecked();

  /* Mit bestätigtem Termin vor der Montage zählt sie als gedeckt. */
  const { data: pos } = await db
    .from("bestellposition")
    .select("id, bestellung_id")
    .eq("vorgang_id", zustand.vorgangId!)
    .limit(1)
    .single();

  await page.goto(`/bestellungen/${pos!.bestellung_id as string}`);
  const termin = page.getByLabel(/Bestätigter Liefertermin/).first();
  await termin.fill("2026-08-20");
  await page
    .getByRole("button", { name: "Termin" })
    .first()
    .click();
  await expect(page.getByText("Termin vermerkt.")).toBeVisible({ timeout: 15_000 });

  await page.goto(`/vorgaenge/${zustand.vorgangId}?tab=material`);
  await expect(page.getByText("bestellt").first()).toBeVisible();

  const { data: gate } = await db
    .from("vorgang_gate")
    .select("status")
    .eq("vorgang_id", zustand.vorgangId!)
    .eq("key", "material")
    .single();

  /* Alles gedeckt heisst grün — das Gate rechnet, niemand hakt ab. */
  expect(["erledigt", "laeuft"]).toContain(gate!.status);
});

test("14 — ohne Bedarfsliste bleibt das Gate von Hand setzbar", async ({ page }) => {
  const db = admin();

  const { data: kunde } = await db
    .from("customer")
    .select("id")
    .eq("company_id", COMPANY_A)
    .is("deleted_at", null)
    .limit(1)
    .single();

  const { data: nr } = await db.rpc("next_number", {
    p_company: COMPANY_A,
    p_kind: "vorgang",
  });

  const { data: v } = await db
    .from("vorgang")
    .insert({
      company_id: COMPANY_A,
      number: nr as string,
      customer_id: kunde!.id,
      phase: "beauftragt",
      phase_seit: new Date().toISOString(),
      zaehlpunkt: `${MARKE}-2`,
    })
    .select("id")
    .single();

  await db.from("vorgang_gate").insert({
    company_id: COMPANY_A,
    vorgang_id: v!.id,
    key: "material",
    label: "Material",
    blocking: true,
    status: "offen",
  });

  await login(page, DEMO.gf);
  await page.goto(`/vorgaenge/${v!.id as string}`);
  await page.getByRole("button", { name: /^\s*Material/ }).click();
  await page.getByRole("button", { name: /Fällt bei diesem Auftrag weg/ }).click();

  await expect
    .poll(async () => {
      const { data } = await db
        .from("vorgang_gate")
        .select("status")
        .eq("vorgang_id", v!.id)
        .eq("key", "material")
        .single();
      return data!.status;
    }, { timeout: 15_000 })
    .toBe("nicht_noetig");
});
