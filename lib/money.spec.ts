import { describe, expect, it } from "vitest";
import {
  nextInvoiceAmount,
  round2,
  totals,
  vatRate,
} from "./money";

describe("Umsatzsteuer", () => {
  it("richtet sich nach dem Kundenland", () => {
    expect(vatRate({ country: "AT", reverseCharge: false })).toBe(20);
    expect(vatRate({ country: "DE", reverseCharge: false })).toBe(19);
    expect(vatRate({ country: "de", reverseCharge: false })).toBe(19);
  });

  it("ist bei Reverse Charge null, unabhängig vom Land", () => {
    expect(vatRate({ country: "AT", reverseCharge: true })).toBe(0);
    expect(vatRate({ country: "DE", reverseCharge: true })).toBe(0);
  });

  it("fällt für unbekannte Länder auf Österreich zurück", () => {
    expect(vatRate({ country: "CH", reverseCharge: false })).toBe(20);
  });
});

describe("Rundung", () => {
  it("rundet kaufmännisch, auch bei Binärproblemen", () => {
    expect(round2(1.005)).toBe(1.01);
    expect(round2(2.675)).toBe(2.68);
    expect(round2(0.1 + 0.2)).toBe(0.3);
  });
});

describe("Summen", () => {
  it("rundet je Position, nicht erst am Ende", () => {
    // 3 x 0,335 = 1,005 -> gerundet 1,01 je Position
    const t = totals([
      { qty: 1, unitPrice: 0.335, vatRate: 20 },
      { qty: 1, unitPrice: 0.335, vatRate: 20 },
      { qty: 1, unitPrice: 0.335, vatRate: 20 },
    ]);
    expect(t.net).toBe(1.02);
  });

  it("weist die Steuer je Satz getrennt aus", () => {
    const t = totals([
      { qty: 2, unitPrice: 100, vatRate: 20 },
      { qty: 1, unitPrice: 100, vatRate: 19 },
    ]);
    expect(t.byRate).toEqual([
      { rate: 19, net: 100, vat: 19 },
      { rate: 20, net: 200, vat: 40 },
    ]);
    expect(t.net).toBe(300);
    expect(t.vat).toBe(59);
    expect(t.gross).toBe(359);
  });

  it("kommt bei Reverse Charge auf null Steuer", () => {
    const t = totals([{ qty: 1, unitPrice: 28400, vatRate: 0 }]);
    expect(t.vat).toBe(0);
    expect(t.gross).toBe(28400);
  });
});

describe("Teilrechnungen", () => {
  const WERT = 28400;

  it("rechnet Anzahlung und Teilrechnung prozentual", () => {
    expect(nextInvoiceAmount(WERT, 0, "deposit")).toBe(8520); // 30 %
    expect(nextInvoiceAmount(WERT, 8520, "partial")).toBe(11360); // 40 %
  });

  it("rechnet die Schlussrechnung als Rest, nicht prozentual", () => {
    // 30 + 40 = 70 Prozent fakturiert, Rest exakt 8520
    const rest = nextInvoiceAmount(WERT, 8520 + 11360, "final");
    expect(rest).toBe(8520);
    expect(round2(8520 + 11360 + rest)).toBe(WERT);
  });

  it("geht auch bei krummen Beträgen exakt auf", () => {
    const wert = 33333.33;
    const a = nextInvoiceAmount(wert, 0, "deposit");
    const b = nextInvoiceAmount(wert, a, "partial");
    const c = nextInvoiceAmount(wert, round2(a + b), "final");
    expect(round2(a + b + c)).toBe(wert);
  });

  it("überzahlt nicht, wenn schon alles fakturiert ist", () => {
    expect(nextInvoiceAmount(WERT, WERT, "final")).toBe(0);
    expect(nextInvoiceAmount(WERT, WERT, "partial")).toBe(0);
  });

  it("deckelt die Teilrechnung auf den Rest", () => {
    // Nur noch 1000 offen, 40 Prozent wären 11360
    expect(nextInvoiceAmount(WERT, WERT - 1000, "partial")).toBe(1000);
  });
});
