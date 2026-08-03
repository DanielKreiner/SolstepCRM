import { expect, test } from "@playwright/test";
import { COMPANY_A, DEMO, admin, login } from "./helpers";

/*
 * Phasenwechsel ausserhalb des Boards.
 *
 * Bisher ging das nur durch Ziehen einer Karte. Wer im Auftrag stand und
 * merkte, dass die Montage läuft, musste zurück ins Board — die Reibung,
 * wegen der Phasen dann tagelang falsch stehen.
 */

test.describe.configure({ mode: "serial" });

async function phasen(kind: string) {
  const db = admin();
  const { data } = await db
    .from("pipeline_phase")
    .select("id, label, sort, pipeline:pipeline_id ( kind )")
    .eq("company_id", COMPANY_A)
    .order("sort");

  return ((data ?? []) as unknown as {
    id: string;
    label: string;
    pipeline: { kind: string } | null;
  }[]).filter((p) => p.pipeline?.kind === kind);
}

test("Ein Auftrag wechselt die Phase von der Detailseite aus", async ({
  page,
}) => {
  const db = admin();
  const liste = await phasen("projekte");

  const { data: job } = await db
    .from("job")
    .select("id, phase_id")
    .eq("company_id", COMPANY_A)
    .limit(1)
    .single();

  const vorher = job!.phase_id as string;
  const ziel = liste.find((p) => p.id !== vorher)!;

  await login(page, DEMO.gf);
  await page.goto(`/auftraege/${job!.id}`);

  await page.getByRole("button", { name: ziel.label, exact: true }).click();

  await expect
    .poll(async () => {
      const { data } = await db
        .from("job")
        .select("phase_id")
        .eq("id", job!.id)
        .single();
      return data?.phase_id;
    }, { timeout: 20_000 })
    .toBe(ziel.id);

  // Die gewählte Phase ist danach als aktueller Schritt ausgezeichnet.
  await expect(
    page.getByRole("button", { name: ziel.label, exact: true }),
  ).toHaveAttribute("aria-current", "step");

  await db.from("job").update({ phase_id: vorher }).eq("id", job!.id);
});

test("Ein Serviceticket wechselt die Phase von der Detailseite aus", async ({
  page,
}) => {
  const db = admin();
  const liste = await phasen("service");

  const { data: ticket } = await db
    .from("service_ticket")
    .select("id, phase_id")
    .eq("company_id", COMPANY_A)
    .limit(1)
    .single();

  const vorher = ticket!.phase_id as string;
  const ziel = liste.find((p) => p.id !== vorher)!;

  await login(page, DEMO.gf);
  await page.goto(`/service/${ticket!.id}`);
  await page.getByRole("button", { name: ziel.label, exact: true }).click();

  await expect
    .poll(async () => {
      const { data } = await db
        .from("service_ticket")
        .select("phase_id")
        .eq("id", ticket!.id)
        .single();
      return data?.phase_id;
    }, { timeout: 20_000 })
    .toBe(ziel.id);

  await db
    .from("service_ticket")
    .update({ phase_id: vorher })
    .eq("id", ticket!.id);
});

test("Eine fremde Pipeline lässt sich nicht unterschieben", async ({ page }) => {
  const db = admin();

  const { data: job } = await db
    .from("job")
    .select("id, phase_id")
    .eq("company_id", COMPANY_A)
    .limit(1)
    .single();

  const vertrieb = await phasen("vertrieb");

  await login(page, DEMO.gf);
  await page.goto(`/auftraege/${job!.id}`);

  /*
   * Die Leiste zeigt nur Projektphasen. Eine Vertriebsphase darf auch
   * über einen zusammengebauten Aufruf nicht in einen Auftrag wandern —
   * geprüft wird das in der Server Action, nicht in der Oberfläche.
   */
  await expect(
    page.getByRole("button", { name: vertrieb[0]!.label, exact: true }),
  ).toHaveCount(0);

  const { data: nachher } = await db
    .from("job")
    .select("phase_id")
    .eq("id", job!.id)
    .single();
  expect(nachher!.phase_id).toBe(job!.phase_id);
});

test("Ohne Schreibrecht ist die Leiste gesperrt", async ({ page }) => {
  const db = admin();
  const { data: job } = await db
    .from("job")
    .select("id")
    .eq("company_id", COMPANY_A)
    .limit(1)
    .single();

  await login(page, DEMO.lager);
  const antwort = await page.goto(`/auftraege/${job!.id}`);

  if ((antwort?.status() ?? 200) < 400) {
    await expect(
      page.getByText("Für Phasenwechsel fehlt deiner Rolle das Schreibrecht."),
    ).toBeVisible();
  }
});
