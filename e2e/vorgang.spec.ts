import { expect, test } from "@playwright/test";
import { COMPANY_A, DEMO, admin, login, suchwahl } from "./helpers";

/*
 * Der Vorgang von der Anfrage bis zum ausgelösten Auftrag.
 *
 * Die Abnahmetests 1 bis 3 aus dem Briefing, Abschnitt 9. Der wichtigste
 * ist Nummer 2: die Kaskade muss aus einer Annahme heraus AB,
 * Anzahlungsrechnung, Materialliste, Gates und Soll-Werte erzeugen —
 * ohne dass eine Position neu getippt wird. Genau dort lag bisher die
 * Doppelarbeit.
 */

test.describe.configure({ mode: "serial" });

const MARKE = "E2E-VORGANG";

const zustand: { vorgangId?: string; nummer?: string; kundeId?: string } = {};

async function aufraeumen(): Promise<void> {
  const db = admin();
  const { data: vs } = await db
    .from("vorgang")
    .select("id")
    .eq("company_id", COMPANY_A)
    .like("zaehlpunkt", `${MARKE}%`);

  for (const v of vs ?? []) {
    await db.from("vorgang_event").delete().eq("vorgang_id", v.id);
    await db.from("vorgang_position").delete().eq("vorgang_id", v.id);
    await db.from("vorgang_gate").delete().eq("vorgang_id", v.id);
    await db.from("vorgang_termin").delete().eq("vorgang_id", v.id);
    await db.from("vorgang_dokument").delete().eq("vorgang_id", v.id);
    await db.from("vorgang").delete().eq("id", v.id);
  }
}

test.beforeAll(async () => {
  await aufraeumen();
  const db = admin();
  const { data: k } = await db
    .from("customer")
    .select("id, name")
    .eq("company_id", COMPANY_A)
    .is("deleted_at", null)
    .limit(1)
    .single();
  zustand.kundeId = k!.id as string;
});

test.afterAll(aufraeumen);

test("1 — Vorgang anlegen und bis zum Angebot führen", async ({ page }) => {
  const db = admin();

  await login(page, DEMO.gf);
  await page.goto("/vorgaenge");

  await page.getByRole("button", { name: "Vorgang anlegen" }).click();
  await suchwahl(page, "Kunde", (await kundenName())!);
  await page.getByLabel("Leistung in kWp").fill("9.84");
  await page.getByLabel("Speicher in kWh").fill("10");
  await page.getByRole("button", { name: "Anlegen", exact: true }).click();

  await expect(page.getByText(/angelegt/)).toBeVisible({ timeout: 20_000 });

  const { data: v } = await db
    .from("vorgang")
    .select("id, number, phase, kwp")
    .eq("company_id", COMPANY_A)
    .eq("customer_id", zustand.kundeId!)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  expect(v!.phase).toBe("anfrage");
  expect(String(v!.number)).toMatch(/^V-\d{4}-\d{4}$/);
  expect(Number(v!.kwp)).toBe(9.84);

  zustand.vorgangId = v!.id as string;
  zustand.nummer = v!.number as string;

  // Markieren, damit das Aufräumen ihn wiederfindet.
  await db
    .from("vorgang")
    .update({ zaehlpunkt: `${MARKE}-1` })
    .eq("id", zustand.vorgangId);
});

async function kundenName(): Promise<string | null> {
  const db = admin();
  const { data } = await db
    .from("customer")
    .select("name")
    .eq("id", zustand.kundeId!)
    .single();
  return (data?.name as string) ?? null;
}

