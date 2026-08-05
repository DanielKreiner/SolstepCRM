import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { BRAND } from "@/lib/brand";
import { ausBytea, entschluesseln } from "@/lib/mail/crypto";
import { markeAus, type Marke } from "@/lib/marke";
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

export type MailArt =
  | "angebot"
  | "rueckfrage"
  | "nachricht"
  | "portal"
  | "termin"
  | "auftrag"
  | "sonstiges";

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
  /**
   * Dateien, die mitgehen. Ohne Portalzugang ist das PDF der einzige
   * Weg, auf dem der Kunde sein Angebot bekommt.
   */
  anhaenge?: { dateiname: string; inhalt: Buffer; mime?: string }[] | undefined;
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
   * Nur ein Postfach anhängen, das auch senden kann.
   *
   * Vorher genügte is_default. Ein eingetragenes, aber nie geprüftes
   * Postfach (status 'unverified') zog damit jede Mail an sich und liess
   * sie dort liegen — der Übergangsversand kam nie zum Zug, und der
   * Betrieb sah nur „Zugangsdaten nicht entschlüsselbar". Genau so ist
   * es passiert: das Demopostfach im Seed war nie verbunden.
   *
   * Ohne brauchbares Postfach bleibt die Zuordnung leer, und der
   * Zusteller entscheidet selbst, worüber er sendet.
   */
  const { data: postfach } = await admin
    .from("mail_account")
    .select("id")
    .eq("company_id", auftrag.companyId)
    .eq("status", "ok")
    .order("is_default", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: firma } = await admin
    .from("company")
    .select("name, zip, city, phone, email, pdf_settings")
    .eq("id", auftrag.companyId)
    .maybeSingle();

  /*
   * Die Fusszeile fällt auf die gepflegten Firmendaten zurück, wenn der
   * Betrieb keinen eigenen Text gesetzt hat — Name, Ort, Telefon, Mail.
   */
  const marke = markeAus(firma?.pdf_settings, firma?.name as string | undefined, [
    firma?.zip as string | null,
    firma?.city as string | null,
    firma?.phone as string | null,
    firma?.email as string | null,
  ]);

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
      body_html: html(auftrag, marke),
      body_text: text(auftrag, marke),
      attachments: (auftrag.anhaenge ?? []).map((a) => ({
        filename: a.dateiname,
        content_base64: a.inhalt.toString("base64"),
        mime: a.mime ?? "application/pdf",
      })),
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
function html(a: MailAuftrag, m: Marke): string {
  const absaetze = a.absaetze
    .map(
      (p) =>
        `<p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:#151210">${esc(p)}</p>`,
    )
    .join("");

  /*
   * Der Knopf als Tabellenzelle mit Hintergrundfarbe, nicht als
   * gestyltes <a>: Outlook wirft border-radius und padding an Links weg,
   * an Tabellenzellen nicht. Die nackte Adresse steht darunter, weil
   * viele Programme Bilder und manche auch Knöpfe unterdrücken.
   */
  const knopf = a.knopf
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0">
         <tr><td style="border-radius:99px;background:${m.akzent}">
           <a href="${esc(a.knopf.url)}" style="display:inline-block;padding:13px 26px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none">${esc(a.knopf.text)}</a>
         </td></tr>
       </table>
       <p style="margin:0 0 14px;font-size:12px;line-height:1.5;color:#6A625A">Falls der Knopf nicht funktioniert: <a href="${esc(a.knopf.url)}" style="color:#6A625A">${esc(a.knopf.url)}</a></p>`
    : "";

  /*
   * Ohne Logo der Firmenname als Schrift — kein leeres Kästchen und kein
   * Platzhalterbild. Feste Höhe, damit ein zu grosses Logo die Mail
   * nicht sprengt.
   */
  const kopf = m.logoUrl
    ? `<img src="${esc(m.logoUrl)}" alt="${esc(m.firma)}" height="40" style="display:block;height:40px;width:auto;border:0">`
    : `<span style="font-size:19px;font-weight:700;letter-spacing:-0.02em;color:#151210">${esc(m.firma)}</span>`;

  const fuss = m.fusszeile
    ? `<tr><td style="padding:0 28px 24px">
         <p style="margin:0;font-size:11.5px;line-height:1.5;color:#9C9289">${esc(m.fusszeile)}</p>
       </td></tr>`
    : "";

  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(a.betreff)}</title></head>
  <body style="margin:0;padding:24px;background:#EAE6E0;font-family:Helvetica,Arial,sans-serif">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:18px">
      <tr><td style="padding:26px 28px 0">${kopf}</td></tr>
      <tr><td style="padding:18px 28px 0"><div style="height:3px;width:44px;border-radius:99px;background:${m.akzent}"></div></td></tr>
      <tr><td style="padding:20px 28px 4px">
        <p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:#151210">Guten Tag ${esc(a.an.name)},</p>
        ${absaetze}
        ${knopf}
        <p style="margin:22px 0 24px;font-size:13px;line-height:1.5;color:#6A625A">Freundliche Grüße<br>${esc(m.firma)}</p>
      </td></tr>
      ${fuss}
    </table>
  </body></html>`;
}

function text(a: MailAuftrag, m: Marke): string {
  return [
    `Guten Tag ${a.an.name},`,
    "",
    ...a.absaetze,
    ...(a.knopf ? ["", `${a.knopf.text}: ${a.knopf.url}`] : []),
    "",
    "Freundliche Grüße",
    m.firma,
    ...(m.fusszeile ? ["", m.fusszeile] : []),
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
