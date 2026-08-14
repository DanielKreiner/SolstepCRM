/*
 * Icons des Planers.
 *
 * Vorher standen hier Sonderzeichen aus der Schrift — ⬠ für die Fläche,
 * ▣ für das Hindernis, ⬓ für das Modul. Auf dem Mac sahen sie halbwegs
 * aus, unter Windows und am iPad zeigten sie Kästchen oder ein völlig
 * anderes Bild. Ein Werkzeug, dessen Zeichen man nicht erkennt, ist
 * kein Werkzeug.
 *
 * Deshalb gezeichnete Pfade: gleiche Strichstärke, gleiches Raster
 * (24 px), keine Füllung. Sie erben die Textfarbe, damit ein Knopf sie
 * mitfärben kann.
 */

interface Props {
  /** Kantenlänge in Pixeln. */
  groesse?: number;
  className?: string;
}

function Rahmen({ groesse = 22, className, children }: Props & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={groesse}
      height={groesse}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {children}
    </svg>
  );
}

/** Zeiger — auswählen und schieben. */
export function ZeichenZeiger(p: Props) {
  return (
    <Rahmen {...p}>
      <path d="M5 3l6 16 2.2-6.2L19 10.5 5 3z" />
    </Rahmen>
  );
}

/** Dachumriss zeichnen: Vieleck mit Eckpunkten. */
export function ZeichenFlaeche(p: Props) {
  return (
    <Rahmen {...p}>
      <path d="M4 9l8-5 8 5v7l-8 5-8-5V9z" />
      <circle cx="4" cy="9" r="1.6" />
      <circle cx="20" cy="9" r="1.6" />
      <circle cx="12" cy="21" r="1.6" />
    </Rahmen>
  );
}

/** Rechteck als Standardform. */
export function ZeichenRechteck(p: Props) {
  return (
    <Rahmen {...p}>
      <rect x="3.5" y="6" width="17" height="12" rx="1.5" />
      <path d="M3.5 12h17" />
    </Rahmen>
  );
}

/** Hindernis: Kamin auf dem Dach. */
export function ZeichenHindernis(p: Props) {
  return (
    <Rahmen {...p}>
      <path d="M3 20l9-9 9 9" />
      <rect x="14" y="5" width="4" height="6" rx="0.8" />
    </Rahmen>
  );
}

/** Baum — Schattenwerfer. */
export function ZeichenBaum(p: Props) {
  return (
    <Rahmen {...p}>
      <path d="M12 21v-5" />
      <path d="M12 3l5 6h-3l3.5 4.5h-11L10 9H7l5-6z" />
    </Rahmen>
  );
}

/** Einzelnes Modul. */
export function ZeichenModul(p: Props) {
  return (
    <Rahmen {...p}>
      <rect x="4" y="4" width="16" height="16" rx="1.5" />
      <path d="M4 12h16M12 4v16" />
    </Rahmen>
  );
}

/** Feld teilen. */
export function ZeichenTeilen(p: Props) {
  return (
    <Rahmen {...p}>
      <rect x="3.5" y="5" width="7" height="14" rx="1.2" />
      <rect x="13.5" y="5" width="7" height="14" rx="1.2" strokeDasharray="3 2.5" />
    </Rahmen>
  );
}

/** Messen: Massband. */
export function ZeichenMessen(p: Props) {
  return (
    <Rahmen {...p}>
      <path d="M3 16.5L16.5 3l4.5 4.5L7.5 21 3 16.5z" />
      <path d="M8 11.5l1.8 1.8M11.5 8l1.8 1.8M14.5 5l1.8 1.8" />
    </Rahmen>
  );
}

/** String / Elektrik. */
export function ZeichenString(p: Props) {
  return (
    <Rahmen {...p}>
      <path d="M13 2L5 13h6l-2 9 10-12h-6l2-8z" />
    </Rahmen>
  );
}

/** Vollbild ein. */
export function ZeichenVollbild(p: Props) {
  return (
    <Rahmen {...p}>
      <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
    </Rahmen>
  );
}

/** Vollbild aus. */
export function ZeichenVollbildAus(p: Props) {
  return (
    <Rahmen {...p}>
      <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
    </Rahmen>
  );
}

/** Häkchen — erledigt. */
export function ZeichenHaken(p: Props) {
  return (
    <Rahmen {...p}>
      <path d="M4.5 12.5l5 5 10-11" />
    </Rahmen>
  );
}

/** Papierkorb. */
export function ZeichenWeg(p: Props) {
  return (
    <Rahmen {...p}>
      <path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 12.5h9L17.5 7" />
    </Rahmen>
  );
}

/** Fadenkreuz — der Nullpunkt des Plans. */
export function ZeichenNullpunkt(p: Props) {
  return (
    <Rahmen {...p}>
      <path d="M12 3v5M12 16v5M3 12h5M16 12h5" />
      <circle cx="12" cy="12" r="3.2" />
    </Rahmen>
  );
}

/** Plus. */
export function ZeichenPlus(p: Props) {
  return (
    <Rahmen {...p}>
      <path d="M12 5v14M5 12h14" />
    </Rahmen>
  );
}
