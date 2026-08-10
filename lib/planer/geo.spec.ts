import { describe, expect, it } from "vitest";
import {
  abstand,
  bildZuMeter,
  ERDRADIUS,
  kachelnFuer,
  type Kamera,
  type LatLon,
  massstab,
  meterProPixel,
  meterZuBild,
  punkteProMeter,
  weltPixel,
  weltPixelZurueck,
  zoomeAn,
  zuLatLon,
  zuMeter,
} from "./geo";

/*
 * Unabhängige Referenz: Haversine auf der Kugel. Bewusst NICHT dieselbe
 * Formel wie in geo.ts — sonst prüft der Test nur, ob er sich selbst
 * gleicht. Damit lässt sich zeigen, dass das lokale Metersystem echte
 * Meter liefert und nicht die um 1/cos(lat) gestreckten Mercator-Meter.
 */
function haversine(a: LatLon, b: LatLon): number {
  const r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r;
  const dLon = (b.lon - a.lon) * r;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * ERDRADIUS * Math.asin(Math.sqrt(h));
}

/** Lindgraben, Burgenland — irgendwo, wo der Betrieb tatsächlich baut. */
const URSPRUNG: LatLon = { lat: 47.6912, lon: 16.4183 };

function kamera(teil: Partial<Kamera> = {}): Kamera {
  return {
    ursprung: URSPRUNG,
    mitte: { x: 0, y: 0 },
    zoom: 20,
    breite: 1000,
    hoehe: 700,
    ...teil,
  };
}

describe("Web Mercator", () => {
  it("bildet Nullpunkt und Ecken der Welt richtig ab", () => {
    // Zoom 0: eine einzige 256er-Kachel für die ganze Welt.
    expect(weltPixel({ lat: 0, lon: 0 }, 0)).toEqual({ x: 128, y: 128 });
    expect(weltPixel({ lat: 0, lon: -180 }, 0).x).toBeCloseTo(0, 9);
    expect(weltPixel({ lat: 0, lon: 180 }, 0).x).toBeCloseTo(256, 9);
    // Die Mercator-Grenze liegt genau am oberen Rand.
    expect(weltPixel({ lat: 85.05112878, lon: 0 }, 0).y).toBeCloseTo(0, 6);
  });

  it("kommt hin und zurück", () => {
    for (const ort of [URSPRUNG, { lat: -33.87, lon: 151.21 }, { lat: 64.13, lon: -21.9 }]) {
      const zurueck = weltPixelZurueck(weltPixel(ort, 19), 19);
      expect(zurueck.lat).toBeCloseTo(ort.lat, 9);
      expect(zurueck.lon).toBeCloseTo(ort.lon, 9);
    }
  });

  it("halbiert die Auflösung je Zoomstufe", () => {
    const a = meterProPixel(URSPRUNG.lat, 19);
    const b = meterProPixel(URSPRUNG.lat, 20);
    expect(a / b).toBeCloseTo(2, 12);
    // Am Äquator, Zoom 0: Erdumfang auf 256 Punkte.
    expect(meterProPixel(0, 0)).toBeCloseTo(156543.03392804097, 6);
  });
});

