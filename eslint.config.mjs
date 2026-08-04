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
      ".next-dev/**",
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
      /*
       * Die Belegausgabe des Kundenportals. Sie liegt unter /api, gehört
       * aber zum Portalpfad: dieselbe Begründung wie lib/portal — kein
       * Supabase-Login, an dem RLS greifen könnte, und die Prüfung steckt
       * in portalVorgangDetail, das nur Zeilen dieses Kunden liefert.
       */
      "app/api/portal/**",
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
      /*
       * Mitarbeiter anlegen. Ein Konto entsteht in auth.users, und
       * company_id und role müssen in app_metadata landen — beides geht
       * ausschliesslich über die Admin-API. Die Rechteprüfung sitzt in
       * der aufrufenden Server Action, die Mandantenzuordnung hier.
       */
      "lib/onboarding/**",
      /*
       * Der Mahnlauf. mail_account hält die Zugangsdaten der Postfächer
       * und ist für authenticated vollständig gesperrt, mail_outbox
       * ebenso — eine angemeldete Sitzung kann keine Mail schreiben.
       * Dieselbe Aufteilung wie bei lib/onboarding: die Rechteprüfung
       * sitzt in der aufrufenden Server Action, die Mandantenzuordnung
       * hier.
       */
      "lib/mahnung.ts",
      /*
       * Mail an den Kunden zu einem Vorgang. Gleiche Begründung wie beim
       * Mahnlauf: mail_outbox und mail_account sind für authenticated
       * gesperrt, eine angemeldete Sitzung kann keine Mail schreiben.
       * Die Rechteprüfung sitzt in der aufrufenden Server Action.
       */
      "lib/vorgang/mail.ts",
      /*
       * Die Bestellung abschicken. Dabei entsteht ein PDF, das in den
       * gesperrten Bucket documents gehört, und die Mail an den
       * Lieferanten in mail_outbox — beides für eine angemeldete
       * Sitzung unerreichbar. Gelesen wird alles mit dem RLS-Client des
       * Anmelders; der Service-Role-Client fasst nur Speicher und
       * Postausgang an. Die Rechteprüfung sitzt in der aufrufenden
       * Serveraktion.
       */
      "lib/material/bestellung.tsx",
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
