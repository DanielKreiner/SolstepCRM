import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { eur } from "@/lib/format";
import { naechsteMahnung, type Mahnstufe } from "@/lib/rules/dunning";
import { createAdminClient } from "@/lib/supabase/admin";

/*
 * Eine Mahnung schreiben und versenden.
 *
 * Eine Funktion für beide Wege — den nächtlichen Lauf und den Knopf in
 * der Offene-Posten-Liste. Zwei Fassungen wären zwei Stellen, an denen
 * die Stufe hochgezählt, aber keine Mail geschrieben wird.
 *
 * Frei von Next-Abhängigkeiten, damit sie auch aus einem Worker läuft
 * (CLAUDE.md Abschnitt 7).
 */

export type MahnErgebnis =
  | { ok: true; stufe: Mahnstufe; nummer: string }
  | { ok: false; grund: string };

type Beleg = {
  id: string;
  company_id: string;
  vorgang_id: string;
  nummer: string | null;
  typ: string;
  betrag_brutto: string | null;
  faellig_am: string | null;
  status: string | null;
  mahnstufe: number;
  mahnung_aktiv: boolean;
};

export const BELEG_FELDER =
  "id, company_id, vorgang_id, nummer, typ, betrag_brutto, faellig_am, status, mahnstufe, mahnung_aktiv";

export async function mahnen(
  admin: SupabaseClient,
  beleg: Beleg,
  heute: string,
  opts: { erzwingen?: boolean } = {},
): Promise<MahnErgebnis> {
  const stufe = naechsteMahnung(
    {
      status: beleg.status,
      faelligAm: beleg.faellig_am,
      mahnstufe: beleg.mahnstufe,
      mahnungAktiv: beleg.mahnung_aktiv,
    },
    heute,
  );

  /*
   * Von Hand darf man eine Stufe vorziehen — aber nicht an den Grenzen
   * vorbei, die der Kunde selbst gesetzt hat. Wer ausgesetzt hat, meint
   * es auch bei einem Klick so, und einen Entwurf hat niemand bekommen.
   */
  const gewaehlt =
    stufe ??
    (opts.erzwingen &&
    beleg.mahnung_aktiv &&
    beleg.status === "versendet" &&
    beleg.mahnstufe < 3
      ? MANUELL[beleg.mahnstufe]
      : null);

  if (!gewaehlt) {
    return { ok: false, grund: "Für diese Rechnung ist keine Mahnung fällig." };
  }

  const { data: vorgang } = await admin
    .from("vorgang")
    .select("number, customer:customer_id ( name, email )")
    .eq("id", beleg.vorgang_id)
    .maybeSingle();

  const kunde = vorgang?.customer as unknown as {
    name: string;
    email: string | null;
  } | null;

  if (!kunde?.email) {
    return { ok: false, grund: "Für diesen Kunden ist keine Mailadresse hinterlegt." };
  }

  /*
   * Ohne eingehängtes Postfach wird trotzdem eingereiht — der Zusteller
   * entscheidet später, worüber er sendet (lib/mail/resend.ts als
   * Übergang). Vorher brach die Mahnung hier ab, und der Text wurde nie
   * geschrieben.
   */
  const { data: postfach } = await admin
    .from("mail_account")
    .select("id")
    .eq("company_id", beleg.company_id)
    .eq("is_default", true)
    .maybeSingle();

  const nummer = beleg.nummer ?? "ohne Nummer";
  const brutto = eur(Number(beleg.betrag_brutto ?? 0));
  const faellig = beleg.faellig_am ?? "—";

  const { error: mailErr } = await admin.from("mail_outbox").insert({
    company_id: beleg.company_id,
    mail_account_id: postfach?.id ?? null,
    to_addrs: [kunde.email],
    subject: `${gewaehlt.label} zu Rechnung ${nummer}`,
    body_html: html(gewaehlt, nummer, brutto, faellig),
    body_text:
      `${gewaehlt.label} zu Rechnung ${nummer} über ${brutto}, ` +
      `fällig war sie am ${faellig}.`,
    vorgang_id: beleg.vorgang_id,
    vorgang_dokument_id: beleg.id,
  });

  if (mailErr) return { ok: false, grund: mailErr.message };

  /*
   * Erst nach der Mail hochzählen. Andersherum wäre der Kunde bei einem
   * Fehler eine Stufe weiter, ohne je etwas bekommen zu haben.
   */
  const { error: updErr } = await admin
    .from("vorgang_dokument")
    .update({ mahnstufe: gewaehlt.stufe, gemahnt_am: new Date().toISOString() })
    .eq("id", beleg.id);

  if (updErr) return { ok: false, grund: updErr.message };

  /*
   * Typ 'rechnung', damit der Betrag der Rollengrenze folgt: der Strom
   * blendet diese Ereignisse für alle aus, die keine Rechnungen sehen
   * dürfen (Migration 0031).
   */
  await admin.from("vorgang_event").insert({
    company_id: beleg.company_id,
    vorgang_id: beleg.vorgang_id,
    typ: "rechnung",
    titel: `${gewaehlt.label} versendet`,
    body: `${nummer} über ${brutto}, fällig war sie am ${faellig}.`,
    payload: { dokument_id: beleg.id, mahnstufe: gewaehlt.stufe },
    kunde_sichtbar: false,
  });

  return { ok: true, stufe: gewaehlt, nummer };
}

