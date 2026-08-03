"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { mitarbeiterAnlegen, rolleSetzen } from "@/lib/onboarding/user";
import { requireMe } from "@/lib/session";

export type PersonalState = { error: string | null; ok: string | null };

const qualiSchema = z.object({
  userId: z.string().uuid(),
  name: z.string().trim().min(2, "Bezeichnung fehlt.").max(80),
  issuedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
});

export async function addQualification(
  _prev: PersonalState,
  formData: FormData,
): Promise<PersonalState> {
  const me = await requireMe();
  if (me.perms.mitarbeiter !== "write") {
    return { error: "Keine Berechtigung für Personaldaten.", ok: null };
  }

  const parsed = qualiSchema.safeParse({
    userId: formData.get("userId"),
    name: formData.get("name"),
    issuedOn: (formData.get("issuedOn") as string) || null,
    validUntil: (formData.get("validUntil") as string) || null,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Eingabe fehlt.", ok: null };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("qualification").insert({
    company_id: me.companyId,
    user_id: parsed.data.userId,
    name: parsed.data.name,
    issued_on: parsed.data.issuedOn,
    valid_until: parsed.data.validUntil,
  });

  if (error) return { error: `Speichern fehlgeschlagen: ${error.message}`, ok: null };

  revalidatePath(`/mitarbeiter/${parsed.data.userId}`);
  revalidatePath("/mitarbeiter");
  return { error: null, ok: `„${parsed.data.name}" eingetragen.` };
}

const MAX_BYTES = 25 * 1024 * 1024;
const ERLAUBT = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/webp",
  "text/csv",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

const dokSchema = z.object({
  userId: z.string().uuid(),
  kind: z.enum(["contract", "payslip", "certificate", "other"]),
  signature: z.enum(["none", "pending"]),
});

/*
 * Personaldokument hochladen.
 *
 * Prüfungen nach CLAUDE.md Abschnitt 11: Whitelist der Dateitypen, maximal
 * 25 MB, Content-Type serverseitig geprüft — der Browser darf ihn behaupten,
 * geglaubt wird er nicht ungeprüft.
 *
 * Pfadschema {company_id}/{entity}/{entity_id}/{uuid}-{filename}. Der
 * Bucket ist privat; ausgeliefert wird später über Signed URLs.
 */
export async function uploadDocument(
  _prev: PersonalState,
  formData: FormData,
): Promise<PersonalState> {
  const me = await requireMe();
  if (me.perms.mitarbeiter !== "write") {
    return { error: "Keine Berechtigung für Personaldaten.", ok: null };
  }

  const parsed = dokSchema.safeParse({
    userId: formData.get("userId"),
    kind: formData.get("kind"),
    signature: formData.get("signature"),
  });
  if (!parsed.success) return { error: "Eingabe unvollständig.", ok: null };

  const datei = formData.get("datei");
  if (!(datei instanceof File) || datei.size === 0) {
    return { error: "Keine Datei gewählt.", ok: null };
  }
  if (datei.size > MAX_BYTES) {
    return {
      error: `Die Datei ist ${(datei.size / 1024 / 1024).toFixed(1)} MB groß, erlaubt sind 25 MB.`,
      ok: null,
    };
  }
  if (!ERLAUBT.has(datei.type)) {
    return {
      error: `Dateityp ${datei.type || "unbekannt"} ist nicht erlaubt.`,
      ok: null,
    };
  }

  const supabase = await createClient();
  const sauber = datei.name.replace(/[^\w.\-]+/g, "_").slice(-80);
  const pfad = `${me.companyId}/mitarbeiter/${parsed.data.userId}/${crypto.randomUUID()}-${sauber}`;

  const { error: uploadErr } = await supabase.storage
    .from("documents")
    .upload(pfad, datei, { contentType: datei.type, upsert: false });

  if (uploadErr) {
    return { error: `Upload fehlgeschlagen: ${uploadErr.message}`, ok: null };
  }

  const { error } = await supabase.from("job_document").insert({
    company_id: me.companyId,
    user_id: parsed.data.userId,
    kind: parsed.data.kind,
    bucket: "documents",
    path: pfad,
    filename: datei.name,
    size_bytes: datei.size,
    visible_to_customer: false,
    signature_status: parsed.data.signature,
  });

  if (error) {
    // Datei wieder wegräumen, sonst liegt sie ohne Eintrag im Bucket.
    await supabase.storage.from("documents").remove([pfad]);
    return { error: `Eintrag fehlgeschlagen: ${error.message}`, ok: null };
  }

  revalidatePath(`/mitarbeiter/${parsed.data.userId}`);
  return { error: null, ok: `${datei.name} abgelegt.` };
}

