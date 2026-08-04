import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  /*
   * Dasselbe "@"-Kürzel wie in der App. Ohne das scheitert jedes
   * Regelmodul, das ein anderes importiert — und man landet bei
   * relativen Pfaden nur, um den Test zufriedenzustellen.
   */
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  test: {
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.spec.ts", "lib/**/*.spec.ts"],
    // Der Isolationstest redet mit einer echten Datenbank.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
