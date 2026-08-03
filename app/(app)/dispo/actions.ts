"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  DEFAULT_RULES,
  blocksPublication,
  checkBooking,
  checkRoster,
  type Absence,
  type Shift,
  type WorktimeRules,
} from "@/lib/rules/worktime";
import { createClient } from "@/lib/supabase/server";
import { requireMe } from "@/lib/session";
import { addDays, isoWeek, startOfViennaWeek, viennaClock } from "@/lib/time";

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

/* ------------------------------------------------------------- EINSÄTZE */

const einsatzSchema = z.object({
  jobId: z.string().uuid({ message: "Bitte einen Auftrag wählen." }),
  userId: z.string().uuid().or(z.literal("")),
  datum: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Datum fehlt."),
  von: z.string().regex(/^\d{2}:\d{2}$/, "Beginn fehlt."),
  bis: z.string().regex(/^\d{2}:\d{2}$/, "Ende fehlt."),
  titel: z.string().trim().max(120).optional().default(""),
  /* Bewusstes Übergehen einer Warnung — mit Begründung, siehe unten. */
  trotzdem: z.string().optional(),
});

/**
 * Einen Einsatz in den Plan setzen.
 *
 * Das hat gefehlt: die Einsatzplanung konnte Einsätze anzeigen, zuordnen
 * und freigeben — aber keinen einzigen anlegen. Wer einen Auftrag im Pool
 * "Nicht terminiert" liegen hatte, kam von hier aus nicht weiter.
 *
 * Geprüft wird sofort, nicht erst bei der Freigabe. Eine Ruhezeit­verletzung
 * bemerkt man besser beim Eintragen als am Freitag beim Veröffentlichen —
 * dieselben Regeln aus lib/rules/worktime.ts, nur früher angewandt.
 */
export async function einsatzAnlegen(
  _prev: DispoState,
  formData: FormData,
): Promise<DispoState> {
  const me = await requireMe();
  if (me.perms.pipelines !== "write") {
    return { error: "Für die Einsatzplanung fehlt dir das Schreibrecht.", ok: null };
  }
  if (me.company.status !== "active") {
    return { error: "Der Zugang ist derzeit nur lesend.", ok: null };
  }

  const parsed = einsatzSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Eingabe fehlt.", ok: null };
  }
  const d = parsed.data;

  const start = viennaClock(d.datum, d.von).toISOString();
  const ende = viennaClock(d.datum, d.bis).toISOString();

  if (new Date(ende).getTime() <= new Date(start).getTime()) {
    return { error: "Das Ende liegt vor dem Beginn.", ok: null };
  }

  const supabase = await createClient();

  /*
   * Ohne zugeordnete Person gibt es nichts zu prüfen — ein Einsatz ohne
   * Namen verletzt keine Ruhezeit. Die Zuordnung kann später folgen, dann
   * greift die Prüfung beim Verschieben oder spätestens bei der Freigabe.
   */
  let hinweise: string[] = [];

  if (d.userId) {
    const konflikte = await einsatzKonflikte(supabase, {
      id: "neu",
      userId: d.userId,
      start,
      end: ende,
    });

    /*
     * Geblockt wird nur, was auch die Veröffentlichung blocken würde —
     * derselbe Massstab (blocksPublication). Warnungen halten niemanden
     * auf, stehen aber in der Rückmeldung: eine Planung, die bei jedem
     * normalen Arbeitstag meckert, wird nach drei Tagen weggeklickt.
     */
    const blockend = konflikte.filter((k) => k.severity === "block");
    hinweise = konflikte.filter((k) => k.severity === "warn").map((k) => k.message);

    if (blockend.length > 0 && !d.trotzdem) {
      return {
        error: `${blockend[0]!.message} — mit „Trotzdem eintragen" übernimmst du das bewusst.`,
        ok: null,
      };
    }
  }

  const { error } = await supabase.from("job_appointment").insert({
    company_id: me.companyId,
    job_id: d.jobId,
    user_id: d.userId || null,
    starts_at: start,
    ends_at: ende,
    title: d.titel || null,
  });

  if (error) return { error: `Eintragen fehlgeschlagen: ${error.message}`, ok: null };

  revalidatePath("/dispo");
  revalidatePath("/cockpit");
  return {
    error: null,
    ok:
      hinweise.length > 0
        ? `Einsatz eingetragen. Hinweis: ${hinweise[0]}`
        : "Einsatz eingetragen.",
  };
}

