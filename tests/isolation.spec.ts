import { beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/*
 * Mandantentrennung ist die einzige Sicherheitsgrenze zwischen allen Kunden
 * dieses Produkts. Ein Postgres, geteilte Tabellen — eine fehlerhafte Policy
 * ist damit ein Datenleck über alle Mandanten hinweg (CLAUDE.md 12.a).
 *
 * Der Test läuft gegen eine echte Datenbank mit echten Sessions. Er prüft
 * NICHT das UI: das UI blendet nur zusätzlich aus, durchgesetzt wird
 * serverseitig.
 *
 * Die Tabellenliste kommt aus public.v_tenant_table, nicht aus einer Konstante.
 * Eine neue Tabelle mit company_id ist damit automatisch mitgeprüft.
 */

const COMPANY_A = "11111111-1111-4111-8111-111111111111";
const COMPANY_B = "22222222-2222-4222-8222-222222222222";

const USER_A = "gf@hofstaetter.example.com";
const USER_B = "gf@zweitbetrieb.example.com";

let clientA: SupabaseClient;
let clientB: SupabaseClient;
let admin: SupabaseClient;
let tables: string[] = [];
let relations: { name: string; type: string }[] = [];

function anonClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

async function signIn(email: string, password: string): Promise<SupabaseClient> {
  const c = anonClient();
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) {
    throw new Error(
      `Anmeldung als ${email} fehlgeschlagen: ${error.message}. ` +
        `Läuft "pnpm seed:users" und stimmt SEED_PASSWORD?`,
    );
  }
  return c;
}

beforeAll(async () => {
  const password = process.env.SEED_PASSWORD;
  if (!password) throw new Error("SEED_PASSWORD fehlt.");

  admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  [clientA, clientB] = await Promise.all([
    signIn(USER_A, password),
    signIn(USER_B, password),
  ]);

  const { data, error } = await clientA
    .from("v_tenant_table")
    .select("table_name, table_type");
  if (error) throw error;

  relations = (data ?? []).map((r) => ({
    name: r.table_name as string,
    type: r.table_type as string,
  }));
  tables = relations.map((r) => r.name).sort();
});

describe("Aufbau des Tests", () => {
  it("kennt die mandantengebundenen Tabellen", () => {
    expect(tables.length).toBeGreaterThan(30);
    // Stichproben quer durch die fachlichen Bereiche
    for (const t of ["job", "invoice", "time_entry", "absence", "customer"]) {
      expect(tables).toContain(t);
    }
  });

  it("prüft auch Views, nicht nur Tabellen", () => {
    // Views laufen in Postgres per Default mit Eigentümerrechten und umgehen
    // damit die RLS ihrer Basistabellen. Genau so ist search_index einmal
    // mandantenübergreifend lesbar gewesen (Migration 0003). Der Test darf
    // sich nie wieder auf BASE TABLE beschränken.
    const views = relations.filter((r) => r.type === "VIEW").map((r) => r.name);
    expect(views.length).toBeGreaterThan(0);
    for (const v of ["search_index", "v_job_kpi", "v_time_balance"]) {
      expect(views).toContain(v);
    }
  });

  it("der Fremdmandant hat überhaupt Daten", async () => {
    // Ohne diese Prüfung wäre der ganze Test wertlos: "A sieht nichts von B"
    // ist trivial wahr, wenn B nichts hat.
    const { count, error } = await admin
      .from("job")
      .select("id", { count: "exact", head: true })
      .eq("company_id", COMPANY_B);
    expect(error).toBeNull();
    expect(count ?? 0).toBeGreaterThan(0);
  });
});

