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
    // Eigener Port und eigenes Build-Verzeichnis, damit ein laufender
    // Dev-Server auf 3000 nicht gestört wird.
    command: `NEXT_DIST_DIR=.next-e2e next dev --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
