import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type Me = {
  id: string;
  companyId: string;
  /** Aus auth.users.app_metadata — dieselbe Quelle wie current_role_name() in der Datenbank. */
  role: string;
  name: string;
  email: string;
  locationId: string | null;
  weeklyHours: number;
  company: { id: string; name: string; status: string };
  /** Bereich -> none|read|write, aus role_permission. */
  perms: Record<string, "none" | "read" | "write">;
};

/**
 * Die Rolle aus den app_metadata des Kontos.
 *
 * Geschrieben wird sie ausschließlich über die Supabase-Admin-API
 * (lib/onboarding/user.ts, rolleSetzen) und ist vom Client nicht
 * änderbar — im Gegensatz zu `user_metadata`. `getUser()` holt sie
 * serverseitig vom Auth-Dienst, nicht aus einem Cookie.
 */
function rolleAusMetadaten(meta: unknown): string | null {
  if (!meta || typeof meta !== "object") return null;
  const wert = (meta as Record<string, unknown>)["role"];
  return typeof wert === "string" && wert.trim() !== "" ? wert.trim() : null;
}

/*
 * Einmal pro Request laden, nicht pro Komponente. `cache` dedupliziert
 * innerhalb eines Renderdurchlaufs.
 *
 * Wichtig: das ist Bequemlichkeit fürs UI, keine Sicherheitsgrenze.
 * Durchgesetzt wird alles über RLS und can() in der Datenbank.
 */
export const getMe = cache(async (): Promise<Me | null> => {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: appUser } = await supabase
    .from("app_user")
    .select("id, company_id, name, email, role, location_id, weekly_hours")
    .eq("id", user.id)
    .maybeSingle();

  if (!appUser) return null;

  /*
   * Die Rolle kommt aus app_metadata, nicht aus der Tabelle.
   *
   * Dieselbe Quelle, aus der die Datenbank sie liest: current_role_name()
   * wertet `auth.jwt() -> app_metadata -> role` aus, und can() baut
   * darauf auf. Solange hier app_user.role stand, gab es dieselbe Angabe
   * an zwei Orten — und der eine davon war über die generische
   * UPDATE-Policy aus 0001 vom Nutzer selbst beschreibbar. Ein
   * `update app_user set role='gf' where id = <eigene id>` aus der
   * Browserkonsole genügte, und /api/export/tenant (prüft nur
   * `me.role !== "gf"`) lieferte den ganzen Mandanten als ZIP.
   *
   * Rückfall auf die Tabelle, damit niemand ohne Rolle dasteht, falls
   * app_metadata bei einem Altkonto fehlt. Migration 0072 zieht den
   * Bestand nach und sperrt zugleich app_user.role: die Spalte ändert
   * seitdem nur noch, wer Schreibrecht auf 'mitarbeiter' hat, und den
   * Wert selbst nur die Geschäftsführung. Der Rückfall ist damit keine
   * offene Tür mehr.
   */
  const rolleAusJwt = rolleAusMetadaten(user.app_metadata);
  // app_user.role ist not null, der Rückfall liefert also immer einen Wert.
  const rolle = rolleAusJwt ?? (appUser.role as string);

  if (!rolleAusJwt) {
    console.warn(
      `[session] Konto ${user.id} hat keine Rolle in app_metadata. ` +
        `Rückfall auf app_user.role — in der Datenbank greift can() für ` +
        `dieses Konto nicht, die Rolle gehört über die Admin-API gesetzt.`,
    );
  }

  // Erst jetzt: role_permission enthält die Zeilen aller Rollen des Mandanten,
  // gefiltert wird auf die eigene Rolle. Ohne den Filter gewönne die zuletzt
  // gelesene Rolle — und ein Monteur hätte die Rechte der Geschäftsführung.
  const [{ data: company }, { data: perms }] = await Promise.all([
    supabase.from("company").select("id, name, status").maybeSingle(),
    supabase.from("role_permission").select("area, level").eq("role", rolle),
  ]);

  if (!company) return null;

  const permMap: Record<string, "none" | "read" | "write"> = {};
  for (const p of perms ?? []) {
    permMap[p.area as string] = p.level as "none" | "read" | "write";
  }

  return {
    id: appUser.id as string,
    companyId: appUser.company_id as string,
    role: rolle,
    name: appUser.name as string,
    email: appUser.email as string,
    locationId: (appUser.location_id as string | null) ?? null,
    weeklyHours: Number(appUser.weekly_hours ?? 0),
    company: {
      id: company.id as string,
      name: company.name as string,
      status: company.status as string,
    },
    perms: permMap,
  };
});

/** Für Seiten, die ohne Anmeldung sinnlos sind. */
export async function requireMe(): Promise<Me> {
  const me = await getMe();
  if (!me) redirect("/login");
  return me;
}

export function can(
  me: Me,
  area: string,
  level: "read" | "write" = "read",
): boolean {
  const have = me.perms[area] ?? "none";
  if (have === "write") return true;
  return level === "read" && have === "read";
}
