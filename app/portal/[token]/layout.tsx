import type { Metadata, Viewport } from "next";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = {
  title: { default: "Kundenportal", template: `%s · ${BRAND.name}` },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#EAE6E0",
};

/* Eigenes Layout: kein Backoffice-Rahmen, keine Navigation, kein Login. */
export default function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="min-h-dvh bg-app">{children}</div>;
}
