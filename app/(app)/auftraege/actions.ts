"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { AktionsStatus } from "@/components/ui/Formular";
import { requireMe } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

/*
 * Aufträge.
 *
 * Bisher entstand ein Auftrag ausschließlich aus einem angenommenen Angebot.
 * Das ist der Regelweg und bleibt es — aber nicht jeder Auftrag hat ein
 * Angebot: Serviceeinsätze, Nachbesserungen und Altbestand aus dem Import
 * brauchen den direkten Weg. Ohne ihn ist das System für den Alltag
 * unbrauchbar.
 *
 * Die Nummer vergibt immer die Datenbank über next_number() — nie der
 * Client. Zwei gleichzeitig angelegte Aufträge dürfen nicht dieselbe
 * Nummer bekommen (CLAUDE.md 5.6).
 */

const auftragSchema = z.object({
  customerId: z.string().uuid("Kunde fehlt."),
  phaseId: z.string().uuid("Phase fehlt."),
  plantId: z.string().uuid().optional().or(z.literal("")),
  locationId: z.string().uuid().optional().or(z.literal("")),
  siteManagerId: z.string().uuid().optional().or(z.literal("")),
  plannedHours: z.coerce.number().min(0).max(100000).default(0),
  valueNet: z.coerce.number().min(0).max(100000000).default(0),
  materialPlanned: z.coerce.number().min(0).max(100000000).default(0),
  scheduledFrom: z.string().trim().optional().or(z.literal("")),
  scheduledTo: z.string().trim().optional().or(z.literal("")),
  address: z.string().trim().max(160).optional().or(z.literal("")),
  zip: z.string().trim().max(12).optional().or(z.literal("")),
  city: z.string().trim().max(80).optional().or(z.literal("")),
  nextStep: z.string().trim().max(200).optional().or(z.literal("")),
});

const leerZuNull = (v: string | undefined): string | null =>
  v && v.trim() !== "" ? v.trim() : null;

async function darfSchreiben() {
  const me = await requireMe();
  if (me.perms.pipelines !== "write") {
    return {
      ok: false as const,
      status: {
        error: "Für Aufträge fehlt deiner Rolle das Schreibrecht.",
        ok: null,
      },
    };
  }
  return { ok: true as const, me };
}

/** Termine prüfen: ein Ende vor dem Beginn ist ein Tippfehler, kein Plan. */
function terminFehler(von: string | null, bis: string | null): string | null {
  if (von && bis && bis < von) {
    return "Das Ende liegt vor dem Beginn.";
  }
  return null;
}

export async function createJob(
  _prev: AktionsStatus,
  formData: FormData,
): Promise<AktionsStatus> {
  const zugang = await darfSchreiben();
  if (!zugang.ok) return zugang.status;

  const parsed = auftragSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Eingabe fehlt.", ok: null };
  }
  const d = parsed.data;

  const von = leerZuNull(d.scheduledFrom);
  const bis = leerZuNull(d.scheduledTo);
  const fehler = terminFehler(von, bis);
  if (fehler) return { error: fehler, ok: null };

  const supabase = await createClient();

  const { data: nummer, error: nummerFehler } = await supabase.rpc("next_number", {
    p_company: zugang.me.companyId,
    p_kind: "job",
  });
  if (nummerFehler || !nummer) {
    return {
      error: `Nummernvergabe fehlgeschlagen: ${nummerFehler?.message ?? "keine Nummer"}`,
      ok: null,
    };
  }

  const { data, error } = await supabase
    .from("job")
    .insert({
      company_id: zugang.me.companyId,
      customer_id: d.customerId,
      phase_id: d.phaseId,
      plant_id: leerZuNull(d.plantId),
      location_id: leerZuNull(d.locationId),
      site_manager_id: leerZuNull(d.siteManagerId),
      number: nummer as string,
      planned_hours: d.plannedHours,
      value_net: d.valueNet,
      material_planned: d.materialPlanned,
      scheduled_from: von,
      scheduled_to: bis,
      address: leerZuNull(d.address),
      zip: leerZuNull(d.zip),
      city: leerZuNull(d.city),
      next_step: leerZuNull(d.nextStep),
      created_by: zugang.me.id,
    })
    .select("id, number")
    .single();

  if (error) return { error: `Anlegen fehlgeschlagen: ${error.message}`, ok: null };

  revalidatePath("/auftraege");
  revalidatePath("/pipelines/projekte");
  revalidatePath("/cockpit");
  return { error: null, ok: `Auftrag ${data.number as string} angelegt.` };
}

