"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
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
