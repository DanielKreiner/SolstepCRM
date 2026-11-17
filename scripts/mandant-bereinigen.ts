/*
 * Einen Mandanten auf Anfang stellen — für die Uebergabe an einen
 * echten Betrieb.
 *
 * Unterschied zu `demo-aufbauen`: Das hier räumt nur weg und baut
 * nichts auf. Was bleibt, ist der Teil, der einem neuen Betrieb am
 * ersten Tag nützt — Artikelstamm, Planer-Stammdaten, Rollenmatrix,
 * Phasen, Checklistenvorlagen, Zeitregeln, Erscheinungsbild.
 *
 * Was verschwindet, ist alles, was nach einem fremden Betrieb aussieht:
 * Kunden, Vorgänge, Belege, Zeiten, Einsätze, Lagerbewegungen,
 * Planungen, Mail, Benachrichtigungen, Serviceanliegen, erfundene
 * Lieferanten und die Demokonten.
 *
 * Ausführen:
 *   pnpm mandant:bereinigen                 Trockenlauf, zeigt nur an
 *   pnpm mandant:bereinigen --wirklich      führt aus
 *
 * Zusätzliche Schalter:
 *   --ek-behalten    lässt die Einkaufspreise stehen (Vorgabe: leeren)
 *   --nummern-behalten  lässt die Nummernkreise weiterlaufen
 *
 * Zu den Einkaufspreisen: Im Artikelstamm stehen die Einkaufspreise, mit
 * denen dieser Bestand aufgebaut wurde. Das sind die Konditionen eines
 * bestimmten Händlers, nicht die des übernehmenden Betriebs. Sie
 * stehen zu lassen hiesse, fremde Einkaufskonditionen weiterzugeben und
 * dem neuen Betrieb eine Nachkalkulation zu zeigen, die nicht seine ist.
 * Deshalb werden sie geleert; der Verkaufspreis bleibt als Listenpreis
 * stehen.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

for (const zeile of readFileSync(".env.local", "utf8").split("\n")) {
  if (!/^[A-Z_0-9]+=/.test(zeile)) continue;
  const i = zeile.indexOf("=");
  const schluessel = zeile.slice(0, i);
  if (process.env[schluessel] === undefined) {
    process.env[schluessel] = zeile.slice(i + 1).replace(/^"|"$/g, "");
  }
}

const COMPANY = process.env.MANDANT_ID ?? "11111111-1111-4111-8111-111111111111";
const WIRKLICH = process.argv.includes("--wirklich");
const EK_BEHALTEN = process.argv.includes("--ek-behalten");
const NUMMERN_BEHALTEN = process.argv.includes("--nummern-behalten");

const db: SupabaseClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

/*
 * Reihenfolge von innen nach aussen entlang der Fremdschlüssel.
 * Vieles hängt auch an ON DELETE CASCADE — sich darauf zu verlassen
 * heisst, beim nächsten Schema-Zusatz eine Waise zu übersehen.
 */
const WEG = [
  // Lager und Beschaffung
  "seriennummer",
  "stock_reservation",
  "stock_move",
  "lagerbewegung",
  "bestellposition",
  "bestellung_dokument",
  "bestellung",
  "purchase_order_item",
  "purchase_order",
  "vorgang_bedarf",
  // Planung und Zeit
  "einsatz_stopp",
  "einsatz_event",
  "einsatz_person",
  "roster_publication",
  "time_correction",
  "time_entry",
  "time_account_move",
  "einsatz",
  "absence",
  // Vorgang mit allem, was daranhängt
  "vorgang_termin_person",
  "vorgang_termin",
  "vorgang_checkliste_punkt",
  "vorgang_checkliste",
  "vorgang_nachricht",
  "vorgang_anfrage",
  "vorgang_anhang",
  "vorgang_event",
  "vorgang_gate",
  "vorgang_dokument",
  "vorgang_position",
  "vorgang_gruppe",
  "job_document",
  "service_message",
  "service_ticket",
  "vorgang",
  // Kunde und was ihm gehört
  "planer_projekt",
  "plant",
  "portal_access",
  "contact_activity",
  "customer",
  // Kommunikation
  "chat_message",
  "chat_channel",
  "mail_attachment",
  "mail_message",
  "mail_outbox",
  "mail_account",
  "notification",
  // Betrieb
  "applicant",
  "support_session",
  "usage_snapshot",
  /*
   * `search_index` steht bewusst NICHT hier: Das ist eine View über die
   * Fachtabellen, keine eigene Ablage. Ein Löschversuch scheitert mit
   * "cannot delete from view" und bricht den ganzen Lauf ab — was leer
   * werden muss, wird es von selbst, sobald die Quellen leer sind.
   */
  // Erfundene Stammdaten
  "angebot_vorlage_position",
  "angebot_vorlage_gruppe",
  "angebot_vorlage",
  "article_supplier",
  "supplier",
];

