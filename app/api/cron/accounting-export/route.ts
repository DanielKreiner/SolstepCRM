import { aktiveMandanten, runCron } from "@/lib/cron";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * Nächtlicher Buchhaltungsexport (CLAUDE.md 6.5).
 *
 * BMD- und DATEV-kompatibles CSV mit Buchungssätzen, abgelegt unter
 * documents/{company_id}/export/. Kein API-Zwang zur Buchhaltung — der
 * Steuerberater bekommt eine Datei, und das ist genau das, was er will.
 *
 * Exportiert werden nur Rechnungen, die noch nicht exportiert wurden.
 * Der Merker steht in job_run, nicht an der Rechnung: die Rechnung ist
 * nach dem Ausstellen unveränderlich.
 *
 * Quelle sind die Rechnungsbelege am Vorgang. Entwürfe bleiben draussen —
 * eine Buchung entsteht mit dem Versand, nicht mit dem Erfassen.
 */
const KONTO_ERLOES = "4000";
const KONTO_FORDERUNG = "2000";

export async function GET(request: Request) {
  return runCron(request, "accounting-export", async (admin) => {
    const heute = new Date().toISOString().slice(0, 10);
    const dateien: { mandant: string; pfad: string; zeilen: number }[] = [];
    const exportiert: string[] = [];

    for (const mandant of await aktiveMandanten(admin)) {
      // Was lief beim letzten Export mit?
      const { data: letzter } = await admin
        .from("job_run")
        .select("result")
        .eq("kind", "accounting-export")
        .order("created_at", { ascending: false })
        .limit(20);

      const schonExportiert = new Set<string>();
      for (const l of letzter ?? []) {
        const r = l.result as { exportiert?: string[] } | null;
        for (const id of r?.exportiert ?? []) schonExportiert.add(id);
      }

      const { data: rechnungen } = await admin
        .from("vorgang_dokument")
        .select(
          `id, nummer, typ, betrag_netto, betrag_brutto, created_at, status,
           vorgang:vorgang_id ( customer:customer_id ( name, number ) )`,
        )
        .eq("company_id", mandant.id)
        .in("typ", ["anzahlungsrechnung", "schlussrechnung"])
        .in("status", ["versendet", "bezahlt"]);

      const neu = (rechnungen ?? []).filter(
        (r) => !schonExportiert.has(r.id as string),
      );
      if (neu.length === 0) continue;

      const kopf =
        "Belegdatum;Belegnummer;Konto;Gegenkonto;Betrag;Steuersatz;Steuerbetrag;Text";
      const zeilen = neu.map((r) => {
        const kunde = (
          r.vorgang as unknown as {
            customer: { name: string; number: string | null } | null;
          } | null
        )?.customer;
        const netto = Number(r.betrag_netto ?? 0);
        const steuer = Number(r.betrag_brutto ?? 0) - netto;
        const satz = netto > 0 ? Math.round((steuer / netto) * 100) : 0;

        return [
          (r.created_at as string).slice(0, 10),
          r.nummer as string,
          KONTO_FORDERUNG,
          KONTO_ERLOES,
          netto.toFixed(2).replace(".", ","),
          String(satz),
          steuer.toFixed(2).replace(".", ","),
          (kunde?.name ?? "").replace(/;/g, ","),
        ].join(";");
      });

      // BOM, sonst zerlegt Excel unter Windows die Umlaute.
      const csv = `﻿${[kopf, ...zeilen].join("\r\n")}\r\n`;
      const pfad = `${mandant.id}/export/buchhaltung-${heute}.csv`;

      const { error } = await admin.storage
        .from("documents")
        .upload(pfad, new Blob([csv], { type: "text/csv" }), {
          upsert: true,
          contentType: "text/csv; charset=utf-8",
        });

      if (error) throw new Error(`Export ${mandant.name}: ${error.message}`);

      dateien.push({ mandant: mandant.name, pfad, zeilen: zeilen.length });
      // Erst nach erfolgreichem Upload vormerken — sonst fehlt eine
      // Rechnung im Export und gilt trotzdem als erledigt.
      exportiert.push(...neu.map((r) => r.id as string));
    }

    return { dateien, exportiert };
  });
}
