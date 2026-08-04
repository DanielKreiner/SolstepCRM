"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { anhangSpeichern } from "@/lib/vorgang/chat";
import { requireMe } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import {
  einreihen,
  kundeZumVorgang,
  mailClient,
  portalLink,
} from "@/lib/vorgang/mail";

export type ChatStatus = { error: string | null; ok: string | null };

/**
 * Gespräch und Rückfragen aus Sicht des Betriebs.
 *
 * Eine interne Nachricht bleibt im Betrieb, eine normale erreicht den
 * Kunden im Portal. Der Umschalter steht direkt am Feld — wer sich
 * vertut, schreibt sonst eine interne Einschätzung an den Kunden.
 */

async function zugang() {
  const me = await requireMe();
  if (me.perms.pipelines !== "write") {
    return { ok: false as const, status: { error: "Keine Berechtigung.", ok: null } };
  }
  if (me.company.status !== "active") {
    return { ok: false as const, status: { error: "Der Zugang ist derzeit nur lesend.", ok: null } };
  }
  return { ok: true as const, me };
}

const nachrichtSchema = z.object({
  vorgangId: z.string().uuid(),
  body: z.string().trim().min(1, "Die Nachricht ist leer.").max(4000),
  intern: z.enum(["ja", "nein"]).optional().default("nein"),
});

export async function nachrichtSenden(
  _prev: ChatStatus,
  formData: FormData,
): Promise<ChatStatus> {
  const z1 = await zugang();
  if (!z1.ok) return z1.status;

  const parsed = nachrichtSchema.safeParse({
    vorgangId: formData.get("vorgangId"),
    body: formData.get("body"),
    intern: formData.get("intern") ?? "nein",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Eingabe fehlt.", ok: null };
  }
  const d = parsed.data;
  const intern = d.intern === "ja";

  const supabase = await createClient();
  const { data: n, error } = await supabase
    .from("vorgang_nachricht")
    .insert({
      company_id: z1.me.companyId,
      vorgang_id: d.vorgangId,
      autor: "betrieb",
      autor_user_id: z1.me.id,
      autor_name: z1.me.name,
      body: d.body,
      intern,
    })
    .select("id")
    .single();

  if (error || !n) {
    return { error: `Senden fehlgeschlagen: ${error?.message}`, ok: null };
  }

  const dateien = formData.getAll("anhang").filter((f): f is File => f instanceof File && f.size > 0);
  for (const datei of dateien) {
    const r = await anhangSpeichern(supabase, {
      companyId: z1.me.companyId,
      vorgangId: d.vorgangId,
      datei,
      von: "betrieb",
      nachrichtId: n.id as string,
    });
    if (!r.ok) return { error: r.grund, ok: null };
  }

  /*
   * Eine Nachricht an den Kunden geht auch als Mail raus. Eine interne
   * Notiz niemals — das ist der ganze Sinn des Umschalters, und ein
   * Fehler hier wäre der teuerste im ganzen Modul.
   */
  let anAdresse: string | null = null;
  if (!intern) {
    anAdresse = await nachrichtMailen(z1.me.companyId, d.vorgangId, d.body);
  }

  revalidatePath(`/vorgaenge/${d.vorgangId}`);
  return {
    error: null,
    ok: intern
      ? "Interne Notiz gespeichert."
      : anAdresse
        ? `Gesendet — im Portal sichtbar und per Mail an ${anAdresse}.`
        : "Gesendet — der Kunde sieht sie im Portal. Per Mail ging nichts raus (keine Adresse oder kein Portalzugang).",
  };
}

/** Siehe rueckfrageMailen: scheitert bewusst leise, die Nachricht steht. */
async function nachrichtMailen(
  companyId: string,
  vorgangId: string,
  body: string,
): Promise<string | null> {
  const admin = mailClient();
  const kunde = await kundeZumVorgang(admin, vorgangId);
  if (!kunde.ok || !kunde.empfaenger) return null;

  const link = await portalLink(admin, kunde.kundeId, {
    vorgangId,
    bereich: "anliegen",
  });
  if (!link) return null;

  const eingereiht = await einreihen(admin, {
    companyId,
    vorgangId,
    art: "nachricht",
    an: kunde.empfaenger,
    betreff: `Neue Nachricht zu ${kunde.nummer}`,
    absaetze: [
      body,
      "Antworten können Sie direkt im Portal — dann bleibt alles an einer Stelle.",
    ],
    knopf: { text: "Im Portal öffnen", url: link },
  });

  return eingereiht.ok ? kunde.empfaenger.email : null;
}

const anfrageSchema = z.object({
  vorgangId: z.string().uuid(),
  titel: z.string().trim().min(3, "Bitte kurz sagen, worum es geht.").max(120),
  beschreibung: z.string().trim().max(1000).optional().default(""),
  fotoNoetig: z.enum(["ja", "nein"]).optional().default("nein"),
});

/**
 * Eine Rückfrage an den Kunden stellen.
 *
 * „Schicken Sie ein Bild vom Zählerkasten" ist die häufigste Frage vor
 * jeder Montage. Per Mail gestellt bedeutet sie, die Antwort später in
 * einem Postfach zu suchen — hier hängt sie am Vorgang.
 */
export async function anfrageStellen(
  _prev: ChatStatus,
  formData: FormData,
): Promise<ChatStatus> {
  const z1 = await zugang();
  if (!z1.ok) return z1.status;

  const parsed = anfrageSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Eingabe fehlt.", ok: null };
  }
  const d = parsed.data;

  const supabase = await createClient();
  const { data: a, error } = await supabase
    .from("vorgang_anfrage")
    .insert({
      company_id: z1.me.companyId,
      vorgang_id: d.vorgangId,
      titel: d.titel,
      beschreibung: d.beschreibung || null,
      foto_noetig: d.fotoNoetig === "ja",
      gestellt_von: z1.me.id,
    })
    .select("id")
    .single();

  if (error || !a) {
    return { error: `Anlegen fehlgeschlagen: ${error?.message}`, ok: null };
  }

  /* Im Verlauf sichtbar, damit der Kunde sie auch dort wiederfindet. */
  await supabase.from("vorgang_event").insert({
    company_id: z1.me.companyId,
    vorgang_id: d.vorgangId,
    typ: "notiz",
    titel: `Rückfrage: ${d.titel}`,
    body: d.beschreibung || null,
    kunde_sichtbar: true,
    created_by: z1.me.id,
  });

  /*
   * Und raus damit. Eine Rückfrage, die nur im Portal steht, wartet
   * darauf, dass der Kunde von selbst nachsieht — genau das tut er nicht.
   * Sie ist der Grund, warum die Montage stillsteht, also muss sie ihn
   * dort erreichen, wo er ohnehin hinschaut.
   */
  const versand = await rueckfrageMailen(z1.me.companyId, d.vorgangId, d.titel, d.beschreibung);

  revalidatePath(`/vorgaenge/${d.vorgangId}`);
  return {
    error: null,
    ok: versand
      ? `Rückfrage gestellt und an ${versand} geschickt.`
      : "Rückfrage gestellt — sie steht im Portal. Per Mail ging nichts raus (keine Adresse oder kein Portalzugang).",
  };
}

