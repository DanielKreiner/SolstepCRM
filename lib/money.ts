/*
 * Kaufmännische Rechenregeln.
 *
 * Alle Beträge netto (CLAUDE.md Abschnitt 5.2). Gerundet wird kaufmännisch
 * und immer erst auf Positionsebene — wer erst die Summe rundet, weicht bei
 * vielen Positionen um Cent ab, und genau die fallen der Buchhaltung auf.
 */

export type TaxContext = {
  /** ISO-Land des Kunden. */
  country: string;
  /** Steuerschuldnerschaft des Leistungsempfängers. */
  reverseCharge: boolean;
};

/** USt.-Satz nach Kundenland. Informativ im Checkout, verbindlich in der Rechnung. */
export function vatRate(ctx: TaxContext): number {
  if (ctx.reverseCharge) return 0;
  switch (ctx.country.toUpperCase()) {
    case "DE":
      return 19;
    case "AT":
    default:
      return 20;
  }
}

export const REVERSE_CHARGE_HINWEIS =
  "Steuerschuldnerschaft des Leistungsempfängers";

/** Kaufmännische Rundung auf zwei Nachkommastellen. */
export function round2(value: number): number {
  // toFixed rundet bei .005 nicht zuverlässig auf — der Umweg über
  // Number.EPSILON gleicht die Binärdarstellung aus.
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export type Position = {
  qty: number;
  unitPrice: number;
  vatRate: number;
};

export type Totals = {
  net: number;
  vat: number;
  gross: number;
  /** Steuer je Satz, für den Ausweis auf der Rechnung. */
  byRate: { rate: number; net: number; vat: number }[];
};

export function totals(positions: Position[]): Totals {
  const proSatz = new Map<number, number>();

  for (const p of positions) {
    const zeile = round2(p.qty * p.unitPrice);
    proSatz.set(p.vatRate, round2((proSatz.get(p.vatRate) ?? 0) + zeile));
  }

  const byRate = [...proSatz.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([rate, net]) => ({ rate, net, vat: round2((net * rate) / 100) }));

  const net = round2(byRate.reduce((s, r) => s + r.net, 0));
  const vat = round2(byRate.reduce((s, r) => s + r.vat, 0));

  return { net, vat, gross: round2(net + vat), byRate };
}

/*
 * Teilrechnungen.
 *
 * Der übliche Ablauf im PV-Bau: Anzahlung bei Beauftragung, Teilrechnung
 * nach Montage, Schlussrechnung nach Abnahme. Die Schlussrechnung ist der
 * Rest — sie wird nie prozentual gerechnet, sonst bleiben Cent stehen.
 */
export type InvoiceKind = "deposit" | "partial" | "final";

export const KIND_LABEL: Record<InvoiceKind, string> = {
  deposit: "Anzahlung",
  partial: "Teilrechnung",
  final: "Schlussrechnung",
};

export const DEFAULT_STAGES: { kind: InvoiceKind; percent: number }[] = [
  { kind: "deposit", percent: 30 },
  { kind: "partial", percent: 40 },
  { kind: "final", percent: 30 },
];

/**
 * Nächster Rechnungsbetrag für einen Auftrag.
 *
 * `bereitsFakturiert` ist die Summe aller nicht stornierten Rechnungen.
 * Bei der Schlussrechnung ergibt sich der Betrag als Rest, nicht aus dem
 * Prozentsatz — nur so geht die Summe am Ende exakt auf.
 */
export function nextInvoiceAmount(
  auftragswert: number,
  bereitsFakturiert: number,
  kind: InvoiceKind,
): number {
  const rest = round2(auftragswert - bereitsFakturiert);
  if (rest <= 0) return 0;
  if (kind === "final") return rest;

  const stufe = DEFAULT_STAGES.find((s) => s.kind === kind);
  const betrag = round2((auftragswert * (stufe?.percent ?? 0)) / 100);
  return Math.min(betrag, rest);
}

/*
 * Mahnstufen.
 *
 * Die Fristen sind bewusst großzügig: ein Handwerksbetrieb verliert mit
 * einer zu scharfen ersten Mahnung mehr Kunden als Geld.
 */
export const DUNNING_LEVELS = [
  { level: 1, afterDays: 7, label: "Zahlungserinnerung" },
  { level: 2, afterDays: 21, label: "1. Mahnung" },
  { level: 3, afterDays: 35, label: "2. Mahnung" },
] as const;

/**
 * Welche Mahnstufe ist heute fällig?
 * Gibt null zurück, wenn nichts zu tun ist.
 */
export function dueDunningLevel(
  dueDate: string,
  currentLevel: number,
  today: string,
): (typeof DUNNING_LEVELS)[number] | null {
  const tageUeberfaellig = Math.floor(
    (new Date(`${today}T00:00:00Z`).getTime() -
      new Date(`${dueDate}T00:00:00Z`).getTime()) /
      86_400_000,
  );
  if (tageUeberfaellig <= 0) return null;

  // Die höchste erreichte Stufe gewinnt, aber immer nur eine pro Lauf —
  // sonst überspringt ein vergessener Cron-Lauf die Zahlungserinnerung.
  const faellig = DUNNING_LEVELS.filter(
    (s) => tageUeberfaellig >= s.afterDays && s.level > currentLevel,
  );
  return faellig[0] ?? null;
}
