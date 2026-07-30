import { NextResponse } from "next/server";
import { exportiereMandant } from "@/lib/export/tenant";
import { getMe } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Ein vollständiger Export mit Dateien braucht länger als die Voreinstellung.
export const maxDuration = 300;

/*
 * Selfservice-Export des eigenen Mandanten.
 *
 * Nur die Geschäftsführung. Der Export enthält Personalakten, Rechnungen und
 * den Zeitstrahl jedes Kunden — er umgeht damit bewusst die Rollenrechte,
 * die im Alltag gelten. Wer ihn auslösen darf, ist deshalb die einzige
 * Sicherung, und die sitzt hier.
 */
export async function GET() {
  const me = await getMe();
  if (!me) {
    return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });
  }

  if (me.role !== "gf") {
    return NextResponse.json(
      {
        error:
          "Den vollständigen Export darf nur die Geschäftsführung auslösen — er enthält auch Personal- und Rechnungsdaten.",
      },
      { status: 403 },
    );
  }

  const ergebnis = await exportiereMandant(me.companyId);

  return new NextResponse(new Uint8Array(ergebnis.daten), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${ergebnis.dateiname}"`,
      "Cache-Control": "no-store",
      // Damit die Oberfläche zeigen kann, was drin ist, ohne das Archiv zu öffnen.
      "X-Export-Tabellen": String(ergebnis.tabellen.length),
      "X-Export-Dateien": String(ergebnis.dateien),
    },
  });
}
