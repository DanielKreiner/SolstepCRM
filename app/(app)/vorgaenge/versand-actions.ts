"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { date, eur } from "@/lib/format";
import { belegPdf } from "@/lib/pdf/erzeugen";
import { createPortalAccess } from "./kunde-actions";
import { requireMe } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { phaseMitziehen } from "@/lib/vorgang/phase-mitziehen";
import {
  einreihen,
  kundeZumVorgang,
  mailClient,
  portalLink,
} from "@/lib/vorgang/mail";

export type VersandStatus = { error: string | null; ok: string | null };

/**
 * Versand aus dem Vorgang heraus.
 *
 * Der entscheidende Unterschied zu vorher: ein Angebot geht raus, weil
 * jemand darauf drückt. Vorher war es sichtbar, sobald es existierte —
 * der Kunde sah dann den halbfertigen Stand, an dem gerade noch
 * gearbeitet wurde.
 */

async function zugang(bereich: "angebote" | "pipelines") {
  const me = await requireMe();
  if (me.perms[bereich] !== "write") {
    return { ok: false as const, status: { error: "Keine Berechtigung.", ok: null } };
  }
  if (me.company.status !== "active") {
    return {
      ok: false as const,
      status: { error: "Der Zugang ist derzeit nur lesend.", ok: null },
    };
  }
  return { ok: true as const, me };
}

const idSchema = z.object({ vorgangId: z.string().uuid() });

/**
 * Das Angebot an den Kunden schicken.
 *
 * Erneutes Senden ist ausdrücklich erlaubt und nicht gesperrt: nachfassen
 * ist der Normalfall im Vertrieb, und ein Angebot, das im Spam gelandet
 * ist, muss man ein zweites Mal schicken können. Der Zeitstempel wandert
 * dabei mit — gefragt ist, wann der Kunde es zuletzt bekommen hat.
 */
