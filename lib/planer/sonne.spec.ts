import { describe, expect, it } from "vitest";
import { sonnenrichtung, sonnenstand, stichpunkte } from "./sonne";

/*
 * Der Sonnenstand ist gegen Werte geprüft, die sich unabhängig
 * nachrechnen lassen — nicht gegen die eigene Ausgabe. Ein Schatten, der
 * eine Stunde zu früh fällt, sieht am Bildschirm völlig plausibel aus;
 * bemerkt wird er erst, wenn die Anlage auf dem Dach ist.
 */

const LINZ = { lat: 48.30604, lon: 14.28583 };

describe("Sonnenstand", () => {
  it("erreicht zur Sommersonnenwende die erwartete Mittagshöhe", () => {
    /*
     * Zu Mittag am längsten Tag steht die Sonne
     *   90° − Breite + Achsneigung = 90 − 48,306 + 23,44 = 65,13°
     * über dem Horizont. Das ist reine Geometrie und von der Rechnung
     * hier unabhängig.
     *
     * Der Sonnenhöchststand in Linz liegt nicht um 12:00, sondern gegen
     * 11:07 UTC (Längengrad 14,29° Ost).
     */
    const s = sonnenstand(LINZ.lat, LINZ.lon, new Date("2026-06-21T11:07:00Z"));
    expect(s.hoehe).toBeCloseTo(65.13, 0);
    // Zu Mittag steht sie im Süden.
    expect(Math.abs(s.azimut - 180)).toBeLessThan(2);
  });

  it("erreicht zur Wintersonnenwende die erwartete Mittagshöhe", () => {
    // 90 − 48,306 − 23,44 = 18,25°
    const s = sonnenstand(LINZ.lat, LINZ.lon, new Date("2026-12-21T11:07:00Z"));
    expect(s.hoehe).toBeCloseTo(18.25, 0);
    expect(Math.abs(s.azimut - 180)).toBeLessThan(2);
  });

  it("steht zum Äquinoktium mittags auf 90° minus Breite", () => {
    // Zur Tagundnachtgleiche ist die Deklination 0: 90 − 48,306 = 41,69°
    const s = sonnenstand(LINZ.lat, LINZ.lon, new Date("2026-03-20T11:07:00Z"));
    expect(s.hoehe).toBeCloseTo(41.69, 0);
  });

  it("geht im Osten auf und im Westen unter", () => {
    /*
     * Zur Tagundnachtgleiche genau in Ost und West — das ist die
     * Kontrolle für die Zählrichtung des Azimuts. Wer ab Süden zählt
     * oder das Vorzeichen dreht, spiegelt hier Ost und West.
     */
    const morgens = sonnenstand(LINZ.lat, LINZ.lon, new Date("2026-03-20T05:15:00Z"));
    expect(morgens.azimut).toBeGreaterThan(80);
    expect(morgens.azimut).toBeLessThan(100);

    const abends = sonnenstand(LINZ.lat, LINZ.lon, new Date("2026-03-20T17:00:00Z"));
    expect(abends.azimut).toBeGreaterThan(260);
    expect(abends.azimut).toBeLessThan(280);
  });

  it("steht nachts unter dem Horizont", () => {
    const nachts = sonnenstand(LINZ.lat, LINZ.lon, new Date("2026-06-21T00:00:00Z"));
    expect(nachts.hoehe).toBeLessThan(0);
  });

  it("steht im Sommer morgens im Nordosten", () => {
    /*
     * Am längsten Tag geht die Sonne in Mitteleuropa deutlich nördlich
     * von Ost auf — nicht in Ost. Wer das falsch rechnet, lässt
     * Schatten von Nachbarhäusern in die falsche Richtung fallen.
     */
    const s = sonnenstand(LINZ.lat, LINZ.lon, new Date("2026-06-21T03:00:00Z"));
    expect(s.azimut).toBeGreaterThan(45);
    expect(s.azimut).toBeLessThan(70);
  });
});

describe("Sonnenrichtung als Vektor", () => {
  it("zeigt bei Süd 45° nach Süden und schräg nach oben", () => {
    const v = sonnenrichtung({ hoehe: 45, azimut: 180 });
    // Süden ist negatives y.
    expect(v.y).toBeCloseTo(-Math.cos(Math.PI / 4), 6);
    expect(v.x).toBeCloseTo(0, 6);
    expect(v.z).toBeCloseTo(Math.sin(Math.PI / 4), 6);
  });

  it("zeigt im Zenit senkrecht nach oben", () => {
    const v = sonnenrichtung({ hoehe: 90, azimut: 180 });
    expect(v.z).toBeCloseTo(1, 6);
    expect(Math.hypot(v.x, v.y)).toBeCloseTo(0, 6);
  });

  it("liefert immer einen Einheitsvektor", () => {
    for (const h of [5, 20, 45, 70]) {
      for (const a of [0, 90, 180, 270]) {
        const v = sonnenrichtung({ hoehe: h, azimut: a });
        expect(Math.hypot(v.x, v.y, v.z)).toBeCloseTo(1, 9);
      }
    }
  });
});

describe("Stichzeitpunkte", () => {
  it("gewichtet zusammen auf genau ein Jahr", () => {
    const p = stichpunkte(2026);
    const summe = p.reduce((s, x) => s + x.gewicht, 0);
    expect(summe).toBeCloseTo(1, 6);
  });

  it("gewichtet den Sommer höher als den Winter", () => {
    const p = stichpunkte(2026);
    const juni = p.filter((x) => x.zeit.getUTCMonth() === 5).reduce((s, x) => s + x.gewicht, 0);
    const dez = p.filter((x) => x.zeit.getUTCMonth() === 11).reduce((s, x) => s + x.gewicht, 0);
    expect(juni).toBeGreaterThan(dez * 2);
  });

  it("gewichtet die Mittagsstunden höher als die Randstunden", () => {
    const p = stichpunkte(2026).filter((x) => x.zeit.getUTCMonth() === 5);
    const mittags = p.find((x) => x.zeit.getUTCHours() === 11)!;
    const morgens = p.find((x) => x.zeit.getUTCHours() === 5)!;
    expect(mittags.gewicht).toBeGreaterThan(morgens.gewicht * 2);
  });

  it("liefert für jeden Punkt eine Sonne über dem Horizont oder knapp darunter", () => {
    /*
     * Die Randstunden können im Dezember unter dem Horizont liegen —
     * das ist in Ordnung und fällt in der Verschattungsrechnung heraus.
     * Was NICHT sein darf: mitten am Tag eine Sonne unter dem Horizont,
     * denn das wäre ein Zeitzonenfehler.
     */
    for (const p of stichpunkte(2026)) {
      const s = sonnenstand(LINZ.lat, LINZ.lon, p.zeit);
      const stunde = p.zeit.getUTCHours();
      if (stunde >= 10 && stunde <= 13) {
        expect(s.hoehe, `${p.zeit.toISOString()} sollte Tag sein`).toBeGreaterThan(0);
      }
    }
  });
});
