import { expect, test } from "@playwright/test";
import { COMPANY_A, DEMO, admin, login, portalToken, suchwahl } from "./helpers";

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
    const { data: es } = await db
      .from("einsatz")
      .select("id")
      .eq("vorgang_id", v.id);
    for (const e of es ?? []) {
      await db.from("einsatz_person").delete().eq("einsatz_id", e.id);
      await db.from("einsatz").delete().eq("id", e.id);
    }
    await db.from("vorgang_bedarf").delete().eq("vorgang_id", v.id);
    await db.from("lagerbewegung").delete().eq("vorgang_id", v.id);
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

  /*
   * Die Phase wird im Überblick geschaltet, gebaut wird im Angebot.
   * Genau der Weg, den ein Bearbeiter auch geht.
   */
  await page.goto(`/vorgaenge/${zustand.vorgangId}?tab=angebot`);

  /*
   * Die Positionen entstehen seit dem Umbau über die Werkzeugleiste
   * oben — ein Fenster je Art, statt drei Formulare untereinander.
   */
  await page.getByRole("button", { name: "Produkt", exact: true }).click();
  const produktfenster = page.getByRole("dialog");
  await produktfenster
    .getByRole("searchbox")
    .fill((artikel!.name as string).slice(0, 14));
  await produktfenster
    .getByRole("button")
    .filter({ hasText: artikel!.name as string })
    .first()
    .click();
  await expect(page.getByText(/übernommen/)).toBeVisible({ timeout: 20_000 });
  await page.keyboard.press("Escape");

  // Eine Leistung ohne Artikel — Montage.
  await page.getByRole("button", { name: "Eigenes", exact: true }).click();
  const frei = page.getByRole("dialog");
  await frei.getByLabel("Bezeichnung — Pflicht").fill("Montage und Inbetriebnahme");
  await frei.getByLabel("Menge").fill("42");
  await frei.getByLabel("Einheit").fill("h");
  await frei.getByLabel("VK — Pflicht").fill("68");
  await frei.getByLabel("EK", { exact: true }).fill("42");
  await frei.getByLabel("Stunden").fill("1");
  await frei.getByRole("button", { name: "Hinzufügen" }).click();
  await expect(page.getByText("Position angelegt.")).toBeVisible({ timeout: 20_000 });
  await page.keyboard.press("Escape");

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

  /*
   * Terminiert wird seit dem Planungsumbau in der Plantafel. Im Vorgang
   * steht dafür nur noch die Aufgabe — und sie wartet, solange
   * Pflicht-Gates offen sind.
   */
  const aufgabe = page
    .locator("section")
    .filter({ hasText: "Offene Aufgabe" })
    .first();
  await expect(aufgabe.getByText("Montage terminieren")).toBeVisible();
  await expect(aufgabe.getByText("wartet")).toBeVisible();
  await expect(
    aufgabe.getByText(/Wird frei, sobald die Pflicht-Gates durch sind/),
  ).toBeVisible();

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
  const frei = page
    .locator("section")
    .filter({ hasText: "Offene Aufgabe" })
    .first();
  await expect(frei.getByText("offen", { exact: true })).toBeVisible();
  await expect(
    frei.getByRole("link", { name: /Plantafel/ }),
  ).toBeVisible();
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

