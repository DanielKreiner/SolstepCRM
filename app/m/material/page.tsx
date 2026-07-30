import type { Metadata } from "next";
import { requireMe } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { MaterialForm } from "./MaterialForm";

export const metadata: Metadata = { title: "Material" };

export default async function MaterialPage() {
  await requireMe();
  const supabase = await createClient();

  const [{ data: articles }, { data: jobs }] = await Promise.all([
    supabase
      .from("article")
      .select("id, sku, name, unit")
      .eq("active", true)
      .order("name"),
    supabase
      .from("job")
      .select("id, number, customer:customer_id ( name )")
      .order("scheduled_from", { ascending: true, nullsFirst: false })
      .limit(30),
  ]);

  return (
    <>
      <h1 className="mb-4 text-[24px] font-bold tracking-[-0.02em]">Material</h1>
      <MaterialForm
        articles={(articles ?? []).map((a) => ({
          id: a.id as string,
          label: `${a.sku as string} · ${a.name as string}`,
          unit: a.unit as string,
        }))}
        jobs={(jobs ?? []).map((j) => ({
          id: j.id as string,
          label: `${j.number as string} · ${(j.customer as unknown as { name: string } | null)?.name ?? ""}`,
        }))}
      />
    </>
  );
}
