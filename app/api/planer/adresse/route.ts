import { NextResponse } from "next/server";
import { requireMe } from "@/lib/session";
import { BRAND } from "@/lib/brand";

/*
 * Adresssuche für den Einstieg in ein Planer-Projekt.
 *
 * Nominatim (OpenStreetMap) als Quelle: frei, ohne Schlüssel, in AT und
 * DE bis zur Hausnummer brauchbar. Damit funktioniert der Einstieg auch
 * bei einem Betrieb, der noch keinen Kartenschlüssel hinterlegt hat —
 * genau wie basemap.at als Bildquelle.
 *
 * Serverseitig, nicht aus dem Browser: Nominatim verlangt eine
 * erkennbare Kennung im User-Agent und begrenzt auf eine Anfrage je
 * Sekunde. Beides lässt sich nur hier durchsetzen; hundert Browser mit
 * Autocomplete würden die freie Instanz sonst zu Recht sperren.
 */

const NOMINATIM = "https://nominatim.openstreetmap.org/search";

/** Letzter Abruf je Prozess — Nominatims Regel ist 1/s. */
let letzterAbruf = 0;

interface Treffer {
  name: string;
  lat: number;
  lon: number;
}

interface NominatimZeile {
  display_name?: string;
  lat?: string;
  lon?: string;
}

export async function GET(req: Request) {
  const me = await requireMe();
  if (me.perms.planer === "none") {
    return NextResponse.json({ fehler: "Kein Zugriff auf den Planer." }, { status: 403 });
  }

  const suche = (new URL(req.url).searchParams.get("q") ?? "").trim();
  // Unter drei Zeichen liefert die Suche nur Rauschen und kostet ein Kontingent.
  if (suche.length < 3) return NextResponse.json({ treffer: [] });

  const wartezeit = Math.max(0, 1100 - (Date.now() - letzterAbruf));
  if (wartezeit > 0) await new Promise((r) => setTimeout(r, wartezeit));
  letzterAbruf = Date.now();

  const url =
    `${NOMINATIM}?format=jsonv2&limit=6&addressdetails=0` +
    `&countrycodes=at,de&accept-language=de&q=${encodeURIComponent(suche)}`;

  const antwort = await fetch(url, {
    headers: {
      // Nominatim verlangt eine Kennung, über die man den Betreiber erreicht.
      "User-Agent": `${BRAND.name} Planer (${BRAND.supportMail})`,
      "Accept-Language": "de",
    },
    cache: "no-store",
  }).catch(() => null);

  if (!antwort || !antwort.ok) {
    /*
     * Kein 502 nach aussen: eine klemmende Adresssuche darf den Planer
     * nicht blockieren. Die Oberfläche zeigt dann „keine Vorschläge",
     * und wer die Adresse nicht findet, zieht die Karte von Hand
     * dorthin — der Planer ist nie auf eine fremde API angewiesen.
     */
    return NextResponse.json({ treffer: [], hinweis: "Adresssuche gerade nicht erreichbar." });
  }

  const roh = (await antwort.json()) as NominatimZeile[];
  const treffer: Treffer[] = roh
    .filter((z) => z.lat && z.lon && z.display_name)
    .map((z) => ({ name: z.display_name!, lat: Number(z.lat), lon: Number(z.lon) }));

  return NextResponse.json({ treffer });
}
