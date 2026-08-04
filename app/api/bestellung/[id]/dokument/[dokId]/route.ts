import { NextResponse } from "next/server";
import { requireMe } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * Ein Beleg zur Bestellung — Bestell-PDF oder Lieferscheinfoto.
 *
 * Der Bucket documents ist nicht öffentlich; ausgegeben wird über eine
 * kurzlebige signierte Adresse. Gelesen wird mit dem RLS-Client: wer die
 * Bestellung nicht sehen darf, bekommt hier auch nichts — die Policy
 * greift, ohne dass diese Route etwas dafür tun müsste.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; dokId: string }> },
) {
  await requireMe();
  const { id, dokId } = await params;

  const supabase = await createClient();
  const { data: dok } = await supabase
    .from("bestellung_dokument")
    .select("storage_path, dateiname")
    .eq("id", dokId)
    .eq("bestellung_id", id)
    .maybeSingle();

  if (!dok) {
    return NextResponse.json({ fehler: "Beleg nicht gefunden." }, { status: 404 });
  }

  const { data: link, error } = await supabase.storage
    .from("documents")
    .createSignedUrl(dok.storage_path as string, 60 * 60);

  if (error || !link) {
    return NextResponse.json(
      { fehler: "Beleg konnte nicht geöffnet werden." },
      { status: 500 },
    );
  }

  return NextResponse.redirect(link.signedUrl);
}
