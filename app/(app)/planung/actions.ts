"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireMe } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { alsPruefdaten, tafelLaden } from "@/lib/einsatz/daten";
import { blockiert, pruefe, type EinsatzKonflikt } from "@/lib/einsatz/konflikte";

export type PlanStatus = {
  error: string | null;
  ok: string | null;
  /** Weiche Warnungen — der Dialog zeigt sie und bietet das Überstimmen an. */
  warnungen?: EinsatzKonflikt[];
};

/*
 * Einsätze anlegen, verschieben, löschen.
 *
 * Die Konfliktprüfung sitzt hier und nicht nur im Dialog: die Oberfläche
 * kann man umgehen, eine Serveraktion nicht. Der Dialog zeigt dieselben
 * Warnungen vorab, damit niemand erst nach dem Klick erfährt, dass der
 * Monteur im Urlaub ist.
 */

async function zugang() {
  const me = await requireMe();
  if (me.perms.pipelines !== "write") {
    return {
      ok: false as const,
      status: { error: "Für die Planung fehlt deiner Rolle das Schreibrecht.", ok: null },
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

const anlegenSchema = z.object({
  art: z.enum(["auftrag", "service", "intern"]),
  titel: z.string().trim().max(120).optional().default(""),
  vorgangId: z.string().uuid().optional().or(z.literal("")),
  von: z.string().min(10),
  bis: z.string().min(10),
  ganztaegig: z.enum(["ja", "nein"]).optional().default("nein"),
  fahrzeugId: z.string().uuid().optional().or(z.literal("")),
  subText: z.string().trim().max(160).optional().default(""),
  notiz: z.string().trim().max(600).optional().default(""),
  /* Mehrfachauswahl kommt als wiederholtes Feld. */
  personen: z.array(z.string().uuid()).optional().default([]),
  benoetigt: z.array(z.string()).optional().default([]),
  /** Begründung fürs Überstimmen. Leer heisst: nicht überstimmt. */
  trotzdem: z.string().trim().max(300).optional().default(""),
  /** Beim Verschieben gesetzt. */
  einsatzId: z.string().uuid().optional().or(z.literal("")),
});

/** Lokale Eingabe („2026-08-12T07:00") in einen Zeitpunkt. */
function alsZeitpunkt(roh: string): string {
  return new Date(roh).toISOString();
}

export async function einsatzSpeichern(
  _prev: PlanStatus,
  formData: FormData,
): Promise<PlanStatus> {
  const z1 = await zugang();
  if (!z1.ok) return z1.status;

  const parsed = anlegenSchema.safeParse({
    ...Object.fromEntries(formData),
    personen: formData.getAll("personen").filter(Boolean),
    benoetigt: formData.getAll("benoetigt").filter(Boolean),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Eingabe fehlt.", ok: null };
  }
  const d = parsed.data;

  if (d.art === "auftrag" && !d.vorgangId) {
    return { error: "Ein Auftragseinsatz braucht einen Vorgang.", ok: null };
  }

  const von = alsZeitpunkt(d.von);
  const bis = alsZeitpunkt(d.bis);
  if (new Date(bis) <= new Date(von)) {
    return { error: "Das Ende liegt vor dem Beginn.", ok: null };
  }

  const supabase = await createClient();

  /*
   * Für die Prüfung reicht die Woche um den Einsatz herum: Ruhezeit und
   * Wochenhöchstarbeitszeit brauchen die Nachbartage, alles Weitere
   * nicht. Die ganze Historie zu laden wäre bei jedem Verschieben eine
   * Abfrage über Jahre.
   */
  const rand = 7 * 86400000;
  const tafel = await tafelLaden(
    supabase,
    new Date(new Date(von).getTime() - rand),
    new Date(new Date(bis).getTime() + rand),
  );
  const pd = alsPruefdaten(tafel);

  const konflikte = pruefe({
    neu: {
      id: d.einsatzId || "neu",
      von,
      bis,
      personen: d.personen,
      fahrzeugId: d.fahrzeugId || null,
      titel: d.titel || "Einsatz",
    },
    bestand: pd.bestand,
    personen: pd.personen,
    abwesenheiten: pd.abwesenheiten,
    benoetigt: d.benoetigt,
    fahrzeuge: tafel.fahrzeuge.map((f) => ({ id: f.id, name: f.name })),
  });

  if (blockiert(konflikte)) {
    return {
      error: konflikte.filter((k) => k.stufe === "hart").map((k) => k.text).join(" "),
      ok: null,
    };
  }

  const weich = konflikte.filter((k) => k.stufe === "weich");
  if (weich.length > 0 && !d.trotzdem) {
    return {
      error: null,
      ok: null,
      warnungen: weich,
    };
  }

  const felder = {
    company_id: z1.me.companyId,
    art: d.art,
    titel: d.titel || null,
    vorgang_id: d.art === "intern" ? null : d.vorgangId || null,
    von,
    bis,
    ganztaegig: d.ganztaegig === "ja",
    fahrzeug_id: d.fahrzeugId || null,
    sub_text: d.subText || null,
    notiz: d.notiz || null,
    benoetigte_qualifikationen: d.benoetigt,
  };

  let id = d.einsatzId || "";
  if (id) {
    const { error } = await supabase.from("einsatz").update(felder).eq("id", id);
    if (error) return { error: `Speichern fehlgeschlagen: ${error.message}`, ok: null };
    await supabase.from("einsatz_person").delete().eq("einsatz_id", id);
  } else {
    const { data, error } = await supabase
      .from("einsatz")
      .insert({ ...felder, created_by: z1.me.id })
      .select("id")
      .single();
    if (error || !data) {
      return { error: `Anlegen fehlgeschlagen: ${error?.message}`, ok: null };
    }
    id = data.id as string;
  }

  if (d.personen.length > 0) {
    const { error } = await supabase.from("einsatz_person").insert(
      d.personen.map((u) => ({
        einsatz_id: id,
        user_id: u,
        company_id: z1.me.companyId,
      })),
    );
    if (error) return { error: `Zuordnung fehlgeschlagen: ${error.message}`, ok: null };
  }

  /*
   * Ein Override ohne Spur wäre kein Override, sondern ein Klick. Er
   * landet am Einsatz und — wenn einer dranhängt — auch am Vorgang, wo
   * die Bauleitung ihn sieht.
   */
  if (weich.length > 0 && d.trotzdem) {
    const body = `${weich.map((w) => w.text).join(" ")}\nBegründung: ${d.trotzdem}`;
    await supabase.from("einsatz_event").insert({
      company_id: z1.me.companyId,
      einsatz_id: id,
      typ: "override",
      titel: "Warnung überstimmt",
      body,
      created_by: z1.me.id,
    });
    if (felder.vorgang_id) {
      await supabase.from("vorgang_event").insert({
        company_id: z1.me.companyId,
        vorgang_id: felder.vorgang_id,
        typ: "notiz",
        titel: "Planungswarnung überstimmt",
        body,
        kunde_sichtbar: false,
        created_by: z1.me.id,
      });
    }
  }

  revalidatePath("/planung");
  if (felder.vorgang_id) revalidatePath(`/vorgaenge/${felder.vorgang_id}`);

  return {
    error: null,
    ok: d.einsatzId ? "Einsatz geändert." : "Einsatz angelegt.",
  };
}

/**
 * Einen Einsatz verschieben — aus dem Ziehen in der Tafel.
 *
 * Prüft dieselben Regeln. Eine harte Sperre hält auch hier: einen Block
 * in einen Urlaub zu ziehen darf nicht gehen, nur weil es mit der Maus
 * bequemer ist als über den Dialog.
 */
export async function einsatzVerschieben(input: {
  einsatzId: string;
  von: string;
  bis: string;
  /** Ziehen auf eine andere Person tauscht die Zuordnung. */
  userId?: string | null;
}): Promise<PlanStatus> {
  const z1 = await zugang();
  if (!z1.ok) return z1.status;

  const parsed = z
    .object({
      einsatzId: z.string().uuid(),
      von: z.string(),
      bis: z.string(),
      userId: z.string().uuid().nullable().optional(),
    })
    .safeParse(input);
  if (!parsed.success) return { error: "Eingabe fehlt.", ok: null };
  const d = parsed.data;

  const supabase = await createClient();
  const { data: alt } = await supabase
    .from("einsatz")
    .select(
      "id, art, titel, von, bis, vorgang_id, fahrzeug_id, benoetigte_qualifikationen, personen:einsatz_person ( user_id )",
    )
    .eq("id", d.einsatzId)
    .maybeSingle();

  if (!alt) return { error: "Einsatz nicht gefunden.", ok: null };

  const bisher = ((alt.personen ?? []) as unknown as { user_id: string }[]).map(
    (p) => p.user_id,
  );
  const personen = d.userId ? [d.userId] : bisher;

  const rand = 7 * 86400000;
  const tafel = await tafelLaden(
    supabase,
    new Date(new Date(d.von).getTime() - rand),
    new Date(new Date(d.bis).getTime() + rand),
  );
  const pd = alsPruefdaten(tafel);

  const konflikte = pruefe({
    neu: {
      id: d.einsatzId,
      von: d.von,
      bis: d.bis,
      personen,
      fahrzeugId: (alt.fahrzeug_id as string | null) ?? null,
      titel: (alt.titel as string | null) ?? "Einsatz",
    },
    bestand: pd.bestand,
    personen: pd.personen,
    abwesenheiten: pd.abwesenheiten,
    benoetigt: (alt.benoetigte_qualifikationen as string[] | null) ?? [],
    fahrzeuge: tafel.fahrzeuge.map((f) => ({ id: f.id, name: f.name })),
  });

  if (blockiert(konflikte)) {
    return {
      error: konflikte.filter((k) => k.stufe === "hart").map((k) => k.text).join(" "),
      ok: null,
    };
  }

  const { error } = await supabase
    .from("einsatz")
    .update({ von: d.von, bis: d.bis })
    .eq("id", d.einsatzId);

  if (error) return { error: `Verschieben fehlgeschlagen: ${error.message}`, ok: null };

  if (d.userId && !bisher.includes(d.userId)) {
    await supabase.from("einsatz_person").delete().eq("einsatz_id", d.einsatzId);
    await supabase.from("einsatz_person").insert({
      einsatz_id: d.einsatzId,
      user_id: d.userId,
      company_id: z1.me.companyId,
    });
  }

  /*
   * Beim Auftragseinsatz erfährt der Vorgang davon. Sonst steht in der
   * Tafel ein neuer Termin und im Vorgang der alte — und der Kunde
   * bekommt am Telefon zwei Auskünfte.
   */
  if (alt.vorgang_id) {
    const wann = new Date(d.von).toLocaleDateString("de-AT", {
      weekday: "long",
      day: "2-digit",
      month: "2-digit",
    });
    await supabase.from("vorgang_event").insert({
      company_id: z1.me.companyId,
      vorgang_id: alt.vorgang_id as string,
      typ: "termin",
      titel: `${(alt.titel as string | null) ?? "Termin"} verschoben auf ${wann}`,
      kunde_sichtbar: true,
      created_by: z1.me.id,
    });
    revalidatePath(`/vorgaenge/${alt.vorgang_id as string}`);
  }

  revalidatePath("/planung");

  const weich = konflikte.filter((k) => k.stufe === "weich");
  return {
    error: null,
    ok: weich.length ? `Verschoben — ${weich[0]!.text}` : "Verschoben.",
    ...(weich.length ? { warnungen: weich } : {}),
  };
}

export async function einsatzLoeschen(
  _prev: PlanStatus,
  formData: FormData,
): Promise<PlanStatus> {
  const z1 = await zugang();
  if (!z1.ok) return z1.status;

  const id = z.string().uuid().safeParse(formData.get("einsatzId"));
  if (!id.success) return { error: "Einsatz fehlt.", ok: null };

  const supabase = await createClient();
  const { error } = await supabase.from("einsatz").delete().eq("id", id.data);
  if (error) return { error: `Löschen fehlgeschlagen: ${error.message}`, ok: null };

  revalidatePath("/planung");
  return { error: null, ok: "Einsatz entfernt." };
}
