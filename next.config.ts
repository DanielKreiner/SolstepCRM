import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  /*
   * Getrennte Verzeichnisse für dev und build. Sonst überschreibt ein
   * "pnpm build" die Chunks des laufenden Dev-Servers, und der antwortet
   * bis zum Neustart mit "Cannot find module ./317.js".
   */
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
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

export default nextConfig;
