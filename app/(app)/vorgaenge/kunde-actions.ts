"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { AktionsStatus } from "@/components/ui/Formular";
import { BRAND } from "@/lib/brand";
import { verschluesseln } from "@/lib/mail/crypto";
import { createToken, hashToken } from "@/lib/portal/token";
import { requireMe } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { einreihen, mailClient } from "@/lib/vorgang/mail";

/*
 * Kunden, deren Anlagen und der Portalzugang.
 *
 * Lag im CRM, das es nicht mehr gibt: ein eigener Reiter für Kundendaten
 * war eine zweite Liste über dieselben Vorgänge. Gepflegt wird der Kunde
 * jetzt dort, wo mit ihm gearbeitet wird.
 *
 * Der Kunde ist die Wurzel des Datenmodells — an ihm hängen Vorgänge,
 * Rechnungen und der Portalzugang. Deshalb wird er nie gelöscht, sondern
 * nur auf `deleted_at` gesetzt: eine Rechnung ohne Kunden wäre nicht mehr
 * zuordenbar, und die Aufbewahrungspflicht gilt sieben Jahre
 * (CLAUDE.md 11, Löschkonzept).
 */

const kundeSchema = z.object({
  name: z.string().trim().min(2, "Name fehlt.").max(120),
  type: z.enum(["lead", "customer"]),
  contactPerson: z.string().trim().max(120).optional().or(z.literal("")),
  email: z
    .string()
    .trim()
    .max(160)
    .refine((v) => v === "" || z.string().email().safeParse(v).success, {
      message: "Das ist keine gültige Mailadresse.",
    }),
  phone: z.string().trim().max(60).optional().or(z.literal("")),
  address: z.string().trim().max(160).optional().or(z.literal("")),
  zip: z.string().trim().max(12).optional().or(z.literal("")),
  city: z.string().trim().max(80).optional().or(z.literal("")),
  source: z.string().trim().max(60).optional().or(z.literal("")),
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
});

/** Leerstring zu null — sonst steht in der Datenbank "" statt "nichts". */
const leerZuNull = (v: string | undefined): string | null =>
  v && v.trim() !== "" ? v.trim() : null;

async function darfSchreiben(): Promise<
  { ok: true; me: Awaited<ReturnType<typeof requireMe>> } | { ok: false; status: AktionsStatus }
> {
  const me = await requireMe();
  /*
   * Weiterhin das CRM-Recht und nicht das Pipeline-Recht: wer Vorgänge
   * bearbeiten darf, darf damit nicht automatisch Kundenstammdaten
   * ändern. Die Rollenmatrix bleibt, nur der Screen ist ein anderer.
   */
  if (me.perms.crm !== "write") {
    return {
      ok: false,
      status: { error: "Für Kundendaten fehlt deiner Rolle das Schreibrecht.", ok: null },
    };
  }
  return { ok: true, me };
}

export async function createCustomer(
  _prev: AktionsStatus,
  formData: FormData,
): Promise<AktionsStatus> {
  const zugang = await darfSchreiben();
  if (!zugang.ok) return zugang.status;

  const parsed = kundeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Eingabe fehlt.", ok: null };
  }
  const d = parsed.data;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("customer")
    .insert({
      company_id: zugang.me.companyId,
      name: d.name,
      type: d.type,
      contact_person: leerZuNull(d.contactPerson),
      email: leerZuNull(d.email),
      phone: leerZuNull(d.phone),
      address: leerZuNull(d.address),
      zip: leerZuNull(d.zip),
      city: leerZuNull(d.city),
      source: leerZuNull(d.source),
      notes: leerZuNull(d.notes),
      created_by: zugang.me.id,
    })
    .select("id, name")
    .single();

  if (error) return { error: `Anlegen fehlgeschlagen: ${error.message}`, ok: null };

  revalidatePath("/vorgaenge");
  return { error: null, ok: `${data.name as string} angelegt.` };
}

