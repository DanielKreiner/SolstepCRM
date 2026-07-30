import type { ReactNode } from "react";

/** Kopf jedes Screens. Maße aus dem Mockup: 32px/700/-0.03em, Sub 14.5px. */
export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-[22px] flex flex-wrap items-start gap-4">
      <div className="min-w-[240px] flex-1">
        <h1 className="text-[32px] leading-[1.1] font-bold tracking-[-0.03em]">
          {title}
        </h1>
        {subtitle ? (
          <p className="mt-[6px] text-[14.5px] text-muted">{subtitle}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center gap-[10px]">{actions}</div>
      ) : null}
    </div>
  );
}
