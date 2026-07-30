import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Board } from "@/components/board/Board";
import { Timeline } from "@/components/board/Timeline";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { PageHeader } from "@/components/ui/PageHeader";
import { PhasePill } from "@/components/ui/PhasePill";
import { RingStat, Stat } from "@/components/ui/Stat";
import { date, eur, eurShort } from "@/lib/format";
import {
  KINDS,
  KIND_HREF,
  KIND_LABEL,
  isKind,
  loadCards,
  loadPhases,
  phaseColor,
  type PipelineCard,
} from "@/lib/pipeline";
import { requireMe } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Pipelines" };

const VIEWS = [
  ["board", "Board"],
  ["tabelle", "Tabelle"],
  ["timeline", "Timeline"],
] as const;

export default async function PipelinePage({
  params,
  searchParams,
}: {
  params: Promise<{ kind: string }>;
  searchParams: Promise<{
    ansicht?: string;
    verantwortlich?: string;
    von?: string;
    bis?: string;
    q?: string;
  }>;
}) {
  const me = await requireMe();
  const { kind } = await params;
  if (!isKind(kind)) notFound();

  const sp = await searchParams;
  const view = VIEWS.some(([v]) => v === sp.ansicht) ? sp.ansicht! : "board";

  const supabase = await createClient();
  const [phasesRaw, cards, { data: users }, counts] = await Promise.all([
    loadPhases(kind),
    loadCards(kind, {
      verantwortlich: sp.verantwortlich,
      von: sp.von,
      bis: sp.bis,
      q: sp.q,
    }),
    supabase.from("app_user").select("id, name").eq("active", true).order("name"),
    countByKind(),
  ]);

  const phases = phasesRaw.map((p) => ({ ...p, color: phaseColor(p.systemKey) }));
  const phaseById = new Map(phases.map((p) => [p.id, p]));

  const owners: Record<string, string> = {};
  for (const u of users ?? []) owners[u.id as string] = u.name as string;

  const offen = cards.filter(
    (c) => !(c.phaseId ? phaseById.get(c.phaseId)?.isFinal : false),
  );
  const gewonnen = cards.filter(
    (c) => phaseById.get(c.phaseId ?? "")?.systemKey === "won",
  );
  const verloren = cards.filter(
    (c) => phaseById.get(c.phaseId ?? "")?.systemKey === "lost",
  );

  const volumenOffen = offen.reduce((s, c) => s + c.valueNet, 0);
  const entschieden = gewonnen.length + verloren.length;
  const quote = entschieden > 0 ? (gewonnen.length / entschieden) * 100 : 0;

  const hrefFor = (c: PipelineCard) => KIND_HREF[c.kind](c.id);
  const boardCards = cards.map((c) => ({ ...c, href: hrefFor(c) }));

  const columns: Column<PipelineCard>[] = [
    {
      key: "nr",
      header: "Nummer",
      width: "140px",
      render: (c) => (
        <span className="num text-[13px] font-semibold">{c.number}</span>
      ),
    },
    {
      key: "kunde",
      header: "Kunde",
      width: "1.6fr",
      render: (c) => (
        <>
          <div className="text-sm font-medium">{c.customerName}</div>
          <div className="text-[12px] text-muted">{c.city ?? "—"}</div>
        </>
      ),
    },
    {
      key: "phase",
      header: "Phase",
      width: "190px",
      render: (c) => {
        const p = c.phaseId ? phaseById.get(c.phaseId) : undefined;
        return p ? (
          <PhasePill label={p.label} systemKey={p.systemKey} />
        ) : (
          <span className="text-[12.5px] text-s-crit">ohne Phase</span>
        );
      },
    },
    {
      key: "termin",
      header: kind === "vertrieb" ? "Gültig bis" : "Termin",
      width: "130px",
      render: (c) => (
        <span className="num text-[12.5px] text-muted">{date(c.dueAt)}</span>
      ),
    },
    {
      key: "wert",
      header: "Wert",
      width: "140px",
      align: "right",
      render: (c) => (
        <span className="num text-[13px] font-semibold">
          {c.valueNet > 0 ? eur(c.valueNet) : "—"}
        </span>
      ),
    },
  ];

  const filterActive = Boolean(sp.verantwortlich || sp.von || sp.bis || sp.q);

  return (
    <>
      <PageHeader
        title="Pipelines"
        subtitle={`${KIND_LABEL[kind]} · ${cards.length} Einträge${filterActive ? " · gefiltert" : ""} · Beträge exkl. USt.`}
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <nav className="flex gap-[3px] rounded-pill bg-surface p-1 shadow-soft">
          {KINDS.map((k) => (
            <Link
              key={k}
              href={`/pipelines/${k}${view !== "board" ? `?ansicht=${view}` : ""}`}
              className={[
                "flex items-center gap-[9px] rounded-pill px-[17px] py-[9px] text-[13.5px] transition-colors",
                k === kind
                  ? "bg-sunk font-semibold text-ink"
                  : "font-normal text-muted hover:text-ink",
              ].join(" ")}
            >
              <span
                aria-hidden
                className="h-2 w-2 rounded-pill"
                style={{
                  background:
                    k === "vertrieb"
                      ? "var(--s-waiting)"
                      : k === "projekte"
                        ? "var(--s-doing)"
                        : "var(--s-warn)",
                }}
              />
              {KIND_LABEL[k]}
              <span className="num text-[11px] opacity-70">{counts[k]}</span>
            </Link>
          ))}
        </nav>

        <nav className="flex gap-[3px] rounded-pill bg-surface p-1 shadow-soft">
          {VIEWS.map(([v, label]) => (
            <Link
              key={v}
              href={buildHref(kind, { ...sp, ansicht: v })}
              className={[
                "rounded-pill px-[15px] py-[9px] text-[13.5px] transition-colors",
                v === view
                  ? "bg-sunk font-semibold text-ink"
                  : "font-normal text-muted hover:text-ink",
              ].join(" ")}
            >
              {label}
            </Link>
          ))}
        </nav>

        {filterActive ? (
          <Link
            href={`/pipelines/${kind}?ansicht=${view}`}
            className="rounded-pill bg-surface px-[15px] py-[10px] text-[13px] text-muted shadow-soft transition-colors hover:text-ink"
          >
            Filter zurücksetzen
          </Link>
        ) : null}
      </div>

      <div className="mb-4 grid gap-[10px] sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Offen" value={offen.length} />
        <Stat label="Volumen offen" value={eurShort(volumenOffen)} />
        <Stat label="Gewonnen" value={gewonnen.length} tone="done" />
        <div className="rounded-input bg-panel px-[14px] py-3">
          <RingStat
            label="Erfolgsquote"
            percent={quote}
            center={`${Math.round(quote)}%`}
            tone={quote >= 50 ? "done" : "crit"}
          />
        </div>
      </div>

      {view === "board" ? (
        <Board
          kind={kind}
          phases={phases}
          cards={boardCards}
          owners={owners}
          canWrite={me.perms.pipelines === "write"}
        />
      ) : view === "timeline" ? (
        <Timeline cards={cards} phases={phases} hrefFor={hrefFor} />
      ) : (
        <DataTable
          columns={columns}
          rows={cards}
          getKey={(c) => c.id}
          hrefFor={hrefFor}
          empty="Keine Einträge."
        />
      )}
    </>
  );
}

function buildHref(
  kind: string,
  sp: Record<string, string | undefined>,
): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (v) params.set(k, v);
  const q = params.toString();
  return `/pipelines/${kind}${q ? `?${q}` : ""}`;
}

async function countByKind(): Promise<Record<string, number>> {
  const supabase = await createClient();
  const { data } = await supabase.from("v_pipeline_card").select("kind");
  const counts: Record<string, number> = { vertrieb: 0, projekte: 0, service: 0 };
  for (const r of data ?? []) {
    const k = r.kind as string;
    counts[k] = (counts[k] ?? 0) + 1;
  }
  return counts;
}
