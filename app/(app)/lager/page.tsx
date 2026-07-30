import type { Metadata } from "next";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pill } from "@/components/ui/Pill";
import { Stat } from "@/components/ui/Stat";
import { eur, num } from "@/lib/format";
import { requireMe } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { StockMoveForm } from "./StockMoveForm";

export const metadata: Metadata = { title: "Lager" };

type Article = {
  id: string;
  sku: string;
  name: string;
  manufacturer: string | null;
  category: string | null;
  unit: string;
  stock: string;
  min_stock: string;
  location_code: string | null;
  purchase_price: string;
  sale_price: string;
};

export default async function LagerPage() {
  const me = await requireMe();
  const supabase = await createClient();

  const [{ data: articles }, { data: jobs }] = await Promise.all([
    supabase
      .from("article")
      .select(
        "id, sku, name, manufacturer, category, unit, stock, min_stock, location_code, purchase_price, sale_price",
      )
      .eq("active", true)
      .order("name"),
    supabase
      .from("job")
      .select("id, number, customer:customer_id ( name )")
      .order("number", { ascending: false })
      .limit(100),
  ]);

  const rows = (articles ?? []) as unknown as Article[];
  const unterMindest = rows.filter(
    (a) => Number(a.stock) <= Number(a.min_stock),
  );
  const lagerwert = rows.reduce(
    (s, a) => s + Number(a.stock) * Number(a.purchase_price),
    0,
  );

  const columns: Column<Article>[] = [
    {
      key: "name",
      header: "Bezeichnung",
      width: "1.7fr",
      render: (a) => {
        const stock = Number(a.stock);
        const min = Number(a.min_stock);
        const pct = min > 0 ? Math.min(100, (stock / (min * 2)) * 100) : 100;
        const color =
          stock <= min ? "var(--s-crit)" : stock <= min * 1.3 ? "var(--s-warn)" : "var(--s-done)";
        return (
          <>
            <div className="text-sm font-medium">{a.name}</div>
            <div className="mt-[7px] h-[6px] max-w-[230px] overflow-hidden rounded-pill bg-panel">
              <div
                className="h-full rounded-pill"
                style={{ width: `${pct}%`, background: color }}
              />
            </div>
          </>
        );
      },
    },
    {
      key: "sku",
      header: "Artikelnr.",
      width: "150px",
      render: (a) => (
        <span className="num text-[12.5px] text-muted">{a.sku}</span>
      ),
    },
    {
      key: "stock",
      header: "Bestand",
      width: "110px",
      align: "right",
      render: (a) => {
        const stock = Number(a.stock);
        const min = Number(a.min_stock);
        return (
          <span
            className={`num text-[13.5px] font-semibold ${stock <= min ? "text-s-crit" : "text-s-done"}`}
          >
            {num(stock)}
          </span>
        );
      },
    },
    {
      key: "min",
      header: "Mindest",
      width: "100px",
      align: "right",
      render: (a) => (
        <span className="num text-[12.5px] text-muted">{num(a.min_stock)}</span>
      ),
    },
    {
      key: "einheit",
      header: "Einheit",
      width: "90px",
      render: (a) => (
        <span className="num text-[12px] text-muted">{a.unit}</span>
      ),
    },
    {
      key: "ort",
      header: "Lagerort",
      width: "110px",
      render: (a) => (
        <span className="num text-[12px] text-muted">
          {a.location_code ?? "—"}
        </span>
      ),
    },
    {
      key: "ek",
      header: "EK",
      width: "110px",
      align: "right",
      render: (a) => (
        <span className="num text-[12.5px]">{eur(a.purchase_price)}</span>
      ),
    },
  ];

  const articleOptions = rows.map((a) => ({
    id: a.id,
    label: `${a.sku} · ${a.name}`,
  }));
  const jobOptions = (jobs ?? []).map((j) => ({
    id: j.id as string,
    label: `${j.number as string} · ${(j.customer as unknown as { name: string } | null)?.name ?? ""}`,
  }));

  return (
    <>
      <PageHeader
        title="Lager"
        subtitle={`${rows.length} aktive Artikel · Preise exkl. USt.`}
        actions={
          unterMindest.length > 0 ? (
            <div className="flex items-center gap-3 rounded-pill bg-surface px-4 py-[9px] shadow-soft">
              <span className="h-[9px] w-[9px] rounded-pill bg-s-crit" />
              <span className="text-[13px] font-medium">
                {unterMindest.length}{" "}
                {unterMindest.length === 1 ? "Artikel" : "Artikel"} unter
                Mindestbestand
              </span>
            </div>
          ) : null
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-[10px] lg:grid-cols-4">
        <Stat label="Artikel" value={rows.length} />
        <Stat
          label="Unter Mindestbestand"
          value={unterMindest.length}
          tone={unterMindest.length > 0 ? "crit" : "done"}
        />
        <Stat label="Lagerwert (EK)" value={eur(lagerwert)} />
        <Stat
          label="Kategorien"
          value={new Set(rows.map((a) => a.category).filter(Boolean)).size}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.7fr_1fr] xl:items-start">
        <div className="flex flex-col gap-4">
          {unterMindest.length > 0 ? (
            <div className="rounded-[20px] bg-surface p-5 shadow-soft">
              <h2 className="mb-3 text-[15px] font-semibold">
                Unter Mindestbestand
              </h2>
              <div className="flex flex-wrap gap-2">
                {unterMindest.map((a) => (
                  <Pill key={a.id} tone="crit" mono>
                    {a.sku} · {num(a.stock)} von {num(a.min_stock)}
                  </Pill>
                ))}
              </div>
            </div>
          ) : null}

          <DataTable
            columns={columns}
            rows={rows}
            getKey={(a) => a.id}
            hrefFor={(a) => `/lager/${a.id}`}
            empty="Noch keine Artikel angelegt."
          />
        </div>

        {me.perms.lager === "write" ? (
          <StockMoveForm articles={articleOptions} jobs={jobOptions} />
        ) : (
          <div className="rounded-[20px] bg-surface p-[22px] text-[13px] text-muted shadow-soft">
            Für Lagerbuchungen fehlt deiner Rolle das Schreibrecht.
          </div>
        )}
      </div>
    </>
  );
}
