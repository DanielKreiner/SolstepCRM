"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireMe } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { phaseMitziehen } from "@/lib/vorgang/phase-mitziehen";
import { anhangSpeichern } from "@/lib/vorgang/chat";

export type AufnahmeStatus = { error: string | null; ok: string | null };

/*
 * Die Aufnahme vor Ort, am einzelnen Vorgang.
 *
 * Die Machbarkeit entscheidet sich auf dem Dach: Zählerart, Ziegelform,
 * Sparrenabstand, Verschattung. Wer das nicht dort abhakt, fährt ein
 * zweites Mal hin — und dieser zweite Weg frisst die Marge.
 */

async function zugang() {
  const me = await requireMe();
  if (me.perms.pipelines !== "write") {
    return {
      ok: false as const,
      status: { error: "Für Vorgänge fehlt deiner Rolle das Schreibrecht.", ok: null },
    };
  }
  if (me.company.status !== "active") {
    return {
      ok: false as const,
      status: { error: "Der Zugang ist derzeit nur lesend.", ok: null },
    };
  }
  return { ok: true as const, me };
}

/**
 * Die Aufnahme starten: Punkte aus der Vorlage kopieren.
 *
 * Kopiert, nicht verknüpft — dieselbe Regel wie bei Angebotspositionen.
 * Ändert der Betrieb morgen seine Vorlage, darf das eine gestern
 * durchgeführte Aufnahme nicht rückwirkend umschreiben.
 */
export async function aufnahmeStarten(
  _prev: AufnahmeStatus,
  formData: FormData,
): Promise<AufnahmeStatus> {
  const z1 = await zugang();
  if (!z1.ok) return z1.status;

  const id = z.string().uuid().safeParse(formData.get("vorgangId"));
  if (!id.success) return { error: "Vorgang fehlt.", ok: null };
  const vorgangId = id.data;

  const supabase = await createClient();

  const { count } = await supabase
    .from("vorgang_checkliste")
    .select("id", { count: "exact", head: true })
    .eq("vorgang_id", vorgangId)
    .eq("art", "aufnahme");

  if ((count ?? 0) > 0) return { error: "Die Aufnahme läuft bereits.", ok: null };

  const { data: vorlage } = await supabase
    .from("checkliste_vorlage")
    .select(
      "id, name, punkte:checkliste_punkt_vorlage ( label, hinweis, typ, pflicht, sort )",
    )
    .eq("art", "aufnahme")
    .eq("aktiv", true)
    .limit(1)
    .maybeSingle();

  const { data: liste, error } = await supabase
    .from("vorgang_checkliste")
    .insert({
      company_id: z1.me.companyId,
      vorgang_id: vorgangId,
      vorlage_id: (vorlage?.id as string | undefined) ?? null,
      name: (vorlage?.name as string | undefined) ?? "Aufnahme vor Ort",
      art: "aufnahme",
    })
    .select("id")
    .single();

  if (error || !liste) {
    return { error: `Anlegen fehlgeschlagen: ${error?.message}`, ok: null };
  }

  const punkte = ((vorlage?.punkte ?? []) as unknown as {
    label: string;
    hinweis: string | null;
    typ: string;
    pflicht: boolean;
    sort: number;
  }[]).slice().sort((a, b) => a.sort - b.sort);

  if (punkte.length > 0) {
    const { error: pErr } = await supabase.from("vorgang_checkliste_punkt").insert(
      punkte.map((p, i) => ({
        company_id: z1.me.companyId,
        checkliste_id: liste.id as string,
        vorgang_id: vorgangId,
        label: p.label,
        hinweis: p.hinweis,
        typ: p.typ,
        pflicht: p.pflicht,
        sort: (i + 1) * 10,
      })),
    );
    if (pErr) return { error: `Punkte fehlgeschlagen: ${pErr.message}`, ok: null };
  }

  /*
   * Wer die Aufnahme startet, hat sie begonnen — dafür braucht es
   * keinen zweiten Knopf im Überblick.
   */
  await phaseMitziehen(supabase, {
    companyId: z1.me.companyId,
    vorgangId,
    userId: z1.me.id,
    aus: ["anfrage"],
    nach: "aufnahme",
    grund: "Aufnahme vor Ort begonnen.",
  });

  revalidatePath(`/vorgaenge/${vorgangId}`);
  return {
    error: null,
    ok:
      punkte.length > 0
        ? `Aufnahme gestartet mit ${punkte.length} Punkten.`
        : "Aufnahme gestartet. Die Vorlage hat noch keine Punkte — in den Einstellungen pflegen.",
  };
}

