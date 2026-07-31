/*
 * Personenmarke. Kein Foto-Zwang — der Betrieb pflegt selten Bilder, und
 * ein leerer Platzhalterkreis sagt weniger als zwei Buchstaben.
 *
 * Die Farbe kommt aus dem Namen, nicht aus einem gespeicherten Feld: derselbe
 * Mensch bekommt auf jedem Screen denselben Ton, ohne dass jemand ihn pflegen
 * muss. Die Palette ist die Statuspalette ohne Rot und ohne Akzent — Rot heisst
 * hier "kritisch", und der Akzent gehoert den Aktionen.
 */

const TOENE = [
  "#3E7BC6", // doing
  "#3E9E6B", // done
  "#8465C4", // waiting
  "#8B92A0", // new
  "#4F8A8B",
  "#A8703E",
] as const;

function tonVon(name: string): string {
  let summe = 0;
  for (let i = 0; i < name.length; i++) summe = (summe + name.charCodeAt(i)) % 997;
  return TOENE[summe % TOENE.length]!;
}

export function initialen(name: string): string {
  const teile = name.trim().split(/\s+/).filter(Boolean);
  if (teile.length === 0) return "?";
  if (teile.length === 1) return teile[0]!.slice(0, 2).toUpperCase();
  return (teile[0]![0]! + teile[teile.length - 1]![0]!).toUpperCase();
}

export function Avatar({
  name,
  size = 30,
  /** Im Stapel ueberlappen die Marken und brauchen einen Rand zum Absetzen. */
  imStapel = false,
}: {
  name: string;
  size?: number;
  imStapel?: boolean;
}) {
  return (
    <span
      title={name}
      className={[
        "inline-grid shrink-0 place-items-center rounded-pill font-semibold text-white select-none",
        imStapel ? "ring-2 ring-surface" : "",
      ].join(" ")}
      style={{
        width: size,
        height: size,
        background: tonVon(name),
        fontSize: Math.round(size * 0.38),
      }}
    >
      {initialen(name)}
    </span>
  );
}

export function AvatarStapel({
  namen,
  max = 4,
  size = 26,
}: {
  namen: string[];
  max?: number;
  size?: number;
}) {
  const gezeigt = namen.slice(0, max);
  const rest = namen.length - gezeigt.length;

  return (
    <span
      className="inline-flex items-center"
      aria-label={namen.join(", ")}
      title={namen.join(", ")}
    >
      {gezeigt.map((n, i) => (
        <span key={n + i} style={{ marginLeft: i === 0 ? 0 : -size * 0.3 }}>
          <Avatar name={n} size={size} imStapel />
        </span>
      ))}
      {rest > 0 ? (
        <span
          className="num inline-grid place-items-center rounded-pill bg-sunk font-semibold text-muted ring-2 ring-surface"
          style={{
            width: size,
            height: size,
            marginLeft: -size * 0.3,
            fontSize: Math.round(size * 0.36),
          }}
        >
          +{rest}
        </span>
      ) : null}
    </span>
  );
}
