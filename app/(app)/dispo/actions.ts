"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  DEFAULT_RULES,
  blocksPublication,
  checkRoster,
  type Absence,
  type Shift,
  type WorktimeRules,
} from "@/lib/rules/worktime";
import { createClient } from "@/lib/supabase/server";
import { requireMe } from "@/lib/session";
import { addDays, isoWeek, startOfViennaWeek } from "@/lib/time";

export type DispoState = { error: string | null; ok: string | null };

const publishSchema = z.object({
  week: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** Bestätigung, dass blockierende Konflikte bewusst in Kauf genommen werden. */
  bestaetigt: z.string().optional(),
  grund: z.string().trim().max(300).optional(),
});

/**
 * Dienstplan veröffentlichen.
 *
 * Definition of Done Meilenstein 6: eine Ruhezeitverletzung blockt die
 * Veröffentlichung bis zur Bestätigung. Nicht bis zur Korrektur — ein
 * Betrieb muss im Notfall veröffentlichen können, aber dann steht die
 * Entscheidung mit Namen und Begründung in roster_publication.
 */
export async function publishRoster(
  _prev: DispoState,
  formData: FormData,
): Promise<DispoState> {
  const me = await requireMe();
  if (me.perms.pipelines !== "write") {
    return { error: "Keine Berechtigung, Dienstpläne zu veröffentlichen.", ok: null };
  }

  const parsed = publishSchema.safeParse({
    week: formData.get("week"),
    bestaetigt: formData.get("bestaetigt") ?? undefined,
    grund: formData.get("grund") ?? undefined,
  });
  if (!parsed.success) return { error: "Woche fehlt.", ok: null };

  const montag = startOfViennaWeek(parsed.data.week);
  const { conflicts, rules } = await loadConflicts(montag);

  const blockiert = blocksPublication(conflicts);
  const bestaetigt = parsed.data.bestaetigt === "ja";

  if (blockiert && !bestaetigt) {
    const blockierend = conflicts.filter((c) => c.severity === "block");
    return {
      error:
        `${blockierend.length} ${blockierend.length === 1 ? "Verstoß blockiert" : "Verstöße blockieren"} die Veröffentlichung. ` +
        `Zum Veröffentlichen ausdrücklich bestätigen.`,
      ok: null,
    };
  }

  if (blockiert && bestaetigt && !parsed.data.grund) {
    return {
      error: "Bei bestätigten Verstößen ist eine Begründung nötig.",
      ok: null,
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("roster_publication").upsert(
    {
      company_id: me.companyId,
      iso_week: isoWeek(montag),
      published_by: me.id,
      published_at: new Date().toISOString(),
      warnings_json: {
        konflikte: conflicts,
        regeln: rules,
        bestaetigt: blockiert ? { durch: me.name, grund: parsed.data.grund } : null,
      },
    },
    { onConflict: "company_id,iso_week" },
  );

  if (error) {
    return { error: `Veröffentlichung fehlgeschlagen: ${error.message}`, ok: null };
  }

  revalidatePath("/dispo");
  return {
    error: null,
    ok: blockiert
      ? `Veröffentlicht trotz ${conflicts.filter((c) => c.severity === "block").length} Verstößen. Die Bestätigung ist protokolliert.`
      : `Dienstplan ${isoWeek(montag)} veröffentlicht.`,
  };
}

/** Konflikte einer Woche — dieselbe Rechnung wie im Screen. */
export async function loadConflicts(montag: string): Promise<{
  conflicts: ReturnType<typeof checkRoster>;
  rules: WorktimeRules;
}> {
  const supabase = await createClient();
  const von = new Date(`${montag}T00:00:00.000Z`).toISOString();
  const bis = new Date(`${addDays(montag, 7)}T00:00:00.000Z`).toISOString();

  const [{ data: termine }, { data: abwesenheiten }, { data: location }] =
    await Promise.all([
      supabase
        .from("job_appointment")
        .select("id, user_id, starts_at, ends_at")
        .gte("starts_at", von)
        .lt("starts_at", bis)
        .not("user_id", "is", null),
      supabase
        .from("absence")
        .select("user_id, from_date, to_date, kind, status")
        .eq("status", "approved")
        .lte("from_date", addDays(montag, 6))
        .gte("to_date", montag),
      supabase.from("location").select("worktime_rules").limit(1).maybeSingle(),
    ]);

  const rules: WorktimeRules = {
    ...DEFAULT_RULES,
    ...((location?.worktime_rules as Partial<WorktimeRules> | null) ?? {}),
  };

  const shifts: Shift[] = (termine ?? []).map((t) => ({
    id: t.id as string,
    userId: t.user_id as string,
    start: t.starts_at as string,
    end: t.ends_at as string,
  }));

  const absences: Absence[] = (abwesenheiten ?? []).map((a) => ({
    userId: a.user_id as string,
    from: a.from_date as string,
    to: a.to_date as string,
    kind: a.kind as string,
  }));

  return { conflicts: checkRoster(shifts, rules, absences), rules };
}

const assignSchema = z.object({
  appointmentId: z.string().uuid(),
  userId: z.string().uuid().nullable(),
});

/** Einsatz einer Person zuordnen oder die Zuordnung lösen. */
export async function assignAppointment(
  appointmentId: string,
  userId: string | null,
): Promise<DispoState> {
  const me = await requireMe();
  if (me.perms.pipelines !== "write") {
    return { error: "Keine Berechtigung.", ok: null };
  }

  const parsed = assignSchema.safeParse({ appointmentId, userId });
  if (!parsed.success) return { error: "Ungültige Zuordnung.", ok: null };

  const supabase = await createClient();
  const { error } = await supabase
    .from("job_appointment")
    .update({ user_id: parsed.data.userId })
    .eq("id", parsed.data.appointmentId);

  if (error) return { error: `Zuordnung fehlgeschlagen: ${error.message}`, ok: null };

  revalidatePath("/dispo");
  return { error: null, ok: "Zugeordnet." };
}
