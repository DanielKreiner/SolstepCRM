import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Panel } from "@/components/ui/Panel";
import { Pill } from "@/components/ui/Pill";
import { Button } from "@/components/ui/Button";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "../logout/actions";

export const metadata: Metadata = { title: "Cockpit" };

export default async function CockpitPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  /*
   * Erster echter RLS-Lesezugriff: company kommt ausschliesslich ueber die
   * Policy company_select, nicht ueber eine company_id aus dem Client.
   * Kein maybeSingle mit Annahme — wenn hier nichts kommt, fehlt das
   * app_metadata.company_id des Nutzers, und das soll man sehen.
   */
  const { data: company, error } = await supabase
    .from("company")
    .select("id, name, status")
    .maybeSingle();

  return (
    <main className="mx-auto max-w-[var(--content-max)] p-[14px]">
      <Panel className="p-[30px]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-[22px] font-bold tracking-[-0.02em]">Cockpit</h1>
            <p className="mt-[3px] text-[13px] text-muted">
              Angemeldet als{" "}
              <span className="num break-all">{user.email}</span>
            </p>
          </div>
          <form action={signOut}>
            <Button variant="ghost" type="submit">
              Abmelden
            </Button>
          </form>
        </div>

        <div className="mt-[22px] border-t border-line pt-[18px]">
          {error ? (
            <p className="text-[13px] text-s-crit">
              Mandant konnte nicht geladen werden: {error.message}
            </p>
          ) : company ? (
            <div className="flex flex-wrap items-center gap-x-[10px] gap-y-[6px]">
              <span className="text-[15px] font-semibold">{company.name}</span>
              <Pill tone={company.status === "active" ? "done" : "warn"}>
                {company.status}
              </Pill>
              <span className="num w-full truncate text-[11px] text-faint">
                {company.id}
              </span>
            </div>
          ) : (
            <p className="text-[13px] text-muted">
              Kein Mandant sichtbar. Dem Konto fehlt{" "}
              <span className="num">app_metadata.company_id</span>.
            </p>
          )}
        </div>
      </Panel>
    </main>
  );
}
