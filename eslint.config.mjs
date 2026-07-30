import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({ baseDirectory: __dirname });

const ADMIN_CLIENT_MESSAGE =
  "Der Service-Role-Client umgeht RLS. Erlaubt nur in /api/webhooks, /api/cron, /app/portal und /app/ops. " +
  "Normale Lese- und Schreiboperationen laufen über lib/supabase/server.ts unter RLS.";

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),

  {
    ignores: [
      "node_modules/**",
      ".next/**",
      ".next-build/**",
      ".next-e2e/**",
      "test-results/**",
      "playwright-report/**",
      "design/**", // Mockups, read-only Referenz
      "supabase/**",
      "next-env.d.ts",
    ],
  },

  {
    // CLAUDE.md Abschnitt 11 und 12.a: Service-Role-Key nur auf erlaubten Pfaden.
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/lib/supabase/admin",
              message: ADMIN_CLIENT_MESSAGE,
            },
          ],
          patterns: [
            {
              group: ["**/lib/supabase/admin"],
              message: ADMIN_CLIENT_MESSAGE,
            },
          ],
        },
      ],
    },
  },

  {
    // Die Ausnahmeliste — und sonst nichts.
    files: [
      "app/api/webhooks/**",
      "app/api/cron/**",
      "app/api/oauth/**",
      "app/api/export/**",
      "app/api/pdf/**",
      "app/portal/**",
      "app/ops/**",
      "lib/mail/**",
      "lib/supabase/admin.ts",
      "scripts/**",
      "tests/**",
    ],
    rules: {
      "no-restricted-imports": "off",
    },
  },
];

export default eslintConfig;
