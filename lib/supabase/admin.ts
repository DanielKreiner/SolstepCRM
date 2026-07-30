import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { publicEnv, serverEnv } from "@/lib/env";

/**
 * Service-Role-Client — umgeht RLS vollstaendig.
 *
 * Erlaubte Aufrufer und sonst niemand (CLAUDE.md Abschnitt 12.a):
 *   /api/webhooks/*, /api/cron/*, /app/portal/*, /app/ops/*
 *
 * Jede Abfrage muss `company_id` (bzw. `customer_id` im Portal) selbst einschraenken.
 * Die Datenbank tut es hier nicht mehr fuer dich.
 */
export function createAdminClient() {
  const { SUPABASE_SERVICE_ROLE_KEY } = serverEnv();

  return createSupabaseClient(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    },
  );
}
