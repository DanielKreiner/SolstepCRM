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
 * basemap.at läuft bewusst NICHT hierüber: die Quelle ist frei, ein
 * Proxy würde nur eine Zwischenstation einbauen und jede Kachel
 * verlangsamen.
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

function quelleUrl(id: AnbieterId, schluessel: string, sitzung: string | null, z: string, x: string, y: string): string | null {
  if (id === "google") {
    if (!sitzung) return null;
    return `https://tile.googleapis.com/v1/2dtiles/${z}/${x}/${y}?session=${encodeURIComponent(sitzung)}&key=${encodeURIComponent(schluessel)}`;
  }
  if (id === "azure") {
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
  if (a.id !== id || a.art !== "kachel" || !a.brauchtSchluessel) {
    return NextResponse.json({ fehler: "Anbieter läuft nicht über den Proxy." }, { status: 400 });
  }

  // Ganze Zahlen, sonst hängt man beliebige Pfade an die Anbieter-URL.
  if (![z, x, y].every((v) => /^\d{1,3}$/.test(v))) {
    return NextResponse.json({ fehler: "Ungültige Kachel." }, { status: 400 });
  }

  const supabase = await createClient();
  const { data } = await supabase
    .from("planer_kartenschluessel")
    .select("schluessel")
    .eq("anbieter", id)
    .maybeSingle();

  const schluessel = (data as { schluessel: string } | null)?.schluessel;
  if (!schluessel) {
    return NextResponse.json({ fehler: "Für diesen Anbieter ist kein Schlüssel hinterlegt." }, { status: 428 });
  }

  const url = quelleUrl(
    a.id,
    schluessel,
    a.id === "google" ? await googleSitzung(schluessel) : null,
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
