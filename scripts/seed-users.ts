/*
 * Legt die Demo-Nutzer an. Getrennt von seed.sql, weil company_id und role in
 * auth.users.raw_app_meta_data gehören — und das geht nur über die Admin-API.
 *
 * app_metadata statt user_metadata ist kein Geschmack: user_metadata ist vom
 * Client änderbar. Läge die company_id dort, könnte sich jeder Nutzer in einen
 * fremden Mandanten schreiben, und RLS würde es durchwinken.
 *
 * Ausführen:  pnpm seed:users
 * Passwort:   SEED_PASSWORD setzen, sonst wird eines erzeugt und ausgegeben.
 */
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const COMPANY_A = "11111111-1111-4111-8111-111111111111";
const COMPANY_B = "22222222-2222-4222-8222-222222222222";
const LOC_LINZ = "1a000000-0000-4000-8000-000000000001";
const LOC_WELS = "1a000000-0000-4000-8000-000000000002";
const LOC_GRAZ = "2a000000-0000-4000-8000-000000000001";

type Role = "gf" | "buero" | "bauleitung" | "monteur" | "lager";

type SeedUser = {
  email: string;
  name: string;
  role: Role;
  companyId: string;
  locationId: string;
  weeklyHours: number;
  hourlyCost: number;
};

const USERS: SeedUser[] = [
  {
    email: "gf@hofstaetter.example.com",
    name: "Michael Hofstätter",
    role: "gf",
    companyId: COMPANY_A,
    locationId: LOC_LINZ,
    weeklyHours: 40,
    hourlyCost: 68,
  },
  {
    email: "buero@hofstaetter.example.com",
    name: "Sabine Reiter",
    role: "buero",
    companyId: COMPANY_A,
    locationId: LOC_LINZ,
    weeklyHours: 30,
    hourlyCost: 41,
  },
  {
    email: "bauleitung@hofstaetter.example.com",
    name: "Thomas Zauner",
    role: "bauleitung",
    companyId: COMPANY_A,
    locationId: LOC_WELS,
    weeklyHours: 38.5,
    hourlyCost: 52,
  },
  {
    email: "monteur@hofstaetter.example.com",
    name: "Dominik Pöschl",
    role: "monteur",
    companyId: COMPANY_A,
    locationId: LOC_WELS,
    weeklyHours: 38.5,
    hourlyCost: 39,
  },
  {
    email: "lager@hofstaetter.example.com",
    name: "Erwin Haslinger",
    role: "lager",
    companyId: COMPANY_A,
    locationId: LOC_LINZ,
    weeklyHours: 38.5,
    hourlyCost: 36,
  },
  {
    // Fremdmandant — ohne ihn kann der Isolationstest nichts beweisen.
    email: "gf@zweitbetrieb.example.com",
    name: "Anna Steinbauer",
    role: "gf",
    companyId: COMPANY_B,
    locationId: LOC_GRAZ,
    weeklyHours: 40,
    hourlyCost: 66,
  },
];

function loadEnv(): Record<string, string> {
  try {
    return Object.fromEntries(
      readFileSync(".env.local", "utf8")
        .split("\n")
        .filter((l) => /^[A-Z_0-9]+=/.test(l))
        .map((l) => {
          const i = l.indexOf("=");
          return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, "")];
        }),
    );
  } catch {
    return {};
  }
}

async function main() {
  const env = { ...loadEnv(), ...process.env };
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL und SUPABASE_SERVICE_ROLE_KEY werden gebraucht.",
    );
  }

  const givenPassword = env.SEED_PASSWORD;
  const password = givenPassword ?? `dev-${randomBytes(9).toString("base64url")}`;

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Bestehende Konten einsammeln, damit ein zweiter Lauf nicht scheitert.
  const existing = new Map<string, string>();
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    for (const u of data.users) if (u.email) existing.set(u.email, u.id);
    if (data.users.length < 200) break;
  }

  for (const u of USERS) {
    const appMetadata = { company_id: u.companyId, role: u.role };
    let userId = existing.get(u.email);

    if (userId) {
      const { error } = await admin.auth.admin.updateUserById(userId, {
        app_metadata: appMetadata,
        ...(givenPassword ? { password } : {}),
      });
      if (error) throw error;
      console.log(`aktualisiert  ${u.email.padEnd(36)} ${u.role}`);
    } else {
      const { data, error } = await admin.auth.admin.createUser({
        email: u.email,
        password,
        email_confirm: true,
        app_metadata: appMetadata,
        user_metadata: { name: u.name },
      });
      if (error) throw error;
      userId = data.user.id;
      console.log(`angelegt      ${u.email.padEnd(36)} ${u.role}`);
    }

    const { error: rowError } = await admin.from("app_user").upsert(
      {
        id: userId,
        company_id: u.companyId,
        location_id: u.locationId,
        name: u.name,
        email: u.email,
        role: u.role,
        weekly_hours: u.weeklyHours,
        hourly_cost: u.hourlyCost,
        active: true,
      },
      { onConflict: "id" },
    );
    if (rowError) throw rowError;
  }

  console.log(`\n${USERS.length} Nutzer bereit.`);
  console.log(
    givenPassword
      ? "Passwort: aus SEED_PASSWORD."
      : `Passwort für alle: ${password}\n(einmalig erzeugt — notieren oder SEED_PASSWORD setzen)`,
  );
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
