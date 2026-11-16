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
 *
 * Teilzahlungen stehen bewusst NICHT in dieser Datei: exportiert werden
 * Ausgangsrechnungen, nicht der Zahlungseingang. Den bucht die
 * Buchhaltung aus dem Bankauszug, und eine zweite Quelle dafür würde
 * doppelt gebucht.
 */
const KONTO_ERLOES = "4000";
const KONTO_FORDERUNG = "2000";

export async function GET(request: Request) {
  return runCron(request, "accounting-export", async (admin) => {
    const heute = new Date().toISOString().slice(0, 10);
    const dateien: { mandant: string; pfad: string; zeilen: number }[] = [];
    const exportiert: string[] = [];

    for (const mandant of await aktiveMandanten(admin)) {
      /*
       * Was schon exportiert wurde — ueber ALLE Laeufe, nicht ueber die
       * letzten zwanzig.
       *
       * `runCron` legt bei jedem Lauf eine Zeile an und der Cron laeuft
       * taeglich. Mit `limit(20)` rutschte der Lauf, in dem eine Rechnung
       * exportiert wurde, nach zwanzig Tagen aus dem Fenster; die
       * Rechnung galt wieder als neu und erschien ein zweites Mal in
       * einer CSV — doppelte Buchungssaetze beim Steuerberater, unter
       * derselben Belegnummer.
       *
       * Gelesen werden nur Laeufe, die tatsaechlich etwas exportiert
       * haben; die taeglichen Leerlaeufe tragen nichts bei.
       */
      const { data: letzter } = await admin
        .from("job_run")
        .select("result")
        .eq("kind", "accounting-export")
        .not("result", "is", null)
        .order("created_at", { ascending: false });

      const schonExportiert = new Set<string>();
      for (const l of letzter ?? []) {
        const r = l.result as { exportiert?: string[] } | null;
        for (const id of r?.exportiert ?? []) schonExportiert.add(id);
      }

      /*
       * Storniertes kommt mit — als Gegenbuchung.
       *
       * Ein Storno setzt nur den Status (Begründung in
       * rechnung-actions.ts bei `rechnungStornieren`). Für die laufende
       * Auswertung reicht das, für den Steuerberater nicht: war die
       * Rechnung schon in einer CSV, liegt die Buchung bei ihm und
       * bleibt dort stehen, bis sie aufgehoben wird. Deshalb wird eine
       * stornierte Rechnung, die exportiert WAR, ein zweites Mal
       * exportiert — mit getauschten Konten, was die Buchung aufhebt.
       *
       * Eine Rechnung, die vor dem ersten Export storniert wurde, war
       * nie Buchung und bleibt draussen: `neu` nimmt kein Storniertes
       * auf, und ohne Ersteintrag gibt es nichts aufzuheben.
       */
      const { data: rechnungen } = await admin
        .from("vorgang_dokument")
        .select(
          `id, nummer, typ, betrag_netto, betrag_brutto, created_at, status,
           storniert_am, storno_grund,
           vorgang:vorgang_id ( customer:customer_id ( name, number ) )`,
        )
        .eq("company_id", mandant.id)
        .in("typ", ["anzahlungsrechnung", "schlussrechnung"])
        .in("status", ["versendet", "bezahlt", "storniert"]);

      const alle = rechnungen ?? [];

      const neu = alle.filter(
        (r) => r.status !== "storniert" && !schonExportiert.has(r.id as string),
      );

      /* Der Merker trägt ein eigenes Präfix — die Gegenbuchung ist ein
         zweiter Export derselben Rechnung und darf den ersten nicht
         verdecken. Alte Läufe haben nur die nackten IDs, das bleibt
         lesbar. */
      const stornoSchluessel = (id: string) => `storno:${id}`;
      const stornos = alle.filter(
        (r) =>
          r.status === "storniert" &&
          schonExportiert.has(r.id as string) &&
          !schonExportiert.has(stornoSchluessel(r.id as string)),
      );

      if (neu.length === 0 && stornos.length === 0) continue;

      const kopf =
        "Belegdatum;Belegnummer;Konto;Gegenkonto;Betrag;Steuersatz;Steuerbetrag;Text";

      const kundenName = (r: (typeof alle)[number]): string =>
        (
          r.vorgang as unknown as {
            customer: { name: string; number: string | null } | null;
          } | null
        )?.customer?.name ?? "";

      const zeilen = neu.map((r) => {
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
          kundenName(r).replace(/;/g, ","),
        ].join(";");
      });

      /*
       * Gegenbuchung: dieselben Beträge, Konto und Gegenkonto getauscht.
       * Kein negativer Betrag — den liest nicht jede Buchhaltung gleich,
       * und ein Vorzeichenfehler wäre hier eine doppelte Erlösminderung.
       */
      for (const r of stornos) {
        const netto = Number(r.betrag_netto ?? 0);
        const steuer = Number(r.betrag_brutto ?? 0) - netto;
        const satz = netto > 0 ? Math.round((steuer / netto) * 100) : 0;
        const grund = ((r.storno_grund as string | null) ?? "ohne Angabe")
          .replace(/[;\r\n]/g, " ")
          .slice(0, 120);

        zeilen.push(
          [
            ((r.storniert_am as string | null) ?? (r.created_at as string)).slice(0, 10),
            r.nummer as string,
            KONTO_ERLOES,
            KONTO_FORDERUNG,
            netto.toFixed(2).replace(".", ","),
            String(satz),
            steuer.toFixed(2).replace(".", ","),
            `Storno ${kundenName(r).replace(/;/g, ",")} — ${grund}`,
          ].join(";"),
        );
      }

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
      exportiert.push(...stornos.map((r) => stornoSchluessel(r.id as string)));
    }

    return { dateien, exportiert };
  });
}
