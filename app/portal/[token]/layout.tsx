import type { Metadata, Viewport } from "next";
import { Akzentfarbe } from "@/components/app/Akzentfarbe";
import { BRAND } from "@/lib/brand";
import { resolvePortal } from "@/lib/portal/data";

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
export default async function PortalLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ token: string }>;
}) {
  /*
   * Die Farbe des Betriebs gilt auch hier. Für den Kunden ist das Portal
   * die Seite seines Elektrikers — in unserem Bernstein wäre es die
   * Seite eines Softwareanbieters.
   *
   * Ein ungültiger Token liefert keine Sitzung; dann bleibt es beim
   * Standard, und die Seite selbst antwortet ohnehin mit 404.
   */
  const { token } = await params;
  const session = await resolvePortal(token);

  return (
    <div className="min-h-dvh bg-app">
      <Akzentfarbe akzent={session?.akzent ?? null} />
      {children}
    </div>
  );
}