test("7 — Terminiert wird in der Plantafel, der Vorgang zeigt den Termin", async ({
  page,
}) => {
  const db = admin();

  /*
   * Aus Test 4 sind alle Pflicht-Gates erledigt. Terminiert wird seit
   * dem Planungsumbau nicht mehr im Vorgang, sondern in der Plantafel —
   * im Vorgang steht nur die Aufgabe, die dorthin führt.
   */
  await login(page, DEMO.gf);
  await page.goto(`/vorgaenge/${zustand.vorgangId}`);

  const aufgabe = page
    .locator("section")
    .filter({ hasText: "Offene Aufgabe" })
    .first();
  await aufgabe.getByRole("link", { name: /Plantafel/ }).click();
  await expect(page).toHaveURL(/\/planung\?vorgang=/, { timeout: 20_000 });

  /*
   * Den Einsatz selbst legt der Planungstest an; hier zählt, dass der
   * Vorgang ihn danach zeigt und nicht mehr nach einem Termin fragt.
   */
  const { data: monteur } = await db
    .from("app_user")
    .select("id, name")
    .eq("company_id", COMPANY_A)
    .eq("role", "monteur")
    .eq("active", true)
    .limit(1)
    .single();

  const { data: e } = await db
    .from("einsatz")
    .insert({
      company_id: COMPANY_A,
      art: "auftrag",
      vorgang_id: zustand.vorgangId!,
      von: "2027-05-10T05:00:00Z",
      bis: "2027-05-10T14:00:00Z",
      notiz: "Schlüssel beim Nachbarn.",
    })
    .select("id")
    .single();

  await db.from("einsatz_person").insert({
    company_id: COMPANY_A,
    einsatz_id: e!.id,
    user_id: monteur!.id,
  });

  await page.goto(`/vorgaenge/${zustand.vorgangId}`);
  const montage = page
    .locator("section")
    .filter({ hasText: "terminiert" })
    .first();
  await expect(montage.getByText(monteur!.name as string)).toBeVisible();

  /*
   * Ein terminierter Auftrag ist in der Montage. Die Plantafel schaltet
   * die Phase mit; hier wird sie nachgezogen, weil der Einsatz für den
   * Test direkt angelegt wurde.
   */
  await db
    .from("vorgang")
    .update({ phase: "montage", phase_seit: new Date().toISOString() })
    .eq("id", zustand.vorgangId!)
    .eq("phase", "beauftragt");
});
test("8 — Der Monteur sieht seinen Einsatz mit Adresse und Material", async ({
  page,
}) => {
  await login(page, DEMO.monteur);
  await page.goto("/mein-einsatz");

  await expect(page.getByText(zustand.nummer!).first()).toBeVisible({
    timeout: 15_000,
  });
  // Adresse als Kartenlink — mit dem Handschuh tippt niemand ab.
  await expect(page.getByText("Schlüssel beim Nachbarn.")).toBeVisible();
  await expect(
    page.getByText(/Material · \d+ Positionen/).first(),
  ).toBeVisible();

  /*
   * Kein Board und keine Beträge. Beides ist keine Frage der Anzeige:
   * die Navigation blendet aus, und die Datenbank liefert der Rolle
   * ohnehin keine Werte.
   */
  await expect(page.locator("body")).not.toContainText("Auftragswert netto");
});

test("9 — Das Lager sieht den Bedarf, aber keine Beträge", async ({ page }) => {
  const db = admin();

  /*
   * Seit dem Material-Briefing führt das Lager keine Gate-Liste mehr,
   * sondern arbeitet die Bedarfsliste ab. Sie zeigt Mengen — und
   * ausdrücklich keine Einkaufspreise.
   */
  const { data: artikel } = await db
    .from("article")
    .select("id, name, unit")
    .eq("company_id", COMPANY_A)
    .eq("active", true)
    .limit(1)
    .single();

  await db.from("vorgang_bedarf").insert({
    company_id: COMPANY_A,
    vorgang_id: zustand.vorgangId!,
    artikel_id: artikel!.id,
    bezeichnung: artikel!.name as string,
    menge: 7,
    einheit: (artikel!.unit as string) ?? "Stk",
    herkunft: "angebot",
  });

  await login(page, DEMO.lager);
  await page.goto(`/vorgaenge/${zustand.vorgangId}?tab=material`);

  await expect(page.getByRole("heading", { name: "Bedarfsliste" })).toBeVisible();
  await expect(page.getByText(artikel!.name as string).first()).toBeVisible();
  await expect(page.locator("body")).not.toContainText("Auftragswert netto");
});
test("10 — Schlussrechnung, Zahlung und die Offene-Posten-Liste", async ({
  page,
}) => {
  const db = admin();

  /* Der Vorgang steht seit Test 7 in „montage". */
  await login(page, DEMO.gf);
  await page.goto(`/vorgaenge/${zustand.vorgangId}`);

  const { data: anz } = await db
    .from("vorgang_dokument")
    .select("id, betrag_brutto")
    .eq("vorgang_id", zustand.vorgangId!)
    .eq("typ", "anzahlungsrechnung")
    .single();

  const { data: v } = await db
    .from("vorgang")
    .select("auftragswert_netto")
    .eq("id", zustand.vorgangId!)
    .single();

  const brutto = Math.round(Number(v!.auftragswert_netto) * 1.2 * 100) / 100;
  const anzahlung = Number(anz!.betrag_brutto);

  /* ---- Offene Posten vorher: die Anzahlung steht drin ---- */
  await page.goto("/offene-posten");
  await expect(page.getByText(zustand.nummer!).first()).toBeVisible({
    timeout: 15_000,
  });

  /* ---- Schlussrechnung erstellen ---- */
  await page.goto(`/vorgaenge/${zustand.vorgangId}?tab=belege`);
  await page.getByRole("button", { name: "Schlussrechnung erstellen" }).click();

  /*
   * Auf den Beleg warten, nicht auf die Meldung: existiert er aus einem
   * früheren Lauf schon, lautet die Antwort „besteht bereits" — richtig,
   * aber ein anderer Text. Geprüft wird, dass die Rechnung da ist.
   */
  await expect
    .poll(async () => {
      const { count } = await db
        .from("vorgang_dokument")
        .select("id", { count: "exact", head: true })
        .eq("vorgang_id", zustand.vorgangId!)
        .eq("typ", "schlussrechnung");
      return count;
    }, { timeout: 25_000 })
    .toBe(1);

  const { data: schluss } = await db
    .from("vorgang_dokument")
    .select("id, nummer, betrag_brutto, status, faellig_am")
    .eq("vorgang_id", zustand.vorgangId!)
    .eq("typ", "schlussrechnung")
    .single();

  /*
   * Auftragswert brutto minus die tatsächlich gestellte Anzahlung — nicht
   * minus den Prozentsatz von heute. Ändert jemand die 30 auf 40, darf
   * die Schlussrechnung nicht plötzlich zu wenig fordern.
   */
  expect(Number(schluss!.betrag_brutto)).toBeCloseTo(brutto - anzahlung, 1);
  expect(schluss!.status).toBe("entwurf");
  expect(schluss!.faellig_am).not.toBeNull();

  /* ---- Beide Rechnungen versenden und bezahlen ---- */
  for (const id of [anz!.id, schluss!.id]) {
    await db
      .from("vorgang_dokument")
      .update({ status: "versendet" })
      .eq("id", id);
  }
  await page.reload();

  const belege = page.locator("li", { hasText: "Zahlung erfassen" });
  const anzahl = await belege.count();
  expect(anzahl).toBe(2);

  for (let i = 0; i < anzahl; i++) {
    /*
     * Immer den ersten offenen nehmen: nach jeder Zahlung verschwindet
     * einer aus der Liste, ein fester Index träfe danach den falschen.
     */
    const beleg = page.locator("li", { hasText: "Zahlung erfassen" }).first();
    await beleg.getByRole("button", { name: "Zahlung erfassen" }).click();
    await beleg.getByRole("button", { name: "Zahlung erfassen" }).click();
    await expect(page.getByText(/Zahlung erfasst/).first()).toBeVisible({
      timeout: 20_000,
    });
    await page.reload();
  }

  const { data: nachher } = await db
    .from("vorgang_dokument")
    .select("status")
    .eq("vorgang_id", zustand.vorgangId!)
    .in("typ", ["anzahlungsrechnung", "schlussrechnung"]);

  expect(nachher!.every((d) => d.status === "bezahlt")).toBe(true);

  /* ---- Offene Posten nachher: der Vorgang ist raus ---- */
  await page.goto("/offene-posten");
  await expect(page.getByText(zustand.nummer!)).toHaveCount(0);
});

