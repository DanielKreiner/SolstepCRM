import "server-only";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

/*
 * Gemeinsame Klammer für alle Cron-Handler.
 *
 * Zwei Anforderungen aus CLAUDE.md Abschnitt 7, die sonst jeder Handler
 * einzeln erfüllen müsste — und einer davon würde es vergessen:
 *   - Authorization: Bearer ${CRON_SECRET}
 *   - Idempotenz. Vercel kann denselben Lauf doppelt zustellen. Der
 *     run_key in job_run ist der Riegel.
 *
 * Der Lauf wird vor der Arbeit eingetragen und danach mit dem Ergebnis
 * ergänzt. Bricht die Arbeit ab, bleibt der Eintrag stehen — ein
 * fehlgeschlagener Lauf soll sich nicht automatisch wiederholen, sondern
 * auffallen.
 */

export type CronResult = Record<string, unknown>;

export async function runCron(
  request: Request,
  kind: string,
  arbeit: (admin: ReturnType<typeof createAdminClient>) => Promise<CronResult>,
  opts: { runKey?: string } = {},
): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");

  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET ist nicht gesetzt." },
      { status: 500 },
    );
  }
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Nicht berechtigt." }, { status: 401 });
  }

  const admin = createAdminClient();
  const runKey = opts.runKey ?? `${kind}-${new Date().toISOString().slice(0, 10)}`;

  const { error: lockErr } = await admin
    .from("job_run")
    .insert({ kind, run_key: runKey });

  if (lockErr) {
    if (lockErr.code === "23505") {
      return NextResponse.json({ ok: true, uebersprungen: "bereits gelaufen" });
    }
    return NextResponse.json({ error: lockErr.message }, { status: 500 });
  }

  try {
    const ergebnis = await arbeit(admin);
    await admin
      .from("job_run")
      .update({ result: ergebnis })
      .eq("kind", kind)
      .eq("run_key", runKey);

    return NextResponse.json({ ok: true, ...ergebnis });
  } catch (e) {
    const meldung = e instanceof Error ? e.message : "Unbekannter Fehler";
    await admin
      .from("job_run")
      .update({ result: { fehler: meldung } })
      .eq("kind", kind)
      .eq("run_key", runKey);

    return NextResponse.json({ error: meldung }, { status: 500 });
  }
}

/** Läufe, die häufiger als täglich kommen, brauchen einen feineren Schlüssel. */
export function minutenSchluessel(kind: string, takt: number): string {
  const jetzt = new Date();
  const minuten = Math.floor(jetzt.getTime() / 60000 / takt) * takt;
  return `${kind}-${new Date(minuten * 60000).toISOString().slice(0, 16)}`;
}

/** Alle Mandanten, die schreiben dürfen. Bei readonly ruht die Automatik. */
export async function aktiveMandanten(
  admin: ReturnType<typeof createAdminClient>,
): Promise<{ id: string; name: string }[]> {
  const { data, error } = await admin
    .from("company")
    .select("id, name")
    .in("status", ["trial", "active"]);

  if (error) throw new Error(`Mandanten: ${error.message}`);
  return (data ?? []).map((c) => ({ id: c.id as string, name: c.name as string }));
}

/** Standardpostfach eines Mandanten, oder null. */
export async function postfachVon(
  admin: ReturnType<typeof createAdminClient>,
  companyId: string,
): Promise<string | null> {
  const { data } = await admin
    .from("mail_account")
    .select("id")
    .eq("company_id", companyId)
    .eq("is_default", true)
    .maybeSingle();

  return (data?.id as string | null) ?? null;
}
