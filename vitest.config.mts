import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  /*
   * Dasselbe "@"-Kürzel wie in der App. Ohne das scheitert jedes
   * Regelmodul, das ein anderes importiert — und man landet bei
   * relativen Pfaden nur, um den Test zufriedenzustellen.
   */
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
      /*
       * "server-only" wirft beim Import, sobald es nicht in einer
       * Server-Umgebung von Next läuft. Das ist im Betrieb richtig und
       * im Test eine Wand: Gerade die Module mit einer
       * Sicherheitsgrenze darin — die Token der Links ohne Anmeldung —
       * tragen diesen Schutz zu Recht und wären damit die einzigen, die
       * sich nicht prüfen lassen. Hier steht dafür ein leeres Modul.
       */
      "server-only": fileURLToPath(new URL("./tests/leer.ts", import.meta.url)),
    },
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