const signSchema = z.object({ documentId: z.string().uuid() });

/**
 * Unterschrift bestätigen.
 *
 * Bewusst nur der Status, keine Signaturdatei — die kommt mit dem
 * E-Signatur-Anbieter. signed_at wird gesetzt, weil eine Signatur ohne
 * Zeitpunkt als Nachweis wertlos ist; die Datenbank erzwingt das seit 0010.
 */
export async function markSigned(
  _prev: PersonalState,
  formData: FormData,
): Promise<PersonalState> {
  const me = await requireMe();

  const parsed = signSchema.safeParse({ documentId: formData.get("documentId") });
  if (!parsed.success) return { error: "Dokument fehlt.", ok: null };

  const supabase = await createClient();
  const { data: dok } = await supabase
    .from("job_document")
    .select("id, user_id, filename, signature_status")
    .eq("id", parsed.data.documentId)
    .maybeSingle();

  if (!dok) return { error: "Dokument nicht gefunden.", ok: null };

  // Unterschreiben darf die betroffene Person selbst oder die Personalstelle.
  if (dok.user_id !== me.id && me.perms.mitarbeiter !== "write") {
    return { error: "Keine Berechtigung.", ok: null };
  }
  if (dok.signature_status !== "pending") {
    return { error: "Für dieses Dokument steht keine Unterschrift aus.", ok: null };
  }

  const { error } = await supabase
    .from("job_document")
    .update({ signature_status: "signed", signed_at: new Date().toISOString() })
    .eq("id", dok.id);

  if (error) return { error: `Speichern fehlgeschlagen: ${error.message}`, ok: null };

  revalidatePath(`/mitarbeiter/${dok.user_id as string}`);
  revalidatePath("/meine-dokumente");
  return { error: null, ok: `${dok.filename as string} als unterschrieben erfasst.` };
}

/* ------------------------------------------------------- MITARBEITER */

const ROLLEN = ["gf", "buero", "bauleitung", "monteur", "lager"] as const;

const neuSchema = z.object({
  name: z.string().trim().min(2, "Name fehlt.").max(80),
  email: z.string().trim().email("Keine gültige Mailadresse."),
  role: z.enum(ROLLEN),
  locationId: z.string().uuid().or(z.literal("")),
  phone: z.string().trim().max(40).optional().default(""),
  weeklyHours: z.coerce.number().min(1).max(60),
  employmentType: z.enum(["vollzeit", "teilzeit", "geringfuegig", "lehrling"]),
  hourlyCost: z.coerce.number().min(0).max(500).optional().default(0),
  vacationDaysYear: z.coerce.number().min(0).max(60),
});

/**
 * Mitarbeiter anlegen und einladen.
 *
 * Nur die Geschäftsführung darf das. Ein Schreibrecht auf "mitarbeiter"
 * reicht nicht: wer anlegen darf, vergibt damit auch Rollen und könnte
 * sich über einen zweiten Zugang selbst Rechte verschaffen, die die
 * Rollenmatrix ihm verweigert.
 */
export async function mitarbeiterEinladen(
  _prev: PersonalState,
  formData: FormData,
): Promise<PersonalState> {
  const me = await requireMe();
  if (me.role !== "gf") {
    return {
      error: "Mitarbeiter anlegen darf nur die Geschäftsführung.",
      ok: null,
    };
  }
  if (me.company.status !== "active") {
    return { error: "Der Zugang ist derzeit nur lesend.", ok: null };
  }

  const parsed = neuSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Eingabe fehlt.", ok: null };
  }
  const d = parsed.data;

  const ergebnis = await mitarbeiterAnlegen({
    companyId: me.companyId,
    name: d.name,
    email: d.email,
    role: d.role,
    locationId: d.locationId || null,
    phone: d.phone || null,
    weeklyHours: d.weeklyHours,
    employmentType: d.employmentType,
    hourlyCost: d.hourlyCost > 0 ? d.hourlyCost : null,
    vacationDaysYear: d.vacationDaysYear,
  });

  if (!ergebnis.ok) return { error: ergebnis.grund, ok: null };

  revalidatePath("/mitarbeiter");
  revalidatePath("/einstellungen");

  return {
    error: null,
    ok: ergebnis.einladung
      ? `${d.name} angelegt — die Einladung ist unterwegs an ${d.email}.`
      : `${d.name} angelegt. Die Einladungsmail ging nicht raus, ${d.name} kann sich über „Passwort vergessen“ hineinlassen.`,
  };
}

