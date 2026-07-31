"use client";

import { useMemo, useOptimistic, useRef, useState, useTransition } from "react";
import Link from "next/link";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { eur, eurShort, date, initials } from "@/lib/format";
import type { Kind, Phase, PipelineCard } from "@/lib/pipeline";
import { moveCard } from "@/app/(app)/pipelines/[kind]/actions";

/*
 * cards tragen ihren Link bereits mit sich. Eine hrefFor-Funktion ließe sich
 * nicht von einer Server- an eine Client-Komponente übergeben.
 */
export type BoardCard = PipelineCard & { href: string };

type Props = {
  kind: Kind;
  phases: (Phase & { color: string })[];
  cards: BoardCard[];
  owners: Record<string, string>;
  canWrite: boolean;
};

export function Board({ kind, phases, cards, owners, canWrite }: Props) {
  const [optimistic, setOptimistic] = useOptimistic(
    cards,
    (state: BoardCard[], move: { id: string; phaseId: string }) =>
      state.map((c) => (c.id === move.id ? { ...c, phaseId: move.phaseId } : c)),
  );
  const [, startTransition] = useTransition();
  const [dragging, setDragging] = useState<BoardCard | null>(null);
  const [error, setError] = useState<string | null>(null);

  /*
   * Nach einem Drag feuert der Browser trotzdem ein click auf den Link — die
   * Karte würde sich beim Loslassen öffnen. Das Zeitfenster unterdrückt genau
   * diesen einen Klick, ohne den normalen Klick zum Öffnen zu verlieren.
   */
  const justDragged = useRef(false);

  // Ein Pixel Toleranz reicht nicht: sonst wird jeder Klick zum Drag und die
  // Karte öffnet sich nicht mehr.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const byPhase = useMemo(() => {
    const map = new Map<string, BoardCard[]>();
    for (const p of phases) map.set(p.id, []);
    const ohne: BoardCard[] = [];
    for (const c of optimistic) {
      if (c.phaseId && map.has(c.phaseId)) map.get(c.phaseId)!.push(c);
      else ohne.push(c);
    }
    return { map, ohne };
  }, [optimistic, phases]);

  function onDragStart(e: DragStartEvent) {
    const card = optimistic.find((c) => c.id === e.active.id);
    setDragging(card ?? null);
  }

  function onDragEnd(e: DragEndEvent) {
    setDragging(null);
    justDragged.current = true;
    window.setTimeout(() => {
      justDragged.current = false;
    }, 250);
    const cardId = String(e.active.id);
    const target = e.over ? String(e.over.id) : null;
    if (!target) return;

    const card = optimistic.find((c) => c.id === cardId);
    if (!card || card.phaseId === target) return;

    setError(null);
    startTransition(async () => {
      setOptimistic({ id: cardId, phaseId: target });
      const result = await moveCard(kind, cardId, target);
      // Bei Fehler zieht der Server-Refresh die Karte zurück; die Meldung
      // muss trotzdem sichtbar sein, sonst wirkt es wie ein Ruckler.
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <>
      {error ? (
        <p
          role="alert"
          className="mb-3 rounded-input bg-s-crit/10 px-[13px] py-[10px] text-[13px] font-medium text-s-crit"
        >
          {error}
        </p>
      ) : null}

      <DndContext
        sensors={sensors}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
      >
        <div className="flex items-start gap-[14px] overflow-x-auto pb-[10px]">
          {phases.map((phase) => {
            const list = byPhase.map.get(phase.id) ?? [];
            const sum = list.reduce((s, c) => s + c.valueNet, 0);
            return (
              <Column
                key={phase.id}
                phase={phase}
                count={list.length}
                sum={sum}
                showSum={kind !== "service"}
                canWrite={canWrite}
              >
                {list.map((card) => (
                  <Card
                    key={card.id}
                    card={card}
                    owner={card.ownerId ? owners[card.ownerId] : undefined}
                    color={phase.color}
                    draggable={canWrite}
                    suppressClick={justDragged}
                  />
                ))}
              </Column>
            );
          })}

          {byPhase.ohne.length > 0 ? (
            <div className="w-[282px] shrink-0">
              <div className="rounded-[18px] bg-surface p-4 shadow-soft">
                <div className="h-1 w-11 rounded-pill bg-s-crit" />
                <div className="mt-[11px] text-[14.5px] font-semibold">
                  Ohne Phase
                </div>
                <p className="mt-1 text-[11.5px] text-muted">
                  Nach dem Import zuzuordnen.
                </p>
              </div>
              <div className="mt-3 flex flex-col gap-3">
                {byPhase.ohne.map((card) => (
                  <Card
                    key={card.id}
                    card={card}
                    owner={card.ownerId ? owners[card.ownerId] : undefined}
                    color="var(--s-crit)"
                    draggable={canWrite}
                    suppressClick={justDragged}
                  />
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <DragOverlay dropAnimation={null}>
          {dragging ? (
            <div className="rotate-[3deg]">
              <CardBody
                card={dragging}
                owner={dragging.ownerId ? owners[dragging.ownerId] : undefined}
                color="var(--accent)"
              />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </>
  );
}

function Column({
  phase,
  count,
  sum,
  showSum,
  canWrite,
  children,
}: {
  phase: Phase & { color: string };
  count: number;
  sum: number;
  showSum: boolean;
  canWrite: boolean;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: phase.id });

  return (
    <div className="flex w-[282px] shrink-0 flex-col gap-3">
      <div className="rounded-[18px] bg-surface p-4 shadow-soft">
        <div
          className="h-1 w-11 rounded-pill"
          style={{ background: phase.color }}
        />
        <div className="mt-[11px] flex items-center gap-2">
          <span className="flex-1 text-[14.5px] font-semibold tracking-[-0.01em]">
            {phase.label}
          </span>
          <span className="num rounded-pill bg-panel px-[9px] py-[2px] text-[11.5px] text-muted">
            {count}
          </span>
        </div>
        {showSum ? (
          <div className="num mt-1 text-[11.5px] text-faint">
            {sum > 0 ? eurShort(sum) : "—"}
          </div>
        ) : null}
      </div>

      <div
        ref={setNodeRef}
        data-phase={phase.key}
        className={[
          "flex min-h-[120px] flex-col gap-3 rounded-[18px] transition-colors duration-200",
          isOver && canWrite ? "bg-accent-sunk outline-2 outline-accent" : "",
        ].join(" ")}
      >
        {children}
      </div>
    </div>
  );
}

function Card({
  card,
  owner,
  color,
  draggable,
  suppressClick,
}: {
  card: BoardCard;
  owner?: string | undefined;
  color: string;
  draggable: boolean;
  suppressClick: { current: boolean };
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: card.id,
    disabled: !draggable,
  });

  return (
    <div
      ref={setNodeRef}
      {...(draggable ? listeners : {})}
      {...(draggable ? attributes : {})}
      className={isDragging ? "opacity-30" : ""}
    >
      <Link
        href={card.href}
        className="block text-ink"
        onClick={(e) => {
          if (suppressClick.current) e.preventDefault();
        }}
      >
        <CardBody card={card} owner={owner} color={color} />
      </Link>
    </div>
  );
}

/*
 * Die Karte nach SPEC 4.2: Nummer, Kunde, Ort und Anlagengroesse, Wert,
 * naechster Schritt, Fortschritt Stunden ist/soll, Person,
 * Deckungsbeitrag-Ampel.
 *
 * Die Ampel traegt neben der Farbe immer die Zahl. Eine Karte, die nur
 * rot leuchtet, sagt einem Bauleiter nicht, ob es um zwei oder zwanzig
 * Prozentpunkte geht.
 */
function CardBody({
  card,
  owner,
  color,
}: {
  card: BoardCard;
  owner?: string | undefined;
  color: string;
}) {
  const plan = card.plannedHours ?? 0;
  const ist = card.hoursActual ?? 0;
  const fortschritt = plan > 0 ? (ist / plan) * 100 : null;
  const ueberzogen = fortschritt !== null && fortschritt > 100;

  return (
    <div className="flex cursor-pointer flex-col gap-[9px] rounded-[18px] bg-surface p-[15px] shadow-soft transition-transform duration-200 ease-out-quint hover:-translate-y-[2px]">
      <div className="flex items-center justify-between gap-2">
        <span className="num rounded-pill bg-panel px-[9px] py-[3px] text-[11px] text-muted">
          {card.number}
        </span>
        <span className="num truncate text-[11.5px] text-faint">
          {[card.city, card.kwp ? `${card.kwp} kWp` : null]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </div>

      <div className="text-[15.5px] leading-[1.25] font-semibold tracking-[-0.015em]">
        {card.customerName}
      </div>

      {card.note ? (
        <div className="line-clamp-2 text-[12.5px] text-muted">{card.note}</div>
      ) : null}

      {fortschritt !== null ? (
        <div>
          <div
            className="h-[5px] w-full overflow-hidden rounded-pill bg-sunk"
            role="img"
            aria-label={`Stunden ${Math.round(ist)} von ${Math.round(plan)}`}
          >
            <div
              className="h-full rounded-pill"
              style={{
                width: `${Math.min(100, fortschritt)}%`,
                background: ueberzogen
                  ? "var(--s-crit)"
                  : "linear-gradient(90deg,var(--accent-from),var(--accent-to))",
              }}
            />
          </div>
          <div className="num mt-[5px] flex justify-between text-[10.5px] text-faint">
            <span className={ueberzogen ? "text-s-crit" : undefined}>
              {Math.round(ist)} / {Math.round(plan)} h
            </span>
            <span className={ueberzogen ? "text-s-crit" : undefined}>
              {Math.round(fortschritt)} %
            </span>
          </div>
        </div>
      ) : null}

      <div className="num flex items-center justify-between gap-2 text-[11px] text-muted">
        <span>{card.valueNet > 0 ? eur(card.valueNet) : ""}</span>
        <span>{card.dueAt ? date(card.dueAt) : ""}</span>
      </div>

      <div className="flex items-center justify-between gap-2">
        {owner ? (
          <span
            className="flex h-[26px] w-[26px] items-center justify-center rounded-pill border-2 border-surface text-[10px] font-semibold text-white"
            style={{ background: color }}
            title={owner}
          >
            {initials(owner)}
          </span>
        ) : (
          <span />
        )}

        {card.marginPct !== null ? (
          <span
            title="Deckungsbeitrag nach Material"
            className={[
              "num rounded-pill px-[8px] py-[2px] text-[10.5px] font-semibold",
              card.marginPct >= 25
                ? "bg-s-done/12 text-s-done"
                : card.marginPct >= 12
                  ? "bg-accent/14 text-accent-ink"
                  : "bg-s-crit/12 text-s-crit",
            ].join(" ")}
          >
            DB {Math.round(card.marginPct)} %
          </span>
        ) : null}
      </div>
    </div>
  );
}
