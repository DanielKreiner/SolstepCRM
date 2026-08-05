/*
 * Demobestand von Grund auf.
 *
 * Das Skript räumt alle Bewegungsdaten des Mandanten weg und baut einen
 * zusammenhängenden Bestand neu auf. Es ist kein Ergänzungs-Seed: was es
 * vorfindet, ist danach nicht mehr da.
 *
 * WAS BLEIBT
 *   Artikel, Einstellungen (Logo, Akzentfarbe, PDF-Layout, Zeitregeln),
 *   Standorte, Fahrzeuge, Lagerorte, Qualifikationen, Rollenrechte,
 *   Nummernkreise.
 *
 * WAS NEU ENTSTEHT
 *   Kunden, Vorgänge über alle Phasen, Angebotspositionen, Dokumente,
 *   Gates, Bedarfslisten, Bestellungen, Lagerbestand, Einsätze,
 *   Zeitbuchungen, Abwesenheiten, Serviceanliegen.
 *
 * Der Bestand ist bewusst nicht rund: eine Bestellung ist überfällig,
 * ein Vorgang ist verloren, eine Bedarfsposition ist ungedeckt, ein
 * Saldo steht im Minus. Eine Demo, in der alles grün ist, beantwortet
 * die einzige Frage nicht, die ein Betrieb hat — was passiert, wenn
 * etwas schiefgeht.
 *
 * Ausführen:  pnpm demo:neu
 */
import { readFileSync } from "node:fs";
import { fromZonedTime } from "date-fns-tz";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const COMPANY = "11111111-1111-4111-8111-111111111111";
const TZ = "Europe/Vienna";

function loadEnv(): Record<string, string> {
  try {
    return Object.fromEntries(
      readFileSync(".env.local", "utf8")
        .split("\n")
        .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
        .map((l) => [
          l.slice(0, l.indexOf("=")).trim(),
          l.slice(l.indexOf("=") + 1).trim().replace(/^"|"$/g, ""),
        ]),
    );
  } catch {
    return process.env as Record<string, string>;
  }
}

const env = { ...loadEnv(), ...process.env };

const db: SupabaseClient = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL!,
  env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

/* ----------------------------------------------------------- ZEITHILFEN */

