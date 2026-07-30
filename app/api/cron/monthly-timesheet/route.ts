import { aktiveMandanten, runCron } from "@/lib/cron";

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
    const jetzt = new Date();
    const vormonatEnde = new Date(
      Date.UTC(jetzt.getUTCFullYear(), jetzt.getUTCMonth(), 1),
    );
    const vormonatStart = new Date(
      Date.UTC(jetzt.getUTCFullYear(), jetzt.getUTCMonth() - 1, 1),
    );
    const periode = vormonatStart.toISOString().slice(0, 10);

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
        .from("job")
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
            link: "/stundenkonto",
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
