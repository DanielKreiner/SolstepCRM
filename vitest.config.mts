import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.spec.ts", "lib/**/*.spec.ts"],
    // Der Isolationstest redet mit einer echten Datenbank.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
