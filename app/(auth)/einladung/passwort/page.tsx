import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Panel } from "@/components/ui/Panel";
import { BRAND, BRAND_MARK } from "@/lib/brand";
import { T } from "@/lib/strings";
import { createClient } from "@/lib/supabase/server";
import { PasswortForm } from "./PasswortForm";

export const metadata: Metadata = { title: T.zugang.title };

export default async function PasswortPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  /*
   * Ohne Sitzung ist der Link nicht eingelöst worden. Dann ist das hier
   * kein Formular, sondern eine Sackgasse — zurück zur Anmeldung mit
   * dem Hinweis, dass ein neuer Link nötig ist.
   */
  if (!user) redirect("/login?hinweis=link");

  const name =
    (user.user_metadata as { name?: string } | undefined)?.name?.trim() ?? "";

  return (
    <main className="flex min-h-dvh items-center justify-center bg-app p-[14px]">
      <Panel className="w-full max-w-[400px] p-[30px]">
        <div className="mb-[26px] flex items-center gap-[11px]">
          <span
            aria-hidden
            className="flex h-8 w-8 items-center justify-center rounded-[11px] bg-[linear-gradient(150deg,var(--accent-from),var(--accent-to))] text-[15px] font-bold text-white"
          >
            {BRAND_MARK}
          </span>
          <span className="text-[19px] font-bold tracking-[-0.025em]">
            {BRAND.name}
          </span>
        </div>

        <h1 className="text-[22px] font-bold tracking-[-0.02em]">
          {name ? `Willkommen, ${name}` : T.zugang.title}
        </h1>
        <p className="mt-[3px] mb-[22px] text-[13px] text-muted">
          {T.zugang.subtitle}
        </p>

        <PasswortForm email={user.email ?? ""} />
      </Panel>
    </main>
  );
}