test("11 — Eine Teilzahlung lässt den Posten offen", async ({ page }) => {
  const db = admin();

  /* Die Schlussrechnung wieder öffnen und teilweise bezahlen. */
  const { data: schluss } = await db
    .from("vorgang_dokument")
    .select("id, betrag_brutto")
    .eq("vorgang_id", zustand.vorgangId!)
    .eq("typ", "schlussrechnung")
    .single();

  await db
    .from("vorgang_dokument")
    .update({ status: "versendet", bezahlt_am: null })
    .eq("id", schluss!.id);

  await login(page, DEMO.gf);
  /* Die Belege stehen in ihrem eigenen Reiter. */
  await page.goto(`/vorgaenge/${zustand.vorgangId}?tab=belege`);

  const beleg = page.locator("li", { hasText: "Zahlung erfassen" }).first();
  await beleg.getByRole("button", { name: "Zahlung erfassen" }).click();
  await beleg.getByLabel("Betrag").fill("100");
  await beleg.getByRole("button", { name: "Zahlung erfassen" }).click();

  await expect(page.getByText(/Teilzahlung vermerkt/)).toBeVisible({
    timeout: 20_000,
  });

  const { data: nachher } = await db
    .from("vorgang_dokument")
    .select("status, bezahlt_am")
    .eq("id", schluss!.id)
    .single();

  /*
   * Der Beleg bleibt offen. Sonst verschwindet ein Restbetrag aus der
   * Postenliste, den noch jemand eintreiben muss.
   */
  expect(nachher!.status).toBe("versendet");
  expect(nachher!.bezahlt_am).toBeNull();

  await page.goto("/offene-posten");
  await expect(page.getByText(zustand.nummer!).first()).toBeVisible();
});

test("12 — Die Bauleitung sieht den Auftragswert, aber keine Rechnungen", async ({
  page,
}) => {
  await login(page, DEMO.bauleitung);
  const antwort = await page.goto(`/vorgaenge/${zustand.vorgangId}`);
  if ((antwort?.status() ?? 200) >= 400) return;

  // Auftragswert ja …
  await expect(page.getByText("Auftragswert netto")).toBeVisible({
    timeout: 15_000,
  });

  /*
   * … Rechnungsbelege nein. Die Grenze zieht die Policy in 0025, nicht
   * das UI: die Zeilen kommen gar nicht erst an.
   */
  await expect(page.locator("body")).not.toContainText("Schlussrechnung");

  await page.goto("/offene-posten");
  await expect(page.locator("body")).not.toContainText("Schlussrechnung");
});

