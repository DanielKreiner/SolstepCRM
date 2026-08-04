import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { publicEnv } from "@/lib/env";

/** Pfade, die ohne Supabase-Session erreichbar sind. */
const PUBLIC_PREFIXES = [
  "/login",
  "/auth",
  "/portal", // Kundenportal, eigener Token-Mechanismus statt Supabase-Auth
  /*
   * Die Belegausgabe des Portals. Ohne diesen Eintrag schickt die
   * Middleware den Kunden auf die Anmeldung — er hat aber kein Konto,
   * sondern einen Link. Die Prüfung steckt in der Route selbst.
   */
  "/api/portal",
  "/api/webhooks",
  "/api/cron",
  "/api/track",
  "/api/health",
];

/*
 * Seiten der Betriebs-App. Montage und Lager haben dort nichts zu
 * suchen — ausser im Lager selbst, das beide Welten berührt.
 */
const BETRIEBS_PREFIXES = [
  "/cockpit",
  "/vorgaenge",
  "/planung",
  "/zeiten",
  "/offene-posten",
  "/mitarbeiter",
  "/einstellungen",
  "/bestellungen",
];

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // getUser() statt getSession() — nur das prueft das Token serverseitig.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("weiter", pathname);
    return NextResponse.redirect(url);
  }

  /*
   * Zwei Apps, eine Codebasis: Montage und Lager sehen ihre eigene
   * Oberfläche, das Büro die Betriebs-App. Wer die falsche aufruft —
   * über ein altes Lesezeichen oder einen Link aus einer Mail —, landet
   * dort, wo er hingehört, statt vor einer Seite ohne Rechte.
   *
   * Die Rolle steht im Token (app_metadata) und ist vom Client nicht
   * änderbar. Das hier ist Bequemlichkeit; durchgesetzt wird der Zugriff
   * weiterhin über die Policies.
   */
  if (user && !isPublic) {
    const rolle =
      (user.app_metadata as { role?: string } | undefined)?.role ?? "";
    const mitarbeiter = rolle === "monteur" || rolle === "lager";
    const istBetriebsseite = BETRIEBS_PREFIXES.some(
      (p) => pathname === p || pathname.startsWith(`${p}/`),
    );

    if (mitarbeiter && istBetriebsseite) {
      const url = request.nextUrl.clone();
      url.pathname = "/m/heute";
      url.search = "";
      return NextResponse.redirect(url);
    }
  }

  return response;
}
