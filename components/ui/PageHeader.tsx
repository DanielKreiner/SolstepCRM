import type { ReactNode } from "react";

/**
 * Kopf jedes Screens. Maße aus dem Mockup: 32px/700/-0.03em, Sub 14.5px.
 *
 * Am Telefon eine Stufe kleiner: 32px auf 375px Breite sind ein Drittel
 * der Zeilenlänge, und eine Vorgangsnummer bricht dann um.
 */
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
    <div className="mb-5 flex flex-wrap items-start gap-4">
      <div className="min-w-0 flex-1 sm:min-w-[260px]">
        <h1 className="text-[25px] leading-[1.1] font-bold tracking-[-0.03em] sm:text-[30px]">
          {title}
        </h1>
        {subtitle ? (
          <p className="mt-[5px] text-[13.5px] text-muted sm:text-[14.5px]">
            {subtitle}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center gap-[10px]">{actions}</div>
      ) : null}
    </div>
  );
}
