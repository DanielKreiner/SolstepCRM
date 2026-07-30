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
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

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

  await seedMovements(admin);
}

/*
 * Zeiten und Materialbuchungen.
 *
 * Warum hier und nicht in seed.sql: beides hängt an app_user, und app_user
 * entsteht erst durch die Nutzeranlage oben. In einer eigenen SQL-Datei wäre
 * die Reihenfolge nicht erzwingbar — der Seed würde nach einem db reset
 * stillschweigend null Zeilen schreiben.
 */
async function seedMovements(admin: SupabaseClient) {
  const day = (offset: number, hhmm: string) => {
    const d = new Date();
    d.setDate(d.getDate() - offset);
    const local = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return viennaInstant(local, hhmm);
  };

  const [{ data: users }, { data: jobs }, { data: articles }] = await Promise.all([
    admin.from("app_user").select("id, email").eq("company_id", COMPANY_A),
    admin.from("job").select("id, number").eq("company_id", COMPANY_A),
    admin.from("article").select("id, sku").eq("company_id", COMPANY_A),
  ]);

  const byMail = new Map((users ?? []).map((u) => [u.email as string, u.id as string]));
  const byNumber = new Map((jobs ?? []).map((j) => [j.number as string, j.id as string]));
  const bySku = new Map((articles ?? []).map((a) => [a.sku as string, a.id as string]));

  // Idempotent: eigene Demodaten zuerst weg. audit_log bleibt — append-only.
  await admin.from("stock_move").delete().eq("company_id", COMPANY_A);
  await admin.from("time_entry").delete().eq("company_id", COMPANY_A);

  const M = "monteur@hofstaetter.example.com";
  const B = "bauleitung@hofstaetter.example.com";
  const L = "lager@hofstaetter.example.com";

  const times: [number, string, string, string, string, string, string | null][] = [
    [0, "07:00", "12:00", "A-2026-0041", M, "work", "Module gesetzt, Reihe 1 bis 3"],
    [0, "12:00", "12:30", "A-2026-0041", M, "break", null],
    [0, "12:30", "16:30", "A-2026-0041", M, "work", "Verkabelung DC"],
    [0, "06:30", "07:00", "A-2026-0041", M, "travel", "Anfahrt Linz"],
    [0, "08:00", "15:00", "A-2026-0041", B, "work", "Einweisung, Abnahme Unterkonstruktion"],
    [1, "07:00", "16:00", "A-2026-0041", M, "work", "Unterkonstruktion montiert"],
    [1, "07:30", "15:30", "A-2026-0042", B, "work", "Aufmaß und Gerüstplanung"],
    [2, "07:00", "15:30", "A-2026-0042", M, "work", "Vorbereitung Dachhaken"],
    [3, "08:00", "14:00", "A-2026-0038", M, "work", "Restarbeiten und Übergabe"],
    [3, "09:00", "12:00", "A-2026-0038", B, "work", "Abnahme mit Kunde"],
    [4, "07:00", "16:00", "A-2026-0038", M, "work", "Wechselrichter gesetzt, AC angeschlossen"],
  ];

  const timeRows = times
    .filter(([, , , nr, mail]) => byNumber.has(nr) && byMail.has(mail))
    .map(([off, von, bis, nr, mail, kind, note]) => ({
      company_id: COMPANY_A,
      user_id: byMail.get(mail)!,
      job_id: byNumber.get(nr)!,
      kind,
      started_at: day(off, von),
      ended_at: day(off, bis),
      note,
      status: "booked",
    }));

  if (timeRows.length) {
    const { error } = await admin.from("time_entry").insert(timeRows);
    if (error) throw error;
  }

  // Achtung: der Trigger apply_stock_move schreibt article.stock fort.
  // Die Bestände in seed.sql sind die Werte VOR diesen Buchungen.
  const moves: [string, string | null, string, number, string, string | null][] = [
    ["MOD-JAS-440", "A-2026-0041", M, 24, "out", "Reihe 1 bis 3"],
    ["UK-K2-SD", "A-2026-0041", M, 36, "out", "Schienen Süddach"],
    ["KAB-SOL-6", "A-2026-0041", M, 180, "out", "DC-Strang"],
    ["WR-FRO-10", "A-2026-0041", M, 1, "out", null],
    ["UK-K2-SD", "A-2026-0041", M, 4, "return", "Rest zurück ins Lager"],
    ["MOD-JAS-440", "A-2026-0038", M, 18, "out", null],
    ["WR-FRO-10", "A-2026-0038", M, 1, "out", null],
    ["SPE-BYD-10", "A-2026-0038", M, 1, "out", "Speicher Keller"],
    ["KAB-SOL-6", "A-2026-0038", M, 140, "out", null],
    ["MOD-JAS-440", null, L, 60, "goods_in", "Lieferung JA Solar"],
  ];

  const moveRows = moves
    .filter(([sku, nr, mail]) => bySku.has(sku) && byMail.has(mail) && (nr === null || byNumber.has(nr)))
    .map(([sku, nr, mail, qty, kind, note]) => ({
      company_id: COMPANY_A,
      article_id: bySku.get(sku)!,
      job_id: nr ? byNumber.get(nr)! : null,
      user_id: byMail.get(mail)!,
      qty,
      kind,
      note,
    }));

  if (moveRows.length) {
    // Einzeln, damit der Trigger je Zeile feuert und die Reihenfolge stimmt.
    for (const row of moveRows) {
      const { error } = await admin.from("stock_move").insert(row);
      if (error) throw error;
    }
  }

  console.log(`${timeRows.length} Zeitbuchungen, ${moveRows.length} Lagerbewegungen.`);

  await seedPipelines(admin, byMail);
}

