import type { Metadata } from "next";
import Link from "next/link";
import { LinkButton } from "@/components/ui/Button";
import { KpiKarte } from "@/components/ui/KpiKarte";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pill } from "@/components/ui/Pill";
import { Reiter } from "@/components/ui/Reiter";
import { dateTime, eur, eurShort, num } from "@/lib/format";
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

const REITER = ["bestand", "artikel", "bewegungen"] as const;
type ReiterKey = (typeof REITER)[number];

const BEWEGUNG_LABEL: Record<string, string> = {
  out: "Entnahme",
  return: "Rückgabe",
  goods_in: "Wareneingang",
  correction: "Korrektur",
};

const BEWEGUNG_TON: Record<string, "crit" | "done" | "doing" | "warn"> = {
  out: "crit",
  return: "done",
  goods_in: "doing",
  correction: "warn",
};

export default async function LagerPage({
  searchParams,
}: {
  searchParams: Promise<{ reiter?: string }>;
}) {
  const me = await requireMe();
  const supabase = await createClient();
  const { reiter: roh } = await searchParams;
  const reiter: ReiterKey = REITER.includes(roh as ReiterKey)
    ? (roh as ReiterKey)
    : "bestand";

  const [
    { data: articles },
    { data: jobs },
    { data: reservierungen },
    { data: bewegungen },
    { count: offeneBestellungen },
  ] = await Promise.all([
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
    supabase
      .from("stock_reservation")
      .select("article_id, qty, job:job_id ( number )")
      .is("released_at", null),
    supabase
      .from("stock_move")
      .select(
        "id, qty, kind, note, created_at, article:article_id ( sku, name, unit ), job:job_id ( id, number ), user:user_id ( name )",
      )
      .order("created_at", { ascending: false })
      .limit(60),
    supabase
      .from("purchase_order")
      .select("id", { count: "exact", head: true })
      .not("status", "in", "(received,cancelled)"),
  ]);

  const rows = (articles ?? []) as unknown as Article[];

  /*
   * Reserviert ist nicht dasselbe wie entnommen: die Ware liegt noch im
   * Regal, ist aber einem terminierten Auftrag zugesagt. Ohne diese Spalte
   * sieht das Lager voller aus, als es disponibel ist — und genau daran
   * scheitert dann die Kommissionierung.
   */
  const reserviertJe = new Map<string, number>();
  for (const r of reservierungen ?? []) {
    const id = r.article_id as string;
    reserviertJe.set(id, (reserviertJe.get(id) ?? 0) + Number(r.qty));
  }

  const unterMindest = rows.filter(
    (a) => Number(a.stock) <= Number(a.min_stock),
  );
  const lagerwert = rows.reduce(
    (s, a) => s + Number(a.stock) * Number(a.purchase_price),
    0,
  );
  const reserviertGesamt = [...reserviertJe.values()].reduce((s, v) => s + v, 0);

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
        subtitle="Bestand, Artikel, Bewegungen, Bestellungen"
        actions={
          <>
            <LinkButton href="/lager/bestellungen">Bestellvorschlag</LinkButton>
            {unterMindest.length > 0 ? (
              <span className="flex items-center gap-[9px] rounded-pill bg-surface px-4 py-[11px] shadow-soft">
                <span
                  aria-hidden
                  className="h-[9px] w-[9px] rounded-pill bg-s-crit"
                />
                <span className="text-[13px] font-medium">
                  {unterMindest.length} unter Mindestbestand
                </span>
              </span>
            ) : null}
          </>
        }
      />

      <div className="mb-4 grid gap-[10px] sm:grid-cols-2 xl:grid-cols-4">
        <KpiKarte
          akzent
          label="Lagerwert"
          wert={eurShort(lagerwert)}
          pille={`${rows.length} Artikel`}
          notiz="zum Einkaufspreis"
        />
        <KpiKarte
          label="Unter Mindestbestand"
          wert={unterMindest.length}
          pille={unterMindest.length > 0 ? "nachbestellen" : "Bestand gedeckt"}
          ton={unterMindest.length > 0 ? "kritisch" : "gut"}
          notiz="Vorschlag im Reiter Bestellungen"
          href="/lager/bestellungen"
        />
        <KpiKarte
          label="Reserviert"
          wert={num(Math.round(reserviertGesamt * 10) / 10)}
          pille={`${reserviertJe.size} Artikel`}
          notiz="zugesagt an terminierte Aufträge"
        />
        <KpiKarte
          label="Offene Bestellungen"
          wert={offeneBestellungen ?? 0}
          notiz="bestellt, noch nicht eingetroffen"
          href="/lager/bestellungen"
        />
      </div>

      <Reiter
        aktiv={reiter}
        eintraege={[
          { key: "bestand", label: "Bestand", href: "/lager" },
          { key: "artikel", label: "Artikel", href: "/lager?reiter=artikel" },
          {
            key: "bewegungen",
            label: "Bewegungen",
            href: "/lager?reiter=bewegungen",
          },
          {
            key: "bestellungen",
            label: "Bestellungen",
            href: "/lager/bestellungen",
            anzahl: offeneBestellungen ?? 0,
          },
        ]}
      />

      {unterMindest.length > 0 ? (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-[20px] bg-s-crit/8 px-5 py-4">
          <span aria-hidden className="h-[9px] w-[9px] rounded-pill bg-s-crit" />
          <span className="text-[13.5px] font-semibold">
            {unterMindest.length}{" "}
            {unterMindest.length === 1 ? "Artikel" : "Artikel"} unter
            Mindestbestand
          </span>
          {/*
            Nicht die Fehlmenge ausrechnen: der Alarm greift schon beim
            Erreichen des Mindestbestands, dort ist die Fehlmenge null, und
            "0× fehlen" ist keine Meldung. Bestand gegen Mindestbestand sagt
            in beiden Fällen die Wahrheit.
          */}
          <span className="num text-[12px] text-muted">
            {unterMindest
              .slice(0, 3)
              .map((a) => `${a.sku} ${num(a.stock)}/${num(a.min_stock)}`)
              .join(" · ")}
          </span>
          <Link
            href="/lager/bestellungen"
            className="ml-auto text-[12.5px] font-medium"
          >
            Zum Bestellvorschlag
          </Link>
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[1.7fr_1fr] xl:items-start">
        <div className="overflow-x-auto rounded-[20px] bg-surface shadow-soft">
          {reiter === "bestand" ? (
            <BestandTabelle rows={rows} reserviertJe={reserviertJe} />
          ) : reiter === "artikel" ? (
            <ArtikelTabelle rows={rows} />
          ) : (
            <BewegungenTabelle bewegungen={bewegungen ?? []} />
          )}
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

function Kopf({ spalten }: { spalten: [string, boolean][] }) {
  return (
    <div
      className="grid border-b border-line px-4 text-[11px] tracking-[0.07em] text-faint uppercase"
      style={{ gridTemplateColumns: "var(--spalten)" }}
    >
      {spalten.map(([h, rechts]) => (
        <div key={h} className={`px-2 py-[14px] ${rechts ? "text-right" : ""}`}>
          {h}
        </div>
      ))}
    </div>
  );
}

const BESTAND_SPALTEN = "1.7fr 150px 100px 100px 100px 120px 110px";

function BestandTabelle({
  rows,
  reserviertJe,
}: {
  rows: Article[];
  reserviertJe: Map<string, number>;
}) {
  if (rows.length === 0) {
    return (
      <p className="px-6 py-8 text-[13.5px] text-muted">
        Noch keine Artikel angelegt.
      </p>
    );
  }

  return (
    <div className="min-w-[940px]" style={{ ["--spalten" as string]: BESTAND_SPALTEN }}>
      <Kopf
        spalten={[
          ["Bezeichnung", false],
          ["Artikelnr.", false],
          ["Bestand", true],
          ["Reserviert", true],
          ["Verfügbar", true],
          ["Lagerort", false],
          ["EK", true],
        ]}
      />
      {rows.map((a) => {
        const bestand = Number(a.stock);
        const min = Number(a.min_stock);
        const reserviert = reserviertJe.get(a.id) ?? 0;
        const verfuegbar = bestand - reserviert;
        const balken = min > 0 ? Math.min(100, (bestand / (min * 2)) * 100) : 100;
        const farbe =
          bestand <= min
            ? "var(--s-crit)"
            : bestand <= min * 1.3
              ? "var(--s-warn)"
              : "var(--s-done)";

        return (
          <Link
            key={a.id}
            href={`/lager/${a.id}`}
            className="grid items-center border-b border-line px-4 text-ink transition-colors last:border-b-0 hover:bg-panel hover:text-ink"
            style={{ gridTemplateColumns: BESTAND_SPALTEN }}
          >
            <div className="min-w-0 px-2 py-3">
              <div className="truncate text-[13.5px] font-medium">{a.name}</div>
              <div className="mt-[7px] h-[6px] max-w-[230px] overflow-hidden rounded-pill bg-panel">
                <div
                  className="h-full rounded-pill"
                  style={{ width: `${balken}%`, background: farbe }}
                />
              </div>
            </div>
            <div className="num px-2 py-3 text-[12px] text-muted">{a.sku}</div>
            <div
              className={`num px-2 py-3 text-right text-[13.5px] font-semibold ${bestand <= min ? "text-s-crit" : ""}`}
            >
              {num(bestand)}
            </div>
            <div className="num px-2 py-3 text-right text-[12.5px] text-muted">
              {reserviert > 0 ? num(reserviert) : "—"}
            </div>
            <div
              className={`num px-2 py-3 text-right text-[13px] font-semibold ${verfuegbar < 0 ? "text-s-crit" : ""}`}
            >
              {num(verfuegbar)}
            </div>
            <div className="num px-2 py-3 text-[12px] text-muted">
              {a.location_code ?? "—"}
            </div>
            <div className="num px-2 py-3 text-right text-[12.5px]">
              {eur(a.purchase_price)}
            </div>
          </Link>
        );
      })}
    </div>
  );
}

const ARTIKEL_SPALTEN = "1.7fr 150px 1fr 140px 110px 110px 90px";

function ArtikelTabelle({ rows }: { rows: Article[] }) {
  if (rows.length === 0) {
    return (
      <p className="px-6 py-8 text-[13.5px] text-muted">
        Noch keine Artikel angelegt.
      </p>
    );
  }

  return (
    <div className="min-w-[980px]" style={{ ["--spalten" as string]: ARTIKEL_SPALTEN }}>
      <Kopf
        spalten={[
          ["Bezeichnung", false],
          ["Artikelnr.", false],
          ["Hersteller", false],
          ["Kategorie", false],
          ["EK", true],
          ["VK", true],
          ["Marge", true],
        ]}
      />
      {rows.map((a) => {
        const ek = Number(a.purchase_price);
        const vk = Number(a.sale_price);
        const marge = vk > 0 ? Math.round(((vk - ek) / vk) * 100) : null;
        return (
          <Link
            key={a.id}
            href={`/lager/${a.id}`}
            className="grid items-center border-b border-line px-4 text-ink transition-colors last:border-b-0 hover:bg-panel hover:text-ink"
            style={{ gridTemplateColumns: ARTIKEL_SPALTEN }}
          >
            <div className="min-w-0 truncate px-2 py-3 text-[13.5px] font-medium">
              {a.name}
            </div>
            <div className="num px-2 py-3 text-[12px] text-muted">{a.sku}</div>
            <div className="min-w-0 truncate px-2 py-3 text-[12.5px] text-muted">
              {a.manufacturer ?? "—"}
            </div>
            <div className="min-w-0 truncate px-2 py-3 text-[12.5px] text-muted">
              {a.category ?? "—"}
            </div>
            <div className="num px-2 py-3 text-right text-[12.5px]">{eur(ek)}</div>
            <div className="num px-2 py-3 text-right text-[12.5px]">{eur(vk)}</div>
            <div
              className={`num px-2 py-3 text-right text-[12.5px] ${marge !== null && marge < 10 ? "text-s-crit" : ""}`}
            >
              {marge === null ? "—" : `${marge} %`}
            </div>
          </Link>
        );
      })}
    </div>
  );
}

type Bewegung = {
  id: string;
  qty: string;
  kind: string;
  note: string | null;
  created_at: string;
  article: { sku: string; name: string; unit: string } | null;
  job: { id: string; number: string } | null;
  user: { name: string } | null;
};

const BEWEGUNG_SPALTEN = "150px 1.6fr 120px 130px 150px 1fr";

function BewegungenTabelle({ bewegungen }: { bewegungen: unknown[] }) {
  const zeilen = bewegungen as unknown as Bewegung[];

  if (zeilen.length === 0) {
    return (
      <p className="px-6 py-8 text-[13.5px] text-muted">
        Noch keine Bewegung gebucht.
      </p>
    );
  }

  return (
    <div className="min-w-[940px]" style={{ ["--spalten" as string]: BEWEGUNG_SPALTEN }}>
      <Kopf
        spalten={[
          ["Zeitpunkt", false],
          ["Artikel", false],
          ["Menge", true],
          ["Art", false],
          ["Auftrag", false],
          ["Person", false],
        ]}
      />
      {zeilen.map((b) => (
        <div
          key={b.id}
          className="grid items-center border-b border-line px-4 last:border-b-0"
          style={{ gridTemplateColumns: BEWEGUNG_SPALTEN }}
        >
          <div className="num px-2 py-3 text-[12px] text-muted">
            {dateTime(b.created_at)}
          </div>
          <div className="min-w-0 px-2 py-3">
            <div className="truncate text-[13px] font-medium">
              {b.article?.name ?? "—"}
            </div>
            <div className="num truncate text-[11px] text-faint">
              {b.article?.sku ?? ""}
            </div>
          </div>
          <div
            className={`num px-2 py-3 text-right text-[13px] font-semibold ${b.kind === "out" ? "text-s-crit" : "text-s-done"}`}
          >
            {b.kind === "out" ? "−" : "+"}
            {num(b.qty)} {b.article?.unit ?? ""}
          </div>
          <div className="px-2 py-3">
            <Pill tone={BEWEGUNG_TON[b.kind] ?? "neutral"}>
              {BEWEGUNG_LABEL[b.kind] ?? b.kind}
            </Pill>
          </div>
          <div className="num px-2 py-3 text-[12.5px]">
            {b.job ? (
              <Link href={`/auftraege/${b.job.id}`}>{b.job.number}</Link>
            ) : (
              <span className="text-faint">ohne Auftrag</span>
            )}
          </div>
          <div className="min-w-0 truncate px-2 py-3 text-[12.5px] text-muted">
            {b.user?.name ?? "—"}
            {b.note ? ` · ${b.note}` : ""}
          </div>
        </div>
      ))}
    </div>
  );
}
