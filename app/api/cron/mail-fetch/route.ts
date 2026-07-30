import { minutenSchluessel, runCron } from "@/lib/cron";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * Mailabruf, alle fünf Minuten (CLAUDE.md 6.1).
 *
 * Warum Cron und nicht IMAP IDLE: IDLE braucht eine dauerhafte Verbindung,
 * die es auf Vercel nicht gibt. Fünf Minuten sind für einen Handwerksbetrieb
 * mehr als genug.
 *
 * Der Abruf selbst steht in lib/mail/fetch.ts und ist frei von
 * Next-Abhängigkeiten — er wandert unverändert in einen Dauerworker, sobald
 * ein Mandant Sekunden-Reaktion braucht.
 *
 * Ohne verbundenes Postfach ruht der Job. Ein Konto gilt erst als
 * verbunden, wenn der Verbindungstest gelaufen ist (status 'ok').
 */
export async function GET(request: Request) {
  return runCron(
    request,
    "mail-fetch",
    async (admin) => {
      const { data: konten } = await admin
        .from("mail_account")
        .select("id, company_id, provider, address, status")
        .eq("status", "ok");

      if (!konten?.length) {
        return { konten: 0, hinweis: "Kein verbundenes Postfach." };
      }

      const { holeNeueMails } = await import("@/lib/mail/fetch");
      const ergebnis: { konto: string; neu: number; fehler?: string }[] = [];

      for (const konto of konten) {
        try {
          const neu = await holeNeueMails(admin, konto.id as string);
          ergebnis.push({ konto: konto.address as string, neu });
        } catch (e) {
          const meldung = e instanceof Error ? e.message : "Abruf fehlgeschlagen";
          await admin
            .from("mail_account")
            .update({ status: "error", last_error: meldung })
            .eq("id", konto.id);
          ergebnis.push({ konto: konto.address as string, neu: 0, fehler: meldung });
        }
      }

      return { konten: konten.length, ergebnis };
    },
    { runKey: minutenSchluessel("mail-fetch", 5) },
  );
}