async function zaehle(tabelle: string): Promise<number | null> {
  const { count, error } = await db
    .from(tabelle)
    .select("*", { count: "exact", head: true })
    .eq("company_id", COMPANY);
  if (error) return null;
  return count ?? 0;
}

async function main(): Promise<void> {
  const { data: firma } = await db
    .from("company")
    .select("name, city")
    .eq("id", COMPANY)
    .maybeSingle();

  if (!firma) throw new Error(`Mandant ${COMPANY} nicht gefunden.`);

  console.log(`\nMandant: ${firma.name} (${firma.city ?? "ohne Ort"})`);
  console.log(WIRKLICH ? "Modus:   ausführen\n" : "Modus:   Trockenlauf\n");

  let summe = 0;
  for (const tabelle of WEG) {
    const n = await zaehle(tabelle);
    if (n === null) continue; // Tabelle gibt es (noch) nicht
    if (n === 0) continue;
    summe += n;
    console.log(`  ${String(n).padStart(6)}  ${tabelle}`);

    if (WIRKLICH) {
      const { error } = await db.from(tabelle).delete().eq("company_id", COMPANY);
      if (error && !/does not exist|schema cache/i.test(error.message)) {
        throw new Error(`${tabelle}: ${error.message}`);
      }
    }
  }
  console.log(`  ${String(summe).padStart(6)}  Zeilen insgesamt\n`);

  /* Bestand entsteht aus Bewegungen — ohne Bewegungen ist er null. */
  if (WIRKLICH) {
    await db.from("article").update({ stock: 0 }).eq("company_id", COMPANY);
    if (!EK_BEHALTEN) {
      await db.from("article").update({ purchase_price: 0 }).eq("company_id", COMPANY);
    }
  }
  console.log(
    EK_BEHALTEN
      ? "  Bestand auf null, Einkaufspreise bleiben stehen"
      : "  Bestand auf null, Einkaufspreise geleert",
  );

  /*
   * Nummernkreise. Ein übernehmender Betrieb will meist bei 1
   * anfangen — wer seine bisherige Nummerierung fortführen muss, weil
   * die Buchhaltung daran hängt, setzt den Stand danach von Hand.
   */
  if (!NUMMERN_BEHALTEN) {
    const n = await zaehle("doc_counter");
    console.log(`  Nummernkreise zurücksetzen (${n ?? 0} Zähler)`);
    if (WIRKLICH) await db.from("doc_counter").delete().eq("company_id", COMPANY);
  } else {
    console.log("  Nummernkreise bleiben stehen");
  }

  /*
   * Demokonten. Erkennbar an der Beispieldomain — eine echte Adresse
   * wird nie gelöscht, auch nicht versehentlich.
   */
  const { data: konten } = await db
    .from("app_user")
    .select("id, name, email")
    .eq("company_id", COMPANY)
    .like("email", "%@%.example.com");

  console.log(`\n  Demokonten (${konten?.length ?? 0}):`);
  for (const k of konten ?? []) {
    console.log(`    ${k.email}  ${k.name}`);
    if (WIRKLICH) await db.auth.admin.deleteUser(k.id as string);
  }

  const { data: echte } = await db
    .from("app_user")
    .select("id, name, email, active")
    .eq("company_id", COMPANY)
    .not("email", "like", "%@%.example.com");

  /*
   * Wer bleibt, muss auch hineinkommen. Ein inaktives Konto kann sich
   * zwar noch anmelden, bekommt aber bewusst keinen Link über
   * "Passwort vergessen" — und nach dem Entfernen der Demokonten ist
   * dieses eine der einzige Zugang zum Mandanten.
   */
  if (WIRKLICH) {
    for (const e of echte ?? []) {
      if (e.active === false) {
        await db.from("app_user").update({ active: true }).eq("id", e.id as string);
      }
    }
  }

  console.log(`\n  Bleibt (${echte?.length ?? 0}):`);
  for (const e of echte ?? []) {
    console.log(
      `    ${e.email}  ${e.name}${e.active ? "" : WIRKLICH ? "  (war inaktiv, wieder aktiv)" : "  (inaktiv)"}`,
    );
  }

  console.log(
    WIRKLICH
      ? "\nFertig. Stammdaten unangetastet: Artikel, Planer, Rollen, Phasen, Checklisten, Standorte, Fahrzeuge, Lagerorte.\n"
      : "\nTrockenlauf. Mit --wirklich ausführen.\n",
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