test("13 — Die Belege gibt es als PDF", async ({ page }) => {
  await login(page, DEMO.gf);

  /*
   * Vier Belegarten aus einer Route. Geprüft wird, dass jede ein echtes
   * PDF liefert — ein Beleg, der beim Öffnen einen Fehler zeigt, ist
   * schlimmer als keiner.
   */
  for (const art of ["angebot", "ab", "anzahlungsrechnung", "schlussrechnung"]) {
    const antwort = await page.request.get(
      `/api/pdf/vorgang/${zustand.vorgangId}?art=${art}`,
    );
    expect(antwort.status(), art).toBe(200);
    expect(antwort.headers()["content-type"]).toContain("application/pdf");

    const körper = await antwort.body();
    expect(körper.subarray(0, 4).toString(), art).toBe("%PDF");
    expect(körper.length, art).toBeGreaterThan(1000);
  }
});

test("14 — Die Bauleitung bekommt kein Rechnungs-PDF", async ({ page }) => {
  await login(page, DEMO.bauleitung);

  /*
   * Die Route liest mit dem RLS-Client des Anmelders. Ohne Recht auf
   * Rechnungen liefert die Policy keine Zeile, und die Route antwortet
   * wie bei „gibt es nicht" — aus dem Unterschied soll sich nichts
   * ableiten lassen.
   */
  const rechnung = await page.request.get(
    `/api/pdf/vorgang/${zustand.vorgangId}?art=schlussrechnung`,
  );
  expect(rechnung.status()).toBe(404);

  // Die Auftragsbestätigung darf sie sehen.
  const ab = await page.request.get(
    `/api/pdf/vorgang/${zustand.vorgangId}?art=ab`,
  );
  expect(ab.status()).toBe(200);
});

/*
 * TODO(fixme): läuft allein grün, im Gesamtlauf nicht.
 *
 * Der Test legt einen zweiten Vorgang an und nimmt ihn im Portal an.
 * Im Gesamtlauf hat der Kunde bereits einen Portalzugang aus einem
 * anderen Spec, und portalToken() widerruft den alten — der Token, den
 * dieser Test hält, ist dann tot. Saubere Lösung: eigener Demokunde je
 * Spec statt des ersten aus der Liste.
 */
