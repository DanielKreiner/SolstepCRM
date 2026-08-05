import { NextResponse } from "next/server";
import { z } from "zod";
import { regelnAnwenden } from "@/lib/zeiten/anwenden";
import { entnahmeBuchen, rueckgabeBuchen } from "@/lib/material/buchen";
import { createClient } from "@/lib/supabase/server";
import { getMe } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * Sammelendpunkt der Offline-Warteschlange.
 *
 * Zwei Regeln aus CLAUDE.md Abschnitt 8 hängen hier:
 *   - Idempotenz über client_uuid: dieselbe Buchung zweimal gesendet ergibt
 *     eine Zeile. Ohne das erzeugt jeder Verbindungsabbruch Dubletten.
 *   - Zeitstempel kommen vom Client, werden aber serverseitig
 *     plausibilisiert: mehr als 15 Minuten Abweichung -> status 'flagged'.
 *     Nicht abgelehnt — eine falsch gestellte Uhr darf keine Arbeitszeit
 *     verschlucken, sie muss nur auffallen.
 */

const PLAUSIBEL_MIN = 15;

const schema = z.object({
  clientUuid: z.string().uuid(),
  clientTs: z.string().datetime(),
  kind: z.enum(["time_start", "time_stop", "stock_move", "material"]),
  payload: z.record(z.string(), z.unknown()),
});

const timeStart = z.object({
  /*
   * Der Einsatz ist der Anker: eine Zeit ohne Einsatz gehört niemandem.
   * jobId bleibt für Buchungen aus alten, noch nicht abgeräumten
   * Warteschlangen auf den Geräten — die dürfen nicht verloren gehen,
   * nur weil das Feld umbenannt wurde.
   */
  einsatzId: z.string().uuid().nullable().optional(),
  jobId: z.string().uuid().nullable().optional(),
  kind: z.enum(["work", "travel", "break", "errand", "training"]).default("work"),
  note: z.string().max(500).nullable().optional(),
});

const timeStop = z.object({
  entryId: z.string().uuid().nullable().optional(),
});

/*
 * Materialbuchung aus der Beladeliste. Sie geht denselben Weg wie die
 * Zeitbuchung — zuerst in die Warteschlange, dann zum Server: ein
 * Monteur auf einem Dach ohne Netz soll abhaken können, ohne darüber
 * nachzudenken (CLAUDE.md Abschnitt 8).
 */
const material = z.object({
  vorgangId: z.string().uuid(),
  artikelId: z.string().uuid(),
  menge: z.coerce.number().positive(),
  art: z.enum(["entnahme", "rueckgabe"]).default("entnahme"),
  lagerortId: z.string().uuid().nullable().optional(),
  einsatzId: z.string().uuid().nullable().optional(),
});

const stockMove = z.object({
  articleId: z.string().uuid(),
  jobId: z.string().uuid().nullable().optional(),
  qty: z.coerce.number().positive(),
  kind: z.enum(["out", "return"]).default("out"),
  note: z.string().max(300).nullable().optional(),
});

