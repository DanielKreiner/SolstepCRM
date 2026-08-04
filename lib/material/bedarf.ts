import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  bedarfAusPositionen,
  type AngebotsPosition,
  type StuecklistenTeil,
} from "@/lib/material/bedarf-regeln";

/**
 * Die Bedarfsliste aus der Datenbank befüllen. Die Regel dahinter steht
 * in bedarf-regeln.ts und ist dort ohne Datenbank getestet.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any, any, any>;

/**
 * Befüllt die Bedarfsliste eines Vorgangs aus seinem Angebot.
 *
 * Wird von der Annahme-Kaskade aufgerufen und tut nichts, wenn schon
 * eine Liste existiert — ein zweiter Lauf darf die Arbeit des Büros
 * nicht überschreiben.
 */
export async function bedarfVorbefuellen(
  supabase: Client,
  d: { companyId: string; vorgangId: string },
): Promise<{ zeilen: number; nichtBefuellt?: string }> {
  const { count } = await supabase
    .from("vorgang_bedarf")
    .select("id", { count: "exact", head: true })
    .eq("vorgang_id", d.vorgangId);

  if ((count ?? 0) > 0) return { zeilen: 0, nichtBefuellt: "vorhanden" };

  const { data: posRoh } = await supabase
    .from("vorgang_position")
    .select("sort, article_id, bezeichnung, menge, einheit, pos_typ")
    .eq("vorgang_id", d.vorgangId)
    .is("dokument_id", null)
    .order("sort");

  const positionen = (posRoh ?? []) as unknown as AngebotsPosition[];
  if (positionen.length === 0) return { zeilen: 0 };

  /* Die Stücklisten aller beteiligten Pakete in einem Zug. */
  const paketIds = positionen
    .filter((p) => p.pos_typ === "paket" && p.article_id)
    .map((p) => p.article_id as string);

  const stuecklisten = new Map<string, StuecklistenTeil[]>();

  if (paketIds.length > 0) {
    const { data: teile } = await supabase
      .from("artikel_stueckliste")
      .select("paket_id, artikel_id, menge, sort, artikel:artikel_id ( name, unit )")
      .in("paket_id", paketIds)
      .order("sort");

    for (const t of (teile ?? []) as unknown as {
      paket_id: string;
      artikel_id: string;
      menge: string;
      artikel: { name: string; unit: string } | null;
    }[]) {
      const liste = stuecklisten.get(t.paket_id) ?? [];
      liste.push({
        artikel_id: t.artikel_id,
        bezeichnung: t.artikel?.name ?? "Artikel",
        menge: Number(t.menge),
        einheit: t.artikel?.unit ?? "Stk",
      });
      stuecklisten.set(t.paket_id, liste);
    }
  }

  const zeilen = bedarfAusPositionen(d.companyId, d.vorgangId, positionen, stuecklisten);
  if (zeilen.length === 0) return { zeilen: 0 };

  const { error } = await supabase.from("vorgang_bedarf").insert(zeilen);
  if (error) return { zeilen: 0, nichtBefuellt: error.message };

  return { zeilen: zeilen.length };
}
