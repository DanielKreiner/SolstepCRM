import type { HTMLAttributes, ReactNode } from "react";

type PanelProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
};

/** Grosse Flaeche, Radius 26px — Sidebar, Inhaltsspalte, Dialogflaeche. */
export function Panel({ className = "", children, ...rest }: PanelProps) {
  return (
    <div
      className={`bg-surface rounded-panel shadow-soft ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}

/** Karte innerhalb eines Panels, Radius 19px. */
export function Card({ className = "", children, ...rest }: PanelProps) {
  return (
    <div className={`bg-surface rounded-card shadow-soft ${className}`} {...rest}>
      {children}
    </div>
  );
}

/** Eingesenkte Flaeche ohne Schatten — Filterleisten, Suchfelder, Nebenangaben. */
export function Sunk({ className = "", children, ...rest }: PanelProps) {
  return (
    <div className={`bg-sunk rounded-input ${className}`} {...rest}>
      {children}
    </div>
  );
}
