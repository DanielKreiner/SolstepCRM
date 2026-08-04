/*
 * Iconsatz. Geometrie 1:1 aus design/backoffice-v2.dc.html übernommen —
 * viewBox 24, stroke 1.8, runde Enden. Keine Emoji als Icons, keine
 * Icon-Bibliothek mit fremder Optik (CLAUDE.md Abschnitt 9 und 13).
 */

type Part =
  | { t: "rect"; x: number; y: number; w: number; h: number; r?: number }
  | { t: "line"; x1: number; y1: number; x2: number; y2: number }
  | { t: "circle"; cx: number; cy: number; r: number }
  | { t: "path"; d: string };

const R = (x: number, y: number, w: number, h: number, r = 2): Part => ({
  t: "rect",
  x,
  y,
  w,
  h,
  r,
});
const L = (x1: number, y1: number, x2: number, y2: number): Part => ({
  t: "line",
  x1,
  y1,
  x2,
  y2,
});
const C = (cx: number, cy: number, r: number): Part => ({ t: "circle", cx, cy, r });
const P = (d: string): Part => ({ t: "path", d });

export const ICONS = {
  menue: [L(4, 7, 20, 7), L(4, 12, 20, 12), L(4, 17, 20, 17)],
  telefon: [
    P(
      "M6.5 3.5h3l1.5 4-2 1.5a12 12 0 0 0 6 6l1.5-2 4 1.5v3a1.5 1.5 0 0 1-1.7 1.5C11.4 18.4 5.6 12.6 5 5.2A1.5 1.5 0 0 1 6.5 3.5z",
    ),
  ],
  /* Ertragspfeil: aufsteigende Linie mit Spitze. */
  trend: [P("M4 16.5 9.5 11l3.5 3.5L20 8"), P("M15 8h5v5")],
  cockpit: [R(3, 3, 8, 8, 2.5), R(13, 3, 8, 8, 2.5), R(3, 13, 8, 8, 2.5), R(13, 13, 8, 8, 2.5)],
  pipelines: [R(3, 4, 5, 16, 2), R(10, 4, 5, 11, 2), R(17, 4, 4, 7, 2)],
  angebote: [R(5, 3, 14, 18, 2.5), L(9, 9, 15, 9), L(9, 13, 15, 13), L(9, 17, 12, 17)],
  crm: [
    C(9, 8, 3.2),
    P("M3.5 20c0-3.3 2.5-5.5 5.5-5.5s5.5 2.2 5.5 5.5"),
    P("M16.5 5.5a3 3 0 0 1 0 5.6"),
    P("M18 20c0-2.4-.8-4.2-2-5.2"),
  ],
  dispo: [R(3, 5, 18, 16, 2.5), L(3, 10, 21, 10), L(8, 3, 8, 6), L(16, 3, 16, 6), L(9, 15, 15, 15)],
  lager: [P("M4 8.5 12 4l8 4.5v7L12 20l-8-4.5z"), L(4, 8.5, 12, 13), L(12, 13, 20, 8.5), L(12, 13, 12, 20)],
  /* Kartennadel: der Monteur denkt in Baustellen, nicht in Vorgängen. */
  einsatz: [P("M12 21s7-6.3 7-11a7 7 0 1 0-14 0c0 4.7 7 11 7 11z"), C(12, 10, 2.5)],
  rechnungen: [R(5, 3, 14, 18, 2.5), L(9, 8, 15, 8), L(9, 12, 15, 12), L(9, 16, 13, 16)],
  zeit: [C(12, 12, 8.5), L(12, 7.5, 12, 12), L(12, 12, 15.5, 14)],
  konto: [L(4, 20, 20, 20), R(6, 12, 3.5, 6, 1.2), R(11.5, 8, 3.5, 10, 1.2), R(17, 14, 3.5, 4, 1.2)],
  abwesenheit: [
    R(3, 5, 18, 16, 2.5),
    L(3, 10, 21, 10),
    L(8, 3, 8, 6),
    L(16, 3, 16, 6),
    L(9.5, 14.5, 14.5, 18.5),
    L(14.5, 14.5, 9.5, 18.5),
  ],
  mitarbeiter: [
    C(8.5, 8, 3),
    C(16.5, 9, 2.4),
    P("M3 19c0-2.9 2.5-4.8 5.5-4.8S14 16.1 14 19"),
    P("M15 19c0-2 .6-3.4 1.6-4.2 2 0 4.4 1.3 4.4 4.2"),
  ],
  dokumente: [
    P("M8 3h6l4 4v11a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"),
    P("M14 3v4h4"),
    L(9.5, 13, 15, 13),
    L(9.5, 16.5, 13.5, 16.5),
  ],
  chat: [P("M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7A2.5 2.5 0 0 1 17.5 16H10l-4.5 4v-4H6.5A2.5 2.5 0 0 1 4 13.5z")],
  bewerber: [
    C(10, 8, 3.2),
    P("M4 20c0-3.3 2.6-5.5 6-5.5 1.2 0 2.3.3 3.2.8"),
    L(18, 13, 18, 20),
    L(14.5, 16.5, 21.5, 16.5),
  ],
  berichte: [R(3, 4, 18, 16, 2.5), L(7.5, 15.5, 10, 12), L(10, 12, 13, 14.5), L(13, 14.5, 17, 9.5)],
  einstellungen: [
    L(4, 7, 20, 7),
    L(4, 12, 20, 12),
    L(4, 17, 20, 17),
    C(9, 7, 2.2),
    C(15, 12, 2.2),
    C(11, 17, 2.2),
  ],
  suche: [C(11, 11, 7), L(16, 16, 20.5, 20.5)],
  mail: [R(3, 5, 18, 14, 2.5), P("M3.5 7 12 13l8.5-6")],
  plus: [L(12, 5, 12, 19), L(5, 12, 19, 12)],
  sonne: [
    C(12, 12, 4.2),
    L(12, 3, 12, 5),
    L(12, 19, 12, 21),
    L(3, 12, 5, 12),
    L(19, 12, 21, 12),
    L(6, 6, 7.4, 7.4),
    L(16.6, 16.6, 18, 18),
    L(18, 6, 16.6, 7.4),
    L(7.4, 16.6, 6, 18),
  ],
  mond: [P("M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z")],
  stift: [P("M4 20h4l11-11a2.1 2.1 0 0 0-3-3L5 17z"), L(14.5, 6.5, 17.5, 9.5)],
  standort: [P("M12 21s7-6.3 7-11a7 7 0 1 0-14 0c0 4.7 7 11 7 11z"), C(12, 10, 2.5)],
  glocke: [P("M6 16V11a6 6 0 1 1 12 0v5l1.5 2.5H4.5z"), P("M10 19a2 2 0 0 0 4 0")],
  pfeilLinks: [L(19, 12, 5, 12), P("M11 6 5 12l6 6")],
  pfeilRechts: [L(5, 12, 19, 12), P("M13 6l6 6-6 6")],
  /* Diagonal nach aussen — steht in der Vorlage auf jeder Kennzahlkarte
     und heisst "hier geht es zur Liste dahinter", nicht "weiter". */
  pfeilRausOben: [L(7, 17, 17, 7), P("M9 7h8v8")],
  haken: [P("M5 12.5 10 17.5 19 7")],
  kreuz: [L(6, 6, 18, 18), L(18, 6, 6, 18)],
  abmelden: [P("M14 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8"), L(10, 12, 21, 12), P("M17.5 8.5 21 12l-3.5 3.5")],
} as const satisfies Record<string, readonly Part[]>;

export type IconName = keyof typeof ICONS;

export function Icon({
  name,
  size = 16,
  className = "",
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`block shrink-0 ${className}`}
      aria-hidden
    >
      {ICONS[name].map((p, i) => {
        switch (p.t) {
          case "rect":
            return <rect key={i} x={p.x} y={p.y} width={p.w} height={p.h} rx={p.r} />;
          case "line":
            return <line key={i} x1={p.x1} y1={p.y1} x2={p.x2} y2={p.y2} />;
          case "circle":
            return <circle key={i} cx={p.cx} cy={p.cy} r={p.r} />;
          case "path":
            return <path key={i} d={p.d} />;
        }
      })}
    </svg>
  );
}
