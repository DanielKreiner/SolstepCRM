/*
 * Demobestand: alles weg, alles neu.
 *
 * Ein Lauf, der den Mandanten leerräumt und einen zusammenhängenden
 * Bestand aufbaut — Kunden, Vorgänge über alle Phasen, Material,
 * Planung, Zeiten. Stammdaten (Artikel, Einstellungen, Standorte,
 * Fahrzeuge, Lagerorte) bleiben unberührt.
 *
 * Ausführen:  pnpm demo:aufbauen
 *
 * Der Bestand ist bewusst nicht rund: eine Bestellung ist überfällig,
 * ein Vorgang verloren, ein Artikel unter Mindestbestand, ein
 * Urlaubsantrag offen. Eine Demo, in der alles grün leuchtet,
 * beantwortet die einzige Frage nicht, die ein Betrieb wirklich hat.
 */
import {
  COMPANY,
  aufraeumen,
  db,
  istWerktag,
  kunden,
  mannschaft,
  montag,
  plus,
  tag,
  uhr,
} from "./demo-neu";
import { positionen, vorgaenge } from "./demo-inhalt";
import {
  abwesenheiten,
  anliegen,
  bedarf,
  bestellungen,
  lagerbestand,
  mindestbestaende,
  nachweise,
  planung,
  rechnungen,
  termine,
  verlauf,
  werteNachziehen,
  zeiten,
} from "./demo-betrieb";

async function main(): Promise<void> {
  console.log("\nDemobestand neu aufbauen\n");

  /*
   * Ohne .order: location hat kein created_at, und eine Sortierung nach
   * einer Spalte, die es nicht gibt, lässt PostgREST die ganze Abfrage
   * leer zurückgeben — nicht nur die Sortierung fallen.
   */
  const { data: standort, error: standortFehler } = await db
    .from("location")
    .select("id, name")
    .eq("company_id", COMPANY)
    .order("name")
    .limit(1)
    .maybeSingle();

  if (standortFehler) throw new Error(`Standort: ${standortFehler.message}`);
  if (!standort) throw new Error("Kein Standort für den Mandanten gefunden.");

  const { data: lagerorte } = await db
    .from("lagerort")
    .select("id, name, art, fahrzeug_id")
    .eq("company_id", COMPANY);

  const orte = (lagerorte ?? []) as {
    id: string;
    name: string;
    art: string;
    fahrzeug_id: string | null;
  }[];

  const hauptlager = orte.find((o) => o.art === "hauptlager");
  if (!hauptlager) throw new Error("Kein Hauptlager gefunden.");

  const { data: autos, error: autoFehler } = await db
    .from("fahrzeug")
    .select("id, name")
    .eq("company_id", COMPANY)
    .eq("aktiv", true)
    .order("name");

  if (autoFehler) throw new Error(`Fahrzeuge: ${autoFehler.message}`);

  const fahrzeuge = ((autos ?? []) as { id: string; name: string }[]).map((f) => ({
    id: f.id,
    name: f.name,
    lagerortId: orte.find((o) => o.fahrzeug_id === f.id)?.id ?? null,
  }));

  await aufraeumen();

  const leute = await mannschaft(standort.id as string);
  const gf = leute.find((l) => l.role === "gf")!;
  const liste = await kunden(gf.id);

  const c = {
    db,
    company: COMPANY,
    kunden: liste,
    leute,
    hauptlager: hauptlager.id,
    fahrzeuge,
    uhr,
    tag,
    plus,
    montag,
    istWerktag,
  };

  const vs = await vorgaenge(c);
  await positionen(c, vs);
  await werteNachziehen(c, vs);
  await lagerbestand(c);
  await mindestbestaende(c, [
    "MOD-JAS-440",
    "WR-FRO-10",
    "SH-10281",
    "SH-10289",
    "UK-K2-SD",
    "SH-10262",
    "SH-10258",
  ]);
  await bedarf(c, vs);
  await bestellungen(c, vs);
  /*
   * Abwesenheiten zuerst: Planung und Zeiten fragen sie ab, damit
   * niemand eingeteilt oder gebucht wird, der krank oder auf Urlaub
   * war. Andersherum fänden sie nichts, und die Demo widerspräche sich
   * selbst — in einem Punkt, den die Software sonst gerade verhindert.
   */
  await abwesenheiten(c);
  const einsatzIds = await planung(c, vs);
  await termine(c, vs, einsatzIds);
  await zeiten(c, vs);
  await rechnungen(c, vs);
  await verlauf(c, vs);
  await nachweise(c);
  await anliegen(c, vs);

  console.log("\nFertig. Anmelden mit gf@hofstaetter.example.com\n");
}

main().catch((e) => {
  console.error("\nAbgebrochen:", e instanceof Error ? e.message : e);
  process.exit(1);
});
