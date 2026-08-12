import { test } from "@playwright/test";
import { admin, COMPANY_A, DEMO, login } from "./helpers";
import { dachSetzen } from "./planer-helfer";
const ZIEL = "/private/tmp/claude-501/-Users-daniel-Documents-SolstepB2B/ebb677eb-2f41-4835-8b34-10ec58cd7dd9/scratchpad";
test.beforeEach(async () => {
  await admin().from("planer_projekt").delete().eq("company_id", COMPANY_A).like("name", "PR-%");
});
test("wo lande ich", async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 950 });
  await login(page, DEMO.gf);
  await page.goto("/planer/neu");
  await page.route("**/api/planer/adresse**", (r) => r.fulfill({ status: 200, contentType: "application/json",
    body: JSON.stringify({ treffer: [{ name: "Probeweg 1, 4020 Linz", lat: 48.30604, lon: 14.28583 }] }) }));
  await page.getByLabel("Adresse suchen").fill("Probeweg 1");
  await page.getByRole("button", { name: /Probeweg 1/ }).click();
  await page.getByLabel("Projektname").fill("PR-Probe");
  await page.getByRole("button", { name: "Projekt anlegen" }).click();
  await page.waitForURL(/\/planer\/[0-9a-f-]{36}$/);
  const id = page.url().split("/").pop()!;
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${ZIEL}/pr-1-frisch.png` });

  // Karte verschieben, dann Dachform setzen
  const k = (await page.getByTestId("planer-leinwand").boundingBox())!;
  await page.mouse.move(k.x + k.width / 2, k.y + k.height / 2);
  await page.mouse.down();
  await page.mouse.move(k.x + k.width / 2 - 220, k.y + k.height / 2 - 140, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${ZIEL}/pr-2-geschwenkt.png` });

  await dachSetzen(page, "Pultdach", "12", "8");
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${ZIEL}/pr-3-nachform.png` });

  // Neu laden: wo lande ich beim Öffnen?
  await page.reload();
  await page.waitForTimeout(3500);
  await page.screenshot({ path: `${ZIEL}/pr-4-neugeladen.png` });

  const { data } = await admin().from("planer_projekt").select("plan, zoom").eq("id", id).single();
  const plan = data!.plan as { flaechen: Array<{ punkte: Array<{x:number;y:number}> }> };
  console.log("PUNKTE", JSON.stringify(plan.flaechen[0]?.punkte), "ZOOM", data!.zoom);
});
