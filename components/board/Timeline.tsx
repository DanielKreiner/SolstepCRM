import Link from "next/link";
import { date, eurShort } from "@/lib/format";
import type { PipelineCard, Phase } from "@/lib/pipeline";

/*
 * Dritter Renderer über dieselbe Liste. Gruppiert nach Kalenderwoche des
 * Fälligkeits- bzw. Termindatums. Karten ohne Datum stehen am Ende — sie
 * verschwinden nicht, sondern werden als "ohne Termin" sichtbar.
 */
export function Timeline({
  cards,
  phases,
  hrefFor,
}: {
  cards: PipelineCard[];
  phases: (Phase & { color: string })[];
  hrefFor: (c: PipelineCard) => string;
}) {
  const phaseById = new Map(phases.map((p) => [p.id, p]));

  const mit = cards.filter((c) => c.dueAt);
  const ohne = cards.filter((c) => !c.dueAt);

  const groups = new Map<string, PipelineCard[]>();
  for (const c of mit) {
    const key = weekKey(c.dueAt!);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(c);
  }

  const sorted = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  return (
    <div className="flex flex-col gap-4">
      {sorted.length === 0 && ohne.length === 0 ? (
        <p className="rounded-[20px] bg-surface p-6 text-[13.5px] text-muted shadow-soft">
          Keine Einträge im gewählten Zeitraum.
        </p>
      ) : null}

      {sorted.map(([week, list]) => (
        <section key={week} className="rounded-[20px] bg-surface p-5 shadow-soft">
          <div className="mb-3 flex items-center gap-3">
            <h2 className="num text-[13px] font-semibold">{weekLabel(week)}</h2>
            <span className="h-px flex-1 bg-line" />
            <span className="num text-[11.5px] text-faint">
              {list.length} · {eurShort(list.reduce((s, c) => s + c.valueNet, 0))}
            </span>
          </div>
          <ul className="flex flex-col gap-2">
            {list.map((c) => {
              const phase = c.phaseId ? phaseById.get(c.phaseId) : undefined;
              return (
                <li key={c.id}>
                  <Link
                    href={hrefFor(c)}
                    className="flex flex-wrap items-center gap-3 rounded-input bg-panel px-4 py-3 text-ink transition-colors hover:bg-sunk"
                  >
                    <span
                      aria-hidden
                      className="h-[26px] w-1 shrink-0 rounded-pill"
                      style={{ background: phase?.color ?? "var(--s-new)" }}
                    />
                    <span className="num w-[92px] shrink-0 text-[12.5px] text-muted">
                      {date(c.dueAt)}
                    </span>
                    <span className="num text-[13px] font-semibold">
                      {c.number}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[13px]">
                      {c.customerName}
                    </span>
                    {phase ? (
                      <span className="text-[11.5px] text-muted">
                        {phase.label}
                      </span>
                    ) : null}
                    <span className="num text-[12.5px]">
                      {c.valueNet > 0 ? eurShort(c.valueNet) : ""}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {ohne.length > 0 ? (
        <section className="rounded-[20px] bg-surface p-5 shadow-soft">
          <h2 className="mb-3 text-[13px] font-semibold">Ohne Termin</h2>
          <ul className="flex flex-col gap-2">
            {ohne.map((c) => (
              <li key={c.id}>
                <Link
                  href={hrefFor(c)}
                  className="flex items-center gap-3 rounded-input bg-panel px-4 py-3 text-ink transition-colors hover:bg-sunk"
                >
                  <span className="num text-[13px] font-semibold">{c.number}</span>
                  <span className="min-w-0 flex-1 truncate text-[13px]">
                    {c.customerName}
                  </span>
                  <span className="num text-[12.5px]">
                    {c.valueNet > 0 ? eurShort(c.valueNet) : ""}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function weekKey(iso: string): string {
  const d = new Date(iso);
  const target = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
  const dayNr = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNr + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const firstDayNr = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNr + 3);
  const week =
    1 +
    Math.round(
      (target.getTime() - firstThursday.getTime()) / (7 * 24 * 3600 * 1000),
    );
  return `${target.getUTCFullYear()}-${String(week).padStart(2, "0")}`;
}

function weekLabel(key: string): string {
  const [year, week] = key.split("-");
  return `KW ${week} · ${year}`;
}
