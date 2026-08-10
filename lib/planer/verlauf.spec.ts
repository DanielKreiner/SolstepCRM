import { describe, expect, it } from "vitest";
import {
  kannVor,
  kannZurueck,
  VERLAUF_TIEFE,
  verlaufErsetzen,
  verlaufSetzen,
  verlaufStart,
  vor,
  zurueck,
} from "./verlauf";

describe("Verlauf", () => {
  it("beginnt ohne Vergangenheit und ohne Zukunft", () => {
    const v = verlaufStart("a");
    expect(v.gegenwart).toBe("a");
    expect(kannZurueck(v)).toBe(false);
    expect(kannVor(v)).toBe(false);
    // Rückwärts am Anfang darf nicht knallen, sondern nichts tun.
    expect(zurueck(v)).toEqual(v);
    expect(vor(v)).toEqual(v);
  });

  it("geht Schritt für Schritt zurück und wieder vor", () => {
    let v = verlaufStart("a");
    v = verlaufSetzen(v, "b");
    v = verlaufSetzen(v, "c");

    v = zurueck(v);
    expect(v.gegenwart).toBe("b");
    v = zurueck(v);
    expect(v.gegenwart).toBe("a");
    expect(kannZurueck(v)).toBe(false);

    v = vor(v);
    expect(v.gegenwart).toBe("b");
    v = vor(v);
    expect(v.gegenwart).toBe("c");
    expect(kannVor(v)).toBe(false);
  });

  it("verwirft die Zukunft, sobald nach einem Rückschritt weitergearbeitet wird", () => {
    let v = verlaufStart("a");
    v = verlaufSetzen(v, "b");
    v = verlaufSetzen(v, "c");
    v = zurueck(v); // bei "b", "c" liegt in der Zukunft
    expect(kannVor(v)).toBe(true);

    v = verlaufSetzen(v, "x");
    expect(kannVor(v)).toBe(false);
    v = zurueck(v);
    expect(v.gegenwart).toBe("b");
  });

  it("legt beim Ersetzen keinen Schritt an", () => {
    /*
     * Der Fall aus der Praxis: ein Eckpunkt wird gezogen. Dreissig
     * Zwischenstände dürfen nicht dreissig Rückschritte werden — sonst
     * schiebt Undo den Punkt pixelweise zurück.
     */
    let v = verlaufStart("a");
    v = verlaufSetzen(v, "b"); // Ziehen beginnt
    for (const zwischen of ["b1", "b2", "b3"]) v = verlaufErsetzen(v, zwischen);

    expect(v.gegenwart).toBe("b3");
    expect(v.vergangenheit).toEqual(["a"]);
    v = zurueck(v);
    expect(v.gegenwart).toBe("a");
  });

  it("hält die Tiefe ein und wirft die ältesten Schritte weg", () => {
    let v = verlaufStart(0);
    for (let i = 1; i <= VERLAUF_TIEFE + 30; i++) v = verlaufSetzen(v, i);

    expect(v.vergangenheit).toHaveLength(VERLAUF_TIEFE);
    // Ganz zurück: der älteste noch erreichbare Stand, nicht 0.
    while (kannZurueck(v)) v = zurueck(v);
    expect(v.gegenwart).toBe(30);
  });

  it("erfüllt die geforderten mindestens 50 Schritte", () => {
    let v = verlaufStart(0);
    for (let i = 1; i <= 50; i++) v = verlaufSetzen(v, i);
    for (let i = 0; i < 50; i++) v = zurueck(v);
    expect(v.gegenwart).toBe(0);
  });
});
