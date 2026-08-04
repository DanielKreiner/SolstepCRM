import type { Metadata, Viewport } from "next";
import { BRAND } from "@/lib/brand";
import { requireMe } from "@/lib/session";
import { markeLaden } from "@/lib/marke";
import { createClient } from "@/lib/supabase/server";
import { Akzentfarbe } from "@/components/app/Akzentfarbe";
import { MobileNav } from "./MobileNav";
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
export default async function MobileLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const me = await requireMe();
  const marke = await markeLaden(await createClient(), me.companyId);

  return (
    <div className="flex min-h-dvh flex-col bg-app">
      <Akzentfarbe akzent={marke.akzentGesetzt ? marke.akzent : null} />
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

      {/* Platz unten für die Leiste plus den überstehenden Stempeln-Knopf. */}
      <main className="flex-1 px-4 pb-[112px]">{children}</main>

      <MobileNav />
    </div>
  );
}
