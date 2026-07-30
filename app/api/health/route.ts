import { NextResponse } from "next/server";
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

  const healthy = Object.values(checks).every((v) => v === "ok");

  return NextResponse.json(
    { status: healthy ? "ok" : "fehler", checks },
    { status: healthy ? 200 : 503 },
  );
}
