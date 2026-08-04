"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { navFuerMitarbeiter } from "@/lib/nav";

/*
 * Die Navigation der Mitarbeiter-App: vier Punkte, für das Lager fünf.
 *
 * Vorher lag hier ein eigener „Stempeln"-Knopf in der Mitte. Er ist weg —
 * gestempelt wird am Einsatz, auf der Karte in „Heute". Eine Uhr ohne
 * Baustelle daneben erzeugt Zeiten, die niemandem gehören.
 */
export function MobileNav({ rolle }: { rolle: string }) {
  const pathname = usePathname();
  const punkte = navFuerMitarbeiter(rolle);
  const aktiv = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`);

  return (
    <nav
      aria-label="Hauptbereiche"
      className="fixed right-0 bottom-0 left-0 z-20 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)]"
    >
      <div className="mx-auto flex max-w-[520px] items-stretch">
        {punkte.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            aria-current={aktiv(t.href) ? "page" : undefined}
            className={[
              "flex min-h-[64px] flex-1 flex-col items-center justify-center gap-[3px] px-1 text-center text-[11px]",
              aktiv(t.href) ? "font-semibold text-accent-ink" : "text-muted",
            ].join(" ")}
          >
            <Icon name={t.icon} size={21} />
            {t.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
