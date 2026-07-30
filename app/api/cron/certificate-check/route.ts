import { aktiveMandanten, runCron } from "@/lib/cron";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * Ablaufende Qualifikationen.
 *
 * Ein abgelaufener Nachweis ist kein Formfehler: ohne gültige Unterweisung
 * darf der Monteur nicht aufs Dach. Gewarnt wird 60, 30 und 7 Tage vorher —
 * 60 Tage, weil Kurse Vorlaufzeit haben.
 */
const STUFEN = [60, 30, 7];

export async function GET(request: Request) {
  return runCron(request, "certificate-check", async (admin) => {
    const heute = new Date();
    const gewarnt: string[] = [];

    for (const mandant of await aktiveMandanten(admin)) {
      const grenze = new Date(heute);
      grenze.setDate(grenze.getDate() + STUFEN[0]!);

      const { data: qualifikationen } = await admin
        .from("qualification")
        .select("id, name, valid_until, user_id, person:user_id ( name )")
        .eq("company_id", mandant.id)
        .not("valid_until", "is", null)
        .lte("valid_until", grenze.toISOString().slice(0, 10));

      if (!qualifikationen?.length) continue;

      const { data: fuehrung } = await admin
        .from("app_user")
        .select("id")
        .eq("company_id", mandant.id)
        .eq("active", true)
        .in("role", ["gf", "buero"]);

      for (const q of qualifikationen) {
        const tage = Math.ceil(
          (new Date(q.valid_until as string).getTime() - heute.getTime()) /
            86_400_000,
        );
        const stufe = STUFEN.find((s) => tage <= s && tage > (STUFEN[STUFEN.indexOf(s) + 1] ?? -9999));
        if (stufe === undefined && tage > 0) continue;

        const link = `/mitarbeiter/${q.user_id as string}`;
        const titel =
          tage <= 0
            ? `${q.name as string} ist abgelaufen`
            : `${q.name as string} läuft in ${tage} Tagen ab`;

        // Pro Qualifikation und Stufe nur einmal.
        const { count } = await admin
          .from("notification")
          .select("id", { count: "exact", head: true })
          .eq("company_id", mandant.id)
          .eq("kind", "qualification_expiring")
          .eq("title", titel);
        if ((count ?? 0) > 0) continue;

        const person = (q.person as unknown as { name: string } | null)?.name ?? "";
        for (const u of fuehrung ?? []) {
          await admin.from("notification").insert({
            company_id: mandant.id,
            user_id: u.id,
            kind: "qualification_expiring",
            title: titel,
            body: `${person}, gültig bis ${q.valid_until as string}`,
            link,
          });
        }
        gewarnt.push(`${person}: ${q.name as string}`);
      }
    }

    return { gewarnt: gewarnt.length, details: gewarnt };
  });
}
