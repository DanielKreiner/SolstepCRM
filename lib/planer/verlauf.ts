/*
 * Undo/Redo für den Planer (Briefing 1.4: über alles, mindestens 50
 * Schritte).
 *
 * Bewusst Zustandsabzüge statt eines Kommando-Stapels. Das Briefing
 * nennt einen Command-Stack; der lohnt sich, wenn Schritte umkehrbar
 * beschrieben werden müssen — etwa für gemeinsames Bearbeiten oder eine
 * Änderungsliste. Hier hängt daran nichts: das Plandokument einer
 * Anlage ist ein paar Kilobyte, fünfzig Abzüge davon kosten weniger
 * Speicher als ein einziges Kartenbild.
 *
 * Der Unterschied zählt bei der Fehleranfälligkeit. Jedes Kommando
 * braucht ein korrektes Gegenstück; ein einziges fehlerhaftes „rückwärts"
 * verfälscht den Plan still — und still verfälschte Geometrie fällt
 * erst auf, wenn die Stückliste nicht stimmt. Ein Abzug kann das nicht.
 */

export interface Verlauf<T> {
  vergangenheit: T[];
  gegenwart: T;
  zukunft: T[];
}

/** Fünfzig laut Briefing; hundert kosten nichts und reichen für eine Sitzung. */
export const VERLAUF_TIEFE = 100;

export function verlaufStart<T>(zustand: T): Verlauf<T> {
  return { vergangenheit: [], gegenwart: zustand, zukunft: [] };
}

/**
 * Neuen Stand ablegen. Die Zukunft fällt dabei weg — wer nach einem
 * Rückschritt weiterarbeitet, hat den alten Zweig verlassen.
 */
export function verlaufSetzen<T>(v: Verlauf<T>, zustand: T): Verlauf<T> {
  const vergangenheit = [...v.vergangenheit, v.gegenwart].slice(-VERLAUF_TIEFE);
  return { vergangenheit, gegenwart: zustand, zukunft: [] };
}

/**
 * Stand ändern, ohne einen Schritt anzulegen.
 *
 * Für alles, was fortlaufend passiert: während ein Eckpunkt gezogen
 * wird, entstünden sonst je Mausbewegung dreissig Rückschritte, und
 * einmal Undo bewegte den Punkt um einen Pixel. Angelegt wird der
 * Schritt einmal beim Loslassen.
 */
export function verlaufErsetzen<T>(v: Verlauf<T>, zustand: T): Verlauf<T> {
  return { ...v, gegenwart: zustand };
}

export function kannZurueck<T>(v: Verlauf<T>): boolean {
  return v.vergangenheit.length > 0;
}

export function kannVor<T>(v: Verlauf<T>): boolean {
  return v.zukunft.length > 0;
}

export function zurueck<T>(v: Verlauf<T>): Verlauf<T> {
  if (!kannZurueck(v)) return v;
  const vorher = v.vergangenheit[v.vergangenheit.length - 1]!;
  return {
    vergangenheit: v.vergangenheit.slice(0, -1),
    gegenwart: vorher,
    zukunft: [v.gegenwart, ...v.zukunft].slice(0, VERLAUF_TIEFE),
  };
}

export function vor<T>(v: Verlauf<T>): Verlauf<T> {
  if (!kannVor(v)) return v;
  const naechster = v.zukunft[0]!;
  return {
    vergangenheit: [...v.vergangenheit, v.gegenwart].slice(-VERLAUF_TIEFE),
    gegenwart: naechster,
    zukunft: v.zukunft.slice(1),
  };
}
