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
      // Vom ServiceWorker-Build erzeugt, nicht handgeschrieben.
      "public/sw.js",
      "public/swe-worker*.js",
      "app/sw/**",
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
      /*
       * Die Datenschicht des Kundenportals. Das Portal hat keine
       * Supabase-Session, an der RLS greifen könnte — die gesamte
       * Mandantentrennung dieses Pfades liegt in lib/portal/data.ts, und
       * jede Abfrage dort schränkt selbst auf customer_id und company_id
       * ein. Wer diese Datei ändert, ändert eine Sicherheitsgrenze.
       */
      "lib/portal/**",
      /*
       * Die gemeinsame Klammer der Cron-Handler. Sie prüft CRON_SECRET und
       * die Idempotenz und reicht den Service-Role-Client an die Arbeit
       * durch — Crons laufen über alle Mandanten, ohne Session, an der RLS
       * greifen könnte. Ohne diese Datei müsste jeder Handler den Client
       * selbst holen, und einer davon würde die Prüfung vergessen.
       */
      "lib/cron.ts",
      /*
       * Der Mandantenexport. Er MUSS vollständig sein — er enthält auch
       * Personalakten und Rechnungen, die der auslösende Nutzer im Alltag
       * nicht alle sehen darf. Die Sicherung sitzt deshalb nicht hier,
       * sondern in der Route: auslösen darf ihn nur die Geschäftsführung.
       */
      "lib/export/**",
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
