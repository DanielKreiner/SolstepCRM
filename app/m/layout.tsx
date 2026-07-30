import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { BRAND } from "@/lib/brand";
import { requireMe } from "@/lib/session";
import { OfflineBanner } from "./OfflineBanner";

export const metadata: Metadata = {
  title: { default: "Montage", template: `%s · ${BRAND.name}` },
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Montage" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#EAE6E0",
};

/*
 * Monteur-App. 390px zuerst, Touchziele mindestens 56px (CLAUDE.md
 * Abschnitt 8). Kein Sidebar-Layout — auf dem Dach zählt jeder Zentimeter.
 */
const TABS = [
  { href: "/m/heute", label: "Heute", icon: "cockpit" },
  { href: "/m/stempeln", label: "Stempeln", icon: "zeit" },
  { href: "/m/material", label: "Material", icon: "lager" },
] as const;

export default async function MobileLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const me = await requireMe();

  return (
    <div className="flex min-h-dvh flex-col bg-app">
      <header className="flex items-center gap-3 px-4 pt-4 pb-2">
        <span
          aria-hidden
          className="flex h-9 w-9 items-center justify-center rounded-[12px] bg-[linear-gradient(150deg,var(--accent-from),var(--accent-to))] text-[15px] font-bold text-white"
        >
          {me.name.slice(0, 1)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-semibold">
            {me.name}
          </span>
          <span className="block truncate text-[12px] text-muted">
            {me.company.name}
          </span>
        </span>
      </header>

      <OfflineBanner />

      <main className="flex-1 px-4 pb-[96px]">{children}</main>

      <nav className="fixed right-0 bottom-0 left-0 flex border-t border-line bg-surface pb-[env(safe-area-inset-bottom)]">
        {TABS.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className="flex min-h-[64px] flex-1 flex-col items-center justify-center gap-1 text-[12px] text-muted"
          >
            <Icon name={t.icon} size={22} />
            {t.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
