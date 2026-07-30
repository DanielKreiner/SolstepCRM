import Link from "next/link";
import type { ReactNode } from "react";

/*
 * Dichte, tabellarische Liste — Maße aus dem Mockup: Kopfzeile 11px
 * versalgesperrt, Zeilen mindestens 66px, Trennlinie je Zeile, Zellen 8px/6px.
 *
 * Grid statt <table>, weil die Spaltenbreiten aus dem Mockup fixe Tracks sind
 * und die Zeile als Ganzes ein Link sein soll. Auf schmalen Geräten scrollt
 * die Tabelle in ihrem eigenen Container, nie die Seite.
 */

export type Column<T> = {
  key: string;
  header: string;
  /** CSS-Grid-Track, z. B. "1.7fr" oder "150px". */
  width: string;
  align?: "left" | "right";
  render: (row: T) => ReactNode;
};

type Props<T> = {
  columns: Column<T>[];
  rows: T[];
  getKey: (row: T) => string;
  /** Macht die ganze Zeile klickbar. */
  hrefFor?: (row: T) => string;
  empty?: string;
  /** Kompakte Zeilenhöhe (36px statt 44px Inhalt). */
  compact?: boolean;
};

export function DataTable<T>({
  columns,
  rows,
  getKey,
  hrefFor,
  empty = "Keine Einträge.",
  compact = false,
}: Props<T>) {
  const template = columns.map((c) => c.width).join(" ");
  const minHeight = compact ? "min-h-[52px]" : "min-h-[66px]";
  const minWidth = columns.length > 4 ? "min-w-[880px]" : "min-w-[520px]";

  return (
    <div className="overflow-x-auto rounded-[20px] bg-surface shadow-soft">
      <div className={minWidth}>
        <div
          className="grid border-b border-line px-5 text-[11px] tracking-[0.07em] text-faint uppercase"
          style={{ gridTemplateColumns: template }}
          role="row"
        >
          {columns.map((c) => (
            <div
              key={c.key}
              role="columnheader"
              className={`px-[6px] py-[14px] ${c.align === "right" ? "text-right" : ""}`}
            >
              {c.header}
            </div>
          ))}
        </div>

        {rows.length === 0 ? (
          <p className="px-5 py-8 text-[13.5px] text-muted">{empty}</p>
        ) : (
          rows.map((row) => {
            const cells = columns.map((c) => (
              <div
                key={c.key}
                className={`px-[6px] py-2 ${c.align === "right" ? "text-right" : ""}`}
              >
                {c.render(row)}
              </div>
            ));

            const className = `grid items-center border-b border-line px-5 ${minHeight} transition-colors duration-150 last:border-b-0`;

            return hrefFor ? (
              <Link
                key={getKey(row)}
                href={hrefFor(row)}
                className={`${className} text-ink hover:bg-panel`}
                style={{ gridTemplateColumns: template }}
              >
                {cells}
              </Link>
            ) : (
              <div
                key={getKey(row)}
                className={className}
                style={{ gridTemplateColumns: template }}
              >
                {cells}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