const verschiebenSchema = z.object({
  appointmentId: z.string().uuid(),
  datum: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  von: z.string().regex(/^\d{2}:\d{2}$/),
  bis: z.string().regex(/^\d{2}:\d{2}$/),
  userId: z.string().uuid().or(z.literal("")),
});

/** Einsatz verschieben oder umbesetzen. */
export async function einsatzSpeichern(
  _prev: DispoState,
  formData: FormData,
): Promise<DispoState> {
  const me = await requireMe();
  if (me.perms.pipelines !== "write") {
    return { error: "Keine Berechtigung.", ok: null };
  }

  const parsed = verschiebenSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Eingabe fehlt.", ok: null };
  }
  const d = parsed.data;

  const start = viennaClock(d.datum, d.von).toISOString();
  const ende = viennaClock(d.datum, d.bis).toISOString();
  if (new Date(ende).getTime() <= new Date(start).getTime()) {
    return { error: "Das Ende liegt vor dem Beginn.", ok: null };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("job_appointment")
    .update({
      starts_at: start,
      ends_at: ende,
      user_id: d.userId || null,
      /*
       * Ein von Hand verschobener Termin ist gegenüber dem Kalender nicht
       * mehr synchron und die Kundenbestätigung gilt nicht mehr — sie galt
       * dem alten Termin.
       */
      sync_state: "local",
      customer_confirmed: false,
    })
    .eq("id", d.appointmentId);

  if (error) return { error: `Speichern fehlgeschlagen: ${error.message}`, ok: null };

  revalidatePath("/dispo");
  return { error: null, ok: "Verschoben. Der Kunde muss neu bestätigen." };
}

const loeschSchema = z.object({ appointmentId: z.string().uuid() });

export async function einsatzLoeschen(
  _prev: DispoState,
  formData: FormData,
): Promise<DispoState> {
  const me = await requireMe();
  if (me.perms.pipelines !== "write") {
    return { error: "Keine Berechtigung.", ok: null };
  }

  const parsed = loeschSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Eingabe fehlt.", ok: null };

  const supabase = await createClient();
  const { error } = await supabase
    .from("job_appointment")
    .delete()
    .eq("id", parsed.data.appointmentId);

  if (error) return { error: `Löschen fehlgeschlagen: ${error.message}`, ok: null };

  revalidatePath("/dispo");
  return { error: null, ok: "Einsatz entfernt." };
}


/**
 * Konflikte, die ein neuer oder verschobener Einsatz auslöst.
 *
 * Geprüft wird gegen die Einsätze derselben Person in einem Fenster von
 * drei Tagen um den Termin — die Ruhezeit reicht über die Tagesgrenze,
 * eine Prüfung nur innerhalb des Tages würde genau den häufigsten Fall
 * übersehen: spät raus und am nächsten Morgen wieder früh rein.
 */
async function einsatzKonflikte(
  supabase: Awaited<ReturnType<typeof createClient>>,
  neuer: Shift,
): Promise<{ message: string; severity: "block" | "warn" }[]> {
  const von = new Date(new Date(neuer.start).getTime() - 3 * 86_400_000);
  const bis = new Date(new Date(neuer.end).getTime() + 3 * 86_400_000);

  const { data } = await supabase
    .from("job_appointment")
    .select("id, user_id, starts_at, ends_at")
    .eq("user_id", neuer.userId)
    .gte("starts_at", von.toISOString())
    .lte("starts_at", bis.toISOString());

  const vorherige: Shift[] = ((data ?? []) as unknown as {
    id: string;
    user_id: string;
    starts_at: string;
    ends_at: string;
  }[])
    .filter((a) => a.id !== neuer.id)
    .map((a) => ({
      id: a.id,
      userId: a.user_id,
      start: a.starts_at,
      end: a.ends_at,
    }));

  /*
   * Der geplante Block enthält die Pause — ein Dienstplan plant ein
   * Zeitfenster, keine Nettoarbeitszeit. Ohne diese Angabe meldet die
   * Pausenregel bei jedem gewöhnlichen Arbeitstag einen Verstoss. Ob die
   * Pause tatsächlich genommen wurde, entscheidet die Zeiterfassung, nicht
   * der Plan.
   */
  const dauerMin =
    (new Date(neuer.end).getTime() - new Date(neuer.start).getTime()) / 60000;
  const mitPause: Shift =
    dauerMin > DEFAULT_RULES.breakAfterMin
      ? { ...neuer, breakMin: DEFAULT_RULES.breakMin }
      : neuer;

  return checkBooking(mitPause, vorherige, DEFAULT_RULES).map((c) => ({
    message: c.message,
    severity: c.severity,
  }));
}
