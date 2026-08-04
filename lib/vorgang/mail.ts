import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { BRAND } from "@/lib/brand";
import { ausBytea, entschluesseln } from "@/lib/mail/crypto";
import { createAdminClient } from "@/lib/supabase/admin";

/*
 * Mail an den Kunden zu einem Vorgang.
 *
 * Eine Stelle für alle drei Anlässe — Angebot, Rückfrage, Nachricht —,
 * weil sie dieselben drei Dinge brauchen: die Adresse des Kunden, den
 * Link ins Portal und einen Eintrag im Postausgang. Verstreut hiesse:
 * eine davon vergisst den Link, und der Kunde bekommt eine Mail, die
 * ihn nirgendwohin führt.
 *
 * Frei von Next-Abhängigkeiten (CLAUDE.md Abschnitt 7), damit derselbe
 * Code später aus einem Dauerworker läuft.
 *
 * Warum der Admin-Client: mail_outbox und mail_account sind für
 * authenticated vollständig gesperrt — eine angemeldete Sitzung kann
 * keine Mail schreiben. Die Rechteprüfung sitzt wie bei lib/mahnung.ts
 * in der aufrufenden Server Action, die Mandantenzuordnung hier.
 */

export type MailArt = "angebot" | "rueckfrage" | "nachricht" | "sonstiges";

export type Empfaenger = { name: string; email: string };

/**
 * Der Portallink des Kunden, wenn es einen gibt.
 *
 * In portal_access steht der Token zusätzlich verschlüsselt, damit das
 * Backoffice ihn noch einmal zeigen kann (0017). Ältere Zugänge haben
 * nur den Hash — für die gibt es keinen Link, und dann kommt null
 * zurück statt eines kaputten.
 */
export async function portalLink(
  admin: SupabaseClient,
  kundeId: string,
  ziel?: { vorgangId: string; bereich?: string },
): Promise<string | null> {
  const { data } = await admin
    .from("portal_access")
    .select("token_enc")
    .eq("customer_id", kundeId)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data?.token_enc) return null;

  let token: string;
  try {
    const roh = ausBytea(data.token_enc);
    if (!roh) return null;
    token = entschluesseln(roh);
  } catch {
    return null;
  }

  const basis = `${BRAND.domain}/portal/${token}`;
  if (!ziel) return basis;
  const bereich = ziel.bereich ? `?bereich=${ziel.bereich}` : "";
  return `${basis}/vorgang/${ziel.vorgangId}${bereich}`;
}

/** Kunde und Vorgangsnummer in einem Zug — jeder Anlass braucht beides. */
export async function kundeZumVorgang(
  admin: SupabaseClient,
  vorgangId: string,
): Promise<
  | { ok: true; kundeId: string; nummer: string; empfaenger: Empfaenger | null }
  | { ok: false; grund: string }
> {
  const { data } = await admin
    .from("vorgang")
    .select("number, customer_id, customer:customer_id ( name, email )")
    .eq("id", vorgangId)
    .maybeSingle();

  if (!data) return { ok: false, grund: "Der Vorgang wurde nicht gefunden." };

  const k = data.customer as unknown as { name: string; email: string | null } | null;
  return {
    ok: true,
    kundeId: data.customer_id as string,
    nummer: (data.number as string) ?? "",
    empfaenger: k?.email ? { name: k.name, email: k.email } : null,
  };
}

export type MailAuftrag = {
  companyId: string;
  vorgangId: string;
  art: MailArt;
  an: Empfaenger;
  betreff: string;
  /** Der Fliesstext ohne Rahmen — Anrede und Fusszeile kommen von hier. */
  absaetze: string[];
  knopf?: { text: string; url: string } | undefined;
  /** Verweis auf die Mail, die hiermit wiederholt wird. */
  erneutZu?: string | undefined;
};

/**
 * Die Mail in den Postausgang legen. Versendet wird sie vom Cron
 * `mail-send` — hier wird nichts zugestellt, nur eingereiht.
 */
export async function einreihen(
  admin: SupabaseClient,
  auftrag: MailAuftrag,
): Promise<{ ok: true; id: string } | { ok: false; grund: string }> {
  /*
   * Ohne eingehängtes Postfach wird trotzdem eingereiht — der Zusteller
   * entscheidet später, worüber er sendet. Sonst geht der Text verloren,
   * bevor jemand das Postfach einhängt.
   */
  const { data: postfach } = await admin
    .from("mail_account")
    .select("id")
    .eq("company_id", auftrag.companyId)
    .eq("is_default", true)
    .maybeSingle();

  const { data, error } = await admin
    .from("mail_outbox")
    .insert({
      company_id: auftrag.companyId,
      mail_account_id: postfach?.id ?? null,
      vorgang_id: auftrag.vorgangId,
      art: auftrag.art,
      erneut_zu: auftrag.erneutZu ?? null,
      to_addrs: [auftrag.an.email],
      subject: auftrag.betreff,
      body_html: html(auftrag),
      body_text: text(auftrag),
    })
    .select("id")
    .single();

  if (error || !data) {
    return { ok: false, grund: error?.message ?? "Einreihen fehlgeschlagen." };
  }
  return { ok: true, id: data.id as string };
}

/*
 * Tabellenbasiertes HTML, weil Outlook nichts anderes zuverlässig
 * darstellt (CLAUDE.md 6.1). Keine externen Bilder, keine Webfonts —
 * beides wird im Standard blockiert und hinterlässt Löcher.
 */
function html(a: MailAuftrag): string {
  const absaetze = a.absaetze
    .map(
      (p) =>
        `<p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:#151210">${esc(p)}</p>`,
    )
    .join("");

  const knopf = a.knopf
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0">
         <tr><td style="border-radius:99px;background:#E8952B">
           <a href="${esc(a.knopf.url)}" style="display:inline-block;padding:13px 26px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none">${esc(a.knopf.text)}</a>
         </td></tr>
       </table>
       <p style="margin:0 0 14px;font-size:12px;line-height:1.5;color:#6A625A">Falls der Knopf nicht funktioniert: ${esc(a.knopf.url)}</p>`
    : "";

  return `<!doctype html><html lang="de"><body style="margin:0;padding:24px;background:#EAE6E0;font-family:Helvetica,Arial,sans-serif">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:16px">
      <tr><td style="padding:28px">
        <p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:#151210">Guten Tag ${esc(a.an.name)},</p>
        ${absaetze}
        ${knopf}
        <p style="margin:22px 0 0;font-size:13px;line-height:1.5;color:#6A625A">Freundliche Grüße<br>${esc(BRAND.name)}</p>
      </td></tr>
    </table>
  </body></html>`;
}

function text(a: MailAuftrag): string {
  return [
    `Guten Tag ${a.an.name},`,
    "",
    ...a.absaetze,
    ...(a.knopf ? ["", `${a.knopf.text}: ${a.knopf.url}`] : []),
    "",
    "Freundliche Grüße",
    BRAND.name,
  ].join("\n");
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Der Admin-Client für die Aufrufer, die keinen eigenen bauen wollen. */
export function mailClient(): SupabaseClient {
  return createAdminClient();
}
