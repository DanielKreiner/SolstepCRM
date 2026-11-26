import "server-only";
import { randomBytes } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  ausBase64url,
  base64url,
  gleich,
  hashe,
  signiere,
  zweckSchluessel,
} from "@/lib/token/hmac";

/*
 * Der Einrichtungslink.
 *
 * Kein Supabase-Auth: Wer die Angaben hat, hat oft keinen Zugang — den
 * Kundenstamm exportiert der Steuerberater, den Resturlaub kennt die
 * Lohnverrechnung. Für drei Angaben legt niemand ein Konto an.
 *
 * Damit liegt die ganze Mandantentrennung dieses Pfades in dieser Datei.
 * Jede Abfrage hier schränkt selbst auf company_id ein; es gibt keine
 * Session, an der RLS greifen könnte, und damit keine zweite Sicherung.
 *
 * Erreichbar ist über diesen Link ausschließlich die Einrichtungsliste
 * eines Mandanten. Kein Kunde, kein Vorgang, keine Rechnung, kein
 * Mitarbeiter — und das muss so bleiben. Wer hier eine Abfrage ergänzt,
 * öffnet sie für jeden, der den Link hat.
 */

const ZWECK = "einrichtung";
const ABLAUF_TAGE = 30;

/* Rate-Limit nach CLAUDE.md 11. */
const FENSTER_MS = 60_000;
const MAX_ANFRAGEN = 30;

function schluessel(): Buffer {
  return zweckSchluessel(ZWECK);
}

export type ZugangPayload = { companyId: string; exp: number };

/**
 * Einen Token erzeugen. Der Rückgabewert wird genau einmal ausgegeben;
 * danach steht in der Datenbank nur noch sein Hash.
 *
 * Das `e1.` am Anfang ist eine zweite Absicherung neben dem
 * Zweckschlüssel: Selbst wenn jemand beide Arten mit demselben
 * Schlüssel signieren würde, ist der Inhalt nicht verwechselbar.
 */
export function zugangToken(companyId: string, tage = ABLAUF_TAGE): string {
  const exp = Math.floor(Date.now() / 1000) + tage * 86400;
  const nonce = randomBytes(9).toString("base64url");
  const body = `e1.${companyId}.${exp}.${nonce}`;
  return `${base64url(body)}.${signiere(schluessel(), body)}`;
}

export function zugangPruefen(token: string): ZugangPayload | null {
  const teile = token.split(".");
  if (teile.length !== 2) return null;

  const [kopf, signatur] = teile as [string, string];
  const body = ausBase64url(kopf);
  if (body === null) return null;

  if (!gleich(signatur, signiere(schluessel(), body))) return null;

  const stuecke = body.split(".");
  if (stuecke.length !== 4) return null;
  const [marke, companyId, expStr] = stuecke as [string, string, string, string];
  if (marke !== "e1") return null;
  if (!companyId) return null;

  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp * 1000 < Date.now()) return null;

  return { companyId, exp };
}

export function zugangHash(token: string): string {
  return hashe(schluessel(), token);
}

export type EinrichtungSession = {
  zugangId: string;
  companyId: string;
  companyName: string;
  logoUrl: string | null;
  akzent: string | null;
  /** false = der Mandant darf derzeit nur lesen. */
  schreibbar: boolean;
};

/** Grund, warum ein Link nicht aufgeht — nur für das Protokoll, nicht für den Besucher. */
export type ZugangFehler = "ungueltig" | "zu-viele";

/**
 * Den Link auflösen.
 *
 * Nach aussen wird nicht unterschieden, warum ein Link nicht geht: Ein
 * abgelaufener, ein widerrufener und ein erfundener Link führen auf
 * dieselbe Seite. Alles andere wäre eine Auskunft darüber, welche Tokens
 * es gibt.
 */