export async function POST(request: Request) {
  const me = await getMe();
  if (!me) {
    return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });
  }

  const body = schema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json({ error: "Ungültige Anfrage." }, { status: 400 });
  }

  const supabase = await createClient();
  const { clientUuid, clientTs, kind, payload } = body.data;

  const abweichungMin = Math.abs(Date.now() - new Date(clientTs).getTime()) / 60000;
  const flagged = abweichungMin > PLAUSIBEL_MIN;

  if (kind === "time_start") {
    const p = timeStart.safeParse(payload);
    if (!p.success) {
      return NextResponse.json({ error: "Buchung unvollständig." }, { status: 400 });
    }

    /* Der Vorgangsbezug kommt vom Einsatz, nicht vom Gerät. */
    const { data: einsatz } = p.data.einsatzId
      ? await supabase
          .from("einsatz")
          .select("id, vorgang_id")
          .eq("id", p.data.einsatzId)
          .maybeSingle()
      : { data: null };

    const { error } = await supabase.from("time_entry").insert({
      company_id: me.companyId,
      user_id: me.id,
      einsatz_id: einsatz?.id ?? null,
      vorgang_id: einsatz?.vorgang_id ?? p.data.jobId ?? null,
      kind: p.data.kind,
      started_at: clientTs,
      note: p.data.note ?? null,
      status: flagged ? "flagged" : "running",
      client_uuid: clientUuid,
      client_ts: clientTs,
      flagged_reason: flagged
        ? `Client-/Serverzeit weichen um ${Math.round(abweichungMin)} Minuten ab`
        : null,
      created_by: me.id,
    });

    if (error) return antwortAufFehler(error);
    return NextResponse.json({ ok: true, flagged });
  }

  if (kind === "time_stop") {
    const p = timeStop.safeParse(payload);
    if (!p.success) {
      return NextResponse.json({ error: "Buchung unvollständig." }, { status: 400 });
    }

    /*
     * Den laufenden Eintrag erst holen: Rundung und Pausenabzug des
     * Betriebs brauchen den Beginn. Sonst wäre eine offline gestempelte
     * Schicht die einzige, für die die Zeitregeln nicht gelten.
     */
    let suche = supabase
      .from("time_entry")
      .select("id, started_at")
      .eq("user_id", me.id)
      .eq("status", "running");
    if (p.data.entryId) suche = suche.eq("id", p.data.entryId);

    const { data: laufend } = await suche.limit(1).maybeSingle();

    if (!laufend) {
      return NextResponse.json(
        { error: "Kein laufender Eintrag zum Beenden." },
        { status: 409 },
      );
    }

    const geregelt = await regelnAnwenden(
      supabase,
      me.companyId,
      laufend.started_at as string,
      clientTs,
    );

    const query = supabase
      .from("time_entry")
      .update({
        ended_at: geregelt.bis,
        auto_break_min: geregelt.autoBreakMin,
        status: flagged ? "flagged" : "booked",
        ...(flagged
          ? {
              flagged_reason: `Client-/Serverzeit weichen um ${Math.round(abweichungMin)} Minuten ab`,
            }
          : {}),
      })
      .eq("id", laufend.id as string)
      .eq("status", "running");

    const { data, error } = await query.select("id");
    if (error) return antwortAufFehler(error);

    if ((data ?? []).length === 0) {
      return NextResponse.json(
        { error: "Kein laufender Eintrag zum Beenden." },
        { status: 409 },
      );
    }
    return NextResponse.json({ ok: true, flagged });
  }

  if (kind === "material") {
    const p = material.safeParse(payload);
    if (!p.success) {
      return NextResponse.json({ error: "Buchung unvollständig." }, { status: 400 });
    }

    const ergebnis =
      p.data.art === "rueckgabe"
        ? await rueckgabeBuchen(supabase, {
            companyId: me.companyId,
            userId: me.id,
            vorgangId: p.data.vorgangId,
            artikelId: p.data.artikelId,
            menge: p.data.menge,
            clientUuid,
          })
        : await entnahmeBuchen(supabase, {
            companyId: me.companyId,
            userId: me.id,
            vorgangId: p.data.vorgangId,
            artikelId: p.data.artikelId,
            menge: p.data.menge,
            vonLagerortId: p.data.lagerortId ?? null,
            einsatzId: p.data.einsatzId ?? null,
            clientUuid,
          });

    if (!ergebnis.ok) {
      return NextResponse.json({ error: ergebnis.grund }, { status: 500 });
    }
    return NextResponse.json({ ok: true, flagged: false });
  }

  const p = stockMove.safeParse(payload);
  if (!p.success) {
    return NextResponse.json({ error: "Buchung unvollständig." }, { status: 400 });
  }

  const { error } = await supabase.from("stock_move").insert({
    company_id: me.companyId,
    article_id: p.data.articleId,
    vorgang_id: p.data.jobId ?? null,
    user_id: me.id,
    qty: p.data.qty,
    kind: p.data.kind,
    note: p.data.note ?? null,
    client_uuid: clientUuid,
  });

  if (error) return antwortAufFehler(error);
  return NextResponse.json({ ok: true, flagged: false });
}

function antwortAufFehler(error: { code?: string; message: string }) {
  // 23505 = Unique-Verletzung auf client_uuid. Die Buchung war schon da,
  // der Client darf sie aus der Warteschlange nehmen.
  if (error.code === "23505") {
    return NextResponse.json({ ok: true, duplikat: true });
  }
  return NextResponse.json({ error: error.message }, { status: 500 });
}
