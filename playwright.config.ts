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
     * Der grössere Heap ist kein Luxus: Der Dev-Server kompiliert jede
     * Route beim ersten Aufruf und behält sie im Speicher. Ab rund
     * vierzig Tests reichte der Standardwert nicht mehr — der Prozess
     * starb mitten im Lauf, und alle folgenden Tests scheiterten binnen
     * Millisekunden mit ERR_CONNECTION_REFUSED. Das sah nach einem
     * Fehler in der Anwendung aus und war keiner.
     */
    command: `NODE_OPTIONS=--max-old-space-size=6144 NEXT_DIST_DIR=.next-e2e next dev --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
