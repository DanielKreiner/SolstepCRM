import withSerwistInit from "@serwist/next";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  /*
   * Der Dev-Server schreibt nach .next-dev, der Build ins Standard-.next.
   * Grund für die Trennung: sonst überschreibt ein "pnpm build" die Chunks
   * des laufenden Dev-Servers, und der antwortet bis zum Neustart mit
   * "Cannot find module ./317.js".
   *
   * Warum der BUILD das Standardverzeichnis behält und nicht der Dev-Server:
   * Vercel liest next.config, um das Ausgabeverzeichnis zu finden — in einem
   * Prozess, in dem NEXT_DIST_DIR nicht gesetzt ist. Ein abweichendes
   * distDir für den Build lässt das Deployment ins Leere greifen.
   */
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  experimental: {
    /*
     * Ohne diese Angabe nimmt eine Server Action höchstens 1 MB Rumpf.
     * Ein Handyfoto ist drei- bis fünfmal so gross, und die Anfrage
     * bricht ab, bevor eigener Code sie sieht — der Benutzer bekommt
     * einen Fehlerbildschirm, nicht die Meldung aus pruefeDatei. Genau
     * das hat im Onboarding ein Kunde erlebt, der im Portal ein Foto
     * vom Zählerkasten angehängt hat.
     *
     * 4 MB und nicht mehr: Serverlose Funktionen lassen ohnehin nur
     * rund 4,5 MB durch, eine höhere Zahl hier wäre ein Versprechen,
     * das die Plattform nicht hält. Alles darüber fängt
     * lib/bilder/verkleinern.ts im Browser ab — Bilder werden klein
     * gerechnet, der Rest wird gemeldet.
     */
    serverActions: { bodySizeLimit: "4mb" },
  },
  /*
   * Alte Lesezeichen sollen nicht ins Leere laufen. Die Seiten dahinter
   * gibt es nicht mehr — ihre Inhalte sind in „Zeiten", „Heute" und den
   * Vorgang gewandert.
   */
  async redirects() {
    return [
      { source: "/zeiterfassung", destination: "/zeiten", permanent: false },
      { source: "/stundenkonto", destination: "/zeiten?tab=konten", permanent: false },
      { source: "/meine-zeiten", destination: "/m/zeiten", permanent: false },
      { source: "/meine-dokumente", destination: "/m/dokumente", permanent: false },
      { source: "/mein-einsatz", destination: "/m/heute", permanent: false },
      { source: "/m/stempeln", destination: "/m/heute", permanent: false },
      { source: "/dokumente", destination: "/mitarbeiter", permanent: false },
      { source: "/berichte", destination: "/cockpit", permanent: false },
      { source: "/chat", destination: "/vorgaenge", permanent: false },
      { source: "/bewerber", destination: "/mitarbeiter", permanent: false },
    ];
  },
  typescript: {
    // Kein Build, der Typfehler durchwinkt.
    ignoreBuildErrors: false,
  },
  eslint: {
    ignoreDuringBuilds: false,
  },
  images: {
    // Avatare liegen im öffentlichen Supabase-Bucket, alles andere kommt über Signed URLs.
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
    ],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

/*
 * ServiceWorker nur im Produktionsbuild. Im Entwicklungsmodus würde er
 * jede Codeänderung hinter einem Cache verstecken.
 */
const withSerwist = withSerwistInit({
  swSrc: "app/sw/sw.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV !== "production",
  reloadOnOnline: true,
});

export default withSerwist(nextConfig);
