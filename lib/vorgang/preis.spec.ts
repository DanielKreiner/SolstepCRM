import { describe, expect, it } from "vitest";
import {
  berechne,
  gruppenNetto,
  zeilenNetto,
  type Angebotsrahmen,
  type PreisGruppe,
  type PreisPosition,
} from "./preis";

const RAHMEN: Angebotsrahmen = {
  ustSatz: 20,
  rabattProzent: 0,
  lieferungNetto: 299,
};

function pos(over: Partial<PreisPosition> = {}): PreisPosition {
  return {
    id: over.id ?? "p1",
    gruppeId: over.gruppeId ?? null,
    menge: over.menge ?? 1,
    epNetto: over.epNetto ?? 100,
    rabattProzent: over.rabattProzent ?? 0,
    optional: over.optional ?? false,
    ...(over.gewaehlt === undefined ? {} : { gewaehlt: over.gewaehlt }),
    kalkEk: over.kalkEk ?? null,
  };
}

describe("zeilenNetto", () => {
  it("rechnet Menge mal Preis", () => {
    expect(zeilenNetto(pos({ menge: 20, epNetto: 73.66 }))).toBe(1473.2);
  });

  it("zieht den Positionsrabatt ab", () => {
    expect(zeilenNetto(pos({ menge: 2, epNetto: 100, rabattProzent: 10 }))).toBe(180);
  });

  /*
   * Der Klassiker: 1.005 rundet über toFixed auf 1,00. Über Cent
   * gerechnet kommt 1,01 heraus — und genau diese Cent sucht sonst
   * jemand beim Vergleich von Angebot und Rechnung.
   */
  it("rundet kaufmännisch und nicht über die Fliesskommadarstellung", () => {
    expect(zeilenNetto(pos({ menge: 3, epNetto: 0.335 }))).toBe(1.01);
  });
});

describe("gruppenNetto", () => {
  const gruppe: PreisGruppe = { id: "g1", paketPreis: null };
  const positionen = [
    pos({ id: "a", gruppeId: "g1", menge: 20, epNetto: 73.66 }),
    pos({ id: "b", gruppeId: "g1", menge: 1, epNetto: 1769.83 }),
    pos({ id: "c", gruppeId: null, menge: 1, epNetto: 500 }),
  ];

  it("summiert nur die eigenen Positionen", () => {
    expect(gruppenNetto(gruppe, positionen)).toBe(3243.03);
  });

  /*
   * Der wichtigste Test dieser Datei. Der Betrieb hat 7205,93 € für das
   * Paket verhandelt — dann gilt das, egal was die Einzelteile ergeben.
   */
  it("der Paketpreis schlägt die Summe der Einzelteile", () => {
    expect(gruppenNetto({ id: "g1", paketPreis: 7205.93 }, positionen)).toBe(
      7205.93,
    );
  });

  it("lässt abgewählte Optionen auch im Paket draussen", () => {
    const mitOption = [
      ...positionen,
      pos({ id: "o", gruppeId: "g1", epNetto: 220, optional: true }),
    ];
    expect(gruppenNetto({ id: "g1", paketPreis: 1000 }, mitOption)).toBe(1000);
  });

  it("legt gewählte Optionen auf den Paketpreis obendrauf", () => {
    const mitOption = [
      ...positionen,
      pos({
        id: "o",
        gruppeId: "g1",
        epNetto: 220,
        optional: true,
        gewaehlt: true,
      }),
    ];
    expect(gruppenNetto({ id: "g1", paketPreis: 1000 }, mitOption)).toBe(1220);
  });
});