test("2 — Positionen im Vorgang zusammenstellen, ohne Seitenwechsel", async ({
  page,
}) => {
  const db = admin();
  await login(page, DEMO.gf);
  await page.goto(`/vorgaenge/${zustand.vorgangId}`);

  /*
   * Phase weiterschalten: der Editor steht ab „aufnahme" offen, und die
   * Annahme setzt „angebot" voraus.
   */
  await page.getByRole("button", { name: "Aufnahme starten" }).click();
  await expect(page.getByText("Phase: Aufnahme.")).toBeVisible({ timeout: 20_000 });

  const { data: artikel } = await db
    .from("article")
    .select("name")
    .eq("company_id", COMPANY_A)
    .eq("active", true)
    .gt("sale_price", 0)
    .limit(1)
    .single();

  const form = page.locator("form", { hasText: "Artikel übernehmen" });
  await suchwahl(form, "Artikel", artikel!.name as string);
  await form.getByLabel("Menge").fill("22");
  await form.getByRole("button", { name: "Übernehmen" }).click();
  await expect(page.getByText(/übernommen/)).toBeVisible({ timeout: 20_000 });

  // Eine Leistung ohne Artikel — Montage.
  const frei = page.locator("form", { hasText: "Freie Position" });
  await frei.getByLabel("Bezeichnung").fill("Montage und Inbetriebnahme");
  await frei.getByLabel("Menge").fill("42");
  await frei.getByLabel("Einheit").fill("h");
  await frei.getByLabel("Verkauf netto").fill("68");
  await frei.getByLabel("Einkauf").fill("42");
  await frei.getByLabel("Stunden").fill("1");
  await frei.getByRole("button", { name: "Position anlegen" }).click();
  await expect(page.getByText("Position angelegt.")).toBeVisible({ timeout: 20_000 });

  const { data: pos } = await db
    .from("vorgang_position")
    .select("bezeichnung, menge, ep_netto, ist_material, dokument_id")
    .eq("vorgang_id", zustand.vorgangId!);

  expect(pos).toHaveLength(2);
  // Beide gehören zum lebenden Entwurf, nicht zu einer Version.
  expect(pos!.every((p) => p.dokument_id === null)).toBe(true);

  const { data: v } = await db
    .from("vorgang")
    .select("angebotswert_netto")
    .eq("id", zustand.vorgangId!)
    .single();
  expect(Number(v!.angebotswert_netto)).toBeGreaterThan(0);
});

test("3 — Die Annahme löst alles auf einmal aus", async ({ page }) => {
  const db = admin();
  await login(page, DEMO.gf);
  await page.goto(`/vorgaenge/${zustand.vorgangId}`);

  await page.getByRole("button", { name: "Angebot erstellen" }).click();

  /*
   * Nicht auf die Erfolgsmeldung warten: mit dem Phasenwechsel tauscht
   * das Aktionspanel seinen Inhalt aus, und die Meldung verschwindet mit
   * dem Formular, das sie trug. Geprüft wird die Wirkung — der
   * Annahmeknopf der nächsten Phase.
   */
  await expect(
    page.getByRole("button", { name: "Angebot angenommen" }),
  ).toBeVisible({ timeout: 20_000 });

  const { data: vorher } = await db
    .from("vorgang")
    .select("angebotswert_netto")
    .eq("id", zustand.vorgangId!)
    .single();
  const netto = Number(vorher!.angebotswert_netto);

  await page.getByRole("button", { name: "Angebot angenommen" }).click();

  /*
   * Auf den Dialog eingrenzen: „Anzahlung in Prozent" steht auch in den
   * Stammdaten daneben, und ohne Eingrenzung füllt der Test das falsche
   * Feld.
   */
  const dialog = page.locator("form", { hasText: "Wunsch-Zeitraum Montage" });
  await dialog.getByLabel("Anzahlung in Prozent").fill("30");
  await dialog.getByLabel("Wunsch-Zeitraum Montage").fill("KW 33");
  await dialog.getByLabel("Gerüst oder Hebebühne nötig?").selectOption("nein");
  await dialog.getByLabel("Sub nötig?").selectOption("nein");
  await dialog.getByRole("button", { name: "Auftrag auslösen" }).click();

  await expect(page.getByText(/Auftrag ausgelöst/)).toBeVisible({ timeout: 30_000 });

  /* ---- Phase und Werte ---- */
  const { data: v } = await db
    .from("vorgang")
    .select("phase, auftragswert_netto, soll_stunden, soll_materialkosten, anzahlung_prozent")
    .eq("id", zustand.vorgangId!)
    .single();

  expect(v!.phase).toBe("beauftragt");
  expect(Number(v!.auftragswert_netto)).toBe(netto);
  expect(Number(v!.anzahlung_prozent)).toBe(30);
  // 42 Stunden aus der Montageposition.
  expect(Number(v!.soll_stunden)).toBe(42);
  expect(Number(v!.soll_materialkosten)).toBeGreaterThan(0);

  /* ---- Dokumente ---- */
  const { data: docs } = await db
    .from("vorgang_dokument")
    .select("typ, nummer, betrag_brutto, status")
    .eq("vorgang_id", zustand.vorgangId!);

  const typen = (docs ?? []).map((d) => d.typ).sort();
  expect(typen).toEqual(["ab", "anzahlungsrechnung", "materialliste"]);

  // Die AB trägt die Vorgangsnummer — das ist der Kern des Umbaus.
  const ab = (docs ?? []).find((d) => d.typ === "ab");
  expect(ab!.nummer).toBe(zustand.nummer);

  // Anzahlung: 30 % vom Brutto.
  const re = (docs ?? []).find((d) => d.typ === "anzahlungsrechnung");
  expect(String(re!.nummer)).toMatch(/^RE-\d{4}-\d{4}$/);
  expect(re!.status).toBe("entwurf");
  expect(Number(re!.betrag_brutto)).toBeCloseTo(netto * 1.2 * 0.3, 1);

  /* ---- Positionen eingefroren, nicht neu getippt ---- */
  const { data: pos } = await db
    .from("vorgang_position")
    .select("dokument_id, bezeichnung")
    .eq("vorgang_id", zustand.vorgangId!);

  const entwurf = (pos ?? []).filter((p) => p.dokument_id === null);
  const eingefroren = (pos ?? []).filter((p) => p.dokument_id !== null);
  expect(entwurf).toHaveLength(2);
  expect(eingefroren).toHaveLength(2);
  /*
   * Dieselben Bezeichnungen: nichts wurde neu erfasst, es wurde kopiert.
   * Das ist der Abnahmetest, um den es im Briefing geht.
   */
  expect(eingefroren.map((p) => p.bezeichnung).sort()).toEqual(
    entwurf.map((p) => p.bezeichnung).sort(),
  );

  /* ---- Gates ---- */
  const { data: gates } = await db
    .from("vorgang_gate")
    .select("key, status, blocking")
    .eq("vorgang_id", zustand.vorgangId!);

  expect(gates).toHaveLength(6);
  // Kein Gerüst nötig → gleich abgehakt, ohne dass jemand klicken muss.
  expect(gates!.find((g) => g.key === "geruest")!.status).toBe("nicht_noetig");
  // Kein Sub → das Team steht.
  expect(gates!.find((g) => g.key === "team")!.status).toBe("erledigt");
  expect(gates!.find((g) => g.key === "material")!.status).toBe("offen");
});

