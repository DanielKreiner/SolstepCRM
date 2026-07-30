import { aktiveMandanten, postfachVon, runCron } from "@/lib/cron";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * Erinnerung an offene Angebote.
 *
 * Sieben Tage ohne Reaktion (CLAUDE.md 6.1). "Ohne Reaktion" heißt: gesendet,
 * aber weder geöffnet noch angenommen noch verloren. Je Angebot abschaltbar
 * über quote.reminder_enabled — wer einmal freundlich nachfragt, will nicht,
 * dass die Software danach weiter mahnt.
 */
export async function GET(request: Request) {
  return runCron(request, "quote-reminders", async (admin) => {
    const grenze = new Date();
    grenze.setDate(grenze.getDate() - 7);

    const erinnert: string[] = [];

    for (const mandant of await aktiveMandanten(admin)) {
      const { data: offen } = await admin
        .from("quote")
        .select(
          "id, number, sent_at, customer:customer_id ( name, email ), phase:phase_id ( system_key )",
        )
        .eq("company_id", mandant.id)
        .eq("reminder_enabled", true)
        .eq("status", "sent")
        .lt("sent_at", grenze.toISOString());

      if (!offen?.length) continue;

      const postfach = await postfachVon(admin, mandant.id);
      if (!postfach) continue;

      for (const q of offen) {
        const phase = (q.phase as unknown as { system_key: string | null } | null)
          ?.system_key;
        // Entschiedene Angebote nicht anfassen, auch wenn der Status hinterherhinkt.
        if (phase === "won" || phase === "lost") continue;

        const kunde = q.customer as unknown as {
          name: string;
          email: string | null;
        } | null;
        if (!kunde?.email) continue;

        // Schon einmal erinnert? Dann nicht noch einmal.
        const { count } = await admin
          .from("quote_event")
          .select("id", { count: "exact", head: true })
          .eq("quote_id", q.id)
          .eq("kind", "reminded");
        if ((count ?? 0) > 0) continue;

        await admin.from("mail_outbox").insert({
          company_id: mandant.id,
          mail_account_id: postfach,
          to_addrs: [kunde.email],
          subject: `Nachfrage zu unserem Angebot ${q.number as string}`,
          body_html:
            `<p>Guten Tag,</p><p>wir haben Ihnen vor einer Woche das Angebot ` +
            `${q.number as string} geschickt. Gibt es dazu offene Fragen?</p>` +
            `<p>Melden Sie sich gern, wir gehen es auch telefonisch durch.</p>`,
          body_text: `Nachfrage zum Angebot ${q.number as string}.`,
          quote_id: q.id,
        });

        await admin.from("quote_event").insert({
          company_id: mandant.id,
          quote_id: q.id,
          kind: "reminded",
        });

        erinnert.push(q.number as string);
      }
    }

    return { erinnert: erinnert.length, angebote: erinnert };
  });
}