const eigenSchema = z.object({
  vorgangId: z.string().uuid(),
  checklisteId: z.string().uuid(),
  label: z.string().trim().min(2, "Bitte den Punkt benennen.").max(120),
  hinweis: z.string().trim().max(300).optional().default(""),
  typ: z.enum(["haken", "text", "zahl", "foto", "datei"]),
});

/** Ein Punkt, den es nur bei diesem Kunden gibt. */
export async function punktErgaenzen(
  _prev: AufnahmeStatus,
  formData: FormData,
): Promise<AufnahmeStatus> {
  const z1 = await zugang();
  if (!z1.ok) return z1.status;

  const parsed = eigenSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Eingabe fehlt.", ok: null };
  }
  const d = parsed.data;

  const supabase = await createClient();
  const { data: letzter } = await supabase
    .from("vorgang_checkliste_punkt")
    .select("sort")
    .eq("checkliste_id", d.checklisteId)
    .order("sort", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await supabase.from("vorgang_checkliste_punkt").insert({
    company_id: z1.me.companyId,
    checkliste_id: d.checklisteId,
    vorgang_id: d.vorgangId,
    label: d.label,
    hinweis: d.hinweis || null,
    typ: d.typ,
    eigen: true,
    sort: ((letzter?.sort as number | undefined) ?? 0) + 10,
  });

  if (error) return { error: `Anlegen fehlgeschlagen: ${error.message}`, ok: null };

  revalidatePath(`/vorgaenge/${d.vorgangId}`);
  return { error: null, ok: "Punkt ergänzt." };
}

const antwortSchema = z.object({
  vorgangId: z.string().uuid(),
  punktId: z.string().uuid(),
  wertText: z.string().trim().max(500).optional().default(""),
  wertZahl: z.string().trim().optional().default(""),
  erledigt: z.enum(["ja", "nein"]).optional().default("nein"),
});

/**
 * Einen Punkt beantworten — Haken, Text, Zahl und optional Dateien.
 *
 * Alles in einem Zug, weil der Vertrieb vor Ort steht und nicht zweimal
 * auf Speichern drücken soll. Der Zeitstempel wird gesetzt, sobald etwas
 * dasteht: eine Zahl ohne „erledigt" wäre eine halbe Antwort.
 */
