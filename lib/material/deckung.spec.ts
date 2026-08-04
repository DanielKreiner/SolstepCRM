import { describe, expect, it } from "vitest";
import { deckung, gedeckt, materialGate } from "@/lib/material/deckung";

const basis = {
  menge: 10,
  aufVorgang: 0,
  imLager: 0,
  bestellt: 0,
  terminReicht: false,
};

describe("deckung", () => {
  it("nennt vollständig gebuchtes Material geladen", () => {
    expect(deckung({ ...basis, aufVorgang: 10 })).toBe("geladen");
  });

  it("rechnet die Restmenge gegen den Lagerbestand", () => {
    expect(deckung({ ...basis, aufVorgang: 6, imLager: 4 })).toBe("im_lager");
    expect(deckung({ ...basis, aufVorgang: 6, imLager: 3 })).toBe("offen");
  });

  it("zählt eine Bestellung nur mit passendem Termin", () => {
    expect(deckung({ ...basis, bestellt: 10, terminReicht: true })).toBe("bestellt");
    expect(deckung({ ...basis, bestellt: 10, terminReicht: false })).toBe("offen");
  });

  it("bevorzugt den Lagerbestand vor der Bestellung", () => {
    expect(deckung({ ...basis, imLager: 10, bestellt: 10, terminReicht: true })).toBe("im_lager");
  });
});

describe("gedeckt", () => {
  it("lässt bestellt gelten, streng aber nicht", () => {
    expect(gedeckt("bestellt", false)).toBe(true);
    expect(gedeckt("bestellt", true)).toBe(false);
    expect(gedeckt("im_lager", true)).toBe(true);
    expect(gedeckt("offen", false)).toBe(false);
  });
});

describe("materialGate", () => {
  it("ist ohne Bedarfsliste nicht berechenbar", () => {
    expect(materialGate([], false)).toBeNull();
  });

  it("wird grün, wenn alles gedeckt ist", () => {
    expect(materialGate(["bestellt", "im_lager", "geladen"], false)).toBe("erledigt");
  });

  it("bleibt gelb, solange eine Position offen ist", () => {
    expect(materialGate(["geladen", "offen"], false)).toBe("laeuft");
  });

  it("ist rot, wenn nichts angestossen wurde", () => {
    expect(materialGate(["offen", "offen"], false)).toBe("offen");
  });

  it("wird streng erst mit der Ware im Haus grün", () => {
    expect(materialGate(["bestellt", "im_lager"], true)).toBe("laeuft");
    expect(materialGate(["im_lager", "geladen"], true)).toBe("erledigt");
  });
});
