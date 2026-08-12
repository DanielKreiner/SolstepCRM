import { defineConfig, devices } from "@playwright/test";
import { readFileSync } from "node:fs";

// .env.local einlesen, ohne dotenv. In CI kommen die Werte aus Secrets.
try {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    if (!/^[A-Z_0-9]+=/.test(line)) continue;
    const i = line.indexOf("=");
    const key = line.slice(0, i);
    if (process.env[key] === undefined) {
      process.env[key] = line.slice(i + 1).replace(/^"|"$/g, "");
    }
  }
} catch {
  /* in CI erwartet */
}

const PORT = 3100;

export default defineConfig({
  testDir: "./e2e",
  /*
   * Der Lauf legt Planer-Projekte in derselben Datenbank an, in der
   * auch gearbeitet wird. Was er anlegt, räumt er hinterher weg —
   * Startmarke vorher, Löschlauf danach.
   */
  globalSetup: "./e2e/lauf-start.ts",
  globalTeardown: "./e2e/lauf-ende.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "line" : "list",
  timeout: 45_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
    locale: "de-AT",
    timezoneId: "Europe/Vienna",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    /*
     * Eigener Port und eigenes Build-Verzeichnis, damit ein laufender
     * Dev-Server auf 3000 nicht gestört wird.
     *
     * Zum Heap-Limit: Der Dev-Server kompiliert jede Route beim ersten
     * Aufruf und behält sie im Speicher. Ohne Vorgabe starb der Prozess
     * bei über fünfzig Tests mitten im Lauf, und alle folgenden Tests
     * scheiterten binnen Millisekunden mit ERR_CONNECTION_REFUSED — was
     * wie ein Fehler in der Anwendung aussieht und keiner ist.
     *
     * Der Wert ist bewusst klein: mit 6 GB wurde es schlimmer, weil der
     * Prozess auf einem 16-GB-Rechner bis dorthin wächst und samt
     * Chromium vom Betriebssystem abgeräumt wird. Ein enges Limit
     * zwingt V8, früher und öfter aufzuräumen.
     *
     * Ein Produktionsbuild wäre stabiler, ändert aber das
     * Caching-Verhalten von Server Actions und Navigation — mehrere
     * Tests, die auf sofortige Aktualisierung setzen, scheitern dort.
     * Das ist ein eigener Umbau und nicht Teil des Planers.
     */
    command: `NODE_OPTIONS=--max-old-space-size=2560 NEXT_DIST_DIR=.next-e2e next dev --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