/**
 * Die Rückfrage per Mail hinterherschicken.
 *
 * Scheitert bewusst leise: die Frage ist bereits angelegt und steht im
 * Portal. Ein Abbruch würde sie wieder wegnehmen, nur weil beim Kunden
 * keine Adresse hinterlegt ist — schlechter Tausch.
 */
async function rueckfrageMailen(
  companyId: string,
  vorgangId: string,
  titel: string,
  beschreibung: string,
): Promise<string | null> {
  const admin = mailClient();
  const kunde = await kundeZumVorgang(admin, vorgangId);
  if (!kunde.ok || !kunde.empfaenger) return null;

  const link = await portalLink(admin, kunde.kundeId, {
    vorgangId,
    bereich: "anliegen",
  });
  if (!link) return null;

  const eingereiht = await einreihen(admin, {
    companyId,
    vorgangId,
    art: "rueckfrage",
    an: kunde.empfaenger,
    betreff: `Kurze Rückfrage zu ${kunde.nummer}: ${titel}`,
    absaetze: [
      "für den nächsten Schritt brauchen wir noch etwas von Ihnen:",
      titel,
      ...(beschreibung ? [beschreibung] : []),
      "Sie können direkt im Portal antworten — dort hängt Ihre Antwort gleich am richtigen Vorgang.",
    ],
    knopf: { text: "Im Portal antworten", url: link },
  });

  return eingereiht.ok ? kunde.empfaenger.email : null;
}

const erledigtSchema = z.object({
  vorgangId: z.string().uuid(),
  anfrageId: z.string().uuid(),
});

export async function anfrageErledigt(
  _prev: ChatStatus,
  formData: FormData,
): Promise<ChatStatus> {
  const z1 = await zugang();
  if (!z1.ok) return z1.status;

  const parsed = erledigtSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Eingabe fehlt.", ok: null };

  const supabase = await createClient();
  const { error } = await supabase
    .from("vorgang_anfrage")
    .update({ status: "erledigt" })
    .eq("id", parsed.data.anfrageId)
    .eq("vorgang_id", parsed.data.vorgangId);

  if (error) return { error: `Fehlgeschlagen: ${error.message}`, ok: null };

  revalidatePath(`/vorgaenge/${parsed.data.vorgangId}`);
  return { error: null, ok: "Als erledigt vermerkt." };
}
