import { runCron } from "@/lib/cron";
import { viennaDay } from "@/lib/format";
import { addDays, endOfViennaDay, startOfViennaDay } from "@/lib/time";
import { montageErinnerung } from "@/lib/vorgang/kundenmails";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * Die Erinnerung am Vortag.
 *
 * „Ich hab's vergessen, ich bin nicht daheim" ist die teuerste Absage
 * überhaupt: das Team steht mit Material vor einer verschlossenen
 * Einfahrt, und der Tag ist weg. Eine Mail am Vortag kostet nichts.
 *
 * Läuft morgens; wer sie abends bekäme, liest sie erst am Tag darauf.
 */
export async function GET(request: Request) {
  return runCron(request, "montage-erinnerung", async (admin) => {
    /*
     * Der Tag von morgen in Ortszeit. Über UTC gerechnet läge das
     * Fenster im Sommer zwei Stunden daneben und erwischte Einsätze,
     * die erst übermorgen früh beginnen.
     */
    const tag = addDays(viennaDay(), 1);
    const von = startOfViennaDay(tag).toISOString();
    const bis = endOfViennaDay(tag).toISOString();

    const { data: morgen } = await admin
      .from("einsatz")
      .select("id, company_id, vorgang_id, von, bis, ganztaegig")
      .eq("art", "auftrag")
      .not("vorgang_id", "is", null)
      .gte("von", von)
      .lt("von", bis);

    let geschickt = 0;
    for (const e of (morgen ?? []) as unknown as {
      id: string;
      company_id: string;
      vorgang_id: string;
      von: string;
      bis: string;
      ganztaegig: boolean;
    }[]) {
      /*
       * Nur einmal je Einsatz. Vercel kann einen Cron doppelt zustellen,
       * und zwei Erinnerungen an denselben Kunden wirken schlampig.
       */
      const { count } = await admin
        .from("einsatz_event")
        .select("id", { count: "exact", head: true })
        .eq("einsatz_id", e.id)
        .eq("typ", "erinnerung");

      if ((count ?? 0) > 0) continue;

      const an = await montageErinnerung(e.company_id, e.vorgang_id, {
        von: e.von,
        bis: e.bis,
        ganztaegig: e.ganztaegig,
      });
      if (!an) continue;

      await admin.from("einsatz_event").insert({
        company_id: e.company_id,
        einsatz_id: e.id,
        typ: "erinnerung",
        titel: "Erinnerung an den Kunden geschickt",
        body: `An ${an}`,
      });
      geschickt++;
    }

    return { morgen: (morgen ?? []).length, geschickt };
  });
}