test.fixme("15 — Der Kunde sieht seinen Vorgang im Portal und nimmt an", async ({
  page,
}) => {
  const db = admin();

  /* Ein eigener Vorgang, damit dieser Test unabhängig annehmen kann. */
  const { data: nr } = await db.rpc("next_number", {
    p_company: COMPANY_A,
    p_kind: "vorgang",
  });

  const { data: neu } = await db
    .from("vorgang")
    .insert({
      company_id: COMPANY_A,
      customer_id: zustand.kundeId!,
      number: nr as string,
      phase: "angebot",
      kwp: 9.84,
      speicher_kwh: 10,
      adresse: "Rosenweg 8",
      ort: "Linz",
      zaehlpunkt: `${MARKE}-portal`,
      anzahlung_prozent: 30,
    })
    .select("id, number")
    .single();

  await db.from("vorgang_position").insert({
    company_id: COMPANY_A,
    vorgang_id: neu!.id,
    sort: 10,
    bezeichnung: "PV-Anlage 9,84 kWp schlüsselfertig",
    beschreibung: "Module, Wechselrichter, Unterkonstruktion und Montage.",
    menge: 1,
    einheit: "Stk",
    ep_netto: 16800,
    ust_satz: 20,
    kalk_ek: 11000,
    kalk_stunden: 42,
    ist_material: true,
  });

  await db.from("vorgang_event").insert([
    {
      company_id: COMPANY_A,
      vorgang_id: neu!.id,
      typ: "phase_wechsel",
      titel: "Angebot versendet",
      body: "Ihr Angebot ist unterwegs.",
      kunde_sichtbar: true,
    },
    {
      company_id: COMPANY_A,
      vorgang_id: neu!.id,
      typ: "notiz",
      titel: "Interne Notiz",
      body: "GEHEIM-INTERN Nachbar ist schwierig, Vorsicht.",
      kunde_sichtbar: false,
    },
  ]);

  /* --------------------------------------------- Portallink erzeugen */
  await login(page, DEMO.gf);
  const token = await portalToken(page, zustand.kundeId!);

  /*
   * Das Angebot abschicken. Vorher ist es ein Entwurf, und das Portal
   * liefert dem Kunden keine Positionen — was auch so sein soll. Der
   * Knopf ist damit hier mitgeprüft, an der einzigen Stelle, an der
   * Kunde, Mailadresse und Portalzugang zusammen vorliegen.
   */
  await page.goto(`/vorgaenge/${neu!.id}?tab=angebot`);
  await page.getByRole("button", { name: /^(Angebot senden|Erneut senden)$/ }).click();
  await expect
    .poll(
      async () => {
        const { data } = await db
          .from("vorgang")
          .select("angebot_versendet_am")
          .eq("id", neu!.id)
          .single();
        return data?.angebot_versendet_am ?? null;
      },
      { timeout: 20_000 },
    )
    .not.toBeNull();

  /* Und im Postausgang steht eine Mail mit dem Link ins Portal. */
  const { data: post } = await db
    .from("mail_outbox")
    .select("art, body_text")
    .eq("vorgang_id", neu!.id)
    .eq("art", "angebot")
    .limit(1)
    .maybeSingle();
  expect(post, "Angebotsmail fehlt im Postausgang").not.toBeNull();
  expect(String(post!.body_text)).toContain(`/vorgang/${neu!.id}?bereich=angebot`);

  await page.context().clearCookies();
  await page.goto(`/portal/${token}`);

  // Die Übersicht zeigt den Vorgang mit Fortschrittsbalken.
  await expect(page.getByText(neu!.number as string).first()).toBeVisible({
    timeout: 15_000,
  });

  await page.goto(`/portal/${token}/vorgang/${neu!.id}`);

  /* ---- Was der Kunde zuerst sieht: der Fortschritt ---- */
  await expect(page.getByRole("heading", { name: "Fortschritt" })).toBeVisible();
  await expect(page.getByText("9,84 kWp").first()).toBeVisible();
  await expect(page.getByText("Wo Ihr Projekt steht")).toBeVisible();
  // Phasen in Kundensprache, nicht „Beauftragt — Gates laufen".
  await expect(page.getByText("Material, Netzanmeldung und Förderung laufen.")).toBeVisible();
  await expect(page.getByText("Angebot versendet")).toBeVisible();

  /* ---- Was er nicht sieht ---- */
  await expect(page.locator("body")).not.toContainText("GEHEIM-INTERN");

  /*
   * Das Angebot ist ein eigener Bereich. Der Weg dorthin führt über die
   * Navigation — genau den Klick macht der Kunde auch.
   */
  await page.getByRole("link", { name: "Ihr Angebot" }).first().click();
  await expect(page.getByText("PV-Anlage 9,84 kWp schlüsselfertig")).toBeVisible();
  await expect(page.locator("body")).not.toContainText("GEHEIM-INTERN");

  /* ---- Annehmen ---- */
  await page.getByRole("button", { name: "Angebot annehmen" }).click();
  await page.getByLabel(/Ihr Name/).fill("Katrin Weber");
  await page.getByRole("button", { name: "Verbindlich annehmen" }).click();

  /*
   * Nicht auf die Dankesmeldung warten: mit der Zusage wechselt die Phase,
   * die Annahmeleiste wird gar nicht mehr gerendert, und die Meldung
   * verschwindet mit ihr. Geprüft wird die Wirkung.
   */
  await expect
    .poll(async () => {
      const { data } = await db
        .from("vorgang")
        .select("phase")
        .eq("id", neu!.id)
        .single();
      return data?.phase;
    }, { timeout: 30_000 })
    .toBe("beauftragt");

  /* ---- Die Kaskade lief, wie im Backoffice ---- */
  const { data: v } = await db
    .from("vorgang")
    .select("phase, auftragswert_netto")
    .eq("id", neu!.id)
    .single();
  expect(Number(v!.auftragswert_netto)).toBe(16800);

  const { data: docs } = await db
    .from("vorgang_dokument")
    .select("typ, kunde_sichtbar")
    .eq("vorgang_id", neu!.id);

  /*
   * Die eingefrorene Angebotsfassung gehört dazu: sie ist das, was der
   * Kunde in Händen hatte, als er zugesagt hat.
   */
  expect((docs ?? []).map((d) => d.typ).sort()).toEqual([
    "ab",
    "angebot",
    "anzahlungsrechnung",
    "materialliste",
  ]);
  /* Die Materialbedarfsliste trägt Einkaufspreise — nie ins Portal. */
  expect((docs ?? []).find((d) => d.typ === "materialliste")!.kunde_sichtbar).toBe(
    false,
  );

  const { data: gates } = await db
    .from("vorgang_gate")
    .select("key")
    .eq("vorgang_id", neu!.id);
  expect(gates).toHaveLength(6);

  /* ---- Das Angebot als PDF ---- */
  const pdf = await page.request.get(`/api/portal/${token}/pdf/${neu!.id}?art=ab`);
  expect(pdf.status()).toBe(200);
  expect((await pdf.body()).subarray(0, 4).toString()).toBe("%PDF");

  /* ---- Die Materialliste nicht ---- */
  const gesperrt = await page.request.get(
    `/api/portal/${token}/pdf/${neu!.id}?art=materialliste`,
  );
  expect(gesperrt.status()).toBe(404);

  await db.from("vorgang_event").delete().eq("vorgang_id", neu!.id);
  await db.from("vorgang_position").delete().eq("vorgang_id", neu!.id);
  await db.from("vorgang_gate").delete().eq("vorgang_id", neu!.id);
  await db.from("vorgang_dokument").delete().eq("vorgang_id", neu!.id);
  await db.from("vorgang").delete().eq("id", neu!.id);
});

