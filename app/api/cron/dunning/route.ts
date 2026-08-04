import { aktiveMandanten, runCron } from "@/lib/cron";
import { BELEG_FELDER, mahnen } from "@/lib/mahnung";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * Mahnlauf.
 *
 * Läuft über alle Mandanten (CLAUDE.md Abschnitt 7). Quelle sind die
 * Rechnungsbelege am Vorgang: versendet, fällig, nicht ausgesetzt.
 *
 * Höchstens eine Stufe je Rechnung und Lauf — die Regel steckt in
 * lib/rules/dunning.ts und wird vom Knopf in der Offene-Posten-Liste
 * genauso befragt. Was der Lauf hier tut, tut ein Klick dort auch.
 */
export async function GET(request: Request) {
  return runCron(request, "dunning", async (admin) => {
    const heute = new Date().toISOString().slice(0, 10);
    const gemahnt: { nummer: string; stufe: number }[] = [];
    const uebersprungen: string[] = [];

    for (const mandant of await aktiveMandanten(admin)) {
      const { data: belege } = await admin
        .from("vorgang_dokument")
        .select(BELEG_FELDER)
        .eq("company_id", mandant.id)
        .in("typ", ["anzahlungsrechnung", "schlussrechnung"])
        .eq("status", "versendet")
        .eq("mahnung_aktiv", true)
        .not("faellig_am", "is", null)
        .lt("faellig_am", heute);

      for (const beleg of belege ?? []) {
        const ergebnis = await mahnen(admin, beleg, heute);
        if (ergebnis.ok) {
          gemahnt.push({
            nummer: ergebnis.nummer,
            stufe: ergebnis.stufe.stufe,
          });
        } else if (beleg.nummer) {
          /*
           * Fehlende Mailadresse oder kein Postfach ist kein Abbruch —
           * aber es soll im Lauf stehen. Sonst bleibt eine Rechnung
           * monatelang ungemahnt, und niemand weiss warum.
           */
          uebersprungen.push(`${beleg.nummer}: ${ergebnis.grund}`);
        }
      }
    }

    return { gemahnt: gemahnt.length, details: gemahnt, uebersprungen };
  });
}
