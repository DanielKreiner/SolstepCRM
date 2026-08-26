/**
 * Hersteller und Bezeichnung zu einem Namen.
 *
 * Im Materialstamm steht der Hersteller oft schon in der Bezeichnung
 * („AIKO Neostar 2S A450"). Stumpf zusammengesetzt las sich das im
 * Angebot als „AIKO AIKO Neostar 2S A450" — und weil Karten und
 * Tabellen kürzen, blieb vom eigentlichen Typ nichts übrig.
 *
 * Dieselbe Regel wie in der Modulwahl am Bildschirm, nur ohne
 * Abhängigkeit zu einer Komponente: Sie wird auch im PDF und im Portal
 * gebraucht.
 */
export function geraetName(g: { hersteller: string; bezeichnung: string }): string {
  const h = g.hersteller.trim();
  const b = g.bezeichnung.trim();
  if (!h) return b;
  return b.toLowerCase().startsWith(h.toLowerCase()) ? b : `${h} ${b}`;
}