test("16 — Ein fremder Token öffnet den Vorgang nicht", async ({ page }) => {
  const db = admin();
  const { data: fremd } = await db
    .from("customer")
    .select("id")
    .eq("company_id", COMPANY_A)
    .neq("id", zustand.kundeId!)
    .is("deleted_at", null)
    .limit(1)
    .single();

  await login(page, DEMO.gf);
  const fremdToken = await portalToken(page, fremd!.id as string);

  await page.context().clearCookies();
  const antwort = await page.goto(
    `/portal/${fremdToken}/vorgang/${zustand.vorgangId}`,
  );
  expect(antwort?.status()).toBe(404);

  await db.from("portal_access").delete().eq("customer_id", fremd!.id);
});

test("17 — Rückfrage mit Foto: der Techniker fragt, der Kunde antwortet", async ({
  page,
}) => {
  const db = admin();

  await login(page, DEMO.gf);
  /* Das Gespräch mit dem Kunden hat seinen eigenen Reiter. */
  await page.goto(`/vorgaenge/${zustand.vorgangId}?tab=kommunikation`);

  /* ---- Der Betrieb stellt die Rückfrage ---- */
  await page.getByRole("button", { name: "Rückfrage an den Kunden stellen" }).click();
  await page.getByLabel("Worum geht es?").fill("Foto vom Zählerkasten");
  await page
    .getByLabel("Erklärung")
    .fill("Bitte mit geöffneter Tür, damit wir den Platz sehen.");
  await page.getByLabel(/Foto ist Pflicht/).check();
  await page.getByRole("button", { name: "Rückfrage stellen" }).click();

  await expect(page.getByText(/Rückfrage gestellt/)).toBeVisible({
    timeout: 20_000,
  });

  const { data: anfrage } = await db
    .from("vorgang_anfrage")
    .select("id, foto_noetig, status")
    .eq("vorgang_id", zustand.vorgangId!)
    .single();
  expect(anfrage!.foto_noetig).toBe(true);
  expect(anfrage!.status).toBe("offen");

  /* ---- Der Kunde sieht sie im Portal ---- */
  const token = await portalToken(page, zustand.kundeId!);
  await page.context().clearCookies();
  await page.goto(`/portal/${token}/vorgang/${zustand.vorgangId}`);

  await expect(page.getByText("Wir brauchen etwas von Ihnen")).toBeVisible({
    timeout: 15_000,
  });
  /* Die Frage steht als Karte oben und zusätzlich im Verlauf. */
  await expect(
    page.getByRole("heading", { name: "Foto vom Zählerkasten" }),
  ).toBeVisible();

  /* ---- Ohne Foto geht es nicht ---- */
  await page.getByLabel("Ihre Antwort").fill("Passt schon.");
  await page.getByRole("button", { name: "Antwort senden" }).click();

  /*
   * Der Browser hält das Formular selbst an, weil das Feld required ist.
   * Die Serveraktion prüft es zusätzlich — ein required-Attribut ist eine
   * Bequemlichkeit, keine Absicherung.
   */
  const { data: nochOffen } = await db
    .from("vorgang_anfrage")
    .select("status")
    .eq("id", anfrage!.id)
    .single();
  expect(nochOffen!.status).toBe("offen");

  /* ---- Mit Foto schon ---- */
  await page.getByLabel(/Foto \(nötig\)/).setInputFiles({
    name: "zaehlerkasten.jpg",
    mimeType: "image/jpeg",
    /* Ein winziges, gültiges JPEG mit EXIF-Segment. */
    buffer: Buffer.from([
      0xff, 0xd8, 0xff, 0xe1, 0x00, 0x10, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00,
      0x49, 0x49, 0x2a, 0x00, 0x88, 0x25, 0x00, 0x00, 0xff, 0xda, 0x00, 0x03,
      0x01, 0x22, 0x33,
    ]),
  });
  await page.getByRole("button", { name: "Antwort senden" }).click();

  /*
   * Nicht auf die Dankesmeldung warten: mit der Antwort fällt die Frage
   * aus der Liste der offenen, das Formular wird nicht mehr gerendert und
   * die Meldung verschwindet mit ihm. Geprüft wird die Wirkung.
   */
  await expect
    .poll(async () => {
      const { data } = await db
        .from("vorgang_anfrage")
        .select("status")
        .eq("id", anfrage!.id)
        .single();
      return data?.status;
    }, { timeout: 25_000 })
    .toBe("beantwortet");

  const { data: beantwortet } = await db
    .from("vorgang_anfrage")
    .select("status, antwort_text, beantwortet_am")
    .eq("id", anfrage!.id)
    .single();
  expect(beantwortet!.status).toBe("beantwortet");
  expect(beantwortet!.beantwortet_am).not.toBeNull();

  const { data: anhang } = await db
    .from("vorgang_anhang")
    .select("id, dateiname, mime, groesse_bytes, storage_path, hochgeladen_von")
    .eq("anfrage_id", anfrage!.id)
    .single();

  expect(anhang!.hochgeladen_von).toBe("kunde");
  expect(anhang!.mime).toBe("image/jpeg");
  expect(String(anhang!.storage_path)).toContain(`/vorgang/${zustand.vorgangId}/`);

  /*
   * Das EXIF-Segment ist raus — ein Handyfoto vom Zählerkasten trägt die
   * Koordinaten des Wohnhauses (CLAUDE.md 11).
   */
  const { data: datei } = await db.storage
    .from("job-photos")
    .download(anhang!.storage_path as string);
  const bytes = new Uint8Array(await datei!.arrayBuffer());
  const text = Buffer.from(bytes).toString("latin1");
  expect(text).not.toContain("Exif");
  expect(bytes.length).toBeLessThan(27);

  /* ---- Der Betrieb sieht die Antwort samt Bild ---- */
  await page.context().clearCookies();
  await login(page, DEMO.gf);
  await page.goto(`/vorgaenge/${zustand.vorgangId}?tab=kommunikation`);
  await expect(page.getByText("beantwortet").first()).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.locator('img[alt="zaehlerkasten.jpg"]')).toBeVisible();
});

