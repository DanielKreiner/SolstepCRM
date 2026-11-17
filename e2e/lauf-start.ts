import { createClient } from "@supabase/supabase-js";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/*
 * Startzeit des Testlaufs festhalten.
 *
 * Sie ist die Grenze für das Aufräumen danach: Was NACH diesem
 * Zeitpunkt entstanden ist, stammt aus dem Lauf und wird entfernt; was
 * vorher dastand, gehört jemand anderem und bleibt.
 *
 * Über eine Datei und nicht über eine Umgebungsvariable, weil
 * Playwright Setup und Teardown nicht garantiert im selben Prozess
 * ausführt.
 */

export const LAUF_MARKE = "test-results/laufstart.txt";

const COMPANY_A = "11111111-1111-4111-8111-111111111111";

/*
 * Die Tests arbeiten auf einer echten Datenbank. Sie legen Kunden an,
 * buchen Lagerbewegungen, erzeugen Belege und löschen wieder. Solange
 * dort Demodaten stehen, ist das harmlos.
 *
 * Sobald in diesem Mandanten ein echter Betrieb arbeitet, ist es das
 * nicht mehr: Ein Lauf bucht dann Bestand im Lager eines Kunden und
 * legt Vorgänge an, die niemand bestellt hat. Deshalb prüft der Lauf
 * vorher, ob er auf Demodaten zeigt, und bricht sonst ab.
 *
 * Erkennungsmerkmal ist die Beispieldomain der Demokonten. Sie steht
 * ohnehin in jedem Test (DEMO.gf und so weiter) — ohne sie läuft die
 * Suite sowieso nicht, der Abbruch sagt nur früher und deutlicher,
 * warum.
 *
 * Wer die Prüfung umgehen muss, setzt E2E_ZIELMANDANT auf die ID des
 * Mandanten, der bespielt werden darf. Das ist Absicht und keine
 * Hintertür: es steht dann in der Befehlszeile, und niemand kann
 * behaupten, er habe es nicht gesehen.
 */
async function pruefeDemomandant(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return; // Ohne Zugang scheitern die Tests ohnehin gleich.

  /* Ausdrücklich freigegeben — dann ist die Entscheidung getroffen. */
  if (process.env.E2E_ZIELMANDANT) return;
  const ziel = COMPANY_A;

  const db = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: firma } = await db
    .from("company")
    .select("name")
    .eq("id", ziel)
    .maybeSingle();

  const { count } = await db
    .from("app_user")
    .select("id", { count: "exact", head: true })
    .eq("company_id", ziel)
    .like("email", "%@%.example.com");

  if ((count ?? 0) > 0) return;

  throw new Error(
    [
      "",
      "Der Testlauf wurde angehalten.",
      "",
      `Im Mandanten ${firma?.name ?? ziel} stehen keine Demokonten mehr.`,
      "Das sieht nach einem Betrieb aus, der wirklich damit arbeitet — und",
      "die Tests wuerden dort Kunden anlegen, Bestand buchen und Belege",
      "erzeugen.",
      "",
      "Richtiger Weg: einen eigenen Mandanten mit Demobestand aufbauen",
      "(pnpm demo:aufbauen) und die Tests dorthin zeigen lassen.",
      "",
      "Nur wenn du sicher bist, dass dieser Mandant bespielt werden darf:",
      "  E2E_ZIELMANDANT=<id> npx playwright test",
      "",
    ].join("\n"),
  );
}

export default async function laufStart(): Promise<void> {
  await pruefeDemomandant();
  mkdirSync(dirname(LAUF_MARKE), { recursive: true });
  writeFileSync(LAUF_MARKE, new Date().toISOString(), "utf8");
}
