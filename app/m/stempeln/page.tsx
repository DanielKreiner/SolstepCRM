import type { Metadata } from "next";
import { requireMe } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { Stempeluhr } from "./Stempeluhr";

export const metadata: Metadata = { title: "Stempeln" };

export default async function StempelnPage() {
  const me = await requireMe();
  const supabase = await createClient();

  const [{ data: vorgaenge }, { data: laufend }] = await Promise.all([
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
  ]);

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
      />
    </>
  );
}