export async function angebotSenden(
  _prev: VersandStatus,
  formData: FormData,
): Promise<VersandStatus> {
  const z1 = await zugang("angebote");
  if (!z1.ok) return z1.status;

  const parsed = idSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Vorgang fehlt.", ok: null };
  const { vorgangId } = parsed.data;

  const supabase = await createClient();

  /*
   * Ein leeres Angebot zu verschicken ist keine Freiheit, sondern ein
   * Fehler, den der Kunde sieht. Deshalb hier und nicht erst im Portal.
   */
  const { count } = await supabase
    .from("vorgang_position")
    .select("id", { count: "exact", head: true })
    .eq("vorgang_id", vorgangId);

  if (!count) {
    return { error: "Das Angebot hat noch keine Positionen.", ok: null };
  }

  const admin = mailClient();
  const kunde = await kundeZumVorgang(admin, vorgangId);
  if (!kunde.ok) return { error: kunde.grund, ok: null };
  if (!kunde.empfaenger) {
    return {
      error: "Für diesen Kunden ist keine Mailadresse hinterlegt.",
      ok: null,
    };
  }

  /*
   * Ohne Portalzugang ging bisher gar nichts — der Versand brach ab und
   * verlangte, erst einen Zugang anzulegen. Das ist eine Bevormundung:
   * manche Kunden wollen kein Portal, und ein Angebot als PDF an eine
   * Mailadresse ist seit dreissig Jahren ein gültiger Weg.
   *
   * Jetzt entscheidet der Betrieb: mit Portal (der Kunde kann ansehen,
   * Optionen wählen und annehmen) oder nur per Mail mit PDF im Anhang.
   */
  const nurMail = formData.get("ohnePortal") === "ja";

  /*
   * Wer im Dialog „Portalzugang anlegen und senden" wählt, bekommt ihn
   * hier — ein zweiter Klick auf einer anderen Seite wäre ein Umweg um
   * seiner selbst willen.
   */
  if (!nurMail && formData.get("portalAnlegen") === "ja") {
    const daten = new FormData();
    daten.set("customerId", kunde.kundeId);
    const angelegt = await createPortalAccess({ error: null, ok: null }, daten);
    if (angelegt.error) return { error: angelegt.error, ok: null };
  }

  const link = nurMail
    ? null
    : await portalLink(admin, kunde.kundeId, { vorgangId, bereich: "angebot" });

  if (!nurMail && !link) {
    return {
      error:
        "Der Portalzugang liess sich nicht anlegen. Schick das Angebot nur per Mail oder sieh in den Einstellungen nach.",
      ok: null,
    };
  }

  /*
   * Ohne Portal muss das PDF mit — sonst bekommt der Kunde eine Mail,
   * die von einem Angebot spricht, das nirgends liegt.
   */
  let anhang: { dateiname: string; inhalt: Buffer } | null = null;
  if (!link) {
    const beleg = await belegPdf(supabase, vorgangId, "angebot");
    if (!beleg.ok) {
      return { error: `Das Angebots-PDF liess sich nicht erzeugen: ${beleg.grund}`, ok: null };
    }
    anhang = { dateiname: beleg.dateiname, inhalt: beleg.buffer };
  }

  /* Der Betrag steht in der Mail, weil er die erste Frage beantwortet. */
  const { data: wert } = await supabase
    .from("v_vorgang_wert")
    .select("angebotswert_netto")
    .eq("vorgang_id", vorgangId)
    .maybeSingle();

  const { data: v } = await supabase
    .from("vorgang")
    .select("angebot_gueltig_bis, angebot_versendet_am")
    .eq("id", vorgangId)
    .maybeSingle();

  const erneut = Boolean(v?.angebot_versendet_am);
  const netto = wert?.angebotswert_netto;

  const eingereiht = await einreihen(admin, {
    companyId: z1.me.companyId,
    vorgangId,
    art: "angebot",
    an: kunde.empfaenger,
    betreff: erneut
      ? `Ihr Angebot ${kunde.nummer} — noch einmal zum Ansehen`
      : `Ihr Angebot ${kunde.nummer}`,
    absaetze: [
      erneut
        ? "wie besprochen schicken wir Ihnen Ihr Angebot noch einmal."
        : link
          ? "Ihr Angebot ist fertig. Sie können es in Ihrem Kundenportal ansehen, Optionen auswählen und dort auch direkt annehmen."
          : "Ihr Angebot ist fertig — Sie finden es als PDF im Anhang.",
      ...(netto ? [`Der Angebotswert liegt bei ${eur(Number(netto))} netto.`] : []),
      ...(v?.angebot_gueltig_bis
        ? [`Das Angebot ist gültig bis ${date(v.angebot_gueltig_bis as string)}.`]
        : []),
      link
        ? "Wenn etwas unklar ist, antworten Sie einfach auf diese Mail oder schreiben Sie uns direkt im Portal."
        : "Wenn etwas unklar ist oder Sie annehmen möchten, antworten Sie einfach auf diese Mail.",
    ],
    ...(link ? { knopf: { text: "Angebot ansehen", url: link } } : {}),
    ...(anhang ? { anhaenge: [anhang] } : {}),
  });

  if (!eingereiht.ok) {
    return { error: `Versand fehlgeschlagen: ${eingereiht.grund}`, ok: null };
  }

  /*
   * Die verschickte Fassung einfrieren.
   *
   * Vorher las das Portal den lebenden Entwurf: wer nach dem Versand
   * eine Position änderte, änderte still auch das, was der Kunde vor
   * sich hatte. Jetzt ist eine Version genau das, was rausging.
   */
  const fassung = await fassungEinfrieren(admin, z1.me.companyId, vorgangId, kunde.nummer);

  /*
   * Erst nach der Mail den Zeitstempel setzen. Andersherum stünde am
   * Vorgang „versendet", ohne dass je etwas rausgegangen wäre.
   */
  await admin
    .from("vorgang")
    .update({ angebot_versendet_am: new Date().toISOString() })
    .eq("id", vorgangId);

  /*
   * Ein verschicktes Angebot IST das Angebot. Vorher stand der Vorgang
   * danach noch in „Aufnahme", bis jemand im Überblick einen Knopf
   * drückte — im Board also eine Phase zurück, obwohl der Kunde die Mail
   * schon hatte.
   */
  await phaseMitziehen(admin, {
    companyId: z1.me.companyId,
    vorgangId,
    userId: z1.me.id,
    aus: ["anfrage", "aufnahme"],
    nach: "angebot",
    grund: "Angebot an den Kunden verschickt.",
  });

  await admin.from("vorgang_event").insert({
    company_id: z1.me.companyId,
    vorgang_id: vorgangId,
    typ: "angebot",
    titel: erneut
      ? `Angebot erneut versendet — Fassung ${fassung}`
      : `Angebot versendet — Fassung ${fassung}`,
    body: `An ${kunde.empfaenger.email}`,
    kunde_sichtbar: true,
    created_by: z1.me.id,
  });

  revalidatePath(`/vorgaenge/${vorgangId}`);
  return {
    error: null,
    ok: erneut
      ? `Fassung ${fassung} an ${kunde.empfaenger.email} eingereiht.`
      : `An ${kunde.empfaenger.email} eingereiht — geht mit dem nächsten Versandlauf raus.`,
  };
}