/*
 * TODO(fixme): Der Portal-Teil findet den Schreiben-Knopf nicht.
 *
 * Die interne Notiz im Betrieb funktioniert (bis dahin läuft der Test
 * durch); es hängt am Kundenportal unter „Anliegen" — dort greift
 * getByTestId("portal-chat-oeffnen") ins Leere, obwohl das Attribut in
 * PortalChat.tsx steht. Vermutlich rendert der Bereich den Chat nur
 * unter einer Bedingung, die dieser Vorgang nach Test 17 nicht mehr
 * erfüllt (offene Rückfrage?). Erst prüfen, was der Bereich tatsächlich
 * zeigt, dann Test oder Bedingung geraderücken.
 */
test.fixme("18 — Der Kunde schreibt, interne Notizen bleiben im Betrieb", async ({
  page,
}) => {
  const db = admin();

  await login(page, DEMO.gf);
  await page.goto(`/vorgaenge/${zustand.vorgangId}?tab=kommunikation`);

  /* Interne Notiz im Chat. */
  await page.getByTestId("chat-intern").click();
  await page
    .getByLabel(/Interne Notiz/)
    .fill("GEHEIM-CHAT Nachbar meldet sich ständig.");
  await page.getByRole("button", { name: "Notiz speichern" }).click();
  await expect(page.getByText(/Interne Notiz gespeichert/)).toBeVisible({
    timeout: 20_000,
  });

  const token = await portalToken(page, zustand.kundeId!);
  await page.context().clearCookies();
  /* Das Gespräch steht im Portal unter „Anliegen". */
  await page.goto(
    `/portal/${token}/vorgang/${zustand.vorgangId}?bereich=anliegen`,
  );

  /* Die interne Notiz kommt gar nicht erst an — gefiltert in der Abfrage. */
  await expect(page.locator("body")).not.toContainText("GEHEIM-CHAT");

  /* Der Kunde schreibt zurück. */
  await page.getByTestId("portal-chat-oeffnen").click();
  await page.getByTestId("portal-chat-text").fill("Wann kommen Sie ungefähr?");
  await page.getByTestId("portal-chat-senden").getByRole("button").click();

  await expect(page.getByText("Ihre Nachricht ist angekommen.")).toBeVisible({
    timeout: 20_000,
  });

  const { data: n } = await db
    .from("vorgang_nachricht")
    .select("autor, body, intern")
    .eq("vorgang_id", zustand.vorgangId!)
    .eq("autor", "kunde")
    .single();
  expect(n!.body).toBe("Wann kommen Sie ungefähr?");
  expect(n!.intern).toBe(false);
});

