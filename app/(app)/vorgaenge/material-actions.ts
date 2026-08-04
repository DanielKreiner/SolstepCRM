"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { AktionsStatus } from "@/components/ui/Formular";
import { bedarfVorbefuellen } from "@/lib/material/bedarf";
import { materialGateSchreiben } from "@/lib/material/daten";
import { requireMe } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

/*
 * Die Bedarfsliste im Vorgang.
 *
 * Sie ist die Ausführungsebene und darf sich frei vom Angebot bewegen —
 * Kabelweg vierzig Meter länger als gedacht, ein Optimierer weniger.
 * Was hier passiert, ändert den Angebotspreis nie. Wer mehr verrechnen
 * will, schreibt einen Nachtrag; das ist ein Gespräch mit dem Kunden,
 * keine Datenbankoperation.
 */

async function zugang() {
  const me = await requireMe();
  if (me.perms.pipelines !== "write" && me.perms.lager !== "write") {
    return {
      ok: false as const,
      status: { error: "Für die Bedarfsliste fehlt deiner Rolle das Schreibrecht.", ok: null },
    };
  }
  return { ok: true as const, me };
}

function frisch(vorgangId: string) {
  revalidatePath(`/vorgaenge/${vorgangId}`);
}

/**
 * Eine Zeile hinzufügen — mit Stammartikel oder als Freitext.
 */
export async function bedarfHinzufuegen(
  _prev: AktionsStatus,
  formData: FormData,
): Promise<AktionsStatus> {
  const z1 = await zugang();
  if (!z1.ok) return z1.status;

  const parsed = z
    .object({
      vorgangId: z.string().uuid(),
      artikelId: z.string().uuid().optional().or(z.literal("")),
      bezeichnung: z.string().trim().max(200).optional().default(""),
      menge: z.coerce.number().gt(0, "Menge muss größer als null sein."),
      einheit: z.string().trim().max(20).optional().default("Stk"),
      notiz: z.string().trim().max(500).optional().default(""),
    })
    .safeParse(Object.fromEntries(formData));

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Eingabe fehlt.", ok: null };
  }
  const d = parsed.data;
  const supabase = await createClient();

  let bezeichnung = d.bezeichnung;
  let einheit = d.einheit || "Stk";

  if (d.artikelId) {
    const { data: a } = await supabase
      .from("article")
      .select("name, unit")
      .eq("id", d.artikelId)
      .maybeSingle();
    if (!a) return { error: "Artikel nicht gefunden.", ok: null };
    bezeichnung = a.name as string;
    einheit = (a.unit as string) ?? "Stk";
  }

  if (bezeichnung.trim().length < 2) {
    return { error: "Ohne Bezeichnung weiss im Lager niemand, was gemeint ist.", ok: null };
  }

  const { data: letzte } = await supabase
    .from("vorgang_bedarf")
    .select("sort")
    .eq("vorgang_id", d.vorgangId)
    .order("sort", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await supabase.from("vorgang_bedarf").insert({
    company_id: z1.me.companyId,
    vorgang_id: d.vorgangId,
    artikel_id: d.artikelId || null,
    bezeichnung,
    menge: d.menge,
    einheit,
    notiz: d.notiz || null,
    sort: Number(letzte?.sort ?? 0) + 10,
    herkunft: "manuell",
  });

  if (error) return { error: `Fehlgeschlagen: ${error.message}`, ok: null };

  await ereignis(supabase, z1.me.companyId, d.vorgangId, z1.me.id, {
    titel: "Bedarf ergänzt",
    body: `${d.menge} ${einheit} ${bezeichnung}`,
  });
  await materialGateSchreiben(supabase, {
    companyId: z1.me.companyId,
    vorgangId: d.vorgangId,
  });

  frisch(d.vorgangId);
  return { error: null, ok: `${bezeichnung} aufgenommen.` };
}

