import { NextResponse } from "next/server";
import type { BelegArt } from "@/lib/pdf/vorgang";
import { belegPdf } from "@/lib/pdf/erzeugen";
import { requireMe } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * Belege zum Vorgang als PDF.
 *
 * Eine Route für Angebot, Auftragsbestätigung und beide Rechnungen. Der
 * Aufbau steckt in lib/pdf/erzeugen — der Angebotsversand braucht
 * dasselbe PDF als Anhang.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  await requireMe();
  const { id } = await params;

  const url = new URL(request.url);
  const art = (url.searchParams.get("art") ?? "angebot") as BelegArt;
  if (!["angebot", "ab", "anzahlungsrechnung", "schlussrechnung"].includes(art)) {
    return NextResponse.json({ fehler: "Unbekannte Belegart." }, { status: 400 });
  }

  const supabase = await createClient();
  const ergebnis = await belegPdf(supabase, id, art);

  if (!ergebnis.ok) {
    return NextResponse.json({ fehler: ergebnis.grund }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(ergebnis.buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${ergebnis.dateiname}"`,
      "Cache-Control": "no-store",
    },
  });
}