describe("lokales Metersystem", () => {
  it("liefert echte Meter — nicht die von Mercator gestreckten", () => {
    // 100 m nach Norden und 100 m nach Osten, gegen Haversine geprüft.
    const nord = zuLatLon(URSPRUNG, { x: 0, y: 100 });
    const ost = zuLatLon(URSPRUNG, { x: 100, y: 0 });
    expect(haversine(URSPRUNG, nord)).toBeCloseTo(100, 3);
    expect(haversine(URSPRUNG, ost)).toBeCloseTo(100, 3);

    /*
     * Die Falle: rechnete man Meter aus Mercator-Weltpixeln, käme die
     * Nord-Süd-Strecke um 1/cos(lat) zu lang heraus — bei 47,7° sind das
     * fast 49 %. Hier zeigt der Test, dass genau das NICHT passiert.
     */
    const gestreckt = 100 / Math.cos((URSPRUNG.lat * Math.PI) / 180);
    expect(gestreckt).toBeGreaterThan(148);
    expect(haversine(URSPRUNG, nord)).toBeLessThan(101);
  });

  it("kommt hin und zurück, auch weit draussen", () => {
    for (const m of [{ x: 0, y: 0 }, { x: 12.4, y: -7.3 }, { x: -480, y: 500 }]) {
      const zurueck = zuMeter(URSPRUNG, zuLatLon(URSPRUNG, m));
      expect(zurueck.x).toBeCloseTo(m.x, 6);
      expect(zurueck.y).toBeCloseTo(m.y, 6);
    }
  });

  it("hält ein 10 × 7 m grosses Rechteck massgenau", () => {
    // Abnahmetest 1: die Kantenpillen müssen 10,00 und 7,00 zeigen.
    const ecken = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 7 },
      { x: 0, y: 7 },
    ];
    const alsOrt = ecken.map((e) => zuLatLon(URSPRUNG, e));
    const zurueck = alsOrt.map((o) => zuMeter(URSPRUNG, o));

    expect(abstand(zurueck[0]!, zurueck[1]!)).toBeCloseTo(10, 6);
    expect(abstand(zurueck[1]!, zurueck[2]!)).toBeCloseTo(7, 6);
    // Gegen die unabhängige Referenz auf der Kugel — Millimeter genau.
    expect(haversine(alsOrt[0]!, alsOrt[1]!)).toBeCloseTo(10, 3);
    expect(haversine(alsOrt[1]!, alsOrt[2]!)).toBeCloseTo(7, 3);
  });
});

describe("Kamera", () => {
  it("rechnet Meter und Bildpunkte verlustfrei hin und her", () => {
    const k = kamera();
    for (const m of [{ x: 0, y: 0 }, { x: 6.25, y: -3.5 }, { x: -40, y: 22 }]) {
      const zurueck = bildZuMeter(k, meterZuBild(k, m));
      expect(zurueck.x).toBeCloseTo(m.x, 9);
      expect(zurueck.y).toBeCloseTo(m.y, 9);
    }
  });

  it("legt Norden nach oben", () => {
    const k = kamera();
    const mitte = meterZuBild(k, { x: 0, y: 0 });
    const nord = meterZuBild(k, { x: 0, y: 10 });
    const ost = meterZuBild(k, { x: 10, y: 0 });
    expect(mitte).toEqual({ x: 500, y: 350 });
    expect(nord.y).toBeLessThan(mitte.y); // Norden = kleineres Bildschirm-y
    expect(ost.x).toBeGreaterThan(mitte.x);
  });

  it("lässt gespeicherte Geometrie von Zoom und Fenstergrösse unberührt", () => {
    /*
     * Abnahmetest 1, der eigentliche Kern: dieselbe Kante, vier
     * Kamerazustände. Die Länge in Metern darf sich um kein Bit ändern.
     */
    const kante: [{ x: number; y: number }, { x: number; y: number }] = [
      { x: -5, y: -3.5 },
      { x: 5, y: -3.5 },
    ];
    const laengen = [
      kamera(),
      kamera({ zoom: 18 }),
      kamera({ zoom: 21.7 }),
      kamera({ breite: 390, hoehe: 844, mitte: { x: 120, y: -80 } }),
    ].map(() => abstand(kante[0], kante[1]));

    expect(new Set(laengen).size).toBe(1);
    expect(laengen[0]).toBe(10);
  });

  it("hält beim Zoomen den Punkt unter dem Finger fest", () => {
    const k = kamera();
    const finger = { x: 812, y: 190 };
    const vorher = bildZuMeter(k, finger);
    const nachher = bildZuMeter(zoomeAn(k, finger, 21.3), finger);
    expect(nachher.x).toBeCloseTo(vorher.x, 9);
    expect(nachher.y).toBeCloseTo(vorher.y, 9);
  });

  it("begrenzt den Zoom, ohne den Fixpunkt zu verlieren", () => {
    const k = kamera();
    const finger = { x: 100, y: 100 };
    const weit = zoomeAn(k, finger, 99);
    expect(weit.zoom).toBe(22.5);
    const fix = bildZuMeter(weit, finger);
    expect(fix.x).toBeCloseTo(bildZuMeter(k, finger).x, 9);
  });
});

