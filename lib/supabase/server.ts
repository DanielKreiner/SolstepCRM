import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { publicEnv } from "@/lib/env";

/**
 * Server-Client fuer Server Components, Server Actions und Route Handlers.
 * Benutzt den anon-Key, laeuft also unter RLS — genau so gewollt.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Aus einer Server Component heraus ist das Setzen nicht erlaubt.
            // Die Middleware erneuert die Session ohnehin bei jedem Request.
          }
        },
      },
    },
  );
}