export async function bedarfMenge(
  _prev: AktionsStatus,
  formData: FormData,
): Promise<AktionsStatus> {
  const z1 = await zugang();
  if (!z1.ok) return z1.status;

  const parsed = z
    .object({
      vorgangId: z.string().uuid(),
      id: z.string().uuid(),
      menge: z.coerce.number().gt(0, "Menge muss größer als null sein."),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Eingabe fehlt.", ok: null };
  }
  const d = parsed.data;

  const supabase = await createClient();
  const { data: alt } = await supabase
    .from("vorgang_bedarf")
    .select("bezeichnung, menge, einheit")
    .eq("id", d.id)
    .maybeSingle();

  const { error } = await supabase
    .from("vorgang_bedarf")
    .update({ menge: d.menge })
    .eq("id", d.id);

  if (error) return { error: `Fehlgeschlagen: ${error.message}`, ok: null };

  if (alt) {
    await ereignis(supabase, z1.me.companyId, d.vorgangId, z1.me.id, {
      titel: "Bedarf geändert",
      body: `${alt.bezeichnung as string}: ${alt.menge} → ${d.menge} ${alt.einheit as string}`,
    });
  }
  await materialGateSchreiben(supabase, {
    companyId: z1.me.companyId,
    vorgangId: d.vorgangId,
  });

  frisch(d.vorgangId);
  return { error: null, ok: "Menge geändert." };
}

export async function bedarfStreichen(
  _prev: AktionsStatus,
  formData: FormData,
): Promise<AktionsStatus> {
  const z1 = await zugang();
  if (!z1.ok) return z1.status;

  const parsed = z
    .object({ vorgangId: z.string().uuid(), id: z.string().uuid() })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Eingabe fehlt.", ok: null };
  const d = parsed.data;

  const supabase = await createClient();
  const { data: alt } = await supabase
    .from("vorgang_bedarf")
    .select("bezeichnung, menge, einheit")
    .eq("id", d.id)
    .maybeSingle();

  /*
   * Eine Zeile, die schon bestellt oder entnommen wurde, verschwindet
   * nicht einfach — sonst hinge eine Bestellposition an einem Bedarf,
   * den es nicht mehr gibt, und niemand fände heraus, wofür die Ware
   * gedacht war.
   */
  const { count } = await supabase
    .from("bestellposition")
    .select("id", { count: "exact", head: true })
    .eq("bedarf_id", d.id);

  if ((count ?? 0) > 0) {
    return {
      error: "Diese Position steckt schon in einer Bestellung. Storniere zuerst dort.",
      ok: null,
    };
  }

  const { error } = await supabase.from("vorgang_bedarf").delete().eq("id", d.id);
  if (error) return { error: `Fehlgeschlagen: ${error.message}`, ok: null };

  if (alt) {
    await ereignis(supabase, z1.me.companyId, d.vorgangId, z1.me.id, {
      titel: "Bedarf gestrichen",
      body: `${alt.menge} ${alt.einheit as string} ${alt.bezeichnung as string}`,
    });
  }
  await materialGateSchreiben(supabase, {
    companyId: z1.me.companyId,
    vorgangId: d.vorgangId,
  });

  frisch(d.vorgangId);
  return { error: null, ok: "Gestrichen." };
}

/**
 * Die Liste nachträglich aus dem Angebot befüllen.
 *
 * Für Vorgänge, die vor diesem Modul angenommen wurden — und für den
 * Fall, dass jemand versehentlich alles gelöscht hat.
 */
export async function bedarfAusAngebot(
  _prev: AktionsStatus,
  formData: FormData,
): Promise<AktionsStatus> {
  const z1 = await zugang();
  if (!z1.ok) return z1.status;

  const vorgangId = z.string().uuid().safeParse(formData.get("vorgangId"));
  if (!vorgangId.success) return { error: "Vorgang fehlt.", ok: null };

  const supabase = await createClient();
  const ergebnis = await bedarfVorbefuellen(supabase, {
    companyId: z1.me.companyId,
    vorgangId: vorgangId.data,
  });

  if (ergebnis.nichtBefuellt === "vorhanden") {
    return {
      error: "Es gibt schon eine Bedarfsliste. Sie wird nicht überschrieben.",
      ok: null,
    };
  }
  if (ergebnis.nichtBefuellt) {
    return { error: `Fehlgeschlagen: ${ergebnis.nichtBefuellt}`, ok: null };
  }
  if (ergebnis.zeilen === 0) {
    return { error: "Das Angebot enthält kein Material.", ok: null };
  }

  await ereignis(supabase, z1.me.companyId, vorgangId.data, z1.me.id, {
    titel: "Bedarfsliste aus dem Angebot erzeugt",
    body: `${ergebnis.zeilen} Zeilen, Pakete aufgelöst.`,
  });
  await materialGateSchreiben(supabase, {
    companyId: z1.me.companyId,
    vorgangId: vorgangId.data,
  });

  frisch(vorgangId.data);
  return { error: null, ok: `${ergebnis.zeilen} Zeilen übernommen.` };
}

/* Jede Änderung an der Bedarfsliste steht im Strom — sie kostet Geld. */
async function ereignis(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  companyId: string,
  vorgangId: string,
  userId: string | null,
  d: { titel: string; body: string },
): Promise<void> {
  await supabase.from("vorgang_event").insert({
    company_id: companyId,
    vorgang_id: vorgangId,
    typ: "notiz",
    titel: d.titel,
    body: d.body,
    kunde_sichtbar: false,
    created_by: userId,
  });
}
