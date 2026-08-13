import { NextResponse } from "next/server";
import { requireMe } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { anbieter, type AnbieterId } from "@/lib/planer/anbieter";

/*
 * Kachel-Proxy für die Anbieter mit Schlüssel.
 *
 * Warum überhaupt ein Proxy: Google und Azure rechnen je Kachelabruf ab.
 * Läge der Schlüssel im Browser — und bei einer direkten Kachel-URL läge
 * er dort —, könnte ihn jeder aus dem Netzwerk-Tab kopieren und auf
 * Rechnung des Betriebs abrufen. Hier verlässt er den Server nie.
 *
 * In der Draufsicht läuft basemap.at bewusst NICHT hierüber: die Quelle
 * ist frei, und ein Proxy würde jede Kachel verlangsamen.
 *
 * Für die räumliche Ansicht gilt das Gegenteil. Dort werden die Kacheln
 * in ein Canvas gezeichnet, und ein Canvas mit fremden Bildern ist
 * „tainted" — WebGL lehnt die Textur dann ab. Ein fremder Server muss
 * dafür `Access-Control-Allow-Origin` schicken, und ob er das tut,
 * hängt an seiner Tageslaune: In der Produktion kam von basemap.at
 * nichts an, im Entwicklungsserver schon, und man sah nur eine
 * dunkelgrüne Fläche ohne jede Fehlermeldung. Über den eigenen Server
 * geholt ist die Kachel gleicher Herkunft, und die Frage stellt sich
 * nicht mehr.
 */

/** Sitzungstoken von Google, je Schlüssel. Google gibt sie mit Ablaufdatum aus. */
const googleSitzungen = new Map<string, { token: string; laeuftAb: number }>();

async function googleSitzung(schluessel: string): Promise<string | null> {
  const da = googleSitzungen.get(schluessel);
  if (da && da.laeuftAb > Date.now() + 60_000) return da.token;

  const antwort = await fetch(`https://tile.googleapis.com/v1/createSession?key=${encodeURIComponent(schluessel)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mapType: "satellite", language: "de-AT", region: "AT" }),
  });
  if (!antwort.ok) return null;

  const daten = (await antwort.json()) as { session?: string; expiry?: string };
  if (!daten.session) return null;

  // `expiry` kommt als Sekunden seit Epoch. Fehlt es, halten wir eine
  // Stunde — lieber öfter neu anfragen als mit totem Token 403 kassieren.
  const laeuftAb = daten.expiry ? Number(daten.expiry) * 1000 : Date.now() + 3600_000;
  googleSitzungen.set(schluessel, { token: daten.session, laeuftAb });
  return daten.session;
}

function quelleUrl(id: AnbieterId, schluessel: string | null, sitzung: string | null, z: string, x: string, y: string): string | null {
  if (id === "google") {
    if (!sitzung || !schluessel) return null;
    return `https://tile.googleapis.com/v1/2dtiles/${z}/${x}/${y}?session=${encodeURIComponent(sitzung)}&key=${encodeURIComponent(schluessel)}`;
  }
  if (id === "basemap") {
    return `https://mapsneu.wien.gv.at/basemap/bmaporthofoto30cm/normal/google3857/${z}/${y}/${x}.jpeg`;
  }
  if (id === "azure") {
    if (!schluessel) return null;
    return (
      "https://atlas.microsoft.com/map/tile?api-version=2024-04-01" +
      `&tilesetId=microsoft.imagery&zoom=${z}&x=${x}&y=${y}` +
      `&subscription-key=${encodeURIComponent(schluessel)}`
    );
  }
  return null;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ anbieter: string; z: string; x: string; y: string }> },
) {
  const { anbieter: id, z, x, y } = await params;

  // Angemeldet und berechtigt — sonst wäre der Proxy ein offener
  // Kachelservice auf fremde Rechnung.
  const me = await requireMe();
  if (me.perms.planer === "none") {
    return NextResponse.json({ fehler: "Kein Zugriff auf den Planer." }, { status: 403 });
  }

  const a = anbieter(id);
  if (a.id !== id || a.art !== "kachel") {
    return NextResponse.json({ fehler: "Anbieter läuft nicht über den Proxy." }, { status: 400 });
  }

  /*
   * Ganze Zahlen, sonst hängt man beliebige Pfade an die Anbieter-URL.
   *
   * Die erste Fassung liess höchstens drei Stellen zu. Bei Stufe 19
   * hat ein Kachelindex aber bis zu sechs — der Proxy hat also jede
   * echte Kachel mit „Ungültige Kachel" abgelehnt, und Google wie
   * Azure lieferten im ganzen Planer kein Bild. Aufgefallen ist es
   * nicht, weil die Voreinstellung basemap.at direkt lädt.
   *
   * Geprüft wird jetzt gegen die Stufe selbst: Auf Stufe z gibt es
   * 2^z Kacheln je Achse, alles darüber kann es nicht geben.
   */
  if (!/^\d{1,2}$/.test(z) || !/^\d{1,7}$/.test(x) || !/^\d{1,7}$/.test(y)) {
    return NextResponse.json({ fehler: "Ungültige Kachel." }, { status: 400 });
  }
  const stufe = Number(z);
  const proAchse = 2 ** stufe;
  if (stufe > 22 || Number(x) >= proAchse || Number(y) >= proAchse) {
    return NextResponse.json({ fehler: "Kachel liegt ausserhalb der Stufe." }, { status: 400 });
  }

  let schluessel: string | null = null;
  if (a.brauchtSchluessel) {
    const supabase = await createClient();
    const { data } = await supabase
      .from("planer_kartenschluessel")
      .select("schluessel")
      .eq("anbieter", id)
      .maybeSingle();

    schluessel = (data as { schluessel: string } | null)?.schluessel ?? null;
    if (!schluessel) {
      return NextResponse.json({ fehler: "Für diesen Anbieter ist kein Schlüssel hinterlegt." }, { status: 428 });
    }
  }

  const url = quelleUrl(
    a.id,
    schluessel,
    a.id === "google" && schluessel ? await googleSitzung(schluessel) : null,
    z,
    x,
    y,
  );
  if (!url) {
    return NextResponse.json({ fehler: "Sitzung beim Anbieter fehlgeschlagen." }, { status: 502 });
  }

  const bild = await fetch(url, { cache: "no-store" }).catch(() => null);
  if (!bild || !bild.ok) {
    return NextResponse.json(
      { fehler: `Anbieter antwortet mit ${bild?.status ?? "keiner Verbindung"}.` },
      { status: 502 },
    );
  }

  return new NextResponse(bild.body, {
    headers: {
      "Content-Type": bild.headers.get("Content-Type") ?? "image/jpeg",
      /*
       * Kacheln ändern sich über Monate nicht. Ein Tag im Browsercache
       * spart bei jedem Schwenk über dasselbe Dach echte Abrufe — und
       * die kosten hier Geld. `private`, weil der Abruf an einer
       * Anmeldung hängt und nicht in einem geteilten Cache landen darf.
       */
      "Cache-Control": "private, max-age=86400",
    },
  });
}
