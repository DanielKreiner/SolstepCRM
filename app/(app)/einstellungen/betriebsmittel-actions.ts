"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireMe } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

/*
 * Fahrzeuge und Lagerorte.
 *
 * Beides wurde bisher ausschliesslich gelesen — im Seed angelegt, im
 * Betrieb nie änderbar. Ein übernommener Mandant hatte damit auf Dauer
 * "Bus 1", "Bus 2" und "Pritsche" stehen, und seine echten Fahrzeuge
 * kamen nie hinein. Dasselbe Muster wie beim Standort.
 *
 * Der Zusammenhang der beiden Tabellen ist der Punkt, auf den es
 * ankommt: Ein Fahrzeug IST ein Lagerort. Das Schema sichert das mit
 * `unique (fahrzeug_id)` ab — ein Bus hat genau einen Lagerort, nicht
 * drei. Deshalb entsteht der Lagerort hier automatisch mit dem Fahrzeug
 * und trägt auch dessen Namen: Wer seinen Bus umbenennt, will nicht
 * hinterher in einer zweiten Liste denselben Namen nachziehen, und zwei
 * auseinanderlaufende Namen für dasselbe Fahrzeug sind im Lager die
 * sichere Fehlbuchung.
 */

export type BetriebsmittelState = { error: string | null; ok: string | null };

async function zugang() {
  const me = await requireMe();
  if (me.perms.einstellungen !== "write") {
    return {
      ok: false as const,
      status: { error: "Keine Berechtigung für Einstellungen.", ok: null },
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

/** Ans Ende der Liste, in Zehnerschritten — damit später etwas dazwischenpasst. */
async function naechsterPlatz(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tabelle: "fahrzeug" | "lagerort",
): Promise<number> {
  const { data } = await supabase
    .from(tabelle)
    .select("sort")
    .order("sort", { ascending: false })
    .limit(1)
    .maybeSingle();
  return Number(data?.sort ?? 0) + 10;
}

/*
 * ── Fahrzeuge ──────────────────────────────────────────────────────
 */

const fahrzeugSchema = z.object({
  name: z.string().trim().min(2, "Das Fahrzeug braucht eine Bezeichnung.").max(60),
  kennzeichen: z.string().trim().max(20).optional().default(""),
});

export async function fahrzeugAnlegen(
  _prev: BetriebsmittelState,
  formData: FormData,
): Promise<BetriebsmittelState> {
  const z1 = await zugang();
  if (!z1.ok) return z1.status;

  const parsed = fahrzeugSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Eingabe fehlt.", ok: null };
  }
  const d = parsed.data;
  const supabase = await createClient();

  const { data: fahrzeug, error } = await supabase
    .from("fahrzeug")
    .insert({
      company_id: z1.me.companyId,
      name: d.name,
      kennzeichen: d.kennzeichen || null,
      sort: await naechsterPlatz(supabase, "fahrzeug"),
    })
    .select("id")
    .single();

  if (error || !fahrzeug) {
    return { error: `Anlegen fehlgeschlagen: ${error?.message ?? "unbekannt"}`, ok: null };
  }

  /*
   * Der Lagerort dazu. Scheitert er, wird das Fahrzeug zurückgenommen —
   * ein Fahrzeug ohne Lagerort taucht in der Beladeliste auf, nimmt aber
   * kein Material an, und das merkt man erst auf der Baustelle.
   */
  const { error: ortFehler } = await supabase.from("lagerort").insert({
    company_id: z1.me.companyId,
    art: "fahrzeug",
    fahrzeug_id: fahrzeug.id,
    name: d.name,
    sort: await naechsterPlatz(supabase, "lagerort"),
  });

  if (ortFehler) {
    await supabase.from("fahrzeug").delete().eq("id", fahrzeug.id);
    return { error: `Lagerort konnte nicht angelegt werden: ${ortFehler.message}`, ok: null };
  }

  revalidatePath("/einstellungen");
  revalidatePath("/material");
  revalidatePath("/planung");
  return { error: null, ok: `${d.name} angelegt.` };
}

const fahrzeugAendernSchema = fahrzeugSchema.extend({
  fahrzeugId: z.string().uuid(),
  aktiv: z.enum(["ja", "nein"]).optional().default("ja"),
});

export async function fahrzeugSpeichern(
  _prev: BetriebsmittelState,
  formData: FormData,
): Promise<BetriebsmittelState> {
  const z1 = await zugang();
  if (!z1.ok) return z1.status;

  const parsed = fahrzeugAendernSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Eingabe fehlt.", ok: null };
  }
  const d = parsed.data;
  const aktiv = d.aktiv === "ja";
  const supabase = await createClient();

  const { error } = await supabase
    .from("fahrzeug")
    .update({ name: d.name, kennzeichen: d.kennzeichen || null, aktiv })
    .eq("id", d.fahrzeugId);

  if (error) return { error: `Speichern fehlgeschlagen: ${error.message}`, ok: null };

  /* Der Lagerort trägt denselben Namen und denselben Zustand. */
  await supabase
    .from("lagerort")
    .update({ name: d.name, aktiv })
    .eq("fahrzeug_id", d.fahrzeugId);

  revalidatePath("/einstellungen");
  revalidatePath("/material");
  revalidatePath("/planung");
  return { error: null, ok: aktiv ? "Fahrzeug gespeichert." : "Fahrzeug stillgelegt." };
}

export async function fahrzeugEntfernen(
  _prev: BetriebsmittelState,
  formData: FormData,
): Promise<BetriebsmittelState> {
  const z1 = await zugang();
  if (!z1.ok) return z1.status;

  const id = z.string().uuid().safeParse(formData.get("fahrzeugId"));
  if (!id.success) return { error: "Fahrzeug nicht gefunden.", ok: null };

  const supabase = await createClient();

  /*
   * Nur, solange nichts daran hängt. Eine Lagerbewegung verweist mit
   * `on delete restrict` auf den Lagerort — der Löschversuch liefe sonst
   * in einen Fremdschlüsselfehler, und der Betrieb bekäme eine
   * Datenbankmeldung statt eines Satzes.
   *
   * Wer Bewegungen hat, legt das Fahrzeug stattdessen still: Es
   * verschwindet überall aus der Auswahl, und seine Geschichte bleibt
   * lesbar.
   */
  const { data: ort } = await supabase
    .from("lagerort")
    .select("id")
    .eq("fahrzeug_id", id.data)
    .maybeSingle();

  if (ort) {
    const { count } = await supabase
      .from("lagerbewegung")
      .select("id", { count: "exact", head: true })
      .or(`von_lagerort_id.eq.${ort.id},nach_lagerort_id.eq.${ort.id}`);

    if ((count ?? 0) > 0) {
      return {
        error:
          "Auf dieses Fahrzeug wurde schon Material gebucht. Bitte stattdessen stilllegen — dann verschwindet es aus der Auswahl und die Buchungen bleiben nachvollziehbar.",
        ok: null,
      };
    }
  }

  const { error } = await supabase.from("fahrzeug").delete().eq("id", id.data);
  if (error) return { error: `Entfernen fehlgeschlagen: ${error.message}`, ok: null };

  revalidatePath("/einstellungen");
  revalidatePath("/material");
  revalidatePath("/planung");
  return { error: null, ok: "Fahrzeug entfernt." };
}

/*
 * ── Lagerorte ohne Fahrzeug ────────────────────────────────────────
 */

const lagerSchema = z.object({
  name: z.string().trim().min(2, "Der Lagerort braucht einen Namen.").max(60),
});

export async function lagerortAnlegen(
  _prev: BetriebsmittelState,
  formData: FormData,
): Promise<BetriebsmittelState> {
  const z1 = await zugang();
  if (!z1.ok) return z1.status;

  const parsed = lagerSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Eingabe fehlt.", ok: null };
  }
  const supabase = await createClient();

  const { error } = await supabase.from("lagerort").insert({
    company_id: z1.me.companyId,
    art: "hauptlager",
    name: parsed.data.name,
    sort: await naechsterPlatz(supabase, "lagerort"),
  });

  if (error) return { error: `Anlegen fehlgeschlagen: ${error.message}`, ok: null };

  revalidatePath("/einstellungen");
  revalidatePath("/material");
  return { error: null, ok: `${parsed.data.name} angelegt.` };
}

