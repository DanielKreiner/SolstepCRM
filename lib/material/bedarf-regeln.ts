/**
 * Wie aus einem Angebot eine Bedarfsliste wird — als reine Regel.
 *
 * Das Angebot ist die Verkaufsebene: was der Kunde sieht und zahlt. Die
 * Bedarfsliste ist die Ausführungsebene. Beim Annehmen wird sie einmal
 * daraus vorbefüllt, danach lebt sie ihr eigenes Leben — nach der
 * Aufnahme vor Ort ändert sich immer etwas.
 *
 * Einbahnregel: Bedarf ändern fasst das Angebot nie an. Mehrbedarf, der
 * verrechnet werden soll, ist eine bewusste Entscheidung des Betriebs
 * (Nachtrag), kein Automatismus — sonst wächst die Rechnung, ohne dass
 * jemand mit dem Kunden geredet hat.
 */

export type BedarfZeile = {
  company_id: string;
  vorgang_id: string;
  artikel_id: string | null;
  bezeichnung: string;
  menge: number;
  einheit: string;
  sort: number;
  herkunft: "angebot" | "paket" | "manuell";
};

export type AngebotsPosition = {
  sort: number;
  article_id: string | null;
  bezeichnung: string;
  menge: string | number;
  einheit: string;
  pos_typ: string;
};

export type StuecklistenTeil = {
  artikel_id: string;
  bezeichnung: string;
  menge: number;
  einheit: string;
};

/**
 * material  → eine Zeile
 * paket     → die Stückliste dahinter, Menge mal Paketmenge
 * leistung  → nichts. „Montage pauschal 4.000 €" braucht kein Material,
 *             sondern Stunden.
 */
export function bedarfAusPositionen(
  companyId: string,
  vorgangId: string,
  positionen: readonly AngebotsPosition[],
  stuecklisten: ReadonlyMap<string, StuecklistenTeil[]>,
): BedarfZeile[] {
  const zeilen: BedarfZeile[] = [];
  let sort = 0;

  for (const p of positionen) {
    const menge = Number(p.menge);
    if (p.pos_typ === "leistung") continue;

    if (p.pos_typ === "paket") {
      const teile = (p.article_id ? stuecklisten.get(p.article_id) : undefined) ?? [];
      /*
       * Ein Paket ohne hinterlegte Stückliste landet als eine Zeile in
       * der Liste, nicht im Nichts. Sonst verschwindet die halbe Anlage,
       * weil jemand vergessen hat, das Paket zu füllen.
       */
      if (teile.length === 0) {
        zeilen.push(zeile(companyId, vorgangId, p.article_id, p.bezeichnung, menge, p.einheit, sort++, "angebot"));
        continue;
      }
      for (const t of teile) {
        zeilen.push(
          zeile(companyId, vorgangId, t.artikel_id, t.bezeichnung, runde(t.menge * menge), t.einheit, sort++, "paket"),
        );
      }
      continue;
    }

    zeilen.push(zeile(companyId, vorgangId, p.article_id, p.bezeichnung, menge, p.einheit, sort++, "angebot"));
  }

  /*
   * Derselbe Artikel aus zwei Positionen wird eine Zeile mit der Summe —
   * zweimal „Dachhaken" im Lager herauszusuchen ist Arbeit, die niemand
   * braucht. Freitextzeilen ohne Artikel bleiben einzeln, dort weiss
   * niemand, ob zweimal dasselbe gemeint ist.
   */
  const zusammen = new Map<string, BedarfZeile>();
  const rest: BedarfZeile[] = [];
  for (const z of zeilen) {
    if (!z.artikel_id) {
      rest.push(z);
      continue;
    }
    const da = zusammen.get(z.artikel_id);
    if (da) da.menge = runde(da.menge + z.menge);
    else zusammen.set(z.artikel_id, { ...z });
  }

  return [...zusammen.values(), ...rest].map((z, i) => ({ ...z, sort: i }));
}

function zeile(
  companyId: string,
  vorgangId: string,
  artikelId: string | null,
  bezeichnung: string,
  menge: number,
  einheit: string,
  sort: number,
  herkunft: BedarfZeile["herkunft"],
): BedarfZeile {
  return {
    company_id: companyId,
    vorgang_id: vorgangId,
    artikel_id: artikelId,
    bezeichnung,
    menge,
    einheit,
    sort,
    herkunft,
  };
}

function runde(n: number): number {
  return Math.round(n * 1000) / 1000;
}
