import type { Metadata, Viewport } from "next";
import { Akzentfarbe } from "@/components/app/Akzentfarbe";
import { BRAND } from "@/lib/brand";
import { einrichtungSession } from "@/lib/einrichtung/zugang";

export const metadata: Metadata = {
  title: { default: "Einrichtung", template: `%s · ${BRAND.name}` },
  /* Ein Link ohne Anmeldung hat in keiner Suchmaschine etwas zu suchen. */
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#EAE6E0",
};

/* Eigenes Layout: kein Backoffice-Rahmen, keine Navigation, kein Login. */
export default async function EinrichtungLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ token: string }>;
}) {
  /*
   * Die Farbe des Betriebs gilt auch hier. Wer den Link bekommt, soll
   * die Seite seines Auftraggebers sehen und nicht die eines
   * Softwareanbieters.
   */
  const { token } = await params;
  const session = await einrichtungSession(token);
  const akzent = typeof session === "string" ? null : session.akzent;

  return (
    <div className="min-h-dvh bg-app">
      <Akzentfarbe akzent={akzent} />
      {children}
    </div>
  );
}
