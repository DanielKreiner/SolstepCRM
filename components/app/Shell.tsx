import { Sidebar } from "@/components/app/Sidebar";
import { Topbar } from "@/components/app/Topbar";
import type { Me } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

/*
 * Gemeinsamer Rahmen für Backoffice und Mitarbeiter-Selfservice.
 *
 * Beide Bereiche teilen Sidebar und Kopfzeile — ein zweiter Nachbau würde
 * beim ersten Designwechsel auseinanderlaufen. Was sie unterscheidet, ist
 * ausschließlich der Inhalt.
 */
/** Nullen und fehlende Zaehler weglassen — eine "0" ist keine Meldung. */
function nurEchte(
  roh: Record<string, number | null>,
): Record<string, number> {
  const aus: Record<string, number> = {};
  for (const [k, v] of Object.entries(roh)) if (v && v > 0) aus[k] = v;
  return aus;
}

export async function Shell({
  me,
  children,
}: {
  me: Me;
  children: React.ReactNode;
}) {
  const supabase = await createClient();

  /*
   * Zaehler in der Navigation. In der Vorlage traegt fast jeder Eintrag
   * einen — und zwar nicht die Gesamtzahl der Datensaetze, sondern das,
   * was Arbeit macht: offene Angebote, unbezahlte Rechnungen, unbeantwortete
   * Antraege. Eine "214" neben CRM, die nur sagt, wie viele Kunden es gibt,
   * ist Dekoration; sie wird nie kleiner und niemand handelt danach.
   *
   * Alle Zaehler laufen als head-Count ueber RLS: was die Rolle nicht sehen
   * darf, zaehlt sie auch nicht mit.
   */
  const [
    { data: location },
    { count: unread },
    { count: lowStock },
    { count: angeboteOffen },
    { count: rechnungenOffen },
    { count: antraegeOffen },
    { count: korrekturenOffen },
    { count: ticketsOffen },
    { count: bewerberOffen },
  ] = await Promise.all([
    me.locationId
      ? supabase
          .from("location")
          .select("name")
          .eq("id", me.locationId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("notification")
      .select("id", { count: "exact", head: true })
      .is("read_at", null),
    supabase.from("v_stock_alert").select("id", { count: "exact", head: true }),
    supabase
      .from("quote")
      .select("id", { count: "exact", head: true })
      .in("status", ["sent", "opened"]),
    supabase
      .from("invoice")
      .select("id", { count: "exact", head: true })
      .not("status", "in", "(paid,draft)"),
    supabase
      .from("absence")
      .select("id", { count: "exact", head: true })
      .eq("status", "requested"),
    supabase
      .from("time_correction")
      .select("id", { count: "exact", head: true })
      .eq("status", "requested"),
    supabase
      .from("service_ticket")
      .select("id", { count: "exact", head: true })
      .not("status", "in", "(closed,resolved)"),
    supabase
      .from("applicant")
      .select("id", { count: "exact", head: true })
      .not("stage", "in", "(zusage,abgelehnt)"),
  ]);

  const visibleAreas = Object.entries(me.perms)
    .filter(([, level]) => level !== "none")
    .map(([area]) => area);

  return (
    <div className="flex h-dvh gap-[14px] overflow-hidden bg-app p-[14px]">
      <div className="hidden md:flex">
        <Sidebar
          companyName={me.company.name}
          locationName={location?.name ?? "Alle Standorte"}
          visibleAreas={visibleAreas}
          badges={nurEchte({
            "/angebote": angeboteOffen,
            "/lager": lowStock,
            "/rechnungen": rechnungenOffen,
            "/zeiterfassung": korrekturenOffen,
            "/abwesenheiten": antraegeOffen,
            "/crm": ticketsOffen,
            "/bewerber": bewerberOffen,
          })}
        />
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-[14px]">
        <Topbar name={me.name} role={me.role} unread={unread ?? 0} />
        <main className="flex-1 overflow-auto rounded-panel bg-panel px-4 pt-[26px] pb-8 shadow-soft sm:px-[26px]">
          <div className="mx-auto w-full max-w-[var(--content-max)]">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