export async function punktBeantworten(
  _prev: AufnahmeStatus,
  formData: FormData,
): Promise<AufnahmeStatus> {
  const z1 = await zugang();
  if (!z1.ok) return z1.status;

  const parsed = antwortSchema.safeParse({
    vorgangId: formData.get("vorgangId"),
    punktId: formData.get("punktId"),
    wertText: formData.get("wertText") ?? "",
    wertZahl: formData.get("wertZahl") ?? "",
    erledigt: formData.get("erledigt") ?? "nein",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Eingabe fehlt.", ok: null };
  }
  const d = parsed.data;

  const supabase = await createClient();

  const dateien = formData
    .getAll("anhang")
    .filter((f): f is File => f instanceof File && f.size > 0);

  for (const datei of dateien) {
    const r = await anhangSpeichern(supabase, {
      companyId: z1.me.companyId,
      vorgangId: d.vorgangId,
      datei,
      von: "betrieb",
    });
    if (!r.ok) return { error: r.grund, ok: null };

    /*
     * Der Anhang gehört an den Punkt. anhangSpeichern kennt die
     * Checkliste nicht — eine zweite Hochladestrecke zu bauen wäre
     * schlechter, weil dort die Prüfung der Dateiart, die Grösse und
     * das Entfernen der GPS-Daten noch einmal stehen müssten.
     */
    await supabase
      .from("vorgang_anhang")
      .update({ checkliste_punkt_id: d.punktId })
      .eq("id", r.id);
  }

  const zahl = d.wertZahl === "" ? null : Number(d.wertZahl);
  if (zahl !== null && Number.isNaN(zahl)) {
    return { error: "Das ist keine Zahl.", ok: null };
  }

  const hatInhalt =
    d.erledigt === "ja" || d.wertText !== "" || zahl !== null || dateien.length > 0;

  const { error } = await supabase
    .from("vorgang_checkliste_punkt")
    .update({
      wert_text: d.wertText || null,
      wert_zahl: zahl,
      erledigt_am: hatInhalt ? new Date().toISOString() : null,
      erledigt_von: hatInhalt ? z1.me.id : null,
    })
    .eq("id", d.punktId)
    .eq("vorgang_id", d.vorgangId);

  if (error) return { error: `Speichern fehlgeschlagen: ${error.message}`, ok: null };

  revalidatePath(`/vorgaenge/${d.vorgangId}`);
  return { error: null, ok: hatInhalt ? "Erledigt." : "Zurückgesetzt." };
}

export async function punktWeg(
  _prev: AufnahmeStatus,
  formData: FormData,
): Promise<AufnahmeStatus> {
  const z1 = await zugang();
  if (!z1.ok) return z1.status;

  const parsed = z
    .object({ vorgangId: z.string().uuid(), punktId: z.string().uuid() })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Eingabe fehlt.", ok: null };

  const supabase = await createClient();

  /*
   * Nur eigene Punkte. Einen Punkt aus der Vorlage zu entfernen hiesse,
   * die Aufnahme unvollständig zu machen, ohne dass es jemand sieht —
   * wer ihn nicht braucht, nimmt ihn in den Einstellungen heraus.
   */
  const { data: punkt } = await supabase
    .from("vorgang_checkliste_punkt")
    .select("eigen")
    .eq("id", parsed.data.punktId)
    .maybeSingle();

  if (!punkt) return { error: "Punkt nicht gefunden.", ok: null };
  if (!punkt.eigen) {
    return {
      error:
        "Der Punkt kommt aus der Vorlage. Dauerhaft entfernen geht in den Einstellungen.",
      ok: null,
    };
  }

  const { error } = await supabase
    .from("vorgang_checkliste_punkt")
    .delete()
    .eq("id", parsed.data.punktId)
    .eq("vorgang_id", parsed.data.vorgangId);

  if (error) return { error: `Löschen fehlgeschlagen: ${error.message}`, ok: null };

  revalidatePath(`/vorgaenge/${parsed.data.vorgangId}`);
  return { error: null, ok: "Punkt entfernt." };
}

/**
 * Die Aufnahme abschliessen.
 *
 * Offene Pflichtpunkte blockieren — genau dafür sind sie da. Wer trotzdem
 * abschliessen muss, nimmt den Punkt vorher aus der Vorlage; still
 * durchwinken wäre der Weg, auf dem die zweite Anfahrt entsteht.
 */
export async function aufnahmeAbschliessen(
  _prev: AufnahmeStatus,
  formData: FormData,
): Promise<AufnahmeStatus> {
  const z1 = await zugang();
  if (!z1.ok) return z1.status;

  const parsed = z
    .object({ vorgangId: z.string().uuid(), checklisteId: z.string().uuid() })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Eingabe fehlt.", ok: null };

  const supabase = await createClient();
  const { data: offen } = await supabase
    .from("vorgang_checkliste_punkt")
    .select("label")
    .eq("checkliste_id", parsed.data.checklisteId)
    .eq("pflicht", true)
    .is("erledigt_am", null);

  if ((offen ?? []).length > 0) {
    const namen = (offen ?? []).map((o) => o.label as string).slice(0, 3);
    return {
      error: `Noch offen: ${namen.join(", ")}${(offen ?? []).length > 3 ? " und weitere" : ""}.`,
      ok: null,
    };
  }

  const { error } = await supabase
    .from("vorgang_checkliste")
    .update({
      abgeschlossen_am: new Date().toISOString(),
      abgeschlossen_von: z1.me.id,
    })
    .eq("id", parsed.data.checklisteId);

  if (error) return { error: `Fehlgeschlagen: ${error.message}`, ok: null };

  await supabase.from("vorgang_event").insert({
    company_id: z1.me.companyId,
    vorgang_id: parsed.data.vorgangId,
    typ: "notiz",
    titel: "Aufnahme vor Ort abgeschlossen",
    kunde_sichtbar: false,
    created_by: z1.me.id,
  });

  /*
   * Und die Phase zieht mit. Vorher musste jemand danach noch im
   * Überblick „Angebot erstellen" drücken — der Vorgang stand also im
   * Board eine Phase zurück, obwohl die Aufnahme fertig war.
   */
  await phaseMitziehen(supabase, {
    companyId: z1.me.companyId,
    vorgangId: parsed.data.vorgangId,
    userId: z1.me.id,
    aus: ["anfrage", "aufnahme"],
    nach: "angebot",
    grund: "Aufnahme vor Ort abgeschlossen.",
  });

  revalidatePath(`/vorgaenge/${parsed.data.vorgangId}`);
  return { error: null, ok: "Aufnahme abgeschlossen. Der Vorgang steht jetzt beim Angebot." };
}