describe("Lesen: kein Mandant sieht fremde Zeilen", () => {
  it("prüft jede Tabelle mit company_id", async () => {
    const leaks: string[] = [];
    // Tabellen, in denen der Fremdmandant tatsächlich Zeilen hat. Nur dort
    // kann der Test überhaupt etwas beweisen — der Rest liefe leer durch.
    const scharf: string[] = [];

    for (const table of tables) {
      const { count: fremdZeilen } = await admin
        .from(table)
        .select("company_id", { count: "exact", head: true })
        .eq("company_id", COMPANY_B);

      if ((fremdZeilen ?? 0) > 0) scharf.push(table);

      for (const [label, client, own] of [
        ["A", clientA, COMPANY_A],
        ["B", clientB, COMPANY_B],
      ] as const) {
        const { data, error } = await client
          .from(table)
          .select("company_id")
          .limit(1000);

        // Ein Fehler ist kein Leck — z. B. Spaltenrechte. Nur Zeilen zählen.
        if (error) continue;

        const fremd = (data ?? []).filter(
          (r) => (r as { company_id: string }).company_id !== own,
        );
        if (fremd.length > 0) {
          leaks.push(`${table}: Mandant ${label} sieht ${fremd.length} fremde Zeile(n)`);
        }
      }
    }

    expect(leaks).toEqual([]);

    // Schutz gegen einen Test, der nur deshalb grün ist, weil nichts da war.
    expect(
      scharf.length,
      `Zu wenige Tabellen mit Fremddaten (${scharf.join(", ")}). Seed erweitern.`,
    ).toBeGreaterThanOrEqual(5);
  });
});

describe("Schreiben: kein Mandant schreibt in fremde Daten", () => {
  it("Insert mit fremder company_id wird abgelehnt (customer)", async () => {
    const { error } = await clientA
      .from("customer")
      .insert({ company_id: COMPANY_B, name: "Einschleusversuch", type: "lead" })
      .select();

    expect(error, "Insert mit fremder company_id muss scheitern").not.toBeNull();
  });

  it("Insert mit fremder company_id wird abgelehnt (article)", async () => {
    const { error } = await clientA
      .from("article")
      .insert({ company_id: COMPANY_B, sku: "LEAK-001", name: "Einschleusversuch" })
      .select();

    expect(error).not.toBeNull();
  });

  it("Update auf eine fremde Zeile trifft nichts", async () => {
    const { data: fremd, error: adminError } = await admin
      .from("customer")
      .select("id")
      .eq("company_id", COMPANY_B)
      .limit(1)
      .single();
    expect(adminError).toBeNull();

    const { data, error } = await clientA
      .from("customer")
      .update({ name: "Überschrieben" })
      .eq("id", fremd!.id)
      .select();

    // RLS filtert die Zeile weg: kein Fehler, aber auch keine Wirkung.
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);

    const { data: nachher } = await admin
      .from("customer")
      .select("name")
      .eq("id", fremd!.id)
      .single();
    expect(nachher?.name).not.toBe("Überschrieben");
  });

  it("Löschen einer fremden Zeile trifft nichts", async () => {
    const { data: fremd } = await admin
      .from("article")
      .select("id")
      .eq("company_id", COMPANY_B)
      .limit(1)
      .single();

    const { data, error } = await clientA
      .from("article")
      .delete()
      .eq("id", fremd!.id)
      .select();

    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);

    const { count } = await admin
      .from("article")
      .select("id", { count: "exact", head: true })
      .eq("id", fremd!.id);
    expect(count).toBe(1);
  });
});

describe("Joins: kein Durchgriff über Beziehungen", () => {
  it("eingebettete Kunden bleiben im eigenen Mandanten", async () => {
    const { data, error } = await clientA
      .from("job")
      .select("id, company_id, customer:customer_id (id, company_id)")
      .limit(200);

    expect(error).toBeNull();
    expect((data ?? []).length).toBeGreaterThan(0);

    for (const row of data ?? []) {
      // PostgREST typisiert eingebettete Beziehungen als Array, auch bei 1:1.
      const r = row as unknown as {
        company_id: string;
        customer: { company_id: string } | { company_id: string }[] | null;
      };
      expect(r.company_id).toBe(COMPANY_A);

      const kunden = r.customer
        ? Array.isArray(r.customer)
          ? r.customer
          : [r.customer]
        : [];
      for (const k of kunden) expect(k.company_id).toBe(COMPANY_A);
    }
  });

  it("Filter auf eine fremde company_id liefert nichts", async () => {
    const { data, error } = await clientA
      .from("job")
      .select("id")
      .eq("company_id", COMPANY_B);

    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });
});
