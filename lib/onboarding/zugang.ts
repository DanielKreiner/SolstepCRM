import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { BRAND } from "@/lib/brand";
import { createAdminClient } from "@/lib/supabase/admin";
import { einreihen } from "@/lib/vorgang/mail";

/*
 * Zugangslinks für Mitarbeiter — Einladung und vergessenes Passwort.
 *
 * Warum nicht `inviteUserByEmail`: das verschickt die Mail selbst, und
 * zwar mit Supabases eigener Vorlage. Beim Einladen kam deshalb eine
 * englische Mail "You've been invited" vom Absender "Supabase Auth" an,
 * und der Knopf darin zeigte auf die Site-URL aus dem
 * Supabase-Dashboard — in der Entwicklung also auf localhost:3000, wo
 * beim Empfänger nichts läuft. Der Eingeladene bekam eine Fehlerseite
 * statt eines Zugangs, und der Betrieb bekam eine Mail, die nicht nach
 * ihm aussieht. Beides widerspricht CLAUDE.md 6.1 (Mail läuft über den
 * Postausgang des Mandanten) und 10 (alle Texte deutsch).
 *
 * `generateLink` erzeugt nur den Token und verschickt nichts. Die Mail
 * schreiben wir selbst, über denselben Weg wie jede andere: deutsch,
 * mit dem Briefkopf des Betriebs, im Postausgang nachvollziehbar.
 *
 * Der Link zeigt auf `/einladung` dieser Anwendung und trägt den
 * gehashten Token als Parameter. Damit hängt die Anmeldung an nichts,
 * was ausserhalb dieses Repos eingestellt werden muss — die Site-URL
 * des Supabase-Projekts spielt keine Rolle mehr.
 *
 * Absender ist bewusst das Postfach des MANDANTEN, nicht das
 * Systempostfach des Betreibers. CLAUDE.md 6.1 nennt Einladungen beim
 * Systempostfach, meint dort aber die Einladung eines Mandanten durch
 * den Betreiber. Hier lädt ein Betrieb seinen eigenen Mitarbeiter ein:
 * Der soll eine Mail von seinem Arbeitgeber bekommen, mit dessen
 * Briefkopf und dessen Adresse, und nicht von einer Software, die er
 * noch gar nicht kennt.
 */

/** `invite` für ein neues Konto, `recovery` für ein vergessenes Passwort. */
export type Zugangsart = "invite" | "recovery";

export type LinkErgebnis =
  | { ok: true; userId: string | null; url: string }
  | { ok: false; grund: string };

export async function zugangsLink(
  admin: SupabaseClient,
  email: string,
  art: Zugangsart,
  name?: string,
): Promise<LinkErgebnis> {
  const antwort =
    art === "invite"
      ? await admin.auth.admin.generateLink({
          type: "invite",
          email,
          options: { data: { name: name ?? "" } },
        })
      : await admin.auth.admin.generateLink({ type: "recovery", email });

  const token = antwort.data?.properties?.hashed_token;
  if (antwort.error || !token) {
    return {
      ok: false,
      grund: antwort.error?.message ?? "Kein Zugangslink erhalten.",
    };
  }

  const url = new URL("/einladung", BRAND.domain);
  url.searchParams.set("token", token);
  url.searchParams.set("typ", art);

  return { ok: true, userId: antwort.data?.user?.id ?? null, url: url.href };
}

/**
 * Die Zugangsmail in den Postausgang legen und sofort zustellen.
 *
 * Gibt zurück, ob sie wirklich draussen ist — nicht, ob sie eingereiht
 * wurde. Wer einen Mitarbeiter einlädt, muss wissen, ob er jetzt auf
 * eine Mail warten kann oder ob er ihm den Zugang anders geben muss.
 */
export async function zugangsmail(
  admin: SupabaseClient,
  d: {
    companyId: string;
    name: string;
    email: string;
    art: Zugangsart;
    url: string;
  },
): Promise<boolean> {
  const einladung = d.art === "invite";

  const ergebnis = await einreihen(admin, {
    companyId: d.companyId,
    vorgangId: null,
    art: "zugang",
    an: { name: d.name, email: d.email },
    /*
     * Ohne Produktnamen im Betreff. Der steht noch nicht fest
     * (CLAUDE.md 0), und "Ihr Zugang zu Betrieb" liest sich mit dem
     * Platzhalter wie ein Fehler. Von wem die Mail kommt, sagt der
     * Briefkopf des Betriebs darüber ohnehin deutlicher.
     */
    betreff: einladung ? "Ihr Zugang" : "Neues Passwort für Ihren Zugang",
    absaetze: einladung
      ? [
          "für Sie wurde ein Zugang eingerichtet. Mit dem Knopf unten vergeben Sie Ihr Passwort und sind sofort angemeldet.",
          "Ihr Benutzername ist diese Mailadresse. Der Link gilt 24 Stunden; danach können Sie über „Passwort vergessen“ auf der Anmeldeseite jederzeit einen neuen anfordern.",
        ]
      : [
          "Sie haben ein neues Passwort angefordert. Mit dem Knopf unten vergeben Sie es und sind sofort angemeldet.",
          "Der Link gilt 24 Stunden. Haben Sie das nicht angefordert, können Sie diese Mail ignorieren — Ihr bisheriges Passwort bleibt gültig.",
        ],
    knopf: {
      text: einladung ? "Passwort vergeben" : "Neues Passwort vergeben",
      url: d.url,
    },
  });

  return ergebnis.ok && ergebnis.gesendet;
}

/** Kein zweiter Link innerhalb dieser Spanne — gegen Mailfluten. */
const SPERRE_MIN = 2;

/**
 * Neues Passwort anfordern.
 *
 * Sagt dem Aufrufer bewusst nicht, ob es die Adresse gibt. Täte sie das,
 * wäre das Formular ein Verzeichnis aller Zugänge des Betriebs — dieselbe
 * Überlegung wie bei der Anmeldung, die auch nicht verrät, ob die Adresse
 * oder das Passwort falsch war.
 *
 * Deaktivierte Mitarbeiter bekommen keinen Link. Wer aus dem Betrieb
 * ausgeschieden ist, holt sich sonst über „Passwort vergessen" einen
 * Zugang zurück, den ihm jemand absichtlich genommen hat.
 */
export async function passwortVergessen(email: string): Promise<void> {
  const admin = createAdminClient();
  const adresse = email.trim().toLowerCase();

  const { data: nutzer } = await admin
    .from("app_user")
    .select("company_id, name, active")
    .eq("email", adresse)
    .maybeSingle();

  if (!nutzer || nutzer.active === false) return;

  /*
   * Wer das Formular wiederholt abschickt — aus Ungeduld oder mit
   * Absicht —, soll nicht beliebig viele Mails auslösen. Der letzte Link
   * gilt ohnehin noch.
   */
  const seit = new Date(Date.now() - SPERRE_MIN * 60_000).toISOString();
  const { data: letzte } = await admin
    .from("mail_outbox")
    .select("id")
    .eq("art", "zugang")
    .contains("to_addrs", [adresse])
    .gt("created_at", seit)
    .limit(1);

  if (letzte?.length) return;

  const link = await zugangsLink(admin, adresse, "recovery");
  if (!link.ok) return;

  await zugangsmail(admin, {
    companyId: nutzer.company_id as string,
    name: (nutzer.name as string | null) ?? "",
    email: adresse,
    art: "recovery",
    url: link.url,
  });
}
