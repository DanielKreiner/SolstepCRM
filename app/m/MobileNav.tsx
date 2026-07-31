"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "@/components/ui/Icon";

/*
 * Bottom-Nav der Monteur-App, fünf Punkte, "Stempeln" mittig hervorgehoben
 * (SPEC 6.1). Der mittlere Knopf steht bewusst über der Leiste: Stempeln ist
 * die eine Aktion, die mit Handschuhen im Halbdunkel treffen muss.
 *
 * Client-Komponente allein wegen usePathname — der aktive Zustand ist auf
 * dem Handy wichtiger als am Desktop, weil es keine Sidebar gibt, die zeigt,
 * wo man ist.
 */

type Tab = { href: string; label: string; icon: IconName };

const LINKS: Tab[] = [
  { href: "/m/heute", label: "Heute", icon: "cockpit" },
  { href: "/m/auftraege", label: "Aufträge", icon: "pipelines" },
];

const RECHTS: Tab[] = [
  { href: "/m/material", label: "Material", icon: "lager" },
  { href: "/m/profil", label: "Profil", icon: "mitarbeiter" },
];

export function MobileNav() {
  const pathname = usePathname();
  const aktiv = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <nav
      aria-label="Hauptbereiche"
      className="fixed right-0 bottom-0 left-0 z-20 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)]"
    >
      <div className="mx-auto flex max-w-[520px] items-end">
        {LINKS.map((t) => (
          <Punkt key={t.href} tab={t} aktiv={aktiv(t.href)} />
        ))}

        <div className="flex flex-1 justify-center">
          <Link
            href="/m/stempeln"
            aria-current={aktiv("/m/stempeln") ? "page" : undefined}
            className={[
              "-mt-6 flex h-[64px] w-[64px] flex-col items-center justify-center gap-[2px] rounded-pill",
              "text-[10.5px] font-semibold text-white",
              "bg-[linear-gradient(150deg,var(--accent-from),var(--accent-to))]",
              "shadow-[0_8px_22px_rgba(201,121,24,0.36)] ring-4 ring-app",
              aktiv("/m/stempeln") ? "brightness-[1.06]" : "",
            ].join(" ")}
          >
            <Icon name="zeit" size={22} />
            Stempeln
          </Link>
        </div>

        {RECHTS.map((t) => (
          <Punkt key={t.href} tab={t} aktiv={aktiv(t.href)} />
        ))}
      </div>
    </nav>
  );
}

function Punkt({ tab, aktiv }: { tab: Tab; aktiv: boolean }) {
  return (
    <Link
      href={tab.href}
      aria-current={aktiv ? "page" : undefined}
      className={[
        "flex min-h-[64px] flex-1 flex-col items-center justify-center gap-[3px] text-[11px]",
        aktiv ? "font-semibold text-accent-ink" : "text-muted",
      ].join(" ")}
    >
      <Icon name={tab.icon} size={21} />
      {tab.label}
    </Link>
  );
}
