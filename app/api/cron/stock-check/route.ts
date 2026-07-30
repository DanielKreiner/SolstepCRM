import { aktiveMandanten, minutenSchluessel, runCron } from "@/lib/cron";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * Stündlicher Bestandscheck.
 *
 * Meldet Artikel unter Mindestbestand — aber nur einmal, bis sich der
 * Zustand ändert. Eine Benachrichtigung, die jede Stunde erneut kommt,
 * schaltet man nach zwei Tagen ab, und dann sieht man auch die wichtige nicht.
 */
export async function GET(request: Request) {
  return runCron(
    request,
    "stock-check",
    async (admin) => {
      const gemeldet: { mandant: string; artikel: number }[] = [];

      for (const mandant of await aktiveMandanten(admin)) {
        const { data: knapp } = await admin
          .from("v_stock_alert")
          .select("id, sku, name, stock, min_stock, unit")
          .eq("company_id", mandant.id);

        if (!knapp?.length) continue;

        const { data: lageristen } = await admin
          .from("app_user")
          .select("id")
          .eq("company_id", mandant.id)
          .eq("active", true)
          .in("role", ["lager", "gf"]);

        let neu = 0;
        for (const a of knapp) {
          const link = `/lager/${a.id as string}`;

          // Offene Meldung zu diesem Artikel? Dann nichts tun.
          const { count } = await admin
            .from("notification")
            .select("id", { count: "exact", head: true })
            .eq("company_id", mandant.id)
            .eq("kind", "stock_low")
            .eq("link", link)
            .is("read_at", null);
          if ((count ?? 0) > 0) continue;

          for (const u of lageristen ?? []) {
            await admin.from("notification").insert({
              company_id: mandant.id,
              user_id: u.id,
              kind: "stock_low",
              title: `${a.sku as string} unter Mindestbestand`,
              body: `${a.stock as string} ${a.unit as string} von ${a.min_stock as string} — ${a.name as string}`,
              link,
            });
          }
          neu++;
        }

        if (neu > 0) gemeldet.push({ mandant: mandant.name, artikel: neu });
      }

      return { gemeldet };
    },
    { runKey: minutenSchluessel("stock-check", 60) },
  );
}
