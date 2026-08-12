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

export default function laufStart(): void {
  mkdirSync(dirname(LAUF_MARKE), { recursive: true });
  writeFileSync(LAUF_MARKE, new Date().toISOString(), "utf8");
}