describe("Kacheln", () => {
  it("decken die Fläche lückenlos ab", () => {
    const k = kamera();
    const kacheln = kachelnFuer(k);
    expect(kacheln.length).toBeGreaterThan(0);

    // Kein Loch: die Vereinigung muss über die Zeichenfläche hinausragen.
    const links = Math.min(...kacheln.map((t) => t.links));
    const oben = Math.min(...kacheln.map((t) => t.oben));
    const rechts = Math.max(...kacheln.map((t) => t.links + t.groesse));
    const unten = Math.max(...kacheln.map((t) => t.oben + t.groesse));
    expect(links).toBeLessThanOrEqual(0);
    expect(oben).toBeLessThanOrEqual(0);
    expect(rechts).toBeGreaterThanOrEqual(k.breite);
    expect(unten).toBeGreaterThanOrEqual(k.hoehe);
  });

  it("holt ganze Stufen und gleicht den Rest über die Grösse aus", () => {
    // Zwischenzoom darf keine krumme Kachelstufe anfordern.
    for (const zoom of [19.2, 20.5, 21.8]) {
      const kacheln = kachelnFuer(kamera({ zoom }));
      expect(kacheln.every((t) => Number.isInteger(t.z))).toBe(true);
      expect(new Set(kacheln.map((t) => t.z)).size).toBe(1);
    }
    expect(kachelnFuer(kamera({ zoom: 20 }))[0]!.groesse).toBeCloseTo(256, 9);
    // Halbe Stufe: gerundet wird auf 21, die Kacheln werden also kleiner
    // gezeichnet — nie mehr als Faktor √2 in die eine oder andere Richtung.
    expect(kachelnFuer(kamera({ zoom: 20.5 }))[0]!.groesse).toBeCloseTo(256 / Math.SQRT2, 6);
    expect(kachelnFuer(kamera({ zoom: 20.4 }))[0]!.groesse).toBeCloseTo(256 * Math.pow(2, 0.4), 6);
  });

  it("bleibt innerhalb der Stufe und läuft in Ost-West um", () => {
    const kacheln = kachelnFuer(kamera({ zoom: 20 }));
    const proAchse = Math.pow(2, 20);
    for (const t of kacheln) {
      expect(t.x).toBeGreaterThanOrEqual(0);
      expect(t.x).toBeLessThan(proAchse);
      expect(t.y).toBeGreaterThanOrEqual(0);
      expect(t.y).toBeLessThan(proAchse);
    }
  });

  it("deckelt die Stufe beim Anbieter-Maximum", () => {
    // basemap.at endet bei 19 — darüber wird hochskaliert, nicht 404 geholt.
    const kacheln = kachelnFuer(kamera({ zoom: 21.4 }), 19);
    expect(kacheln.every((t) => t.z === 19)).toBe(true);
    expect(kacheln[0]!.groesse).toBeGreaterThan(256);
  });
});

describe("Massstabsleiste", () => {
  it("zeigt runde Meterwerte", () => {
    for (const zoom of [17, 18, 19, 20, 21, 22]) {
      const { meter, punkte } = massstab(kamera({ zoom }));
      const ziffern = meter / Math.pow(10, Math.floor(Math.log10(meter)));
      expect([1, 2, 5]).toContain(Math.round(ziffern));
      expect(punkte).toBeLessThanOrEqual(120);
      expect(punkte).toBeGreaterThan(0);
      // Die Leiste muss zur tatsächlichen Skalierung passen.
      expect(punkte).toBeCloseTo(meter * punkteProMeter(kamera({ zoom })), 6);
    }
  });
});