export async function einrichtungSession(
  token: string,
): Promise<EinrichtungSession | ZugangFehler> {
  const payload = zugangPruefen(token);
  if (!payload) return "ungueltig";

  const admin = createAdminClient();

  const { data: zugang } = await admin
    .from("einrichtung_zugang")
    .select(
      "id, company_id, expires_at, revoked_at, zugriffe, fenster_start, fenster_anfragen",
    )
    .eq("token_hash", zugangHash(token))
    .maybeSingle();

  if (!zugang) return "ungueltig";
  if (zugang.revoked_at) return "ungueltig";
  if (new Date(zugang.expires_at as string) < new Date()) return "ungueltig";
  /* Doppelt: der Token sagt Mandant X, die Datenbank muss dasselbe sagen. */
  if (zugang.company_id !== payload.companyId) return "ungueltig";

  const jetzt = new Date();
  const start = zugang.fenster_start ? new Date(zugang.fenster_start as string) : null;
  const imFenster = start !== null && jetzt.getTime() - start.getTime() < FENSTER_MS;
  const anfragen = imFenster ? Number(zugang.fenster_anfragen ?? 0) + 1 : 1;

  await admin
    .from("einrichtung_zugang")
    .update({
      letzter_zugriff: jetzt.toISOString(),
      zugriffe: Number(zugang.zugriffe ?? 0) + 1,
      fenster_start: imFenster ? (zugang.fenster_start as string) : jetzt.toISOString(),
      fenster_anfragen: anfragen,
    })
    .eq("id", zugang.id);

  if (anfragen > MAX_ANFRAGEN) return "zu-viele";

  const { data: company } = await admin
    .from("company")
    .select("id, name, status, pdf_settings")
    .eq("id", zugang.company_id)
    .maybeSingle();

  if (!company) return "ungueltig";

  const pdf = company.pdf_settings as Record<string, unknown> | null;
  const akzent = pdf?.akzent;
  const logo = pdf?.logo_url;

  return {
    zugangId: zugang.id as string,
    companyId: company.id as string,
    companyName: company.name as string,
    logoUrl: typeof logo === "string" ? logo : null,
    akzent: typeof akzent === "string" && /^#[0-9a-fA-F]{6}$/.test(akzent) ? akzent : null,
    schreibbar: company.status === "active" || company.status === "trial",
  };
}

/*
 * Lesen und Schreiben der Punkte über den Link.
 *
 * Beides mit explizitem company_id — und zusätzlich mit explizitem
 * punkt_id, das zuvor gegen denselben Mandanten geprüft wurde. Ein
 * Besucher schickt Punkt-Kennungen aus dem Formular; ohne diese Prüfung
 * könnte er mit der Kennung eines fremden Punktes schreiben.
 */

export type LinkPunkt = {
  id: string;
  schluessel: string;
  bereich: string;
  titel: string;
  grund: string | null;
  art: string;
  optionen: string[];
  dringend: boolean;
  wert: string | null;
  anmerkung: string | null;
  status: string;
  dateien: {
    id: string;
    dateiname: string;
    groesseBytes: number | null;
    storagePath: string;
  }[];
};

export async function linkPunkte(companyId: string): Promise<LinkPunkt[]> {
  const admin = createAdminClient();

  const [{ data: punkte }, { data: dateien }] = await Promise.all([
    admin
      .from("einrichtung_punkt")
      .select(
        "id, schluessel, bereich, titel, grund, art, optionen, dringend, wert, anmerkung, status",
      )
      .eq("company_id", companyId)
      .order("sortierung"),
    admin
      .from("einrichtung_datei")
      .select("id, punkt_id, dateiname, groesse_bytes, storage_path")
      .eq("company_id", companyId)
      .order("created_at"),
  ]);

  const jePunkt = new Map<string, LinkPunkt["dateien"]>();
  for (const d of dateien ?? []) {
    const liste = jePunkt.get(d.punkt_id as string) ?? [];
    liste.push({
      id: d.id as string,
      dateiname: d.dateiname as string,
      groesseBytes: d.groesse_bytes === null ? null : Number(d.groesse_bytes),
      storagePath: d.storage_path as string,
    });
    jePunkt.set(d.punkt_id as string, liste);
  }

  return (punkte ?? []).map((p) => ({
    id: p.id as string,
    schluessel: p.schluessel as string,
    bereich: p.bereich as string,
    titel: p.titel as string,
    grund: (p.grund as string | null) ?? null,
    art: p.art as string,
    optionen: (p.optionen as string[] | null) ?? [],
    dringend: Boolean(p.dringend),
    wert: (p.wert as string | null) ?? null,
    anmerkung: (p.anmerkung as string | null) ?? null,
    status: p.status as string,
    dateien: jePunkt.get(p.id as string) ?? [],
  }));
}

/** Gehört dieser Punkt zu diesem Mandanten? Sonst null. */
export async function linkPunkt(
  companyId: string,
  punktId: string,
): Promise<{ id: string; art: string; titel: string } | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("einrichtung_punkt")
    .select("id, art, titel")
    .eq("company_id", companyId)
    .eq("id", punktId)
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id as string,
    art: data.art as string,
    titel: data.titel as string,
  };
}
