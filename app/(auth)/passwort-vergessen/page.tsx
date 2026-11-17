import type { Metadata } from "next";
import { Panel } from "@/components/ui/Panel";
import { BRAND, BRAND_MARK } from "@/lib/brand";
import { T } from "@/lib/strings";
import { VergessenForm } from "./VergessenForm";

export const metadata: Metadata = { title: T.zugang.vergessenTitle };

export default async function VergessenPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  /*
   * Die Anmeldeseite reicht die eingetippte Adresse herüber, damit sie
   * niemand zweimal schreiben muss. Mehr steht hier nicht in der URL —
   * insbesondere kein Hinweis darauf, ob es den Zugang gibt.
   */
  const { email } = await searchParams;

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
          {T.zugang.vergessenTitle}
        </h1>
        <p className="mt-[3px] mb-[22px] text-[13px] text-muted">
          {T.zugang.vergessenSubtitle}
        </p>

        <VergessenForm email={(email ?? "").slice(0, 120)} />
      </Panel>
    </main>
  );
}