/*
 * Angebote und Servicetickets — die beiden anderen Pipelines.
 * Geschrieben wird phase_id, nicht status: der Trigger aus 0006 zieht den
 * technischen Status anhand von system_key nach.
 */
async function seedPipelines(admin: SupabaseClient, byMail: Map<string, string>) {
  const [{ data: customers }, { data: phases }] = await Promise.all([
    admin.from("customer").select("id, name").eq("company_id", COMPANY_A),
    admin
      .from("pipeline_phase")
      .select("id, key, pipeline:pipeline_id ( kind )")
      .eq("company_id", COMPANY_A),
  ]);

  const byName = new Map((customers ?? []).map((c) => [c.name as string, c.id as string]));
  const phaseId = (kind: string, key: string) =>
    (phases ?? []).find(
      (p) =>
        (p.pipeline as unknown as { kind: string } | null)?.kind === kind &&
        p.key === key,
    )?.id as string | undefined;

  await admin.from("service_ticket").delete().eq("company_id", COMPANY_A);
  await admin.from("quote").delete().eq("company_id", COMPANY_A);

  const inDays = (n: number) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  };

  const quotes = [
    ["AN-2026-0107", "Landwirtschaft Grubmüller", "qualifiziert", 48900, 31200, 21],
    ["AN-2026-0106", "Tischlerei Aigner GmbH", "gesendet", 74900, 48200, 9],
    ["AN-2026-0105", "Familie Brandstätter", "angenommen", 28400, 16800, -14],
    ["AN-2026-0104", "Landwirtschaft Grubmüller", "neu", 12400, 7900, 30],
    ["AN-2026-0103", "Tischlerei Aigner GmbH", "verloren", 33500, 22100, -40],
  ] as const;

  const quoteRows = quotes
    .filter(([, kunde, key]) => byName.has(kunde) && phaseId("vertrieb", key))
    .map(([number, kunde, key, netto, kosten, faellig]) => ({
      company_id: COMPANY_A,
      customer_id: byName.get(kunde)!,
      number,
      phase_id: phaseId("vertrieb", key)!,
      net_total: netto,
      cost_total: kosten,
      valid_until: inDays(faellig),
      owner_id: byMail.get("buero@hofstaetter.example.com") ?? null,
    }));

  if (quoteRows.length) {
    const { error } = await admin.from("quote").insert(quoteRows);
    if (error) throw error;
  }

  const tickets = [
    ["S-2026-0031", "Familie Brandstätter", "offen", "stoerung", 1, "Wechselrichter meldet Fehler 301 seit heute früh."],
    ["S-2026-0030", "Tischlerei Aigner GmbH", "diagnose", "stoerung", 2, "Ertrag seit zwei Wochen rund 20 Prozent unter Vorjahr."],
    ["S-2026-0029", "Familie Brandstätter", "termin", "frage", 3, "Bitte um Einweisung in die App für den Speicher."],
    ["S-2026-0028", "Tischlerei Aigner GmbH", "behoben", "rechnung", 3, "Rückfrage zur Schlussrechnung, geklärt."],
  ] as const;

  const ticketRows = tickets
    .filter(([, kunde, key]) => byName.has(kunde) && phaseId("service", key))
    .map(([number, kunde, key, kategorie, schwere, body]) => ({
      company_id: COMPANY_A,
      customer_id: byName.get(kunde)!,
      number,
      phase_id: phaseId("service", key)!,
      category: kategorie,
      severity: schwere,
      body,
      source: "portal",
      assignee_id: byMail.get("bauleitung@hofstaetter.example.com") ?? null,
    }));

  if (ticketRows.length) {
    const { error } = await admin.from("service_ticket").insert(ticketRows);
    if (error) throw error;
  }

  // Postfach des Betriebs. Ohne Zugangsdaten und mit status 'unverified' —
  // im Seed wird nichts versendet, aber der Versandweg ist vollständig
  // durchspielbar (mail_outbox füllt sich, der Cron würde greifen).
  await admin.from("mail_account").delete().eq("company_id", COMPANY_A);
  const { error: mailErr } = await admin.from("mail_account").insert({
    company_id: COMPANY_A,
    provider: "imap",
    address: "office@hofstaetter.example.com",
    display_name: "Hofstätter Energietechnik",
    is_default: true,
    imap_host: "imap.example.com",
    smtp_host: "smtp.example.com",
    username: "office@hofstaetter.example.com",
    status: "unverified",
  });
  if (mailErr) throw mailErr;

  console.log(
    `${quoteRows.length} Angebote, ${ticketRows.length} Servicetickets, 1 Postfach.`,
  );
}

/** Wiener Wanduhrzeit als UTC-Instant, ohne date-fns-tz im Skript. */
function viennaInstant(day: string, hhmm: string): string {
  const guess = new Date(`${day}T${hhmm}:00Z`);
  const offsetMin =
    (new Date(guess.toLocaleString("en-US", { timeZone: "Europe/Vienna" })).getTime() -
      new Date(guess.toLocaleString("en-US", { timeZone: "UTC" })).getTime()) /
    60000;
  return new Date(guess.getTime() - offsetMin * 60000).toISOString();
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
