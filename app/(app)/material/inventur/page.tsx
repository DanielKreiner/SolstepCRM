import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { date } from "@/lib/format";
import { requireMe } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { Zaehlblatt } from "./Zaehlblatt";

export const metadata: Metadata = { title: "Inventur" };

/**
 * Der Zähl-Flow.
 *
 * Zehn bis fünfzehn Artikel, unter fünf Minuten — mehr wird nicht
 * gezählt, sonst wird es nie gemacht. Gezählt wird, was für diesen Ort
 * geführt wird: beim Fahrzeug die Van-Stock-Artikel, im Hauptlager
 * alles mit Bestand.
 */
export default async function InventurPage({
  searchParams,
}: {
  searchParams: Promise<{ fahrzeug?: string; ort?: string }>;
}) {
  const me = await requireMe();
  const { fahrzeug, ort: ortWahl } = await searchParams;
  const supabase = await createClient();

  if (me.perms.lager !== "write" && me.perms.zeiterfassung !== "write") {
    notFound();
  }

  let frage = supabase
    .from("lagerort")
    .select("id, name, art, fahrzeug_id, letzte_inventur");
  if (fahrzeug) frage = frage.eq("fahrzeug_id", fahrzeug);
  else if (ortWahl) frage = frage.eq("id", ortWahl);
  else frage = frage.eq("art", "hauptlager");

  const { data: ort } = await frage.limit(1).maybeSingle();
  if (!ort) notFound();

  const [{ data: bestand }, { data: regeln }] = await Promise.all([
    supabase.from("v_bestand").select("artikel_id, menge").eq("lagerort_id", ort.id),
    ort.art === "fahrzeug"
      ? supabase
          .from("vanstock_regel")
          .select("artikel_id, min_menge, max_menge")
          .eq("lagerort_id", ort.id)
      : Promise.resolve({ data: [] }),
  ]);

  const mengen = new Map(
    ((bestand ?? []) as unknown as { artikel_id: string; menge: string }[]).map(
      (b) => [b.artikel_id, Number(b.menge)],
    ),
  );

  /*
   * Beim Fahrzeug zählen die geführten Artikel — auch die mit Bestand
   * null. Genau dort steckt der interessante Fall: was rechnerisch leer
   * ist und tatsächlich noch daliegt.
   */
  const ids = new Set<string>(mengen.keys());
  for (const r of (regeln ?? []) as unknown as { artikel_id: string }[]) {
    ids.add(r.artikel_id);
  }

  const { data: artikel } =
    ids.size > 0
      ? await supabase
          .from("article")
          .select("id, sku, name, unit")
          .in("id", [...ids])
          .order("name")
      : { data: [] };

  return (
    <>
      <PageHeader
        title={`Inventur ${ort.name as string}`}
        subtitle={
          ort.letzte_inventur
            ? `zuletzt gezählt ${date(ort.letzte_inventur as string)}`
            : "noch nie gezählt"
        }
        actions={
          <Link
            href="/material"
            className="rounded-pill border border-line bg-surface px-5 py-[13px] text-sm font-medium text-ink transition-colors hover:bg-sunk"
          >
            Zum Lager
          </Link>
        }
      />

      <Zaehlblatt
        lagerortId={ort.id as string}
        zeilen={((artikel ?? []) as unknown as {
          id: string;
          sku: string;
          name: string;
          unit: string;
        }[]).map((a) => ({
          artikelId: a.id,
          sku: a.sku,
          bezeichnung: a.name,
          einheit: a.unit,
          soll: mengen.get(a.id) ?? 0,
        }))}
      />
    </>
  );
}