describe("berechne", () => {
  it("zählt Gruppen und freie Positionen zusammen", () => {
    const p = berechne(
      [
        pos({ id: "a", gruppeId: "g1", menge: 2, epNetto: 100 }),
        pos({ id: "b", gruppeId: null, menge: 1, epNetto: 300 }),
      ],
      [{ id: "g1", paketPreis: null }],
      RAHMEN,
    );
    expect(p.positionenNetto).toBe(500);
    expect(p.netto).toBe(500);
    expect(p.ust).toBe(100);
    expect(p.brutto).toBe(600);
  });

  it("rechnet Lieferung getrennt und mit eigener Steuer", () => {
    const p = berechne([pos({ epNetto: 1000 })], [], RAHMEN);
    expect(p.lieferungNetto).toBe(299);
    expect(p.lieferungBrutto).toBe(358.8);
    expect(p.gesamt).toBe(1558.8);
  });

  it("nimmt den Gesamtrabatt vor der Steuer", () => {
    const p = berechne([pos({ epNetto: 1000 })], [], {
      ...RAHMEN,
      rabattProzent: 10,
      lieferungNetto: 0,
    });
    expect(p.gesamtRabatt).toBe(100);
    expect(p.netto).toBe(900);
    expect(p.ust).toBe(180);
    expect(p.brutto).toBe(1080);
  });

  it("lässt bei Nullsteuersatz keine Steuer übrig", () => {
    const p = berechne([pos({ epNetto: 1000 })], [], {
      ustSatz: 0,
      rabattProzent: 0,
      lieferungNetto: 299,
    });
    expect(p.ust).toBe(0);
    expect(p.lieferungBrutto).toBe(299);
    expect(p.gesamt).toBe(1299);
  });

  /*
   * Optionale Positionen dürfen die Hauptsumme nicht anheben — sonst
   * verspricht das Angebot einen Preis, den es nicht meint.
   */
  it("hält nicht gewählte Optionen aus der Summe heraus", () => {
    const p = berechne(
      [
        pos({ id: "a", epNetto: 1000 }),
        pos({ id: "o", epNetto: 590, optional: true }),
      ],
      [],
      { ...RAHMEN, lieferungNetto: 0 },
    );
    expect(p.netto).toBe(1000);
    expect(p.optionalNetto).toBe(590);
  });

  it("nimmt gewählte Optionen mit", () => {
    const p = berechne(
      [
        pos({ id: "a", epNetto: 1000 }),
        pos({ id: "o", epNetto: 590, optional: true, gewaehlt: true }),
      ],
      [],
      { ...RAHMEN, lieferungNetto: 0 },
    );
    expect(p.netto).toBe(1590);
    expect(p.optionalNetto).toBe(0);
  });

  /*
   * Der Paketpreis ändert den Verkauf, nicht den Einkauf. Zählte er auch
   * für den EK, zeigte die Marge eine Zahl, die niemand bezahlt hat.
   */
  it("rechnet die Marge gegen den echten Einkauf, auch bei Paketpreis", () => {
    const p = berechne(
      [
        pos({ id: "a", gruppeId: "g1", menge: 20, epNetto: 100, kalkEk: 60 }),
      ],
      [{ id: "g1", paketPreis: 1500 }],
      { ustSatz: 20, rabattProzent: 0, lieferungNetto: 0 },
    );
    expect(p.netto).toBe(1500);
    expect(p.ek).toBe(1200);
    expect(p.marge).toBe(300);
    expect(p.margeProzent).toBe(20);
  });

  it("zählt den Einkauf einer abgewählten Option nicht mit", () => {
    const p = berechne(
      [
        pos({ id: "a", epNetto: 1000, kalkEk: 500 }),
        pos({ id: "o", epNetto: 590, optional: true, kalkEk: 490 }),
      ],
      [],
      { ustSatz: 20, rabattProzent: 0, lieferungNetto: 0 },
    );
    expect(p.ek).toBe(500);
  });

  it("teilt bei leerem Angebot nicht durch null", () => {
    const p = berechne([], [], { ustSatz: 20, rabattProzent: 0, lieferungNetto: 0 });
    expect(p.netto).toBe(0);
    expect(p.margeProzent).toBe(0);
    expect(p.gesamt).toBe(0);
  });

  /*
   * Eine Position, deren Gruppe gelöscht wurde, darf nicht verschwinden.
   * Beim Auflösen einer Gruppe bleibt gruppe_id kurz auf einer ID, die
   * es nicht mehr gibt — der Betrag gehört trotzdem ins Angebot.
   */
  it("verliert keine Position, deren Gruppe es nicht mehr gibt", () => {
    const p = berechne(
      [pos({ id: "a", gruppeId: "weg", epNetto: 400 })],
      [],
      { ustSatz: 0, rabattProzent: 0, lieferungNetto: 0 },
    );
    expect(p.netto).toBe(400);
  });
});
