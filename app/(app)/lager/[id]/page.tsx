import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pill } from "@/components/ui/Pill";
import { Stat } from "@/components/ui/Stat";
import { dateTime, eur, num } from "@/lib/format";
import { requireMe } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { StockMoveForm } from "../StockMoveForm";

export const metadata: Metadata = { title: "Artikel" };

type MoveRow = {
  id: string;
  qty: string;
  kind: string;
  note: string | null;
  created_at: string;
  job: { id: string; number: string } | null;
  person: { name: string } | null;
};

const MOVE_LABEL: Record<string, string> = {
  out: "Entnahme",
  return: "Rückgabe",
  goods_in: "Wareneingang",
  correction: "Korrektur",
};

export default async function ArtikelPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const me = await requireMe();
  const { id } = await params;
  const supabase = await createClient();

  const { data: article } = await supabase
    .from("article")
    .select(
      "id, sku, name, manufacturer, category, unit, stock, min_stock, location_code, purchase_price, sale_price, vat_rate",
    )
    .eq("id", id)
    .maybeSingle();

  if (!article) notFound();

  const [{ data: moves }, { data: jobs }] = await Promise.all([
    supabase
      .from("stock_move")
      .select(
        `id, qty, kind, note, created_at,
         job:job_id ( id, number ),
         person:user_id ( name )`,
      )
      .eq("article_id", id)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("job")
      .select("id, number, customer:customer_id ( name )")
      .order("number", { ascending: false })
      .limit(100),
  ]);

  const rows = (moves ?? []) as unknown as MoveRow[];

  const stock = Number(article.stock);
  const min = Number(article.min_stock);
  const ek = Number(article.purchase_price);
  const vk = Number(article.sale_price);
  const marge = vk > 0 ? ((vk - ek) / vk) * 100 : 0;

  const columns: Column<MoveRow>[] = [
    {
      key: "zeit",
      header: "Gebucht",
      width: "160px",
      render: (m) => (
        <span className="num text-[12.5px]">{dateTime(m.created_at)}</span>
      ),
    },
    {
      key: "art",
      header: "Art",
      width: "140px",
      render: (m) => (
        <Pill tone={m.kind === "out" ? "warn" : "done"}>
          {MOVE_LABEL[m.kind] ?? m.kind}
        </Pill>
      ),
    },
    {
      key: "menge",
      header: "Menge",
      width: "120px",
      align: "right",
      render: (m) => (
        <span
          className={`num text-[13px] font-semibold ${m.kind === "out" ? "text-s-crit" : "text-s-done"}`}
        >
          {m.kind === "out" ? "−" : "+"}
          {num(m.qty)}
        </span>
      ),
    },
    {
      key: "auftrag",
      header: "Auftrag",
      width: "140px",
      render: (m) =>
        m.job ? (
          <Link
            href={`/auftraege/${m.job.id}`}
            className="num text-[12.5px] text-accent-ink hover:underline"
          >
            {m.job.number}
          </Link>
        ) : (
          <span className="text-[12.5px] text-faint">—</span>
        ),
    },
    {
      key: "person",
      header: "Person",
      width: "1fr",
      render: (m) => (
        <span className="text-[12.5px] text-muted">{m.person?.name ?? "—"}</span>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title={article.name as string}
        subtitle={`${article.manufacturer ?? "—"} · ${article.category ?? "—"} · Preise exkl. USt.`}
        actions={
          <Link
            href="/lager"
            className="rounded-pill border border-line bg-surface px-5 py-[13px] text-sm font-medium text-ink transition-colors hover:bg-sunk"
          >
            Zum Lager
          </Link>
        }
      />

      <div className="mb-4 grid gap-[10px] sm:grid-cols-2 xl:grid-cols-5">
        <Stat
          label="Bestand"
          value={`${num(stock)} ${article.unit}`}
          tone={stock <= min ? "crit" : "done"}
        />
        <Stat label="Mindestbestand" value={`${num(min)} ${article.unit}`} />
        <Stat label="Einkauf" value={eur(ek)} />
        <Stat label="Verkauf" value={eur(vk)} />
        <Stat
          label="Rohaufschlag"
          value={`${Math.round(marge)} %`}
          tone={marge < 15 ? "warn" : undefined}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.7fr_1fr] xl:items-start">
        <section>
          <h2 className="mb-2 text-[15px] font-semibold">
            Bewegungen{" "}
            <span className="num font-normal text-muted">({rows.length})</span>
          </h2>
          <DataTable
            columns={columns}
            rows={rows}
            getKey={(m) => m.id}
            empty="Für diesen Artikel gibt es noch keine Bewegung."
            compact
          />
        </section>

        {me.perms.lager === "write" ? (
          <StockMoveForm
            articles={[]}
            jobs={(jobs ?? []).map((j) => ({
              id: j.id as string,
              label: `${j.number as string} · ${(j.customer as unknown as { name: string } | null)?.name ?? ""}`,
            }))}
            fixedArticleId={article.id as string}
            unit={article.unit as string}
          />
        ) : null}
      </div>
    </>
  );
}
