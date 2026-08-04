import { describe, expect, it } from "vitest";
import { bedarfAusPositionen, type StuecklistenTeil } from "@/lib/material/bedarf-regeln";

const C = "firma";
const V = "vorgang";

const paket: StuecklistenTeil[] = [
  { artikel_id: "modul", bezeichnung: "Modul 440 Wp", menge: 25, einheit: "Stk" },
  { artikel_id: "wr", bezeichnung: "Wechselrichter 10 kW", menge: 1, einheit: "Stk" },
];

describe("bedarfAusPositionen", () => {
  it("löst ein Paket in seine Stückliste auf", () => {
    const zeilen = bedarfAusPositionen(
      C,
      V,
      [{ sort: 0, article_id: "paket-10", bezeichnung: "10 kWp komplett", menge: 1, einheit: "Stk", pos_typ: "paket" }],
      new Map([["paket-10", paket]]),
    );

    expect(zeilen.map((z) => [z.artikel_id, z.menge])).toEqual([
      ["modul", 25],
      ["wr", 1],
    ]);
    expect(zeilen.every((z) => z.herkunft === "paket")).toBe(true);
  });

  it("multipliziert die Stückliste mit der Paketmenge", () => {
    const zeilen = bedarfAusPositionen(
      C,
      V,
      [{ sort: 0, article_id: "paket-10", bezeichnung: "10 kWp", menge: 2, einheit: "Stk", pos_typ: "paket" }],
      new Map([["paket-10", paket]]),
    );

    expect(zeilen.find((z) => z.artikel_id === "modul")?.menge).toBe(50);
  });

  it("erzeugt aus einer Pauschale keine Materialzeile", () => {
    const zeilen = bedarfAusPositionen(
      C,
      V,
      [
        { sort: 0, article_id: null, bezeichnung: "Montage pauschal", menge: 1, einheit: "pau", pos_typ: "leistung" },
        { sort: 1, article_id: "speicher", bezeichnung: "Speicher 10 kWh", menge: 1, einheit: "Stk", pos_typ: "material" },
      ],
      new Map(),
    );

    expect(zeilen).toHaveLength(1);
    expect(zeilen[0]?.artikel_id).toBe("speicher");
  });

  it("fasst denselben Artikel aus Paket und Einzelposition zusammen", () => {
    const zeilen = bedarfAusPositionen(
      C,
      V,
      [
        { sort: 0, article_id: "paket-10", bezeichnung: "10 kWp", menge: 1, einheit: "Stk", pos_typ: "paket" },
        { sort: 1, article_id: "modul", bezeichnung: "Modul 440 Wp", menge: 5, einheit: "Stk", pos_typ: "material" },
      ],
      new Map([["paket-10", paket]]),
    );

    expect(zeilen.filter((z) => z.artikel_id === "modul")).toHaveLength(1);
    expect(zeilen.find((z) => z.artikel_id === "modul")?.menge).toBe(30);
  });

  it("lässt Freitextzeilen einzeln stehen", () => {
    const zeilen = bedarfAusPositionen(
      C,
      V,
      [
        { sort: 0, article_id: null, bezeichnung: "Sonderhalterung", menge: 1, einheit: "Stk", pos_typ: "material" },
        { sort: 1, article_id: null, bezeichnung: "Sonderhalterung", menge: 1, einheit: "Stk", pos_typ: "material" },
      ],
      new Map(),
    );

    expect(zeilen).toHaveLength(2);
  });

  it("verliert ein Paket ohne Stückliste nicht", () => {
    const zeilen = bedarfAusPositionen(
      C,
      V,
      [{ sort: 0, article_id: "paket-leer", bezeichnung: "Anlage komplett", menge: 1, einheit: "Stk", pos_typ: "paket" }],
      new Map(),
    );

    expect(zeilen).toHaveLength(1);
    expect(zeilen[0]?.bezeichnung).toBe("Anlage komplett");
  });
});
