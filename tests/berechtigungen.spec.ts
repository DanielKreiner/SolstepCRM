import { beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/*
 * Rollenrechte innerhalb eines Mandanten.
 *
 * Der Isolationstest prüft die Grenze ZWISCHEN Mandanten. Dieser hier prüft
 * die Grenze INNERHALB eines Mandanten — und die ist beim ersten Anlauf
 * durchlässig gewesen:
 *
 *   - time_entry hing an can('zeiterfassung'), das ein Monteur zum eigenen
 *     Stempeln braucht. Er sah damit die Zeiten aller Kollegen.
 *   - app_user.hourly_cost war für jeden Angemeldeten lesbar.
 *
 * Beides ist behoben (Migrationen 0008 und 0009). Diese Tests halten es fest.
 */

const COMPANY_A = "11111111-1111-4111-8111-111111111111";

type Rolle = "gf" | "buero" | "bauleitung" | "monteur" | "lager";

const MAIL: Record<Rolle, string> = {
  gf: "gf@hofstaetter.example.com",
  buero: "buero@hofstaetter.example.com",
  bauleitung: "bauleitung@hofstaetter.example.com",
  monteur: "monteur@hofstaetter.example.com",
  lager: "lager@hofstaetter.example.com",
};

/** Rollen, die fremde Personendaten sehen dürfen. */
const DARF_PERSONALDATEN: Rolle[] = ["gf", "buero", "bauleitung"];

let admin: SupabaseClient;
const clients = new Map<Rolle, SupabaseClient>();
const ids = new Map<Rolle, string>();

async function anmelden(rolle: Rolle): Promise<SupabaseClient> {
  const c = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  const { error } = await c.auth.signInWithPassword({
    email: MAIL[rolle],
    password: process.env.SEED_PASSWORD!,
  });
  if (error) throw new Error(`${rolle}: ${error.message}`);
  return c;
}

beforeAll(async () => {
  admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  for (const rolle of Object.keys(MAIL) as Rolle[]) {
    clients.set(rolle, await anmelden(rolle));
    const { data } = await admin
      .from("app_user")
      .select("id")
      .eq("email", MAIL[rolle])
      .single();
    ids.set(rolle, data!.id as string);
  }
});

describe("Fremde Zeitdaten", () => {
  it("Monteur und Lager sehen ausschließlich die eigenen Zeiten", async () => {
    for (const rolle of ["monteur", "lager"] as Rolle[]) {
      const { data, error } = await clients
        .get(rolle)!
        .from("time_entry")
        .select("user_id")
        .limit(500);

      expect(error, `${rolle}: ${error?.message}`).toBeNull();
      const fremd = (data ?? []).filter((e) => e.user_id !== ids.get(rolle));
      expect(fremd, `${rolle} sieht fremde Zeiten`).toHaveLength(0);
    }
  });

  it("Rollen mit Personalrecht sehen die Zeiten des Teams", async () => {
    // Sonst könnte niemand Zeiten prüfen oder freigeben.
    for (const rolle of DARF_PERSONALDATEN) {
      const { data } = await clients
        .get(rolle)!
        .from("time_entry")
        .select("user_id")
        .limit(500);

      const fremd = (data ?? []).filter((e) => e.user_id !== ids.get(rolle));
      expect(fremd.length, `${rolle} sieht keine fremden Zeiten`).toBeGreaterThan(0);
    }
  });

  it("Monteur sieht keine fremden Abwesenheiten", async () => {
    const { data } = await clients
      .get("monteur")!
      .from("absence")
      .select("user_id")
      .limit(500);

    const fremd = (data ?? []).filter((a) => a.user_id !== ids.get("monteur"));
    expect(fremd).toHaveLength(0);
  });

  it("Monteur sieht keine fremden Korrekturanträge", async () => {
    const { data } = await clients
      .get("monteur")!
      .from("time_correction")
      .select("user_id")
      .limit(500);

    const fremd = (data ?? []).filter((k) => k.user_id !== ids.get("monteur"));
    expect(fremd).toHaveLength(0);
  });
});

describe("Stundensätze", () => {
  it("sind für keine Rolle als Spalte lesbar", async () => {
    for (const rolle of Object.keys(MAIL) as Rolle[]) {
      const { error } = await clients
        .get(rolle)!
        .from("app_user")
        .select("hourly_cost")
        .limit(1);

      expect(error, `${rolle} kann hourly_cost lesen`).not.toBeNull();
    }
  });

  it("kommen nur über die geprüfte Funktion, und nur mit Personalrecht", async () => {
    for (const rolle of Object.keys(MAIL) as Rolle[]) {
      const { data } = await clients
        .get(rolle)!
        .rpc("hourly_cost_of", { p_user: ids.get(rolle) });

      if (DARF_PERSONALDATEN.includes(rolle)) {
        expect(Number(data), `${rolle} bekommt keinen Satz`).toBeGreaterThan(0);
      } else {
        expect(data, `${rolle} bekommt einen Satz`).toBeNull();
      }
    }
  });

  it("verraten auch über die Funktion nichts über fremde Mandanten", async () => {
    const { data: fremd } = await admin
      .from("app_user")
      .select("id")
      .neq("company_id", COMPANY_A)
      .limit(1)
      .single();

    const { data } = await clients
      .get("gf")!
      .rpc("hourly_cost_of", { p_user: fremd!.id });

    expect(data).toBeNull();
  });

  it("die Namensliste bleibt für alle nutzbar", async () => {
    // Ohne sie ließe sich kein Auswahlfeld füllen.
    for (const rolle of Object.keys(MAIL) as Rolle[]) {
      const { data, error } = await clients
        .get(rolle)!
        .from("app_user")
        .select("id, name, role")
        .limit(50);

      expect(error, `${rolle}: ${error?.message}`).toBeNull();
      expect((data ?? []).length).toBeGreaterThan(0);
    }
  });
});

describe("Rechnungen", () => {
  it("sind nur mit Recht auf den Bereich sichtbar", async () => {
    const { count: gesamt } = await admin
      .from("invoice")
      .select("id", { count: "exact", head: true })
      .eq("company_id", COMPANY_A);

    for (const rolle of ["monteur", "lager"] as Rolle[]) {
      const { data } = await clients
        .get(rolle)!
        .from("invoice")
        .select("id")
        .limit(100);
      expect(data ?? [], `${rolle} sieht Rechnungen`).toHaveLength(0);
    }

    const { data: gfSicht } = await clients
      .get("gf")!
      .from("invoice")
      .select("id")
      .limit(100);
    expect((gfSicht ?? []).length).toBe(gesamt ?? 0);
  });
});

describe("Lagerjournal", () => {
  it("lässt sich von niemandem ändern oder löschen", async () => {
    const { data: zeile } = await admin
      .from("stock_move")
      .select("id")
      .eq("company_id", COMPANY_A)
      .limit(1)
      .single();

    for (const rolle of Object.keys(MAIL) as Rolle[]) {
      const c = clients.get(rolle)!;
      const { error: delErr } = await c
        .from("stock_move")
        .delete()
        .eq("id", zeile!.id);
      const { error: updErr } = await c
        .from("stock_move")
        .update({ qty: 1 })
        .eq("id", zeile!.id);

      expect(delErr, `${rolle} darf löschen`).not.toBeNull();
      expect(updErr, `${rolle} darf ändern`).not.toBeNull();
    }

    const { count } = await admin
      .from("stock_move")
      .select("id", { count: "exact", head: true })
      .eq("id", zeile!.id);
    expect(count).toBe(1);
  });
});

/*
 * Firmendaten: der Mandant pflegt seine Stammdaten selbst, aber nicht
 * seine Abrechnung. Die Trennung liegt in Spaltenrechten (0023) — eine
 * Row-Level-Policy kann sie nicht leisten, sie entscheidet über Zeilen.
 */
describe("company", () => {
  it("lässt die Geschäftsführung Stammdaten und Zeitregeln ändern", async () => {
    const c = clients.get("gf")!;

    const { data: vorher } = await admin
      .from("company")
      .select("iban, time_settings")
      .eq("id", COMPANY_A)
      .single();

    const { error } = await c
      .from("company")
      .update({ time_settings: { rundungMin: 5 } })
      .eq("id", COMPANY_A);
    expect(error).toBeNull();

    const { data: nachher } = await admin
      .from("company")
      .select("time_settings")
      .eq("id", COMPANY_A)
      .single();
    expect((nachher!.time_settings as { rundungMin: number }).rundungMin).toBe(5);

    await admin
      .from("company")
      .update({ time_settings: vorher!.time_settings })
      .eq("id", COMPANY_A);
  });

  it("lässt niemanden den eigenen Tarif schreiben", async () => {
    const { data: vorher } = await admin
      .from("company")
      .select("plan, seats, status, storage_quota_mb")
      .eq("id", COMPANY_A)
      .single();

    for (const rolle of Object.keys(MAIL) as Rolle[]) {
      const c = clients.get(rolle)!;

      for (const feld of ["plan", "seats", "status", "storage_quota_mb"]) {
        const wert =
          feld === "plan" ? "gratis" : feld === "status" ? "active" : 9999;
        const { error } = await c
          .from("company")
          .update({ [feld]: wert })
          .eq("id", COMPANY_A);

        expect(error, `${rolle} darf ${feld} schreiben`).not.toBeNull();
      }
    }

    const { data: nachher } = await admin
      .from("company")
      .select("plan, seats, status, storage_quota_mb")
      .eq("id", COMPANY_A)
      .single();
    expect(nachher).toEqual(vorher);
  });

  it("lässt die Montage keine Bankverbindung ändern", async () => {
    const c = clients.get("monteur")!;
    const { data: vorher } = await admin
      .from("company")
      .select("iban")
      .eq("id", COMPANY_A)
      .single();

    const { error } = await c
      .from("company")
      .update({ iban: "AT000000000000000000" })
      .eq("id", COMPANY_A);

    /*
     * Die Policy verlangt Schreibrecht auf "einstellungen". Ein UPDATE
     * ohne passende Zeile meldet keinen Fehler — geprüft wird deshalb die
     * Wirkung, nicht die Rückmeldung.
     */
    expect(error).toBeNull();

    const { data: nachher } = await admin
      .from("company")
      .select("iban")
      .eq("id", COMPANY_A)
      .single();
    expect(nachher!.iban).toBe(vorher!.iban);
  });
});

/*
 * Beträge am Vorgang. Die Grenze verlief zuerst über can('pipelines') —
 * und damit sah die Montage den Auftragswert, weil sie dieses Recht
 * braucht, um ihre Vorgänge überhaupt zu öffnen. Seit 0030 hängt die
 * View an can('angebote'): Bauleitung liest, Montage und Lager nicht.
 */
describe("v_vorgang_wert", () => {
  const DARF_BETRAEGE: Rolle[] = ["gf", "buero", "bauleitung"];

  it("zeigt Beträge nur dem Vertrieb", async () => {
    for (const rolle of Object.keys(MAIL) as Rolle[]) {
      const c = clients.get(rolle)!;
      const { data } = await c
        .from("v_vorgang_wert")
        .select("vorgang_id, auftragswert_netto")
        .limit(1);

      const sieht = (data ?? []).length > 0;
      expect(sieht, `${rolle} sieht Beträge`).toBe(DARF_BETRAEGE.includes(rolle));
    }
  });

  it("lässt die Montage die Spalten auch nicht direkt lesen", async () => {
    /*
     * Die View ist der einzige Weg. Wer sie umgeht und die Tabelle direkt
     * fragt, bekommt gar nichts — die Spalten haben kein Leserecht für
     * authenticated (0025).
     */
    const c = clients.get("monteur")!;
    const { error } = await c
      .from("vorgang")
      .select("auftragswert_netto")
      .limit(1);

    expect(error).not.toBeNull();
  });

  it("lässt die Montage ihre Vorgänge trotzdem sehen", async () => {
    // Ohne Adresse und Nummer könnte sie nicht zur Baustelle fahren.
    const c = clients.get("monteur")!;
    const { data, error } = await c
      .from("vorgang")
      .select("number, adresse, phase")
      .limit(1);

    expect(error).toBeNull();
    expect((data ?? []).length).toBeGreaterThan(0);
  });
});
