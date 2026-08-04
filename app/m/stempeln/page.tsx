import type { Metadata } from "next";
import { viennaDay } from "@/lib/format";
import { requireMe } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { endOfViennaDay, startOfViennaDay } from "@/lib/time";
import { Stempeluhr } from "./Stempeluhr";

export const metadata: Metadata = { title: "Stempeln" };

export default async function StempelnPage() {
  const me = await requireMe();
  const supabase = await createClient();
  const heute = viennaDay();

  const [{ data: vorgaenge }, { data: laufend }, { data: einsaetze }] =
    await Promise.all([
      supabase
        .from("vorgang")
        .select("id, number, customer:customer_id ( name )")
        .in("phase", ["aufnahme", "beauftragt", "montage"])
        .order("number", { ascending: false })
        .limit(30),
      supabase
        .from("time_entry")
        .select("id, started_at, vorgang_id")
        .eq("user_id", me.id)
        .eq("status", "running")
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      /*
       * Das Fahrzeug des heutigen Einsatzes. Davon hängt ab, welcher
       * Van-Stock nach dem Ausstempeln zur Meldung angeboten wird —
       * Kabel von Bus 2 hat dieser Monteur nicht verbraucht.
       */
      supabase
        .from("einsatz")
        .select("id, fahrzeug_id, fahrzeug:fahrzeug_id ( name ), personen:einsatz_person ( user_id )")
        .eq("art", "auftrag")
        .gte("von", startOfViennaDay(heute).toISOString())
        .lte("von", endOfViennaDay(heute).toISOString())
        .not("fahrzeug_id", "is", null)
        .order("von"),
    ]);

  const meiner = ((einsaetze ?? []) as unknown as {
    id: string;
    fahrzeug_id: string;
    fahrzeug: { name: string } | null;
    personen: { user_id: string }[];
  }[]).find((e) => e.personen.some((p) => p.user_id === me.id));

  let fahrzeug: {
    name: string;
    lagerortId: string;
    artikel: { artikelId: string; bezeichnung: string; einheit: string; bestand: number }[];
  } | null = null;

  if (meiner) {
    const { data: ort } = await supabase
      .from("lagerort")
      .select("id")
      .eq("fahrzeug_id", meiner.fahrzeug_id)
      .maybeSingle();

    if (ort) {
      const { data: bestand } = await supabase
        .from("v_bestand")
        .select("artikel_id, menge")
        .eq("lagerort_id", ort.id);

      const zeilen = (bestand ?? []) as unknown as {
        artikel_id: string;
        menge: string;
      }[];

      const { data: artikel } =
        zeilen.length > 0
          ? await supabase
              .from("article")
              .select("id, name, unit, typ")
              .in(
                "id",
                zeilen.map((z) => z.artikel_id),
              )
          : { data: [] };

      const stamm = new Map(
        ((artikel ?? []) as unknown as {
          id: string;
          name: string;
          unit: string;
          typ: string;
        }[]).map((a) => [a.id, a]),
      );

      fahrzeug = {
        name: meiner.fahrzeug?.name ?? "Fahrzeug",
        lagerortId: ort.id as string,
        artikel: zeilen
          .filter((z) => stamm.get(z.artikel_id)?.typ === "vanstock")
          .map((z) => ({
            artikelId: z.artikel_id,
            bezeichnung: stamm.get(z.artikel_id)?.name ?? "Artikel",
            einheit: stamm.get(z.artikel_id)?.unit ?? "Stk",
            bestand: Number(z.menge),
          })),
      };
    }
  }

  return (
    <>
      <h1 className="mb-4 text-[24px] font-bold tracking-[-0.02em]">Stempeln</h1>
      <Stempeluhr
        jobs={(vorgaenge ?? []).map((j) => ({
          id: j.id as string,
          number: j.number as string,
          customer:
            (j.customer as unknown as { name: string } | null)?.name ?? "",
        }))}
        laufendSeit={(laufend?.started_at as string | null) ?? null}
        laufendJob={(laufend?.vorgang_id as string | null) ?? null}
        fahrzeug={fahrzeug}
        einsatzId={meiner?.id ?? null}
      />
    </>
  );
}