export async function updateCustomer(
  _prev: AktionsStatus,
  formData: FormData,
): Promise<AktionsStatus> {
  const zugang = await darfSchreiben();
  if (!zugang.ok) return zugang.status;

  const id = z.string().uuid().safeParse(formData.get("customerId"));
  if (!id.success) return { error: "Kunde fehlt.", ok: null };

  const parsed = kundeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Eingabe fehlt.", ok: null };
  }
  const d = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase
    .from("customer")
    .update({
      name: d.name,
      type: d.type,
      contact_person: leerZuNull(d.contactPerson),
      email: leerZuNull(d.email),
      phone: leerZuNull(d.phone),
      address: leerZuNull(d.address),
      zip: leerZuNull(d.zip),
      city: leerZuNull(d.city),
      source: leerZuNull(d.source),
      notes: leerZuNull(d.notes),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id.data);

  if (error) return { error: `Speichern fehlgeschlagen: ${error.message}`, ok: null };

  revalidatePath("/vorgaenge");
  return { error: null, ok: "Gespeichert." };
}

/**
 * Kunde archivieren.
 *
 * Kein DELETE: an einem Kunden hängen Rechnungen, die sieben Jahre bleiben
 * müssen. `deleted_at` blendet ihn überall aus, die Belege bleiben zuordenbar.
 *
 * Offene Aufträge blockieren das Archivieren — sonst verschwindet ein Kunde,
 * an dem noch gearbeitet wird, aus jeder Liste.
 */
export async function archiveCustomer(
  _prev: AktionsStatus,
  formData: FormData,
): Promise<AktionsStatus> {
  const zugang = await darfSchreiben();
  if (!zugang.ok) return zugang.status;

  const id = z.string().uuid().safeParse(formData.get("customerId"));
  if (!id.success) return { error: "Kunde fehlt.", ok: null };

  const supabase = await createClient();

  const { data: offene } = await supabase
    .from("vorgang")
    .select("number, phase")
    .eq("customer_id", id.data)
    .not("phase", "in", "(abschluss,verloren)");

  const laufend = offene ?? [];

  if (laufend.length > 0) {
    return {
      error: `Es laufen noch ${laufend.length} Vorgänge (${laufend
        .map((j) => j.number as string)
        .slice(0, 3)
        .join(", ")}). Erst abschließen, dann archivieren.`,
      ok: null,
    };
  }

  const { error } = await supabase
    .from("customer")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id.data);

  if (error) return { error: `Archivieren fehlgeschlagen: ${error.message}`, ok: null };

  revalidatePath("/vorgaenge");
  return { error: null, ok: "Kunde archiviert. Belege bleiben erhalten." };
}

export async function restoreCustomer(
  _prev: AktionsStatus,
  formData: FormData,
): Promise<AktionsStatus> {
  const zugang = await darfSchreiben();
  if (!zugang.ok) return zugang.status;

  const id = z.string().uuid().safeParse(formData.get("customerId"));
  if (!id.success) return { error: "Kunde fehlt.", ok: null };

  const supabase = await createClient();
  const { error } = await supabase
    .from("customer")
    .update({ deleted_at: null })
    .eq("id", id.data);

  if (error) return { error: `Fehlgeschlagen: ${error.message}`, ok: null };

  revalidatePath("/vorgaenge");
  return { error: null, ok: "Kunde wieder aktiv." };
}

// --------------------------------------------------------------------------
// Anlagen
// --------------------------------------------------------------------------

const anlageSchema = z.object({
  customerId: z.string().uuid(),
  kwp: z.coerce.number().min(0).max(10000).optional(),
  storageKwh: z.coerce.number().min(0).max(10000).optional(),
  modules: z.string().trim().max(120).optional().or(z.literal("")),
  inverter: z.string().trim().max(120).optional().or(z.literal("")),
  meterPoint: z.string().trim().max(60).optional().or(z.literal("")),
  commissionedOn: z.string().trim().optional().or(z.literal("")),
});

/**
 * Anlage anlegen oder ändern.
 *
 * Die Anlage hängt am Kunden, nicht am Auftrag: sie überlebt den Auftrag,
 * der sie errichtet hat, und trägt später die Servicefälle. Kundenportal
 * und Pipelinekarte lesen kWp von hier.
 */
