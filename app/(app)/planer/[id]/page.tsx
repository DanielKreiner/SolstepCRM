import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Planer, type PlanerProjekt } from "@/components/planer/Planer";
import { requireMe } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { ANBIETER, type AnbieterId, stand } from "@/lib/planer/anbieter";
import { planLesen } from "@/lib/planer/plan";

export const metadata: Metadata = { title: "Planer" };

interface Zeile {
  id: string;
  name: string;
  adresse: string | null;
  ursprung_lat: number;
  ursprung_lon: number;
  anbieter: string;
  zoom: number;
  plan: unknown;
  foto_pfad: string | null;
  foto_breite: number | null;
  foto_hoehe: number | null;
  foto_meter_pro_pixel: number | null;
}

export default async function PlanerProjektPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const me = await requireMe();
  if (me.perms.planer === "none") notFound();

  const { id } = await params;
  const supabase = await createClient();

  const { data } = await supabase
    .from("planer_projekt")
    .select(
      "id, name, adresse, ursprung_lat, ursprung_lon, anbieter, zoom, plan, " +
        "foto_pfad, foto_breite, foto_hoehe, foto_meter_pro_pixel",
    )
    .eq("id", id)
    .maybeSingle();

  const zeile = data as Zeile | null;
  if (!zeile) notFound();

  /*
   * Welche Anbieter eingerichtet sind — ohne die Schlüssel selbst. Der
   * Client bekommt nur „ja/nein" und den Grund; der Schlüssel bleibt auf
   * dem Server, die Kacheln laufen über den Proxy.
   *
   * Fehlt das Leserecht für Einstellungen (Bauleitung), liefert die
   * Abfrage durch RLS eine leere Liste. Das ist kein Fehler: der
   * Anbieter erscheint dann ausgegraut, geplant wird mit Basemap.
   */
  const { data: schluessel } = await supabase.from("planer_kartenschluessel").select("anbieter");
  const vorhanden = new Set(((schluessel as { anbieter: string }[] | null) ?? []).map((s) => s.anbieter));

  const staende = ANBIETER.map((a) => stand(a.id, vorhanden.has(a.id)));

  const gewaehlt = ANBIETER.find((a) => a.id === zeile.anbieter)?.id ?? "basemap";
  // Ein gespeicherter Anbieter, dessen Schlüssel inzwischen fehlt, darf
  // nicht in eine leere Karte führen — dann eben zurück auf Basemap.
  const anbieter: AnbieterId = staende.find((s) => s.id === gewaehlt)?.verfuegbar
    ? gewaehlt
    : "basemap";

  /*
   * Drohnenfotos liegen in einem privaten Bucket: sie zeigen das Haus
   * eines namentlich bekannten Kunden. Der Browser bekommt deshalb eine
   * befristet signierte Adresse, keine dauerhaft öffentliche.
   */
  let foto = null as PlanerProjekt["foto"];
  if (zeile.foto_pfad && zeile.foto_breite && zeile.foto_hoehe) {
    const { data: signiert } = await supabase.storage
      .from("planer-fotos")
      .createSignedUrl(zeile.foto_pfad, 60 * 60 * 8);
    if (signiert?.signedUrl) {
      foto = {
        url: signiert.signedUrl,
        breite: zeile.foto_breite,
        hoehe: zeile.foto_hoehe,
        meterProPixel: zeile.foto_meter_pro_pixel ? Number(zeile.foto_meter_pro_pixel) : null,
      };
    }
  }

  const projekt: PlanerProjekt = {
    id: zeile.id,
    name: zeile.name,
    adresse: zeile.adresse,
    ursprung: { lat: Number(zeile.ursprung_lat), lon: Number(zeile.ursprung_lon) },
    anbieter,
    zoom: Number(zeile.zoom),
    plan: planLesen(zeile.plan),
    foto,
  };

  return (
    <Planer
      projekt={projekt}
      staende={staende}
      schreibrecht={me.perms.planer === "write"}
    />
  );
}
