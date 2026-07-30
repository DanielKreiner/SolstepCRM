import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type Me = {
  id: string;
  companyId: string;
  role: string;
  name: string;
  email: string;
  locationId: string | null;
  weeklyHours: number;
  company: { id: string; name: string; status: string };
  /** Bereich -> none|read|write, aus role_permission. */
  perms: Record<string, "none" | "read" | "write">;
};

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

  // Erst jetzt: role_permission enthält die Zeilen aller Rollen des Mandanten,
  // gefiltert wird auf die eigene Rolle. Ohne den Filter gewönne die zuletzt
  // gelesene Rolle — und ein Monteur hätte die Rechte der Geschäftsführung.
  const [{ data: company }, { data: perms }] = await Promise.all([
    supabase.from("company").select("id, name, status").maybeSingle(),
    supabase
      .from("role_permission")
      .select("area, level")
      .eq("role", appUser.role as string),
  ]);

  if (!company) return null;

  const permMap: Record<string, "none" | "read" | "write"> = {};
  for (const p of perms ?? []) {
    permMap[p.area as string] = p.level as "none" | "read" | "write";
  }

  return {
    id: appUser.id as string,
    companyId: appUser.company_id as string,
    role: appUser.role as string,
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