export async function saveAnlage(
  _prev: AktionsStatus,
  formData: FormData,
): Promise<AktionsStatus> {
  const zugang = await darfSchreiben();
  if (!zugang.ok) return zugang.status;

  const parsed = anlageSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Eingabe fehlt.", ok: null };
  }
  const d = parsed.data;
  const anlageId = formData.get("plantId");

  const supabase = await createClient();
  const werte = {
    company_id: zugang.me.companyId,
    customer_id: d.customerId,
    kwp: d.kwp ?? null,
    storage_kwh: d.storageKwh ?? null,
    modules: leerZuNull(d.modules),
    inverter: leerZuNull(d.inverter),
    meter_point: leerZuNull(d.meterPoint),
    commissioned_on: leerZuNull(d.commissionedOn),
  };

  const { error } =
    typeof anlageId === "string" && anlageId.length > 0
      ? await supabase.from("plant").update(werte).eq("id", anlageId)
      : await supabase.from("plant").insert(werte);

  if (error) return { error: `Speichern fehlgeschlagen: ${error.message}`, ok: null };

  revalidatePath("/vorgaenge");
  return { error: null, ok: "Anlage gespeichert." };
}

export async function deleteAnlage(
  _prev: AktionsStatus,
  formData: FormData,
): Promise<AktionsStatus> {
  const zugang = await darfSchreiben();
  if (!zugang.ok) return zugang.status;

  const id = z.string().uuid().safeParse(formData.get("plantId"));
  if (!id.success) return { error: "Anlage fehlt.", ok: null };

  const supabase = await createClient();

  const { error } = await supabase.from("plant").delete().eq("id", id.data);
  if (error) return { error: `Löschen fehlgeschlagen: ${error.message}`, ok: null };

  revalidatePath("/vorgaenge");
  return { error: null, ok: "Anlage gelöscht." };
}

// --------------------------------------------------------------------------
// Kundenportal
// --------------------------------------------------------------------------

/**
 * Portalzugang erzeugen.
 *
 * Das Portal ist der Kundenzugang: Fortschritt, Angebot annehmen, Dokumente,
 * Anliegen. Es gab bisher keinen Weg, einen solchen Zugang aus der Anwendung
 * heraus anzulegen — der einzige existierende Token stammte aus dem Seed.
 * Damit war das Portal gebaut, aber unerreichbar.
 *
 * Der Token wird EINMAL im Klartext zurückgegeben und danach nie wieder:
 * gespeichert ist nur sein Hash (CLAUDE.md 4.3). Wer den Link verliert,
 * erzeugt einen neuen — das ist der Preis dafür, dass ein Datenbankleck
 * keine Kundenzugänge preisgibt.
 *
 * Ein neuer Zugang widerruft den alten. Sonst sammeln sich über die Jahre
 * gültige Links an, die niemand mehr kennt.
 */
export async function createPortalAccess(
  _prev: AktionsStatus,
  formData: FormData,
): Promise<AktionsStatus> {
  const zugang = await darfSchreiben();
  if (!zugang.ok) return zugang.status;

  const id = z.string().uuid().safeParse(formData.get("customerId"));
  if (!id.success) return { error: "Kunde fehlt.", ok: null };

  const supabase = await createClient();
  const { data: kunde } = await supabase
    .from("customer")
    .select("id, name, email")
    .eq("id", id.data)
    .maybeSingle();

  if (!kunde) return { error: "Kunde nicht gefunden.", ok: null };

  /*
   * Token erzeugen und verschlüsseln kann an der Umgebung scheitern —
   * PORTAL_TOKEN_SECRET oder MAIL_CRED_KEY fehlt oder hat die falsche
   * Länge. Ungefangen reisst das die ganze Seite mit und der Betrieb
   * sieht einen weissen Fehlerbildschirm mit einer Prüfsumme darauf.
   * Eine fehlende Einstellung ist kein Absturz, sondern eine Meldung.
   */
  let token: string;
  let verschluesselt: string;
  try {
    token = createToken(id.data);
    verschluesselt = `\\x${verschluesseln(token).toString("hex")}`;
  } catch (e) {
    const grund = e instanceof Error ? e.message : "unbekannt";
    return {
      error: `Der Portalzugang lässt sich nicht erzeugen: ${grund}`,
      ok: null,
    };
  }

  const ablauf = new Date();
  ablauf.setDate(ablauf.getDate() + 90);

  // Alte Zugänge desselben Kunden widerrufen.
  await supabase
    .from("portal_access")
    .update({ revoked_at: new Date().toISOString() })
    .eq("customer_id", id.data)
    .is("revoked_at", null);

  const { error } = await supabase.from("portal_access").insert({
    company_id: zugang.me.companyId,
    customer_id: id.data,
    token_hash: hashToken(token),
    /*
     * Zusätzlich verschlüsselt, damit das Backoffice den Link später noch
     * einmal zeigen kann. Geprüft wird weiterhin gegen den Hash — der
     * verschlüsselte Wert ist reine Anzeige.
     */
    token_enc: verschluesselt,
    expires_at: ablauf.toISOString(),
  });

  if (error) return { error: `Anlegen fehlgeschlagen: ${error.message}`, ok: null };

  /*
   * Und dem Kunden Bescheid geben. Ein Zugang, von dem nur das Backoffice
   * weiss, ist keiner — bisher musste jemand den Link von Hand in eine
   * Mail kopieren, und genau das passierte oft nicht.
   */
  const gemailt = await zugangMailen(
    zugang.me.companyId,
    kunde.id as string,
    (kunde.email as string | null) ?? null,
    kunde.name as string,
    token,
  );

  revalidatePath("/vorgaenge");
  return {
    error: null,
    /*
     * Der Link steht in der Erfolgsmeldung, weil es die einzige Gelegenheit
     * ist. Beim nächsten Laden der Seite ist er weg.
     */
    ok: gemailt
      ? `An ${gemailt} geschickt. Link: ${BRAND.domain}/portal/${token}`
      : `${BRAND.domain}/portal/${token}`,
  };
}

