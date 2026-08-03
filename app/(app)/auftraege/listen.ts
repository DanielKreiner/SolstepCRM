import "server-only";
import { createClient } from "@/lib/supabase/server";

/*
 * Auswahllisten für die Auftragsformulare.
 *
 * Serverseitig geladen und als Prop weitergereicht: ein Client-Formular,
 * das die Listen selbst nachlädt, zeigt beim ersten Öffnen leere
 * Auswahlfelder — und genau dann tippt jemand daneben.
 *
 * Geteilt zwischen Liste und Detail, damit "Anlegen" und "Bearbeiten"
 * dieselben Auswahlmöglichkeiten haben.
 */

export type Option = { wert: string; text: string };

export type AuftragsListen = {
  kunden: Option[];
  phasen: Option[];
  anlagen: Option[];
  standorte: Option[];
  bauleiter: Option[];
};

export async function ladeAuftragsListen(): Promise<AuftragsListen> {
  const supabase = await createClient();

  const [kunden, phasen, anlagen, standorte, leute] = await Promise.all([
    supabase
      .from("customer")
      .select("id, name, city")
      .is("deleted_at", null)
      .order("name"),
    supabase
      .from("pipeline_phase")
      .select("id, label, sort, pipeline:pipeline_id ( kind )")
      .order("sort"),
    supabase.from("plant").select("id, kwp, customer:customer_id ( name )"),
    supabase.from("location").select("id, name").order("name"),
    supabase
      .from("app_user")
      .select("id, name, role")
      .eq("active", true)
      .in("role", ["gf", "bauleitung", "buero"])
      .order("name"),
  ]);

  return {
    kunden: (kunden.data ?? []).map((k) => ({
      wert: k.id as string,
      text: [k.name as string, k.city as string | null]
        .filter(Boolean)
        .join(" · "),
    })),
    /* Nur Projektphasen — ein Auftrag lebt nicht in der Vertriebspipeline. */
    phasen: (phasen.data ?? [])
      .filter(
        (p) =>
          (p.pipeline as unknown as { kind: string } | null)?.kind === "projekte",
      )
      .map((p) => ({ wert: p.id as string, text: p.label as string })),
    anlagen: (anlagen.data ?? []).map((a) => ({
      wert: a.id as string,
      text: [
        (a.customer as unknown as { name: string } | null)?.name,
        a.kwp ? `${a.kwp as string} kWp` : null,
      ]
        .filter(Boolean)
        .join(" · "),
    })),
    standorte: (standorte.data ?? []).map((s) => ({
      wert: s.id as string,
      text: s.name as string,
    })),
    bauleiter: (leute.data ?? []).map((u) => ({
      wert: u.id as string,
      text: u.name as string,
    })),
  };
}
