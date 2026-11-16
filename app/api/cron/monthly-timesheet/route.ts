import { aktiveMandanten, runCron } from "@/lib/cron";
import { viennaDay } from "@/lib/format";
import { startOfViennaDay } from "@/lib/time";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * Monatsabschluss der Zeiterfassung.
 *
 * Läuft am Ersten für den Vormonat. Aufgabe: gebuchte Zeiten auf 'approved'
 * setzen und den Monatssaldo als usage_snapshot festhalten.
 *
 * Bewusst NICHT abgeschlossen werden Buchungen mit status 'flagged' oder
 * offenem Korrekturantrag — beides sind Fälle, die ein Mensch ansehen muss.
 * Ein Abschluss, der Zweifelsfälle mitnimmt, ist keiner.
 */
export async function GET(request: Request) {
  return runCron(request, "monthly-timesheet", async (admin) => {
    /*
     * Die Monatsgrenzen laufen über Europe/Vienna, nicht über UTC.
     *
     * `Date.UTC(...)` setzte den Monatsersten auf 00:00 UTC, also 01:00
     * Ortszeit (02:00 im Sommer). Die erste Stunde des Monats fiel damit
     * aus dem Abschluss und die letzte Stunde des Vormonats hinein: eine
     * Frühschicht ab 06:00 bleibt unberührt, aber jede Nachtbuchung
     * wanderte in den falschen Monat. Dasselbe Fenster bestimmt
     * `usage_snapshot` — das ist die Abrechnungsgrundlage.
     */
    const heute = viennaDay();
    const [jahr, monat] = heute.split("-").map(Number);
    const vorJahr = monat === 1 ? jahr! - 1 : jahr!;
    const vorMonat = monat === 1 ? 12 : monat! - 1;

    const periode = `${vorJahr}-${String(vorMonat).padStart(2, "0")}-01`;
    const vormonatStart = startOfViennaDay(periode);
    const vormonatEnde = startOfViennaDay(`${heute.slice(0, 7)}-01`);

    const ergebnis: { mandant: string; genehmigt: number; offen: number }[] = [];

    for (const mandant of await aktiveMandanten(admin)) {
      const { data: buchungen } = await admin
        .from("time_entry")
        .select("id, user_id, duration_min, status")
        .eq("company_id", mandant.id)
        .gte("started_at", vormonatStart.toISOString())
        .lt("started_at", vormonatEnde.toISOString())
        .not("ended_at", "is", null);

      const { data: offeneKorrekturen } = await admin
        .from("time_correction")
        .select("time_entry_id")
        .eq("company_id", mandant.id)
        .eq("status", "requested");

      const blockiert = new Set(
        (offeneKorrekturen ?? []).map((k) => k.time_entry_id as string),
      );

      const zuGenehmigen = (buchungen ?? []).filter(
        (b) => b.status === "booked" && !blockiert.has(b.id as string),
      );
      const offen = (buchungen ?? []).filter(
        (b) => b.status === "flagged" || blockiert.has(b.id as string),
      );

      for (const b of zuGenehmigen) {
        await admin
          .from("time_entry")
          .update({ status: "approved" })
          .eq("id", b.id);
      }

      const { count: aktiveNutzer } = await admin
        .from("app_user")
        .select("id", { count: "exact", head: true })
        .eq("company_id", mandant.id)
        .eq("active", true);

      const { count: neueAuftraege } = await admin
        .from("vorgang")
        .select("id", { count: "exact", head: true })
        .eq("company_id", mandant.id)
        .gte("created_at", vormonatStart.toISOString())
        .lt("created_at", vormonatEnde.toISOString());

      const { count: mails } = await admin
        .from("mail_outbox")
        .select("id", { count: "exact", head: true })
        .eq("company_id", mandant.id)
        .gte("created_at", vormonatStart.toISOString())
        .lt("created_at", vormonatEnde.toISOString());

      // Grundlage der Abrechnung (CLAUDE.md 12.a).
      await admin.from("usage_snapshot").upsert(
        {
          company_id: mandant.id,
          period: periode,
          active_users: aktiveNutzer ?? 0,
          jobs_created: neueAuftraege ?? 0,
          mails_sent: mails ?? 0,
          storage_mb: 0,
        },
        { onConflict: "company_id,period" },
      );

      if (offen.length > 0) {
        const { data: fuehrung } = await admin
          .from("app_user")
          .select("id")
          .eq("company_id", mandant.id)
          .eq("active", true)
          .in("role", ["gf", "buero"]);

        for (const u of fuehrung ?? []) {
          await admin.from("notification").insert({
            company_id: mandant.id,
            user_id: u.id,
            kind: "timesheet_open",
            title: `${offen.length} Zeitbuchungen aus ${periode.slice(0, 7)} offen`,
            body: "Geprüfte Buchungen oder offene Korrekturen. Der Monatsabschluss hat sie ausgelassen.",
            link: "/zeiten?tab=konten",
          });
        }
      }

      ergebnis.push({
        mandant: mandant.name,
        genehmigt: zuGenehmigen.length,
        offen: offen.length,
      });
    }

    return { periode, ergebnis };
  });
}