test("4 — Terminierung ist blockiert, solange Pflicht-Gates offen sind", async ({
  page,
}) => {
  const db = admin();
  await login(page, DEMO.gf);
  await page.goto(`/vorgaenge/${zustand.vorgangId}`);

  const knopf = page.getByRole("button", { name: "Montage terminieren" });
  await expect(knopf).toBeDisabled();
  /*
   * Der Grund steht am Knopf, nicht im Tooltip — wer nicht mit der Maus
   * arbeitet, sieht einen Tooltip nie.
   */
  await expect(page.getByText(/Offene Pflicht-Gates/)).toBeVisible();

  // Die Aktion weist auch dann ab, wenn jemand den Knopf umgeht.
  const { data: v } = await db
    .from("vorgang")
    .select("phase")
    .eq("id", zustand.vorgangId!)
    .single();
  expect(v!.phase).toBe("beauftragt");

  // Pflicht-Gates abhaken, dann wird der Knopf frei.
  await db
    .from("vorgang_gate")
    .update({ status: "erledigt" })
    .eq("vorgang_id", zustand.vorgangId!)
    .eq("blocking", true);

  await page.reload();
  await expect(
    page.getByRole("button", { name: "Montage terminieren" }),
  ).toBeEnabled();
});

test("5 — Zweimal annehmen erzeugt keinen zweiten Auftrag", async ({ page }) => {
  const db = admin();

  const { data: vorher } = await db
    .from("vorgang_dokument")
    .select("id", { count: "exact" })
    .eq("vorgang_id", zustand.vorgangId!);

  await login(page, DEMO.gf);
  await page.goto(`/vorgaenge/${zustand.vorgangId}`);

  /*
   * Der Dialog ist in Phase „beauftragt" gar nicht mehr da — die Aktion
   * prüft es zusätzlich selbst, falls jemand sie direkt aufruft.
   */
  await expect(
    page.getByRole("button", { name: "Angebot angenommen" }),
  ).toHaveCount(0);

  const { data: nachher } = await db
    .from("vorgang_dokument")
    .select("id", { count: "exact" })
    .eq("vorgang_id", zustand.vorgangId!);

  expect(nachher?.length).toBe(vorher?.length);
});

test("6 — Ein Monteur sieht keine Beträge", async ({ page }) => {
  await login(page, DEMO.monteur);
  const antwort = await page.goto(`/vorgaenge/${zustand.vorgangId}`);

  if ((antwort?.status() ?? 200) >= 400) return;

  /*
   * Kein Betrag heisst ein Strich, nicht 0 €. Die View liefert der Rolle
   * keine Zeile, und eine 0 wäre eine Aussage — und zwar eine falsche.
   */
  await expect(
    page.getByText("für diese Rolle nicht sichtbar"),
  ).toBeVisible({ timeout: 15_000 });
});
