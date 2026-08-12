import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { LAUF_MARKE } from "./lauf-start";

/*
 * Testdaten nach dem Lauf entfernen.
 *
 * Die E2E-Tests laufen gegen dieselbe Supabase-Instanz, in der auch
 * gearbeitet wird. Jeder Lauf legt Planer-Projekte an, und die meisten
 * Tests räumten nur ihre eigenen Namen weg — was ein abgebrochener Lauf
 * hinterliess, blieb liegen.
 *
 * Das ist kein kosmetisches Problem: Nach drei Tagen standen 1965
 * Projekte in der Liste, alle auf zwei erfundenen Adressen. Wer den
 * Planer öffnete, landete in einem Testprojekt irgendwo im Burgenland
 * statt beim eigenen Kunden.
 */

export default async function laufEnde(): Promise<void> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return;

  let start: string;
  try {
    start = readFileSync(LAUF_MARKE, "utf8").trim();
  } catch {
    return; // ohne Startmarke wird nichts gelöscht
  }
  if (!start) return;

  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  const { data, error } = await db
    .from("planer_projekt")
    .delete()
    .gte("created_at", start)
    .select("id");

  if (error) {
    /*
     * Nicht werfen: Ein Aufräumfehler darf einen grünen Lauf nicht rot
     * machen. Stillschweigen darf er aber auch nicht.
     */
    console.error("Aufräumen der Planer-Projekte fehlgeschlagen:", error.message);
  } else if (data && data.length > 0) {
    console.log(`Aufgeräumt: ${data.length} Planer-Projekte aus diesem Lauf entfernt.`);
  }

  /*
   * Die Übergabe legt Kunden an. Entfernt wird nur, was der Lauf selbst
   * angelegt hat UND den Prüfnamen trägt — ein echter Kunde heisst
   * nicht „Prüfkunde", und einer mit Vorgang bliebe ohnehin stehen
   * (Fremdschlüssel).
   */
  const { data: kunden, error: kundenFehler } = await db
    .from("customer")
    .delete()
    .gte("created_at", start)
    .like("name", "Prüfkunde%")
    .select("id");

  if (kundenFehler) {
    console.error("Aufräumen der Prüfkunden fehlgeschlagen:", kundenFehler.message);
  } else if (kunden && kunden.length > 0) {
    console.log(`Aufgeräumt: ${kunden.length} Prüfkunden aus diesem Lauf entfernt.`);
  }
}
