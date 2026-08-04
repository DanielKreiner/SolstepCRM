import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { startseite } from "@/lib/nav";
import { Panel } from "@/components/ui/Panel";
import { BRAND, BRAND_MARK } from "@/lib/brand";
import { T } from "@/lib/strings";
import { createClient } from "@/lib/supabase/server";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: T.login.title };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ weiter?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    const rolle =
      (user.app_metadata as { role?: string } | undefined)?.role ?? "";
    redirect(startseite(rolle));
  }

  const { weiter } = await searchParams;

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
          {T.login.title}
        </h1>
        <p className="mt-[3px] mb-[22px] text-[13px] text-muted">
          {T.login.subtitle}
        </p>

        <LoginForm weiter={weiter} />

        <p className="mt-[22px] border-t border-line pt-[15px] text-[12px] leading-[1.5] text-faint">
          {T.login.noAccount}
        </p>
      </Panel>
    </main>
  );
}
