import { aktiveMandanten, postfachVon, runCron } from "@/lib/cron";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * Erinnerung an offene Angebote.
 *
 * Sieben Tage ohne Reaktion (CLAUDE.md 6.1). "Ohne Reaktion" heißt jetzt:
 * der Vorgang steht in Phase 'angebot', das Angebot ist versendet und
 * seither hat sich nichts bewegt — weder eine Annahme (dann wäre die
 * Phase 'beauftragt') noch eine Absage (dann 'verloren').
 *
 * Genau einmal je Vorgang. Wer freundlich nachfragt, will nicht, dass die
 * Software danach wöchentlich weitermahnt; der Merker ist ein Event am
 * Vorgang und steht damit sichtbar im Aktivitätsstrom, statt in einer
 * Spalte, die niemand aufmacht.
 */
export async function GET(request: Request) {
  return runCron(request, "quote-reminders", async (admin) => {
    const grenze = new Date();
    grenze.setDate(grenze.getDate() - 7);

    const erinnert: string[] = [];

    for (const mandant of await aktiveMandanten(admin)) {
      const { data: offen } = await admin
        .from("vorgang")
        .select("id, number, phase_seit, customer:customer_id ( name, email )")
        .eq("company_id", mandant.id)
        .eq("phase", "angebot")
        .lt("phase_seit", grenze.toISOString());

      if (!offen?.length) continue;

      /* Ohne Postfach wird trotzdem eingereiht — siehe lib/mail/resend.ts. */
      const postfach = await postfachVon(admin, mandant.id);

      for (const v of offen) {
        const kunde = v.customer as unknown as {
          name: string;
          email: string | null;
        } | null;
        if (!kunde?.email) continue;

        /*
         * Ohne versendetes Angebot gibt es nichts nachzufassen. Die Phase
         * allein reicht als Bedingung nicht — sie lässt sich von Hand
         * setzen, und dann stünde beim Kunden eine Nachfrage zu einem
         * Angebot, das er nie bekommen hat.
         */
        const { count: versendet } = await admin
          .from("vorgang_dokument")
          .select("id", { count: "exact", head: true })
          .eq("vorgang_id", v.id)
          .eq("typ", "angebot")
          .in("status", ["versendet", "angenommen"]);
        if (!versendet) continue;

        const { count: schon } = await admin
          .from("vorgang_event")
          .select("id", { count: "exact", head: true })
          .eq("vorgang_id", v.id)
          .eq("typ", "email")
          .contains("payload", { nachfassen: true });
        if ((schon ?? 0) > 0) continue;

        await admin.from("mail_outbox").insert({
          company_id: mandant.id,
          mail_account_id: postfach,
          to_addrs: [kunde.email],
          subject: `Nachfrage zu unserem Angebot ${v.number as string}`,
          body_html:
            `<p>Guten Tag,</p><p>wir haben Ihnen vor einer Woche das Angebot ` +
            `${v.number as string} geschickt. Gibt es dazu offene Fragen?</p>` +
            `<p>Melden Sie sich gern, wir gehen es auch telefonisch durch.</p>`,
          body_text: `Nachfrage zum Angebot ${v.number as string}.`,
          vorgang_id: v.id,
        });

        await admin.from("vorgang_event").insert({
          company_id: mandant.id,
          vorgang_id: v.id,
          typ: "email",
          titel: "Nachgefasst",
          body: `Erinnerung an das Angebot an ${kunde.name}.`,
          payload: { nachfassen: true },
          kunde_sichtbar: false,
        });

        erinnert.push(v.number as string);
      }
    }

    return { erinnert: erinnert.length, angebote: erinnert };
  });
}
