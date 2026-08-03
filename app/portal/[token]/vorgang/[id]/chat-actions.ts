"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { resolvePortal } from "@/lib/portal/data";
import { createAdminClient } from "@/lib/supabase/admin";
import { anhangSpeichern } from "@/lib/vorgang/chat";

export type PortalChatState = { error: string | null; ok: string | null };

/**
 * Der Kunde schreibt und beantwortet Rückfragen.
 *
 * Das Portal hat keine Supabase-Sitzung — die Zugehörigkeit des Vorgangs
 * zum Kunden wird hier geprüft, bevor irgendetwas geschrieben wird
 * (CLAUDE.md 4.3).
 */
async function eigenerVorgang(token: string, vorgangId: string) {
  const session = await resolvePortal(token);
  if (!session) return null;

  const admin = createAdminClient();
  const { data } = await admin
    .from("vorgang")
    .select("id, number")
    .eq("id", vorgangId)
    .eq("customer_id", session.customerId)
    .eq("company_id", session.companyId)
    .maybeSingle();

  return data ? { session, admin, vorgang: data } : null;
}

const nachrichtSchema = z.object({
  token: z.string().min(10),
  vorgangId: z.string().uuid(),
  body: z.string().trim().max(4000).optional().default(""),
});

export async function kundeSchreibt(
  _prev: PortalChatState,
  formData: FormData,
): Promise<PortalChatState> {
  const parsed = nachrichtSchema.safeParse({
    token: formData.get("token"),
    vorgangId: formData.get("vorgangId"),
    body: formData.get("body"),
  });
  if (!parsed.success) return { error: "Eingabe fehlt.", ok: null };
  const d = parsed.data;

  const dateien = formData
    .getAll("anhang")
    .filter((f): f is File => f instanceof File && f.size > 0);

  /* Ein Bild allein ist eine vollständige Nachricht. */
  if (d.body.length === 0 && dateien.length === 0) {
    return { error: "Bitte etwas schreiben oder ein Bild anhängen.", ok: null };
  }

  const ctx = await eigenerVorgang(d.token, d.vorgangId);
  if (!ctx) return { error: "Der Zugang ist abgelaufen.", ok: null };

  const { data: n, error } = await ctx.admin
    .from("vorgang_nachricht")
    .insert({
      company_id: ctx.session.companyId,
      vorgang_id: d.vorgangId,
      autor: "kunde",
      autor_name: ctx.session.customerName,
      body: d.body || "(Bild)",
      intern: false,
    })
    .select("id")
    .single();

  if (error || !n) return { error: "Das hat nicht geklappt.", ok: null };

  for (const datei of dateien) {
    const r = await anhangSpeichern(ctx.admin, {
      companyId: ctx.session.companyId,
      vorgangId: d.vorgangId,
      datei,
      von: "kunde",
      nachrichtId: n.id as string,
    });
    if (!r.ok) return { error: r.grund, ok: null };
  }

  await ctx.admin.from("notification").insert({
    company_id: ctx.session.companyId,
    kind: "vorgang_nachricht",
    title: `Nachricht zu ${ctx.vorgang.number as string}`,
    body: d.body.slice(0, 160) || "Bild erhalten",
    link: `/vorgaenge/${d.vorgangId}`,
  });

  revalidatePath(`/portal/${d.token}`, "layout");
  return { error: null, ok: "Ihre Nachricht ist angekommen." };
}

const antwortSchema = z.object({
  token: z.string().min(10),
  vorgangId: z.string().uuid(),
  anfrageId: z.string().uuid(),
  antwort: z.string().trim().max(2000).optional().default(""),
});

/**
 * Der Kunde beantwortet eine Rückfrage.
 *
 * Verlangt die Frage ein Bild, wird eines gefordert — sonst kommt eine
 * Antwort wie „passt schon", und der Techniker steht am Montagetag vor
 * einem Zählerkasten, in den nichts hineinpasst.
 */
export async function anfrageBeantworten(
  _prev: PortalChatState,
  formData: FormData,
): Promise<PortalChatState> {
  const parsed = antwortSchema.safeParse({
    token: formData.get("token"),
    vorgangId: formData.get("vorgangId"),
    anfrageId: formData.get("anfrageId"),
    antwort: formData.get("antwort"),
  });
  if (!parsed.success) return { error: "Eingabe fehlt.", ok: null };
  const d = parsed.data;

  const ctx = await eigenerVorgang(d.token, d.vorgangId);
  if (!ctx) return { error: "Der Zugang ist abgelaufen.", ok: null };

  const { data: anfrage } = await ctx.admin
    .from("vorgang_anfrage")
    .select("id, titel, foto_noetig")
    .eq("id", d.anfrageId)
    .eq("vorgang_id", d.vorgangId)
    .maybeSingle();

  if (!anfrage) return { error: "Diese Frage gibt es nicht mehr.", ok: null };

  const dateien = formData
    .getAll("anhang")
    .filter((f): f is File => f instanceof File && f.size > 0);

  if (anfrage.foto_noetig && dateien.length === 0) {
    return { error: "Für diese Frage brauchen wir ein Foto.", ok: null };
  }
  if (!anfrage.foto_noetig && d.antwort.length === 0 && dateien.length === 0) {
    return { error: "Bitte etwas schreiben oder ein Bild anhängen.", ok: null };
  }

  for (const datei of dateien) {
    const r = await anhangSpeichern(ctx.admin, {
      companyId: ctx.session.companyId,
      vorgangId: d.vorgangId,
      datei,
      von: "kunde",
      anfrageId: d.anfrageId,
    });
    if (!r.ok) return { error: r.grund, ok: null };
  }

  await ctx.admin
    .from("vorgang_anfrage")
    .update({
      status: "beantwortet",
      antwort_text: d.antwort || null,
      beantwortet_am: new Date().toISOString(),
    })
    .eq("id", d.anfrageId);

  await ctx.admin.from("vorgang_event").insert({
    company_id: ctx.session.companyId,
    vorgang_id: d.vorgangId,
    typ: "notiz",
    titel: `Rückfrage beantwortet: ${anfrage.titel as string}`,
    body: d.antwort || `${dateien.length} Bild(er) erhalten.`,
    kunde_sichtbar: true,
  });

  await ctx.admin.from("notification").insert({
    company_id: ctx.session.companyId,
    kind: "anfrage_beantwortet",
    title: `Antwort zu ${ctx.vorgang.number as string}`,
    body: `${anfrage.titel as string}: ${d.antwort.slice(0, 120) || "Bild erhalten"}`,
    link: `/vorgaenge/${d.vorgangId}`,
  });

  revalidatePath(`/portal/${d.token}`, "layout");
  return { error: null, ok: "Danke — wir haben Ihre Antwort." };
}