/* Beim Vorziehen von Hand jeweils die nächste Stufe. */
const MANUELL: Record<number, Mahnstufe> = {
  0: { stufe: 1, abTagen: 7, label: "Zahlungserinnerung", ton: "erinnerung" },
  1: { stufe: 2, abTagen: 21, label: "1. Mahnung", ton: "mahnung" },
  2: { stufe: 3, abTagen: 35, label: "2. Mahnung", ton: "mahnung" },
};

/*
 * Der Ton steigt mit der Stufe, aber keine der drei Stufen droht. Wer
 * einem Handwerkskunden mit Inkasso schreibt, verliert ihn und den
 * Folgeauftrag — und die Rechtsfolgen stehen ohnehin im Gesetz und
 * nicht im Mailtext.
 */
function html(
  stufe: Mahnstufe,
  nummer: string,
  brutto: string,
  faellig: string,
): string {
  const kopf =
    stufe.ton === "erinnerung"
      ? `<p>Guten Tag,</p><p>zur Rechnung ${nummer} über ${brutto} konnten wir bis heute keinen Zahlungseingang feststellen. Fällig war sie am ${faellig}.</p>`
      : `<p>Guten Tag,</p><p>trotz unserer Erinnerung ist die Rechnung ${nummer} über ${brutto} weiter offen. Fällig war sie am ${faellig}.</p>`;

  const schluss =
    stufe.stufe >= 3
      ? `<p>Bitte melden Sie sich bei uns, damit wir das gemeinsam klären — auch wenn es gerade nicht passt. Eine Ratenzahlung ist meist möglich.</p>`
      : `<p>Sollte sich die Zahlung mit diesem Schreiben überschnitten haben, betrachten Sie es bitte als gegenstandslos.</p>`;

  return `${kopf}${schluss}`;
}


/**
 * Mahnung von aussen auslösen — für Server Actions.
 *
 * Der Service-Role-Client wird hier gebaut und nicht beim Aufrufer:
 * mail_account hält Postfach-Zugangsdaten und ist für authenticated
 * vollständig gesperrt (0001), mail_outbox ebenso. Ohne ihn kann eine
 * angemeldete Sitzung keine Mail schreiben.
 *
 * Die Rechteprüfung gehört in die aufrufende Action — dieselbe
 * Aufteilung wie bei lib/onboarding. Hier wird nur noch gegen die
 * mitgegebene company_id abgesichert, damit ein falscher Aufruf nicht
 * quer durch die Mandanten greift.
 */
export async function mahnungAusloesen(
  companyId: string,
  dokumentId: string,
): Promise<MahnErgebnis> {
  const admin = createAdminClient();

  const { data: beleg } = await admin
    .from("vorgang_dokument")
    .select(BELEG_FELDER)
    .eq("id", dokumentId)
    .eq("company_id", companyId)
    .maybeSingle();

  if (!beleg) return { ok: false, grund: "Beleg nicht gefunden." };

  return mahnen(admin, beleg, new Date().toISOString().slice(0, 10), {
    erzwingen: true,
  });
}
