import { Sidebar } from "@/components/app/Sidebar";
import { Topbar } from "@/components/app/Topbar";
import { requireMe } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const me = await requireMe();
  const supabase = await createClient();

  const [{ data: location }, { count: unread }, { count: lowStock }] =
    await Promise.all([
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
          badges={lowStock ? { "/lager": lowStock } : {}}
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
