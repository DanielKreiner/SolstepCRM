import { runCron } from "@/lib/cron";
import { pruefeAlle, type LaufendeBuchung } from "@/lib/einsatz/zeitschutz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * Vergessene Zeitbuchungen einfangen.
 *
 * Ein Monteur vergisst das Ausstempeln. Am nächsten Morgen läuft die
 * Buchung seit vierzehn Stunden weiter, und niemand weiss mehr, wann er
 * wirklich Feierabend hatte. Die Zahl landet irgendwann in einer
 * Auswertung, wo sie niemandem mehr auffällt.
 *
 * Über Mitternacht oder länger als zwölf Stunden wird deshalb automatisch
 * gestoppt und als „zu prüfen" markiert. Nicht gelöscht und nicht
 * geraten — das Büro sieht die Buchung in der Korrekturliste und
 * entscheidet, was wirklich war.
 *
 * Stündlich, weil eine Stunde Ungenauigkeit bei einer ohnehin zu
 * korrigierenden Buchung nichts kostet; minütlich wäre nur Last.
 */
export async function GET(request: Request) {
  return runCron(request, "zeit-schutz", async (admin) => {
    const jetzt = new Date();

    /*
     * Über alle Mandanten in einem Zug: die Regel hängt an keiner
     * Firmeneinstellung, und laufende Buchungen sind selten.
     */
    const { data: laufend } = await admin
      .from("time_entry")
      .select("id, user_id, company_id, started_at")
      .eq("status", "running");

    const buchungen: LaufendeBuchung[] = ((laufend ?? []) as unknown as {
      id: string;
      user_id: string;
      started_at: string;
    }[]).map((t) => ({ id: t.id, userId: t.user_id, startedAt: t.started_at }));

    const vorschlaege = pruefeAlle(buchungen, jetzt);
    const firmaVon = new Map(
      ((laufend ?? []) as unknown as { id: string; company_id: string }[]).map(
        (t) => [t.id, t.company_id],
      ),
    );

    let gestoppt = 0;
    for (const v of vorschlaege) {
      const { error } = await admin
        .from("time_entry")
        .update({
          ended_at: v.endeAt,
          status: "flagged",
          flagged_reason: v.text,
        })
        .eq("id", v.id)
        /*
         * Nur solange sie noch läuft. Zwischen Lesen und Schreiben kann
         * der Monteur selbst ausgestempelt haben — dann gilt seine Zeit
         * und nicht unsere Schätzung.
         */
        .eq("status", "running");

      if (error) continue;
      gestoppt++;

      const firma = firmaVon.get(v.id);
      if (!firma) continue;

      const { data: buero } = await admin
        .from("app_user")
        .select("id")
        .eq("company_id", firma)
        .eq("active", true)
        .in("role", ["buero", "gf"]);

      for (const u of buero ?? []) {
        await admin.from("notification").insert({
          company_id: firma,
          user_id: u.id as string,
          kind: "time_flagged",
          title: "Zeitbuchung zu prüfen",
          body: v.text,
          link: "/zeiterfassung?filter=zu-pruefen",
        });
      }
    }

    return { gepruefte: buchungen.length, gestoppt };
  });
}