export async function updateJob(
  _prev: AktionsStatus,
  formData: FormData,
): Promise<AktionsStatus> {
  const zugang = await darfSchreiben();
  if (!zugang.ok) return zugang.status;

  const id = z.string().uuid().safeParse(formData.get("jobId"));
  if (!id.success) return { error: "Auftrag fehlt.", ok: null };

  const parsed = auftragSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Eingabe fehlt.", ok: null };
  }
  const d = parsed.data;

  const von = leerZuNull(d.scheduledFrom);
  const bis = leerZuNull(d.scheduledTo);
  const fehler = terminFehler(von, bis);
  if (fehler) return { error: fehler, ok: null };

  const supabase = await createClient();
  const { error } = await supabase
    .from("job")
    .update({
      customer_id: d.customerId,
      phase_id: d.phaseId,
      plant_id: leerZuNull(d.plantId),
      location_id: leerZuNull(d.locationId),
      site_manager_id: leerZuNull(d.siteManagerId),
      planned_hours: d.plannedHours,
      value_net: d.valueNet,
      material_planned: d.materialPlanned,
      scheduled_from: von,
      scheduled_to: bis,
      address: leerZuNull(d.address),
      zip: leerZuNull(d.zip),
      city: leerZuNull(d.city),
      next_step: leerZuNull(d.nextStep),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id.data);

  if (error) return { error: `Speichern fehlgeschlagen: ${error.message}`, ok: null };

  revalidatePath("/auftraege");
  revalidatePath(`/auftraege/${id.data}`);
  revalidatePath("/pipelines/projekte");
  return { error: null, ok: "Gespeichert." };
}

/**
 * Auftrag löschen.
 *
 * Nur, solange nichts daran hängt. Zeitbuchungen und Lagerbewegungen sind
 * revisionspflichtig (CLAUDE.md 5.5) — ein Auftrag, auf den gebucht wurde,
 * verschwindet nicht mehr. Dafür gibt es die Abschlussphase.
 */
export async function deleteJob(
  _prev: AktionsStatus,
  formData: FormData,
): Promise<AktionsStatus> {
  const zugang = await darfSchreiben();
  if (!zugang.ok) return zugang.status;

  const id = z.string().uuid().safeParse(formData.get("jobId"));
  if (!id.success) return { error: "Auftrag fehlt.", ok: null };

  const supabase = await createClient();

  const [zeiten, bewegungen, rechnungen] = await Promise.all([
    supabase
      .from("time_entry")
      .select("id", { count: "exact", head: true })
      .eq("job_id", id.data),
    supabase
      .from("stock_move")
      .select("id", { count: "exact", head: true })
      .eq("job_id", id.data),
    supabase
      .from("invoice")
      .select("id", { count: "exact", head: true })
      .eq("job_id", id.data),
  ]);

  const haengt = [
    (zeiten.count ?? 0) > 0 ? `${zeiten.count} Zeitbuchungen` : null,
    (bewegungen.count ?? 0) > 0 ? `${bewegungen.count} Lagerbewegungen` : null,
    (rechnungen.count ?? 0) > 0 ? `${rechnungen.count} Rechnungen` : null,
  ].filter(Boolean);

  if (haengt.length > 0) {
    return {
      error: `Daran hängen ${haengt.join(", ")}. Die sind revisionspflichtig — schließe den Auftrag ab, statt ihn zu löschen.`,
      ok: null,
    };
  }

  const { error } = await supabase.from("job").delete().eq("id", id.data);
  if (error) return { error: `Löschen fehlgeschlagen: ${error.message}`, ok: null };

  revalidatePath("/auftraege");
  revalidatePath("/pipelines/projekte");
  return { error: null, ok: "Auftrag gelöscht." };
}

