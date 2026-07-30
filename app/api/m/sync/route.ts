import { NextResponse } from "next/server";
import { z } from "zod";
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
  kind: z.enum(["time_start", "time_stop", "stock_move"]),
  payload: z.record(z.string(), z.unknown()),
});

const timeStart = z.object({
  jobId: z.string().uuid().nullable().optional(),
  kind: z.enum(["work", "travel", "break", "errand", "training"]).default("work"),
  note: z.string().max(500).nullable().optional(),
});

const timeStop = z.object({
  entryId: z.string().uuid().nullable().optional(),
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

    const { error } = await supabase.from("time_entry").insert({
      company_id: me.companyId,
      user_id: me.id,
      job_id: p.data.jobId ?? null,
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

    // Ohne explizite id: den laufenden Eintrag des Nutzers schließen.
    let query = supabase
      .from("time_entry")
      .update({
        ended_at: clientTs,
        status: flagged ? "flagged" : "booked",
        ...(flagged
          ? {
              flagged_reason: `Client-/Serverzeit weichen um ${Math.round(abweichungMin)} Minuten ab`,
            }
          : {}),
      })
      .eq("user_id", me.id)
      .eq("status", "running");

    if (p.data.entryId) query = query.eq("id", p.data.entryId);

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

  const p = stockMove.safeParse(payload);
  if (!p.success) {
    return NextResponse.json({ error: "Buchung unvollständig." }, { status: 400 });
  }

  const { error } = await supabase.from("stock_move").insert({
    company_id: me.companyId,
    article_id: p.data.articleId,
    job_id: p.data.jobId ?? null,
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
