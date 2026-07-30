import { ImapFlow } from "imapflow";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ausBytea, entschluesseln } from "./crypto";
import { ordneZu } from "./assign";

/*
 * IMAP-Abruf (CLAUDE.md 6.1).
 *
 * Abgeholt wird über UID SEARCH seit last_uid. uid_validity wird mitgeprüft:
 * ändert der Server sie, sind alle gespeicherten UIDs wertlos und der Abruf
 * setzt neu auf. Ohne diese Prüfung holt man entweder nichts mehr oder
 * dieselben Mails ein zweites Mal.
 *
 * Frei von Next-Abhängigkeiten — dieselbe Funktion läuft im Cron-Handler und
 * später in einem Dauerworker.
 */

const MAX_PRO_LAUF = 50;

export async function holeNeueMails(
  admin: SupabaseClient,
  accountId: string,
): Promise<number> {
  const { data: konto, error } = await admin
    .from("mail_account")
    .select(
      "id, company_id, provider, address, imap_host, imap_port, imap_secure, username, secret_enc, uid_validity, last_uid",
    )
    .eq("id", accountId)
    .single();

  if (error) throw new Error(error.message);
  if (konto.provider !== "imap") {
    // Microsoft läuft über Graph-Delta, nicht über IMAP.
    return 0;
  }

  const paket = ausBytea(konto.secret_enc);
  if (!paket || !konto.imap_host || !konto.username) {
    throw new Error("Postfach ist nicht vollständig eingerichtet.");
  }

  const client = new ImapFlow({
    host: konto.imap_host as string,
    port: (konto.imap_port as number | null) ?? 993,
    secure: (konto.imap_secure as boolean | null) ?? true,
    auth: { user: konto.username as string, pass: entschluesseln(paket) },
    logger: false,
  });

  let neu = 0;
  await client.connect();

  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const box = client.mailbox;
      if (typeof box === "boolean") throw new Error("INBOX nicht lesbar.");

      const serverValidity = Number(box.uidValidity);
      const gespeicherteValidity = konto.uid_validity
        ? Number(konto.uid_validity)
        : null;

      // uid_validity gewechselt: alle gemerkten UIDs sind ungültig.
      const neuAufsetzen =
        gespeicherteValidity !== null && gespeicherteValidity !== serverValidity;

      const abUid = neuAufsetzen ? 1 : Number(konto.last_uid ?? 0) + 1;
      let hoechsteUid = Number(konto.last_uid ?? 0);

      for await (const nachricht of client.fetch(
        { uid: `${abUid}:*` },
        { uid: true, envelope: true, source: true, flags: true },
        { uid: true },
      )) {
        if (neu >= MAX_PRO_LAUF) break;

        const uid = Number(nachricht.uid);
        if (uid < abUid) continue;
        hoechsteUid = Math.max(hoechsteUid, uid);

        const envelope = nachricht.envelope;
        const messageId = envelope?.messageId ?? `uid-${uid}@${konto.address}`;
        const von = envelope?.from?.[0]?.address ?? null;

        const zuordnung = await ordneZu(admin, konto.company_id as string, {
          messageId,
          inReplyTo: envelope?.inReplyTo ?? null,
          from: von,
          subject: envelope?.subject ?? null,
        });

        const { error: insErr } = await admin.from("mail_message").insert({
          company_id: konto.company_id,
          mail_account_id: konto.id,
          direction: "in",
          message_id: messageId,
          in_reply_to: envelope?.inReplyTo ?? null,
          from_addr: von,
          to_addrs: (envelope?.to ?? []).map((t) => t.address).filter(Boolean),
          subject: envelope?.subject ?? null,
          body_text: nachricht.source
            ? nachricht.source.toString("utf8").slice(0, 20000)
            : null,
          received_at: envelope?.date
            ? new Date(envelope.date).toISOString()
            : new Date().toISOString(),
          customer_id: zuordnung.customerId,
          quote_id: zuordnung.quoteId,
          job_id: zuordnung.jobId,
          assigned_by: zuordnung.grund,
        });

        // 23505 = schon vorhanden. Ein doppelter Abruf ist kein Fehler.
        if (insErr && insErr.code !== "23505") throw new Error(insErr.message);
        if (!insErr) neu++;
      }

      await admin
        .from("mail_account")
        .update({
          uid_validity: serverValidity,
          last_uid: hoechsteUid,
          last_sync_at: new Date().toISOString(),
          last_error: null,
          status: "ok",
        })
        .eq("id", konto.id);
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {
      /* Verbindung ist ohnehin weg */
    });
  }

  return neu;
}
