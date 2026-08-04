"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { AktionsStatus } from "@/components/ui/Formular";
import { darfStarten, darfStoppen, minuten } from "@/lib/zeiten/regeln";
import { requireMe } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

/*
 * Stempeln am Einsatz.
 *
 * Eine Zeit ohne Einsatz kann es nicht geben. Wer ohne Plan arbeitet,
 * bekommt einen Einsatz mit Art „intern" und einem Grund in einem Zug —
 * lieber ein Einsatz zu viel als eine Stunde, die niemandem gehört.
 */

function frisch() {
  revalidatePath("/m/heute");
  revalidatePath("/zeiten");
}

async function laufende(supabase: Awaited<ReturnType<typeof createClient>>, userId: string) {
  const { data } = await supabase
    .from("time_entry")
    .select("id, started_at, einsatz_id")
    .eq("user_id", userId)
    .eq("status", "running")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data as { id: string; started_at: string; einsatz_id: string | null } | null;
}

/** Zeit auf einem Einsatz starten. */
export async function zeitStarten(
  _prev: AktionsStatus,
  formData: FormData,
): Promise<AktionsStatus> {
  const me = await requireMe();
  const parsed = z
    .object({ einsatzId: z.string().uuid() })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Einsatz fehlt.", ok: null };

  const supabase = await createClient();
  const laeuft = await laufende(supabase, me.id);

  const pruefung = darfStarten(laeuft?.started_at ?? null);
  if (!pruefung.ok) return { error: pruefung.grund, ok: null };

  const { data: einsatz } = await supabase
    .from("einsatz")
    .select("id, art, vorgang_id, titel")
    .eq("id", parsed.data.einsatzId)
    .maybeSingle();

  if (!einsatz) return { error: "Einsatz nicht gefunden.", ok: null };

  const { error } = await supabase.from("time_entry").insert({
    company_id: me.companyId,
    user_id: me.id,
    einsatz_id: einsatz.id,
    vorgang_id: einsatz.vorgang_id,
    /*
     * Die Art wird nie von Hand gewählt: Auftrag, Service und interne
     * Arbeit sind alle Arbeitszeit. Die Fahrt bucht die Beladeliste
     * getrennt, wenn sie anfällt.
     */
    kind: "work",
    started_at: new Date().toISOString(),
    status: "running",
    quelle: "monteur_app",
    auto_break_min: 0,
    created_by: me.id,
  });

  if (error) return { error: `Start fehlgeschlagen: ${error.message}`, ok: null };

  frisch();
  return { error: null, ok: "Zeit läuft." };
}

/**
 * Zeit stoppen.
 *
 * Unter fünf Minuten kommt die Rückfrage zurück, statt eine
 * 0:00-Buchung anzulegen. Wer bewusst speichern will, schickt
 * `trotzdem=ja`; wer verwerfen will, `verwerfen=ja`.
 */
export async function zeitStoppen(
  _prev: AktionsStatus,
  formData: FormData,
): Promise<AktionsStatus> {
  const me = await requireMe();
  const supabase = await createClient();
  const laeuft = await laufende(supabase, me.id);

  const jetzt = new Date().toISOString();
  const pruefung = darfStoppen(laeuft?.started_at ?? null, jetzt);

  if (!pruefung.ok && !("rueckfrage" in pruefung)) {
    return { error: pruefung.grund, ok: null };
  }

  const trotzdem = formData.get("trotzdem") === "ja";
  const verwerfen = formData.get("verwerfen") === "ja";

  if (!pruefung.ok && "rueckfrage" in pruefung && !trotzdem && !verwerfen) {
    return { error: pruefung.grund, ok: null };
  }

  if (verwerfen) {
    const { error } = await supabase
      .from("time_entry")
      .delete()
      .eq("id", laeuft!.id)
      .eq("status", "running");
    if (error) return { error: `Verwerfen fehlgeschlagen: ${error.message}`, ok: null };
    frisch();
    return { error: null, ok: "Verworfen." };
  }

  const { error } = await supabase
    .from("time_entry")
    .update({
      ended_at: jetzt,
      status: "booked",
      /*
       * Ab sechs Stunden zieht die Pause automatisch ab — sie steht dem
       * Monteur zu, ob er sie stempelt oder nicht.
       */
      auto_break_min: minuten(laeuft!.started_at, jetzt) >= 360 ? 30 : 0,
    })
    .eq("id", laeuft!.id)
    .eq("status", "running");

  if (error) return { error: `Stoppen fehlgeschlagen: ${error.message}`, ok: null };

  frisch();
  return { error: null, ok: "Zeit gestoppt." };
}

/**
 * Arbeit ohne geplanten Einsatz.
 *
 * Es entsteht immer ein Einsatz — entweder ein bestehender wird gewählt
 * oder ein interner mit Grund angelegt. Danach läuft die Zeit an ihm.
 */
export async function ohneEinsatzStarten(
  _prev: AktionsStatus,
  formData: FormData,
): Promise<AktionsStatus> {
  const me = await requireMe();
  const parsed = z
    .object({
      einsatzId: z.string().uuid().optional().or(z.literal("")),
      grund: z.string().trim().max(120).optional().default(""),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Eingabe fehlt.", ok: null };

  const supabase = await createClient();
  const laeuft = await laufende(supabase, me.id);
  const pruefung = darfStarten(laeuft?.started_at ?? null);
  if (!pruefung.ok) return { error: pruefung.grund, ok: null };

  /* Ein bestehender Einsatz war gewählt — dann einfach starten. */
  if (parsed.data.einsatzId) {
    const daten = new FormData();
    daten.set("einsatzId", parsed.data.einsatzId);
    return zeitStarten({ error: null, ok: null }, daten);
  }

  if (parsed.data.grund.trim().length < 3) {
    return {
      error: "Sag kurz, woran du arbeitest — sonst weiss später niemand, wofür die Zeit war.",
      ok: null,
    };
  }

  const jetzt = new Date();
  const ende = new Date(jetzt.getTime() + 4 * 3600_000);

  const { data: einsatz, error: einsatzFehler } = await supabase
    .from("einsatz")
    .insert({
      company_id: me.companyId,
      art: "intern",
      titel: parsed.data.grund.trim(),
      von: jetzt.toISOString(),
      bis: ende.toISOString(),
      created_by: me.id,
    })
    .select("id")
    .single();

  if (einsatzFehler || !einsatz) {
    return { error: `Einsatz anlegen fehlgeschlagen: ${einsatzFehler?.message}`, ok: null };
  }

  await supabase.from("einsatz_person").insert({
    company_id: me.companyId,
    einsatz_id: einsatz.id,
    user_id: me.id,
  });

  const daten = new FormData();
  daten.set("einsatzId", einsatz.id as string);
  return zeitStarten({ error: null, ok: null }, daten);
}