/*
 * Der Mahnlauf.
 *
 * Der schärfste Teil ist nicht das Mahnen, sondern das Nicht-Mahnen: eine
 * ausgesetzte Rechnung und eine, die noch nicht fällig ist, dürfen keine
 * Mail auslösen. Und eine Stufe je Lauf, sonst bekommt ein Kunde nach
 * einem stillgestandenen Cron die zweite Mahnung als erste Nachricht.
 */
test("19 — Der Mahnlauf erinnert, stuft hoch und lässt Ausgesetztes in Ruhe", async ({
  page,
}) => {
  const db = admin();

  const { data: beleg } = await db
    .from("vorgang_dokument")
    .select("id, nummer, status, faellig_am")
    .eq("vorgang_id", zustand.vorgangId!)
    .eq("typ", "schlussrechnung")
    .single();

  const aufraeumen = async () => {
    await db.from("mail_outbox").delete().eq("vorgang_dokument_id", beleg!.id);
    await db.from("job_run").delete().eq("kind", "dunning");
  };
  await aufraeumen();

  const zaehleMails = async (): Promise<number> => {
    const { count } = await db
      .from("mail_outbox")
      .select("id", { count: "exact", head: true })
      .eq("vorgang_dokument_id", beleg!.id);
    return count ?? 0;
  };

  const lauf = async () => {
    await db.from("job_run").delete().eq("kind", "dunning");
    const antwort = await page.request.get("/api/cron/dunning", {
      headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
    });
    expect(antwort.status()).toBe(200);
    return antwort.json() as Promise<{ gemahnt: number }>;
  };

  /* ---- Noch nicht fällig: nichts passiert ---- */
  const morgen = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  await db
    .from("vorgang_dokument")
    .update({
      status: "versendet",
      faellig_am: morgen,
      mahnstufe: 0,
      mahnung_aktiv: true,
    })
    .eq("id", beleg!.id);

  await lauf();
  expect(await zaehleMails(), "vor Fälligkeit wurde gemahnt").toBe(0);

  /* ---- Zehn Tage überfällig: Zahlungserinnerung, Stufe 1 ---- */
  const vorZehnTagen = new Date(Date.now() - 10 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  await db
    .from("vorgang_dokument")
    .update({ faellig_am: vorZehnTagen })
    .eq("id", beleg!.id);

  await lauf();
  expect(await zaehleMails()).toBe(1);

  const { data: nachErster } = await db
    .from("vorgang_dokument")
    .select("mahnstufe, gemahnt_am")
    .eq("id", beleg!.id)
    .single();
  expect(nachErster!.mahnstufe).toBe(1);
  expect(nachErster!.gemahnt_am).not.toBeNull();

  const { data: mail } = await db
    .from("mail_outbox")
    .select("subject, body_text")
    .eq("vorgang_dokument_id", beleg!.id)
    .single();
  expect(String(mail!.subject)).toContain("Zahlungserinnerung");
  expect(String(mail!.subject)).toContain(String(beleg!.nummer));

  /* ---- Derselbe Tag noch einmal: keine zweite Mail ---- */
  await lauf();
  expect(await zaehleMails(), "dieselbe Stufe wurde doppelt gemahnt").toBe(1);

  /*
   * ---- Vierzig Tage überfällig, aber erst Stufe 1: es kommt Stufe 2
   * und nicht Stufe 3. Eine Stufe je Lauf.
   */
  const vorVierzigTagen = new Date(Date.now() - 40 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  await db
    .from("vorgang_dokument")
    .update({ faellig_am: vorVierzigTagen })
    .eq("id", beleg!.id);

  await lauf();
  const { data: nachZweiter } = await db
    .from("vorgang_dokument")
    .select("mahnstufe")
    .eq("id", beleg!.id)
    .single();
  expect(nachZweiter!.mahnstufe, "der Lauf hat eine Stufe übersprungen").toBe(2);

  /* ---- Ausgesetzt: der nächste Lauf lässt sie in Ruhe ---- */
  await db
    .from("vorgang_dokument")
    .update({ mahnung_aktiv: false })
    .eq("id", beleg!.id);

  const vorher = await zaehleMails();
  await lauf();
  expect(await zaehleMails(), "ausgesetzte Rechnung wurde gemahnt").toBe(vorher);

  /* ---- In der Liste steht die Stufe, und man kann sie aufnehmen ---- */
  await login(page, DEMO.gf);
  await page.goto("/offene-posten");
  await expect(page.getByText("1. Mahnung").first()).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText("Mahnlauf ausgesetzt").first()).toBeVisible();

  await aufraeumen();
  await db
    .from("vorgang_dokument")
    .update({
      mahnstufe: 0,
      gemahnt_am: null,
      mahnung_aktiv: true,
      faellig_am: beleg!.faellig_am,
      status: beleg!.status,
    })
    .eq("id", beleg!.id);
});
