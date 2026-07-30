import { z } from "zod";

/*
 * Step-Planer-Import.
 *
 * Zwei Wege, beide erlaubt (CLAUDE.md 6.3): Webhook mit HMAC oder manueller
 * Upload im Angebotsdialog. Beide laufen durch dasselbe Schema und denselben
 * Vorschau-Diff — still importiert wird nie.
 */

export const plannerPositionSchema = z.object({
  sku: z.string().trim().min(1).optional(),
  bezeichnung: z.string().trim().min(1),
  menge: z.coerce.number().positive(),
  einheit: z.string().trim().default("Stk"),
  einzelpreis: z.coerce.number().nonnegative().optional(),
});

export const plannerPayloadSchema = z.object({
  planung_id: z.string().trim().min(1),
  kunde: z
    .object({
      name: z.string().trim().optional(),
      plz: z.string().trim().optional(),
      ort: z.string().trim().optional(),
    })
    .optional(),
  anlage: z
    .object({
      kwp: z.coerce.number().nonnegative().optional(),
      speicher_kwh: z.coerce.number().nonnegative().optional(),
      module: z.string().trim().optional(),
      wechselrichter: z.string().trim().optional(),
      ertrag_kwh_jahr: z.coerce.number().nonnegative().optional(),
      co2_kg_jahr: z.coerce.number().nonnegative().optional(),
    })
    .optional(),
  positionen: z.array(plannerPositionSchema).min(1),
  canvas_jpeg_base64: z.string().optional(),
});

export type PlannerPayload = z.infer<typeof plannerPayloadSchema>;
export type PlannerPosition = z.infer<typeof plannerPositionSchema>;

export type MatchedPosition = {
  pos: number;
  bezeichnung: string;
  menge: number;
  einheit: string;
  /** Gefundener Artikel oder null — dann Freitextposition, rot markiert. */
  articleId: string | null;
  sku: string | null;
  einkauf: number;
  verkauf: number;
  unmatched: boolean;
};

export type ImportPreview = {
  planungId: string;
  positionen: MatchedPosition[];
  erkannt: number;
  nichtZuordenbar: number;
  summeVerkauf: number;
  summeEinkauf: number;
  anlage: PlannerPayload["anlage"];
};

type ArticleLookup = {
  id: string;
  sku: string;
  name: string;
  unit: string;
  purchase_price: number;
  sale_price: number;
};

/**
 * Ordnet die Planungspositionen den Artikeln zu.
 *
 * Reihenfolge: exakte SKU, dann Alias, dann Name (normalisiert). Was übrig
 * bleibt, wird Freitextposition — nicht stillschweigend weggelassen.
 */
export function matchPositions(
  payload: PlannerPayload,
  articles: ArticleLookup[],
  aliases: Map<string, string>,
): ImportPreview {
  const bySku = new Map(articles.map((a) => [normalize(a.sku), a]));
  const byName = new Map(articles.map((a) => [normalize(a.name), a]));
  const byId = new Map(articles.map((a) => [a.id, a]));

  const positionen: MatchedPosition[] = payload.positionen.map((p, i) => {
    let hit: ArticleLookup | undefined;

    if (p.sku) {
      hit = bySku.get(normalize(p.sku));
      if (!hit) {
        const aliasTarget = aliases.get(normalize(p.sku));
        if (aliasTarget) hit = byId.get(aliasTarget);
      }
    }
    if (!hit) hit = byName.get(normalize(p.bezeichnung));

    const verkauf = p.einzelpreis ?? hit?.sale_price ?? 0;

    return {
      pos: i + 1,
      bezeichnung: p.bezeichnung,
      menge: p.menge,
      einheit: hit?.unit ?? p.einheit,
      articleId: hit?.id ?? null,
      sku: hit?.sku ?? p.sku ?? null,
      einkauf: hit?.purchase_price ?? 0,
      verkauf,
      unmatched: !hit,
    };
  });

  return {
    planungId: payload.planung_id,
    positionen,
    erkannt: positionen.filter((p) => !p.unmatched).length,
    nichtZuordenbar: positionen.filter((p) => p.unmatched).length,
    summeVerkauf: positionen.reduce((s, p) => s + p.menge * p.verkauf, 0),
    summeEinkauf: positionen.reduce((s, p) => s + p.menge * p.einkauf, 0),
    anlage: payload.anlage,
  };
}

function normalize(v: string): string {
  return v.trim().toLowerCase().replace(/\s+/g, " ");
}
