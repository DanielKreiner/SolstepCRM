"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireMe } from "@/lib/session";

export type SettingsState = { error: string | null; ok: string | null };

const AREAS = [
  "pipelines",
  "angebote",
  "crm",
  "lager",
  "rechnungen",
  "zeiterfassung",
  "mitarbeiter",
  "berichte",
  "einstellungen",
] as const;

const ROLES = ["gf", "buero", "bauleitung", "monteur", "lager"] as const;

const permSchema = z.object({
  role: z.enum(ROLES),
  area: z.enum(AREAS),
  level: z.enum(["none", "read", "write"]),
});

/**
 * Rollenrecht setzen.
 *
 * Eine Sperre: die Geschäftsführung darf sich das Recht auf
 * "einstellungen" nicht selbst entziehen. Sonst schließt sich der Betrieb
 * mit einem Klick aus seiner eigenen Rechteverwaltung aus, und es bliebe
 * nur der Weg über den Betreiber.
 */
export async function setPermission(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const me = await requireMe();
  if (me.perms.einstellungen !== "write") {
    return { error: "Keine Berechtigung für Einstellungen.", ok: null };
  }

  const parsed = permSchema.safeParse({
    role: formData.get("role"),
    area: formData.get("area"),
    level: formData.get("level"),
  });
  if (!parsed.success) return { error: "Ungültige Angabe.", ok: null };

  if (
    parsed.data.role === "gf" &&
    parsed.data.area === "einstellungen" &&
    parsed.data.level !== "write"
  ) {
    return {
      error:
        "Die Geschäftsführung muss Schreibrecht auf Einstellungen behalten — sonst sperrt sich der Betrieb selbst aus.",
      ok: null,
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("role_permission").upsert(
    {
      company_id: me.companyId,
      role: parsed.data.role,
      area: parsed.data.area,
      level: parsed.data.level,
    },
    { onConflict: "company_id,role,area" },
  );

  if (error) return { error: `Speichern fehlgeschlagen: ${error.message}`, ok: null };

  revalidatePath("/einstellungen");
  return { error: null, ok: "Gespeichert." };
}

const phaseSchema = z.object({
  pipelineId: z.string().uuid(),
  key: z
    .string()
    .trim()
    .min(2)
    .max(40)
    .regex(/^[a-z0-9_]+$/, "Nur Kleinbuchstaben, Ziffern und Unterstrich."),
  label: z.string().trim().min(2).max(60),
  sort: z.coerce.number().int().min(1).max(99),
});

/*
 * Phase anlegen.
 *
 * system_key wird bewusst NICHT gesetzt. Die fünf Semantiken
 * (won, lost, in_execution, ready_to_invoice, closed) sind das, woran die
 * Automatik hängt — eine frei angelegte Zwischenstufe darf keine davon
 * bekommen, sonst löst sie unbeabsichtigt Rechnungen oder Aufträge aus.
 */
export async function addPhase(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const me = await requireMe();
  if (me.perms.einstellungen !== "write") {
    return { error: "Keine Berechtigung für Einstellungen.", ok: null };
  }

  const parsed = phaseSchema.safeParse({
    pipelineId: formData.get("pipelineId"),
    key: formData.get("key"),
    label: formData.get("label"),
    sort: formData.get("sort"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Eingabe fehlt.", ok: null };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("pipeline_phase").insert({
    company_id: me.companyId,
    pipeline_id: parsed.data.pipelineId,
    key: parsed.data.key,
    label: parsed.data.label,
    sort: parsed.data.sort,
    system_key: null,
    is_final: false,
  });

  if (error) {
    if (error.code === "23505") {
      return { error: "Diesen Schlüssel gibt es in der Pipeline schon.", ok: null };
    }
    return { error: `Anlegen fehlgeschlagen: ${error.message}`, ok: null };
  }

  revalidatePath("/einstellungen");
  revalidatePath("/pipelines/vertrieb");
  revalidatePath("/pipelines/projekte");
  revalidatePath("/pipelines/service");
  return { error: null, ok: `Phase „${parsed.data.label}" angelegt.` };
}

const renameSchema = z.object({
  phaseId: z.string().uuid(),
  label: z.string().trim().min(2).max(60),
});

/** Umbenennen ändert nur das Label — system_key bleibt unangetastet. */
export async function renamePhase(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const me = await requireMe();
  if (me.perms.einstellungen !== "write") {
    return { error: "Keine Berechtigung für Einstellungen.", ok: null };
  }

  const parsed = renameSchema.safeParse({
    phaseId: formData.get("phaseId"),
    label: formData.get("label"),
  });
  if (!parsed.success) return { error: "Bezeichnung fehlt.", ok: null };

  const supabase = await createClient();
  const { error } = await supabase
    .from("pipeline_phase")
    .update({ label: parsed.data.label })
    .eq("id", parsed.data.phaseId);

  if (error) return { error: `Speichern fehlgeschlagen: ${error.message}`, ok: null };

  revalidatePath("/einstellungen");
  revalidatePath("/pipelines/projekte");
  return { error: null, ok: "Umbenannt." };
}

const deleteSchema = z.object({ phaseId: z.string().uuid() });

/**
 * Phase löschen.
 *
 * Zwei Sperren: eine Phase mit system_key trägt eine Automatik, und eine
 * belegte Phase würde Aufträge ins Nichts schieben. Die Fremdschlüssel
 * stehen auf restrict, aber die Meldung soll erklären statt zu scheitern.
 */
export async function deletePhase(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const me = await requireMe();
  if (me.perms.einstellungen !== "write") {
    return { error: "Keine Berechtigung für Einstellungen.", ok: null };
  }

  const parsed = deleteSchema.safeParse({ phaseId: formData.get("phaseId") });
  if (!parsed.success) return { error: "Phase fehlt.", ok: null };

  const supabase = await createClient();
  const { data: phase } = await supabase
    .from("pipeline_phase")
    .select("id, label, system_key")
    .eq("id", parsed.data.phaseId)
    .maybeSingle();

  if (!phase) return { error: "Phase nicht gefunden.", ok: null };

  if (phase.system_key) {
    return {
      error: `„${phase.label as string}" trägt die Systembedeutung „${phase.system_key as string}" und wird von Automatiken gebraucht.`,
      ok: null,
    };
  }

  const belegt = await zaehleBelegung(supabase, parsed.data.phaseId);
  if (belegt > 0) {
    return {
      error: `In dieser Phase stehen noch ${belegt} Einträge. Erst verschieben, dann löschen.`,
      ok: null,
    };
  }

  const { error } = await supabase
    .from("pipeline_phase")
    .delete()
    .eq("id", parsed.data.phaseId);

  if (error) return { error: `Löschen fehlgeschlagen: ${error.message}`, ok: null };

  revalidatePath("/einstellungen");
  return { error: null, ok: `Phase „${phase.label as string}" gelöscht.` };
}

const standortSchema = z.object({
  locationId: z.string().uuid(),
  holidayRegion: z.string().trim().min(2).max(10),
  minStaffing: z.coerce.number().int().min(0).max(99),
  restHours: z.coerce.number().min(0).max(24),
  maxDaily: z.coerce.number().min(1).max(24),
  maxWeekly: z.coerce.number().min(1).max(100),
  breakAfterMin: z.coerce.number().int().min(0).max(1440),
  breakMin: z.coerce.number().int().min(0).max(240),
});

/**
 * Arbeitszeitregeln und Feiertagsregion eines Standorts.
 *
 * Diese Werte sind kein Anzeigekram: `lib/rules/worktime.ts` prueft die
 * Dienstplanung gegen genau sie, und `blocksPublication()` haelt eine
 * Veroeffentlichung an, wenn die Ruhezeit unterschritten wird. Wer hier die
 * Ruhezeit auf 0 setzt, schaltet die Pruefung ab — deshalb steht neben dem
 * Feld, was gesetzlich gilt, und deshalb laeuft die Aenderung durch das
 * Audit-Log.
 */
export async function saveLocation(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const me = await requireMe();
  if (me.perms.einstellungen !== "write") {
    return { error: "Keine Berechtigung für Einstellungen.", ok: null };
  }

  const parsed = standortSchema.safeParse({
    locationId: formData.get("locationId"),
    holidayRegion: formData.get("holidayRegion"),
    minStaffing: formData.get("minStaffing"),
    restHours: formData.get("restHours"),
    maxDaily: formData.get("maxDaily"),
    maxWeekly: formData.get("maxWeekly"),
    breakAfterMin: formData.get("breakAfterMin"),
    breakMin: formData.get("breakMin"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Eingabe fehlt.", ok: null };
  }

  const d = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase
    .from("location")
    .update({
      holiday_region: d.holidayRegion,
      min_staffing: d.minStaffing,
      worktime_rules: {
        rest_hours: d.restHours,
        max_daily: d.maxDaily,
        max_weekly: d.maxWeekly,
        break_after_min: d.breakAfterMin,
        break_min: d.breakMin,
      },
    })
    .eq("id", d.locationId);

  if (error) return { error: `Speichern fehlgeschlagen: ${error.message}`, ok: null };

  revalidatePath("/einstellungen");
  revalidatePath("/dispo");
  return { error: null, ok: "Standort gespeichert." };
}

async function zaehleBelegung(
  supabase: Awaited<ReturnType<typeof createClient>>,
  phaseId: string,
): Promise<number> {
  const [jobs, quotes, tickets] = await Promise.all([
    supabase.from("job").select("id", { count: "exact", head: true }).eq("phase_id", phaseId),
    supabase.from("quote").select("id", { count: "exact", head: true }).eq("phase_id", phaseId),
    supabase
      .from("service_ticket")
      .select("id", { count: "exact", head: true })
      .eq("phase_id", phaseId),
  ]);

  return (jobs.count ?? 0) + (quotes.count ?? 0) + (tickets.count ?? 0);
}

/* ------------------------------------------------------ ZEITERFASSUNG */

const zeitSchema = z.object({
  rundungMin: z.coerce.number().int().min(0).max(60),
  pauseAbMin: z.coerce.number().int().min(0).max(720),
  pauseAbzugMin: z.coerce.number().int().min(0).max(180),
  abendAb: z.string().regex(/^\d{2}:\d{2}$/, "Uhrzeit als HH:MM."),
  nachtAb: z.string().regex(/^\d{2}:\d{2}$/, "Uhrzeit als HH:MM."),
  nachtBis: z.string().regex(/^\d{2}:\d{2}$/, "Uhrzeit als HH:MM."),
  zuschlagAbendPct: z.coerce.number().min(0).max(300),
  zuschlagNachtPct: z.coerce.number().min(0).max(300),
  zuschlagSamstagPct: z.coerce.number().min(0).max(300),
  zuschlagSonntagPct: z.coerce.number().min(0).max(300),
  zuschlagFeiertagPct: z.coerce.number().min(0).max(300),
});

/**
 * Zeiterfassungsregeln des Betriebs.
 *
 * Rundung, Pausenautomatik und Zuschlagssätze — kaufmännische Konvention,
 * deshalb je Mandant und nicht je Standort. Die Arbeitszeitgrenzen
 * (Ruhezeit, Höchstarbeitszeit) bleiben am Standort: das ist Arbeitsrecht
 * und kann sich zwischen zwei Niederlassungen unterscheiden.
 */
export async function saveTimeSettings(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const me = await requireMe();
  if (me.perms.einstellungen !== "write") {
    return { error: "Keine Berechtigung für Einstellungen.", ok: null };
  }

  const parsed = zeitSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Eingabe fehlt.", ok: null };
  }
  const d = parsed.data;

  if (d.pauseAbMin > 0 && d.pauseAbzugMin === 0) {
    return {
      error: "Ein Pausenabzug von null Minuten ist keine Automatik — bitte Schwelle auf 0 setzen.",
      ok: null,
    };
  }

  const supabase = await createClient();

  /*
   * Mit .select() geprüft, ob tatsächlich eine Zeile geschrieben wurde.
   * Ein UPDATE, das an einer Policy vorbeiläuft, meldet keinen Fehler —
   * es trifft null Zeilen und der Nutzer sähe eine Erfolgsmeldung für
   * etwas, das nicht passiert ist.
   */
  const { data: geschrieben, error } = await supabase
    .from("company")
    .update({ time_settings: d })
    .eq("id", me.companyId)
    .select("id");

  if (error) return { error: `Speichern fehlgeschlagen: ${error.message}`, ok: null };
  if (!geschrieben || geschrieben.length === 0) {
    return {
      error:
        "Nicht gespeichert — die Firmendaten sind für deinen Zugang schreibgeschützt.",
      ok: null,
    };
  }

  revalidatePath("/einstellungen");
  revalidatePath("/zeiterfassung");
  revalidatePath("/stundenkonto");
  return {
    error: null,
    ok:
      d.rundungMin > 0
        ? `Gespeichert. Neue Buchungen werden auf ${d.rundungMin} Minuten gerundet.`
        : "Gespeichert.",
  };
}
