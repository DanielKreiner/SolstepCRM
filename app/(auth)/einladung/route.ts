import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { publicEnv } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * Der Knopf aus der Einladungsmail landet hier.
 *
 * Der Token wird serverseitig eingelöst (`verifyOtp`), dabei entsteht
 * die Sitzung, und erst danach geht es zum Formular für das Passwort.
 * Der Token taucht damit nie im Browserverlauf einer Seite auf, die ihn
 * noch braucht, und die Anmeldung hängt an keiner Einstellung im
 * Supabase-Dashboard.
 *
 * Die Cookies werden wie in der Middleware von Hand auf die Antwort
 * gesetzt: aus einem Route Handler heraus ist das der verlässliche Weg,
 * und ohne sie wäre die Sitzung nach der Weiterleitung wieder fort.
 */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  const typ = request.nextUrl.searchParams.get("typ");

  /*
   * Die Weiterleitung geht relativ hinaus, nicht über
   * `request.nextUrl.clone()`.
   *
   * `nextUrl` trägt den Host, den Next für sich normalisiert hat: eine
   * Anfrage an 127.0.0.1 wird dort zu localhost. Das ist ein anderer
   * Host für den Browser — die Sitzungscookies, die diese Route gerade
   * gesetzt hat, gehen auf dem Weg verloren, und der Eingeladene landet
   * ohne Sitzung wieder auf der Anmeldung. Ein relatives Location
   * bleibt auf dem Host, den der Browser tatsächlich benutzt, und gilt
   * ebenso hinter einem Proxy mit abweichendem Hostnamen.
   */
  if (!token || (typ !== "invite" && typ !== "recovery")) {
    return weiter("/login?hinweis=link");
  }

  const gesetzt: { name: string; value: string; options: CookieOptions }[] = [];

  const supabase = createServerClient(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          gesetzt.push(...cookiesToSet);
        },
      },
    },
  );

  const { error } = await supabase.auth.verifyOtp({
    type: typ,
    token_hash: token,
  });

  /*
   * Ein Token lässt sich nur einmal einlösen. Manche Mailprogramme und
   * Virenfilter öffnen Links vorab, und manch einer klickt zweimal —
   * dann steht hier ein Fehler, obwohl die Sitzung längst besteht. Wer
   * angemeldet ist, kommt deshalb trotzdem zum Formular.
   */
  if (error) {
    const { data } = await supabase.auth.getUser();
    if (!data.user) return weiter("/login?hinweis=link");
  }

  const antwort = weiter("/einladung/passwort");
  for (const { name, value, options } of gesetzt) {
    antwort.cookies.set(name, value, options);
  }
  return antwort;
}

function weiter(pfad: string): NextResponse {
  return new NextResponse(null, { status: 307, headers: { location: pfad } });
}
