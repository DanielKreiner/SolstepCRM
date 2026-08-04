"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { kaskadeAusloesen } from "@/lib/vorgang/kaskade";
import { requireMe } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { BRAND } from "@/lib/brand";
import { verschluesseln } from "@/lib/mail/crypto";
import { createToken, hashToken } from "@/lib/portal/token";
import { einreihen, mailClient } from "@/lib/vorgang/mail";
import { auftragBestaetigt } from "@/lib/vorgang/kundenmails";

export type KaskadeStatus = { error: string | null; ok: string | null };

/**
 * „Angebot angenommen" — die Kaskade.
 *
 * Ein Dialog, vier Antworten, und daraus entsteht alles Weitere von
 * selbst: Auftragsbestätigung, Anzahlungsrechnung, Materialbedarfsliste,
 * sechs Gates und die Soll-Werte für die spätere Nachkalkulation.
 *
 * Nichts davon erfordert erneutes Eintippen von Positionen. Das ist der
 * wichtigste Abnahmetest des ganzen Umbaus (Briefing Abschnitt 5.2) —
 * denn genau hier lag bisher die Doppelarbeit, die den Betrieb Zeit
 * gekostet hat.
 */

const annahmeSchema = z.object({
  vorgangId: z.string().uuid(),
  anzahlungProzent: z.coerce.number().min(0).max(100),
  wunschZeitraum: z.string().trim().max(80).optional().default(""),
  geruest: z.enum(["ja", "nein"]),
  sub: z.enum(["ja", "nein"]),
  /* Häkchen im Dialog, vorbelegt mit ja. */
  portal: z.enum(["ja", "nein"]).optional().default("nein"),
});

export async function angebotAngenommen(
  _prev: KaskadeStatus,
  formData: FormData,
): Promise<KaskadeStatus> {
  const me = await requireMe();
  if (me.perms.pipelines !== "write" || me.perms.angebote !== "write") {
    return {
      error: "Für die Auftragsauslösung fehlt deiner Rolle das Schreibrecht.",
      ok: null,
    };
  }
  if (me.company.status !== "active") {
    return { error: "Der Zugang ist derzeit nur lesend.", ok: null };
  }

  const parsed = annahmeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Eingabe fehlt.", ok: null };
  }
  const d = parsed.data;

  const supabase = await createClient();

  const ergebnis = await kaskadeAusloesen(supabase, {
    vorgangId: d.vorgangId,
    companyId: me.companyId,
    userId: me.id,
    anzahlungProzent: d.anzahlungProzent,
    wunschZeitraum: d.wunschZeitraum,
    geruest: d.geruest,
    sub: d.sub,
    quelle: "backoffice",
  });

  if (!ergebnis.ok) return { error: ergebnis.grund, ok: null };

  /*
   * Portalzugang gleich mit anlegen und dem Kunden schicken.
   *
   * Der beste Zeitpunkt ist genau dieser: der Kunde hat gerade zugesagt
   * und schaut auf sein Projekt. Eine Woche später ist die Aufmerksamkeit
   * weg, und dann ruft er an, statt nachzusehen.
   *
   * Scheitert leise: der Auftrag ist ausgelöst, und den wieder
   * zurückzudrehen, weil eine Mailadresse fehlt, wäre der schlechtere
   * Tausch. Was nicht klappte, steht in der Meldung.
   */
  /*
   * Der Kunde hört sofort, dass sein Auftrag angekommen ist. Ohne diese
   * Mail ruft er zwei Tage später an und fragt genau das.
   */
  const bestaetigt = await auftragBestaetigt(me.companyId, d.vorgangId);

  let zusatz = bestaetigt ? ` Bestätigung an ${bestaetigt} geschickt.` : "";
  if (d.portal === "ja") {
    const r = await portalMitAnlegen(supabase, me, d.vorgangId);
    zusatz += r ? ` ${r}` : "";
  }

  revalidatePath(`/vorgaenge/${d.vorgangId}`);
  revalidatePath("/vorgaenge");
  revalidatePath("/cockpit");

  return { error: null, ok: `${ergebnis.meldung}${zusatz}` };
}

/**
 * Zugang anlegen, alten widerrufen, Willkommensmail einreihen.
 *
 * Hat der Kunde schon einen gültigen Zugang, bleibt er — ein neuer Link
 * würde den alten entwerten, den er vielleicht gerade offen hat.
 */
async function portalMitAnlegen(
  supabase: Awaited<ReturnType<typeof createClient>>,
  me: Awaited<ReturnType<typeof requireMe>>,
  vorgangId: string,
): Promise<string | null> {
  const { data: v } = await supabase
    .from("vorgang")
    .select("customer_id, customer:customer_id ( name, email )")
    .eq("id", vorgangId)
    .maybeSingle();

  if (!v) return null;
  const kunde = v.customer as unknown as { name: string; email: string | null } | null;
  const kundeId = v.customer_id as string;

  const { count } = await supabase
    .from("portal_access")
    .select("id", { count: "exact", head: true })
    .eq("customer_id", kundeId)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString());

  if ((count ?? 0) > 0) return "Der Portalzugang bestand bereits.";
  if (!kunde?.email) {
    return "Kein Portalzugang: beim Kunden ist keine Mailadresse hinterlegt.";
  }

  let token: string;
  let verschluesselt: string;
  try {
    token = createToken(kundeId);
    verschluesselt = `\\x${verschluesseln(token).toString("hex")}`;
  } catch {
    return "Der Portalzugang liess sich nicht erzeugen — bitte in den Einstellungen prüfen.";
  }

  const ablauf = new Date();
  ablauf.setDate(ablauf.getDate() + 90);

  const { error } = await supabase.from("portal_access").insert({
    company_id: me.companyId,
    customer_id: kundeId,
    token_hash: hashToken(token),
    token_enc: verschluesselt,
    expires_at: ablauf.toISOString(),
  });

  if (error) return `Portalzugang fehlgeschlagen: ${error.message}`;

  const admin = mailClient();
  const r = await einreihen(admin, {
    companyId: me.companyId,
    vorgangId,
    art: "portal",
    an: { name: kunde.name, email: kunde.email },
    betreff: "Ihr Zugang zum Kundenportal",
    absaetze: [
      "vielen Dank für Ihren Auftrag. Wir haben Ihnen einen persönlichen Bereich eingerichtet: dort sehen Sie jederzeit, wie weit Ihr Projekt ist, finden alle Unterlagen und können uns direkt schreiben.",
      "Ein Passwort brauchen Sie nicht — der Link unten genügt. Bitte geben Sie ihn nicht weiter, er ist persönlich.",
      "Der Zugang ist 90 Tage gültig.",
    ],
    knopf: { text: "Portal öffnen", url: `${BRAND.domain}/portal/${token}` },
  });

  return r.ok
    ? `Portalzugang angelegt und an ${kunde.email} geschickt.`
    : "Portalzugang angelegt, die Mail dazu konnte nicht eingereiht werden.";
}