/** Team am Auftrag: Person hinzufügen oder entfernen. */
export async function toggleJobMember(
  _prev: AktionsStatus,
  formData: FormData,
): Promise<AktionsStatus> {
  const zugang = await darfSchreiben();
  if (!zugang.ok) return zugang.status;

  const parsed = z
    .object({
      jobId: z.string().uuid(),
      userId: z.string().uuid(),
      aktion: z.enum(["hinzu", "weg"]),
    })
    .safeParse(Object.fromEntries(formData));

  if (!parsed.success) return { error: "Eingabe fehlt.", ok: null };
  const { jobId, userId, aktion } = parsed.data;

  const supabase = await createClient();

  const { error } =
    aktion === "hinzu"
      ? await supabase.from("job_member").insert({
          company_id: zugang.me.companyId,
          job_id: jobId,
          user_id: userId,
        })
      : await supabase
          .from("job_member")
          .delete()
          .eq("job_id", jobId)
          .eq("user_id", userId);

  if (error) {
    if (error.code === "23505") {
      return { error: null, ok: "Die Person ist bereits im Team." };
    }
    return { error: `Fehlgeschlagen: ${error.message}`, ok: null };
  }

  revalidatePath(`/auftraege/${jobId}`);
  return {
    error: null,
    ok: aktion === "hinzu" ? "Zum Team hinzugefügt." : "Aus dem Team entfernt.",
  };
}

/** Checklistenpunkt am Auftrag anlegen oder abhaken. */
export async function saveChecklistItem(
  _prev: AktionsStatus,
  formData: FormData,
): Promise<AktionsStatus> {
  const me = await requireMe();
  if (me.perms.pipelines === "none") {
    return { error: "Keine Berechtigung.", ok: null };
  }

  const supabase = await createClient();
  const itemId = formData.get("itemId");

  // Abhaken darf jeder mit Zugriff auf den Auftrag — das ist Baustellenarbeit.
  if (typeof itemId === "string" && itemId.length > 0) {
    const erledigt = formData.get("done") === "1";
    const { error } = await supabase
      .from("job_checklist_item")
      .update({
        done: erledigt,
        done_at: erledigt ? new Date().toISOString() : null,
        done_by: erledigt ? me.id : null,
      })
      .eq("id", itemId);

    if (error) return { error: `Fehlgeschlagen: ${error.message}`, ok: null };

    const jobId = formData.get("jobId");
    if (typeof jobId === "string") revalidatePath(`/auftraege/${jobId}`);
    return { error: null, ok: erledigt ? "Erledigt." : "Wieder offen." };
  }

  // Anlegen dagegen nur mit Schreibrecht.
  if (me.perms.pipelines !== "write") {
    return { error: "Für Aufträge fehlt deiner Rolle das Schreibrecht.", ok: null };
  }

  const parsed = z
    .object({
      jobId: z.string().uuid(),
      label: z.string().trim().min(2, "Bezeichnung fehlt.").max(160),
    })
    .safeParse(Object.fromEntries(formData));

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Eingabe fehlt.", ok: null };
  }

  const { error } = await supabase.from("job_checklist_item").insert({
    company_id: me.companyId,
    job_id: parsed.data.jobId,
    label: parsed.data.label,
    done: false,
  });

  if (error) return { error: `Anlegen fehlgeschlagen: ${error.message}`, ok: null };

  revalidatePath(`/auftraege/${parsed.data.jobId}`);
  return { error: null, ok: "Punkt hinzugefügt." };
}
