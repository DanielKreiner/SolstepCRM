import { NextResponse } from "next/server";
import {
  cacheSchluessel,
  type ErtragAnfrage,
  type ErtragAntwort,
  fallbackErtrag,
  pvgisAspekt,
  regionAus,
} from "@/lib/planer/ertrag";
import { createClient } from "@/lib/supabase/server";
import { requireMe } from "@/lib/session";

/*
 * Spezifischer Ertrag für eine Fläche (Briefing 6).
 *
 * Quelle ist PVGIS, die Photovoltaik-Datenbank der EU-Kommission: frei,
 * ohne Schlüssel, aus Satelliten-Einstrahlungsdaten gerechnet. Der
 * Aufruf läuft serverseitig, weil er gecacht werden muss — beim Ziehen
 * am Neigungsregler kämen sonst Dutzende Anfragen je Planung.
 *
 * Zwei Regeln bestimmen alles Weitere:
 *
 *   1. Erst der Cache. Ein Standort ändert seine Einstrahlung nicht
 *      binnen 90 Tagen.
 *   2. Nie blockieren. Antwortet PVGIS nicht, rechnet der Fallback aus
 *      der mitgelieferten Tabelle weiter — und sagt das auch, statt
 *      einen Schätzwert als Messwert auszugeben.
 */

const PVGIS = "https://re.jrc.ec.europa.eu/api/v5_2/PVcalc";

/** Nach dieser Zeit gilt PVGIS als nicht erreichbar. */
const GEDULD_MS = 6000;

interface PvgisAntwort {
  outputs?: {
    totals?: { fixed?: { E_y?: number } };
    monthly?: { fixed?: Array<{ month?: number; E_m?: number }> };
  };
}

function zahl(roh: string | null, standard: number): number {
  const n = Number(roh);
  return Number.isFinite(n) ? n : standard;
}

/**
 * PVGIS fragen. Wirft nicht — wer hier scheitert, bekommt `null`, und
 * der Aufrufer nimmt den Fallback.
 */
async function holeVonPvgis(a: ErtragAnfrage): Promise<ErtragAntwort | null> {
  const url = new URL(PVGIS);
  url.searchParams.set("lat", a.lat.toFixed(4));
  url.searchParams.set("lon", a.lon.toFixed(4));
  // Auf 1 kWp gerechnet — dann ist die Antwort direkt der spezifische Ertrag.
  url.searchParams.set("peakpower", "1");
  url.searchParams.set("loss", String(a.verlustProzent));
  url.searchParams.set("angle", String(Math.round(a.neigung)));
  // PVGIS zählt ab Süden, wir ab Norden.
  url.searchParams.set("aspect", String(Math.round(pvgisAspekt(a.azimut))));
  url.searchParams.set("outputformat", "json");

  try {
    const antwort = await fetch(url, {
      signal: AbortSignal.timeout(GEDULD_MS),
      headers: { "User-Agent": "Solstep Betrieb Planer (kontakt@solstep.de)" },
    });
    if (!antwort.ok) return null;

    const daten = (await antwort.json()) as PvgisAntwort;
    const jahr = daten.outputs?.totals?.fixed?.E_y;
    const monatlich = daten.outputs?.monthly?.fixed;
    if (typeof jahr !== "number" || !Number.isFinite(jahr) || jahr <= 0) return null;

    /*
     * Die Monatswerte nach Monatsnummer einsortieren, nicht nach
     * Reihenfolge im Array. Ein vertauschter Jänner und Juli fällt in
     * der Jahressumme nicht auf, verschiebt aber die ganze
     * Speicherrechnung.
     */
    const monate = Array.from({ length: 12 }, (_, i) => {
      const treffer = monatlich?.find((m) => m.month === i + 1);
      return typeof treffer?.E_m === "number" ? treffer.E_m : jahr / 12;
    });

    return { spezifisch: jahr, monate, quelle: "pvgis" };
  } catch {
    // Zeitüberschreitung, DNS, Netz — der Grund ändert nichts am Vorgehen.
    return null;
  }
}

export async function GET(req: Request) {
  const me = await requireMe();
  if (me.perms.planer === "none") {
    return NextResponse.json({ fehler: "Kein Zugriff auf den Planer." }, { status: 403 });
  }

  const p = new URL(req.url).searchParams;
  const anfrage: ErtragAnfrage = {
    lat: zahl(p.get("lat"), NaN),
    lon: zahl(p.get("lon"), NaN),
    azimut: zahl(p.get("azimut"), 180),
    neigung: zahl(p.get("neigung"), 30),
    verlustProzent: Math.min(40, Math.max(0, zahl(p.get("verlust"), 14))),
  };
  if (!Number.isFinite(anfrage.lat) || !Number.isFinite(anfrage.lon)) {
    return NextResponse.json({ fehler: "Standort fehlt." }, { status: 400 });
  }

  const schluessel = cacheSchluessel(anfrage);
  const db = await createClient();

  /*
   * Der Cache ist mandantenübergreifend — die Sonne scheint für alle
   * Betriebe gleich — und liegt deshalb NICHT unter der üblichen
   * company_id-Policy. Gelesen und geschrieben wird über zwei eng
   * geschnittene Funktionen (Migration 0067), die selbst das
   * Planer-Leserecht prüfen. Der Service-Role-Key hat in einer
   * normalen Route nichts verloren.
   */
  const { data: treffer } = await db.rpc("planer_ertrag_cache_lesen", {
    p_schluessel: schluessel,
  });

  const zeile = (treffer as Array<{ spezifisch: string; monate: unknown[] }> | null)?.[0];
  if (zeile) {
    return NextResponse.json({
      spezifisch: Number(zeile.spezifisch),
      monate: zeile.monate.map(Number),
      quelle: "pvgis" as const,
      cache: true,
    });
  }

  const frisch = await holeVonPvgis(anfrage);

  if (!frisch) {
    /*
     * Kein blockierter Planer wegen einer fremden API. Der Fallback
     * wird NICHT gecacht — sonst stünde ein Schätzwert 90 Tage lang im
     * Weg, obwohl PVGIS längst wieder antwortet.
     */
    const ersatz = fallbackErtrag(anfrage, regionAus(anfrage.lat));
    return NextResponse.json({ ...ersatz, cache: false });
  }

  await db.rpc("planer_ertrag_cache_merken", {
    p_schluessel: schluessel,
    p_spezifisch: frisch.spezifisch,
    p_monate: frisch.monate,
  });

  return NextResponse.json({ ...frisch, cache: false });
}