/**
 * Den aktuellen Entwurf als neue Fassung festhalten.
 *
 * Kopiert und nicht verschoben: der Entwurf bleibt bearbeitbar, sonst
 * stünde der Editor nach dem Senden leer da. Die Gruppen werden
 * mitkopiert und die Positionen auf die Kopien umgehängt — sonst zeigte
 * die eingefrorene Fassung auf Gruppen, die jemand später umbenennt.
 */
async function fassungEinfrieren(
  admin: ReturnType<typeof mailClient>,
  companyId: string,
  vorgangId: string,
  nummer: string,
): Promise<number> {
  const { data: letzte } = await admin
    .from("vorgang_dokument")
    .select("version")
    .eq("vorgang_id", vorgangId)
    .eq("typ", "angebot")
    .not("version", "is", null)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  const version = ((letzte?.version as number | null) ?? 0) + 1;

  const { data: dok } = await admin
    .from("vorgang_dokument")
    .insert({
      company_id: companyId,
      vorgang_id: vorgangId,
      typ: "angebot",
      version,
      dateiname: `Angebot ${nummer} Fassung ${version}`,
      kunde_sichtbar: true,
    })
    .select("id")
    .single();

  if (!dok) return version;

  const { data: gruppen } = await admin
    .from("vorgang_gruppe")
    .select("id, name, beschreibung, sort, paket_preis, einzelpreise_verstecken")
    .eq("vorgang_id", vorgangId)
    .is("dokument_id", null);

  const abbildung = new Map<string, string>();
  for (const g of (gruppen ?? []) as unknown as {
    id: string;
    name: string;
    beschreibung: string | null;
    sort: number;
    paket_preis: string | null;
    einzelpreise_verstecken: boolean;
  }[]) {
    const { data: neu } = await admin
      .from("vorgang_gruppe")
      .insert({
        company_id: companyId,
        vorgang_id: vorgangId,
        dokument_id: dok.id as string,
        name: g.name,
        beschreibung: g.beschreibung,
        sort: g.sort,
        paket_preis: g.paket_preis,
        einzelpreise_verstecken: g.einzelpreise_verstecken,
      })
      .select("id")
      .single();
    if (neu) abbildung.set(g.id, neu.id as string);
  }

  /*
   * Spalten einzeln und nicht mit "*": gp_netto ist eine berechnete
   * Spalte, und Postgres weist jeden Insert zurück, der sie mitschickt.
   * Genau daran ist die erste Fassung still gescheitert — sie hatte
   * Gruppen, aber keine einzige Position, und der Kunde hätte ein leeres
   * Angebot vor sich gehabt.
   */
  const FELDER =
    "company_id, vorgang_id, sort, article_id, bezeichnung, beschreibung, " +
    "menge, einheit, ep_netto, ust_satz, rabatt_prozent, optional, " +
    "kunden_auswahl, kalk_ek, kalk_stunden, ist_material, bild_url, " +
    "gruppe_id, upgrade_article_id, upgrade_kategorie, upgrade_aufpreis, upgrade_text";

  const { data: positionen } = await admin
    .from("vorgang_position")
    .select(FELDER)
    .eq("vorgang_id", vorgangId)
    .is("dokument_id", null);

  const kopien = ((positionen ?? []) as unknown as Record<string, unknown>[]).map(
    (p) => ({
      ...p,
      dokument_id: dok.id as string,
      gruppe_id: p.gruppe_id ? (abbildung.get(p.gruppe_id as string) ?? null) : null,
    }),
  );

  if (kopien.length > 0) {
    const { error } = await admin.from("vorgang_position").insert(kopien);
    /*
     * Eine Fassung ohne Positionen wäre schlimmer als keine: der Kunde
     * sähe ein leeres Angebot. Dann lieber das Dokument wieder weg und
     * der Aufrufer merkt es an der Versionsnummer.
     */
    if (error) {
      await admin.from("vorgang_dokument").delete().eq("id", dok.id as string);
      throw new Error(`Fassung konnte nicht eingefroren werden: ${error.message}`);
    }
  }

  return version;
}