const stammSchema = z.object({
  userId: z.string().uuid(),
  name: z.string().trim().min(2, "Name fehlt.").max(80),
  role: z.enum(ROLLEN),
  locationId: z.string().uuid().or(z.literal("")),
  phone: z.string().trim().max(40).optional().default(""),
  weeklyHours: z.coerce.number().min(1).max(60),
  employmentType: z.enum(["vollzeit", "teilzeit", "geringfuegig", "lehrling"]),
  hourlyCost: z.coerce.number().min(0).max(500).optional().default(0),
  vacationDaysYear: z.coerce.number().min(0).max(60),
  vacationCarry: z.coerce.number().min(-40).max(120),
});

/**
 * Stammdaten ändern.
 *
 * Die Rolle steht bewusst mit drin, wird aber nur von der
 * Geschäftsführung übernommen — und dann auch in app_metadata, sonst
 * ändert sich die Anzeige und nicht der Zugriff.
 */
export async function mitarbeiterSpeichern(
  _prev: PersonalState,
  formData: FormData,
): Promise<PersonalState> {
  const me = await requireMe();
  if (me.perms.mitarbeiter !== "write") {
    return { error: "Keine Berechtigung für Mitarbeiter.", ok: null };
  }

  const parsed = stammSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Eingabe fehlt.", ok: null };
  }
  const d = parsed.data;

  const supabase = await createClient();
  const { data: vorher } = await supabase
    .from("app_user")
    .select("role")
    .eq("id", d.userId)
    .maybeSingle();

  if (!vorher) return { error: "Mitarbeiter nicht gefunden.", ok: null };

  const rolleAendern = d.role !== vorher.role;
  if (rolleAendern && me.role !== "gf") {
    return {
      error: "Die Rolle darf nur die Geschäftsführung ändern.",
      ok: null,
    };
  }

  const { error } = await supabase
    .from("app_user")
    .update({
      name: d.name,
      role: d.role,
      location_id: d.locationId || null,
      phone: d.phone || null,
      weekly_hours: d.weeklyHours,
      employment_type: d.employmentType,
      hourly_cost: d.hourlyCost > 0 ? d.hourlyCost : null,
      vacation_days_year: d.vacationDaysYear,
      vacation_carry: d.vacationCarry,
    })
    .eq("id", d.userId);

  if (error) return { error: `Speichern fehlgeschlagen: ${error.message}`, ok: null };

  /*
   * Die Rolle steht doppelt: in app_user für die Anzeige und in
   * app_metadata für RLS. Ohne den zweiten Schritt sieht der Betrieb die
   * neue Rolle und die Datenbank die alte.
   */
  if (rolleAendern) {
    const gesetzt = await rolleSetzen(d.userId, me.companyId, d.role);
    if (!gesetzt.ok) return { error: gesetzt.grund, ok: null };
  }

  revalidatePath(`/mitarbeiter/${d.userId}`);
  revalidatePath("/mitarbeiter");
  return {
    error: null,
    ok: rolleAendern
      ? "Gespeichert. Die neue Rolle greift beim nächsten Anmelden."
      : "Gespeichert.",
  };
}

const aktivSchema = z.object({
  userId: z.string().uuid(),
  aktiv: z.enum(["ja", "nein"]),
});

/**
 * Austritt und Wiedereintritt.
 *
 * Gelöscht wird nichts: Zeiten, Dokumente und Belege bleiben. Ein
 * ausgetretener Mitarbeiter wird nur inaktiv gesetzt und verschwindet
 * aus Dispo, Zuweisungen und Auswertungen.
 */
export async function mitarbeiterAktivSetzen(
  _prev: PersonalState,
  formData: FormData,
): Promise<PersonalState> {
  const me = await requireMe();
  if (me.role !== "gf") {
    return { error: "Das darf nur die Geschäftsführung.", ok: null };
  }

  const parsed = aktivSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Eingabe fehlt.", ok: null };

  if (parsed.data.userId === me.id && parsed.data.aktiv === "nein") {
    return { error: "Der eigene Zugang lässt sich nicht abschalten.", ok: null };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("app_user")
    .update({ active: parsed.data.aktiv === "ja" })
    .eq("id", parsed.data.userId);

  if (error) return { error: `Fehlgeschlagen: ${error.message}`, ok: null };

  revalidatePath(`/mitarbeiter/${parsed.data.userId}`);
  revalidatePath("/mitarbeiter");
  return {
    error: null,
    ok: parsed.data.aktiv === "ja" ? "Wieder aktiv." : "Als ausgetreten vermerkt.",
  };
}