/**
 * Die Willkommensmail zum Portalzugang.
 *
 * Scheitert bewusst leise: der Zugang steht bereits, und ihn wieder
 * wegzunehmen, weil beim Kunden keine Mailadresse hinterlegt ist, wäre
 * der schlechtere Tausch. Der Link steht dann in der Meldung, und
 * jemand schickt ihn von Hand.
 */
async function zugangMailen(
  companyId: string,
  kundeId: string,
  email: string | null,
  name: string,
  token: string,
): Promise<string | null> {
  if (!email) return null;

  /*
   * Ein Portalzugang gehört dem Kunden und nicht einem einzelnen
   * Vorgang. Für die Zuordnung im Postausgang nehmen wir trotzdem einen
   * — sonst hinge die Mail nirgends und niemand fände sie wieder.
   */
  const admin = mailClient();
  const { data: v } = await admin
    .from("vorgang")
    .select("id")
    .eq("customer_id", kundeId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!v) return null;

  const r = await einreihen(admin, {
    companyId,
    vorgangId: v.id as string,
    art: "portal",
    an: { name, email },
    betreff: "Ihr Zugang zum Kundenportal",
    absaetze: [
      "wir haben Ihnen einen persönlichen Bereich eingerichtet. Dort sehen Sie jederzeit, wie weit Ihr Projekt ist, finden Ihr Angebot und alle Unterlagen, und können uns direkt schreiben.",
      "Ein Passwort brauchen Sie nicht — der Link unten genügt. Bitte geben Sie ihn nicht weiter, er ist persönlich.",
      "Der Zugang ist 90 Tage gültig. Läuft er ab, melden Sie sich einfach bei uns.",
    ],
    knopf: { text: "Portal öffnen", url: `${BRAND.domain}/portal/${token}` },
  });

  return r.ok ? email : null;
}

export async function revokePortalAccess(
  _prev: AktionsStatus,
  formData: FormData,
): Promise<AktionsStatus> {
  const zugang = await darfSchreiben();
  if (!zugang.ok) return zugang.status;

  const id = z.string().uuid().safeParse(formData.get("customerId"));
  if (!id.success) return { error: "Kunde fehlt.", ok: null };

  const supabase = await createClient();
  const { error } = await supabase
    .from("portal_access")
    .update({ revoked_at: new Date().toISOString() })
    .eq("customer_id", id.data)
    .is("revoked_at", null);

  if (error) return { error: `Widerrufen fehlgeschlagen: ${error.message}`, ok: null };

  revalidatePath("/vorgaenge");
  return { error: null, ok: "Zugang widerrufen. Der Link öffnet nichts mehr." };
}
