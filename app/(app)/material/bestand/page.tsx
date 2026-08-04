import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { requireMe } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { Bestandstafel } from "./Bestandstafel";

export const metadata: Metadata = { title: "Bestand" };

/**
 * Bestand je Artikel und Lagerort.
 *
 * Gerechnet aus dem Journal, nicht aus einem Feld. Wer ihn ändern will,
 * bucht eine Umbuchung oder zählt — beides steht danach im Journal, mit
 * Namen und Uhrzeit.
 */
export default async function BestandPage() {
  const me = await requireMe();
  const supabase = await createClient();
  const darfBuchen = me.perms.lager === "write" || me.perms.pipelines === "write";

  const [{ data: orte }, { data: bestand }, { data: artikel }] = await Promise.all([
    supabase.from("lagerort").select("id, name, art").eq("aktiv", true).order("sort"),
    supabase
      .from("v_bestand")
      .select("artikel_id, lagerort_id, lagerort, menge"),
    supabase
      .from("article")
      .select("id, sku, name, unit, typ")
      .eq("active", true)
      .neq("typ", "nicht_bestandsgefuehrt")
      .order("name")
      .limit(1000),
  ]);

  const zeilen = (bestand ?? []) as unknown as {
    artikel_id: string;
    lagerort_id: string;
    menge: string;
  }[];

  const stamm = (artikel ?? []) as unknown as {
    id: string;
    sku: string;
    name: string;
    unit: string;
    typ: string;
  }[];

  const nachArtikel = new Map<string, Map<string, number>>();
  for (const z of zeilen) {
    const je = nachArtikel.get(z.artikel_id) ?? new Map<string, number>();
    je.set(z.lagerort_id, Number(z.menge));
    nachArtikel.set(z.artikel_id, je);
  }

  return (
    <>
      <PageHeader
        title="Bestand"
        subtitle="Summe des Bewegungsjournals — kein Feld, das jemand überschreibt"
        actions={
          <Link
            href="/material"
            className="rounded-pill border border-line bg-surface px-5 py-[13px] text-sm font-medium text-ink transition-colors hover:bg-sunk"
          >
            Zum Lager
          </Link>
        }
      />

      <Bestandstafel
        orte={((orte ?? []) as unknown as { id: string; name: string; art: string }[])}
        artikel={stamm
          .filter((a) => nachArtikel.has(a.id) || a.typ === "vanstock")
          .map((a) => ({
            id: a.id,
            sku: a.sku,
            name: a.name,
            einheit: a.unit,
            typ: a.typ,
            mengen: Object.fromEntries(nachArtikel.get(a.id) ?? new Map()),
          }))}
        alleArtikel={stamm.map((a) => ({ id: a.id, sku: a.sku, name: a.name }))}
        darfBuchen={darfBuchen}
      />
    </>
  );
}