/**
 * Das Angebot wieder zurückziehen.
 *
 * Wer zu früh gedrückt hat, braucht einen Weg zurück. Der Kunde sieht
 * das Angebot danach nicht mehr — die bereits verschickte Mail lässt
 * sich natürlich nicht zurückholen, und deshalb steht das auch so da.
 */
export async function angebotZurueckziehen(
  _prev: VersandStatus,
  formData: FormData,
): Promise<VersandStatus> {
  const z1 = await zugang("angebote");
  if (!z1.ok) return z1.status;

  const parsed = idSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Vorgang fehlt.", ok: null };

  const admin = mailClient();
  const { error } = await admin
    .from("vorgang")
    .update({ angebot_versendet_am: null, angebot_gesehen_am: null })
    .eq("id", parsed.data.vorgangId)
    .eq("company_id", z1.me.companyId);

  if (error) return { error: `Fehlgeschlagen: ${error.message}`, ok: null };

  revalidatePath(`/vorgaenge/${parsed.data.vorgangId}`);
  return {
    error: null,
    ok: "Zurückgezogen. Im Portal ist es wieder unsichtbar — die verschickte Mail bleibt beim Kunden.",
  };
}

const erneutSchema = z.object({
  vorgangId: z.string().uuid(),
  mailId: z.string().uuid(),
});

/**
 * Eine Mail noch einmal schicken.
 *
 * Als neue Zeile, nicht als zurückgesetzte alte: der Postausgang muss
 * zeigen, dass zweimal etwas rausging. Sonst steht dort eine Mail mit
 * einem Datum, und niemand weiss mehr, ob der Kunde eine oder drei
 * bekommen hat.
 */
export async function mailErneutSenden(
  _prev: VersandStatus,
  formData: FormData,
): Promise<VersandStatus> {
  const z1 = await zugang("angebote");
  if (!z1.ok) return z1.status;

  const parsed = erneutSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Eingabe fehlt.", ok: null };

  const admin = mailClient();
  const { data: alt } = await admin
    .from("mail_outbox")
    .select(
      "company_id, vorgang_id, mail_account_id, art, to_addrs, cc_addrs, subject, body_html, body_text, attachments",
    )
    .eq("id", parsed.data.mailId)
    .eq("company_id", z1.me.companyId)
    .maybeSingle();

  if (!alt) return { error: "Die Mail wurde nicht gefunden.", ok: null };

  const { error } = await admin.from("mail_outbox").insert({
    company_id: alt.company_id,
    vorgang_id: alt.vorgang_id,
    mail_account_id: alt.mail_account_id,
    art: alt.art,
    erneut_zu: parsed.data.mailId,
    to_addrs: alt.to_addrs,
    cc_addrs: alt.cc_addrs,
    subject: alt.subject,
    body_html: alt.body_html,
    body_text: alt.body_text,
    attachments: alt.attachments,
  });

  if (error) return { error: `Fehlgeschlagen: ${error.message}`, ok: null };

  revalidatePath(`/vorgaenge/${parsed.data.vorgangId}`);
  return {
    error: null,
    ok: `Noch einmal eingereiht an ${(alt.to_addrs as string[]).join(", ")}.`,
  };
}