const lagerAendernSchema = lagerSchema.extend({
  lagerortId: z.string().uuid(),
  aktiv: z.enum(["ja", "nein"]).optional().default("ja"),
});

export async function lagerortSpeichern(
  _prev: BetriebsmittelState,
  formData: FormData,
): Promise<BetriebsmittelState> {
  const z1 = await zugang();
  if (!z1.ok) return z1.status;

  const parsed = lagerAendernSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Eingabe fehlt.", ok: null };
  }
  const d = parsed.data;
  const aktiv = d.aktiv === "ja";
  const supabase = await createClient();

  /*
   * Das letzte aktive Hauptlager bleibt aktiv. Ohne eines gibt es keinen
   * Ort, an dem Wareneingang verbucht werden kann — die Bestellung käme
   * an und liesse sich nirgendwo einbuchen.
   */
  if (!aktiv) {
    const { count } = await supabase
      .from("lagerort")
      .select("id", { count: "exact", head: true })
      .eq("art", "hauptlager")
      .eq("aktiv", true);

    if ((count ?? 0) <= 1) {
      return { error: "Das letzte Hauptlager kann nicht stillgelegt werden.", ok: null };
    }
  }

  const { error } = await supabase
    .from("lagerort")
    .update({ name: d.name, aktiv })
    .eq("id", d.lagerortId)
    .eq("art", "hauptlager");

  if (error) return { error: `Speichern fehlgeschlagen: ${error.message}`, ok: null };

  revalidatePath("/einstellungen");
  revalidatePath("/material");
  return { error: null, ok: aktiv ? "Lagerort gespeichert." : "Lagerort stillgelegt." };
}
