import { NextResponse } from "next/server";
import { DUNNING_LEVELS, dueDunningLevel } from "@/lib/money";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * Mahnlauf.
 *
 * Läuft über alle Mandanten — deshalb Service-Role. Zwei Dinge, die
 * CLAUDE.md Abschnitt 7 verlangt:
 *   - Authorization: Bearer ${CRON_SECRET}
 *   - Idempotenz: Vercel kann denselben Lauf doppelt zustellen. Der
 *     run_key in job_run verhindert, dass ein Kunde zwei Mahnungen für
 *     denselben Tag bekommt.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Nicht berechtigt." }, { status: 401 });
  }

  const admin = createAdminClient();
  const heute = new Date().toISOString().slice(0, 10);
  const runKey = `dunning-${heute}`;

  const { error: lockErr } = await admin
    .from("job_run")
    .insert({ kind: "dunning", run_key: runKey });

  if (lockErr) {
    if (lockErr.code === "23505") {
      return NextResponse.json({ ok: true, uebersprungen: "bereits gelaufen" });
    }
    return NextResponse.json({ error: lockErr.message }, { status: 500 });
  }

  const { data: offen, error } = await admin
    .from("invoice")
    .select(
      "id, company_id, number, due_date, dunning_level, amount_net, vat_amount, job:job_id ( customer:customer_id ( name, email ) )",
    )
    .in("status", ["sent", "partial", "overdue"])
    .lt("due_date", heute);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const gemahnt: { number: string; level: number }[] = [];

  for (const inv of offen ?? []) {
    const stufe = dueDunningLevel(
      inv.due_date as string,
      Number(inv.dunning_level ?? 0),
      heute,
    );
    if (!stufe) continue;

    await admin
      .from("invoice")
      .update({
        status: "overdue",
        dunning_level: stufe.level,
        last_dunned_at: new Date().toISOString(),
      })
      .eq("id", inv.id);

    const customer = (
      inv.job as unknown as { customer: { name: string; email: string | null } | null } | null
    )?.customer;

    const { data: account } = await admin
      .from("mail_account")
      .select("id")
      .eq("company_id", inv.company_id)
      .eq("is_default", true)
      .maybeSingle();

    if (account && customer?.email) {
      const brutto = (
        Number(inv.amount_net) + Number(inv.vat_amount)
      ).toFixed(2);
      await admin.from("mail_outbox").insert({
        company_id: inv.company_id,
        mail_account_id: account.id,
        to_addrs: [customer.email],
        subject: `${stufe.label} zu Rechnung ${inv.number as string}`,
        body_html:
          `<p>Guten Tag,</p><p>zur Rechnung ${inv.number as string} über ${brutto} EUR ` +
          `konnten wir bis heute keinen Zahlungseingang feststellen. ` +
          `Fällig war sie am ${inv.due_date as string}.</p>` +
          `<p>Sollte sich die Zahlung überschnitten haben, betrachten Sie dieses ` +
          `Schreiben bitte als gegenstandslos.</p>`,
        body_text: `${stufe.label} zu Rechnung ${inv.number as string}, fällig am ${inv.due_date as string}.`,
        invoice_id: inv.id,
      });
    }

    gemahnt.push({ number: inv.number as string, level: stufe.level });
  }

  await admin
    .from("job_run")
    .update({ result: { gemahnt, stufen: DUNNING_LEVELS } })
    .eq("kind", "dunning")
    .eq("run_key", runKey);

  return NextResponse.json({ ok: true, gemahnt: gemahnt.length, details: gemahnt });
}
