import { NextResponse } from "next/server";
import { fehlendeResendVariablen } from "@/lib/mail/resend";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Uptime-Monitor haengt hier drauf (CLAUDE.md 12.a). Keine Mandantendaten. */
export async function GET() {
  const checks: Record<string, "ok" | "fehler"> = {};

  try {
    const supabase = await createClient();
    // Erreichbarkeit, nicht Inhalt: unter RLS ohne Session sind 0 Zeilen korrekt.
    const { error } = await supabase.from("company").select("id").limit(1);
    checks.datenbank = error ? "fehler" : "ok";
  } catch {
    checks.datenbank = "fehler";
  }

  /*
   * Der Mailweg gehört in die Auskunft, aber nicht in die Ampel: ein
   * fehlendes Postfach macht die Anwendung nicht kaputt, es lässt nur
   * Mails liegen. Der Uptime-Monitor soll deswegen nicht anschlagen —
   * wer aber "warum geht kein Versand" fragt, sieht die Antwort hier,
   * ohne sich durch die Vercel-Oberfläche zu klicken. Nur Namen, keine
   * Werte.
   */
  const fehlt = fehlendeResendVariablen();
  const mail = fehlt.length === 0 ? "ok" : `unvollständig: ${fehlt.join(", ")}`;

  const healthy = Object.values(checks).every((v) => v === "ok");

  return NextResponse.json(
    { status: healthy ? "ok" : "fehler", checks, mail },
    { status: healthy ? 200 : 503 },
  );
}