/** Kalendertag in Ortszeit, n Tage von heute aus. */
function tag(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${zwei(d.getMonth() + 1)}-${zwei(d.getDate())}`;
}

function zwei(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Wanduhrzeit eines Tages als Zeitpunkt.
 *
 * Über date-fns-tz und nicht über toLocaleString: der Umweg
 * `new Date(x.toLocaleString(..., { timeZone }))` parst in der Zone des
 * SERVERS und liefert auf einem Rechner, der selbst in Wien steht, einen
 * Versatz von null — der Seed schriebe dann UTC-Zeiten und die Demo
 * stünde zwei Stunden daneben.
 */
function uhr(t: string, hhmm: string): string {
  return fromZonedTime(`${t}T${hhmm}:00`, TZ).toISOString();
}

/** Montag der laufenden Woche. */
function montag(): string {
  const d = new Date();
  const versatz = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - versatz);
  return `${d.getFullYear()}-${zwei(d.getMonth() + 1)}-${zwei(d.getDate())}`;
}

function plus(t: string, n: number): string {
  const d = new Date(`${t}T12:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${zwei(d.getMonth() + 1)}-${zwei(d.getDate())}`;
}

function istWerktag(t: string): boolean {
  const w = new Date(`${t}T12:00:00`).getDay();
  return w >= 1 && w <= 5;
}

/* ------------------------------------------------------------ AUFRÄUMEN */

/**
 * Alle Bewegungsdaten des Mandanten entfernen.
 *
 * Die Reihenfolge folgt den Fremdschlüsseln von innen nach aussen.
 * Vieles hinge auch an ON DELETE CASCADE, aber sich darauf zu verlassen
 * heisst, beim nächsten Schema-Zusatz eine Waise zu übersehen.
 */
async function aufraeumen(): Promise<void> {
  const tabellen = [
    "seriennummer",
    "lagerbewegung",
    "bestellposition",
    "bestellung_dokument",
    "bestellung",
    "vorgang_bedarf",
    "einsatz_stopp",
    "einsatz_event",
    "einsatz_person",
    "time_correction",
    "time_entry",
    "einsatz",
    "absence",
    "chat_message",
    "vorgang_event",
    "vorgang_gate",
    "vorgang_termin",
    "vorgang_dokument",
    "vorgang_position",
    "service_ticket",
    "vorgang",
    "portal_access",
    "mail_outbox",
    "notification",
    "customer",
  ];

  for (const t of tabellen) {
    const { error } = await db.from(t).delete().eq("company_id", COMPANY);
    /*
     * Eine Tabelle, die es nicht (mehr) gibt, ist kein Grund
     * abzubrechen — das Skript soll auch nach einem Schema-Umbau noch
     * laufen. Alles andere schon.
     */
    if (error && !/does not exist|schema cache/i.test(error.message)) {
      throw new Error(`${t}: ${error.message}`);
    }
  }

  /* Der Lagerbestand entsteht aus Bewegungen — die Altspalte mit. */
  await db.from("article").update({ stock: 0 }).eq("company_id", COMPANY);

  console.log("  Bewegungsdaten entfernt, Stammdaten unangetastet");
}

/* ------------------------------------------------------------ MITARBEITER */

type Person = { id: string; name: string; role: string; weekly: number };

/**
 * Die Mannschaft auffüllen.
 *
 * Mit einem einzigen Monteur sieht eine Plantafel aus wie ein
 * Einmannbetrieb — und die Konfliktprüfung, das Herzstück der Planung,
 * hat nichts, woran sie sich zeigen könnte. Die neuen Konten bekommen
 * dasselbe Passwort wie die bestehenden; es ist eine Demo.
 */
async function mannschaft(standortId: string): Promise<Person[]> {
  const neue = [
    { email: "monteur2@hofstaetter.example.com", name: "Lukas Berger", role: "monteur", weekly: 38.5 },
    { email: "monteur3@hofstaetter.example.com", name: "Markus Grabner", role: "monteur", weekly: 38.5 },
    { email: "monteur4@hofstaetter.example.com", name: "Stefan Aichinger", role: "monteur", weekly: 20 },
  ];

  const bekannt = new Map<string, string>();
  for (let seite = 1; ; seite++) {
    const { data, error } = await db.auth.admin.listUsers({ page: seite, perPage: 200 });
    if (error) throw error;
    for (const u of data.users) if (u.email) bekannt.set(u.email, u.id);
    if (data.users.length < 200) break;
  }

  for (const n of neue) {
    let id = bekannt.get(n.email);
    if (!id) {
      const { data, error } = await db.auth.admin.createUser({
        email: n.email,
        password: env.SEED_PASSWORD!,
        email_confirm: true,
        app_metadata: { company_id: COMPANY, role: n.role },
        user_metadata: { name: n.name },
      });
      if (error) throw error;
      id = data.user.id;
    }

    const { error } = await db.from("app_user").upsert(
      {
        id,
        company_id: COMPANY,
        location_id: standortId,
        name: n.name,
        email: n.email,
        role: n.role,
        weekly_hours: n.weekly,
        hourly_cost: 42,
        active: true,
      },
      { onConflict: "id" },
    );
    if (error) throw error;
  }

  const { data } = await db
    .from("app_user")
    .select("id, name, role, weekly_hours")
    .eq("company_id", COMPANY)
    .eq("active", true)
    .order("name");

  const leute = ((data ?? []) as { id: string; name: string; role: string; weekly_hours: number }[]).map(
    (u) => ({ id: u.id, name: u.name, role: u.role, weekly: Number(u.weekly_hours) }),
  );
  console.log(`  ${leute.length} Mitarbeiter, davon ${leute.filter((l) => l.role === "monteur").length} auf Montage`);
  return leute;
}

/* ---------------------------------------------------------------- KUNDEN */

type Kunde = { id: string; name: string; ort: string };

const KUNDEN = [
  {
    name: "Familie Brandstätter",

    kontakt: "Reinhard Brandstätter",
    mail: "r.brandstaetter@example.at",
    tel: "0664 1234567",
    adresse: "Ahornweg 12",
    plz: "4060",
    ort: "Leonding",
  },
  {
    name: "Tischlerei Aigner GmbH",

    kontakt: "Klaus Aigner",
    mail: "office@tischlerei-aigner.example.at",
    tel: "07242 44112",
    adresse: "Gewerbepark 8",
    plz: "4600",
    ort: "Wels",
  },
  {
    name: "Landwirtschaft Grubmüller",

    kontakt: "Josef Grubmüller",
    mail: "j.grubmueller@example.at",
    tel: "0676 9988776",
    adresse: "Hofstraße 3",
    plz: "4070",
    ort: "Eferding",
  },
  {
    name: "Dominic Steiner",

    kontakt: "Dominic Steiner",
    mail: "d.steiner@example.at",
    tel: "0699 11223344",
    adresse: "Neugasse 16",
    plz: "4020",
    ort: "Linz",
  },
  {
    name: "Autohaus Reisinger GmbH",

    kontakt: "Petra Reisinger",
    mail: "p.reisinger@autohaus-reisinger.example.at",
    tel: "07229 61200",
    adresse: "Industriezeile 44",
    plz: "4050",
    ort: "Traun",
  },
  {
    name: "Familie Hofer",

    kontakt: "Bernadette Hofer",
    mail: "b.hofer@example.at",
    tel: "0650 4455667",
    adresse: "Sonnleite 7",
    plz: "4210",
    ort: "Gallneukirchen",
  },
  {
    name: "Bäckerei Wimmer e.U.",

    kontakt: "Andreas Wimmer",
    mail: "a.wimmer@baeckerei-wimmer.example.at",
    tel: "07229 88440",
    adresse: "Hauptplatz 2",
    plz: "4052",
    ort: "Ansfelden",
  },
  {
    name: "Familie Mitterhuber",

    kontakt: "Karin Mitterhuber",
    mail: "k.mitterhuber@example.at",
    tel: "0664 7778899",
    adresse: "Am Kirchenberg 5",
    plz: "4111",
    ort: "Walding",
  },
] as const;

async function kunden(gfId: string): Promise<Kunde[]> {
  const zeilen = KUNDEN.map((k, i) => ({
    company_id: COMPANY,
    /*
     * lead oder customer — mehr kennt das Enum nicht, und das ist
     * richtig so: privat/gewerbe ist eine Eigenschaft des Namens, keine
     * des Datensatzes. Wer noch nichts beauftragt hat, ist ein Lead;
     * die ersten sechs haben laufende oder abgeschlossene Vorgänge.
     */
    type: i < 6 ? "customer" : "lead",
    number: `K-${String(1001 + i)}`,
    name: k.name,
    contact_person: k.kontakt,
    email: k.mail,
    phone: k.tel,
    address: k.adresse,
    zip: k.plz,
    city: k.ort,
    source: i % 3 === 0 ? "empfehlung" : i % 3 === 1 ? "website" : "messe",
    owner_id: gfId,
    created_by: gfId,
  }));

  const { data, error } = await db.from("customer").insert(zeilen).select("id, name, city");
  if (error) throw error;

  console.log(`  ${data!.length} Kunden`);
  return (data as { id: string; name: string; city: string }[]).map((k) => ({
    id: k.id,
    name: k.name,
    ort: k.city,
  }));
}

export { aufraeumen, mannschaft, kunden, db, COMPANY, tag, uhr, montag, plus, istWerktag, zwei };
export type { Person, Kunde };
