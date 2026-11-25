import { describe, expect, it } from "vitest";
import {
  mb,
  passtDurch,
  UPLOAD_MAX_BYTES,
  ZIEL_KANTE,
  zielMasse,
} from "./verkleinern";

/*
 * Diese Tests stehen hier wegen eines Fehlers aus dem Betrieb: Der Kunde
 * hat im Portal ein Foto vom Zählerkasten angehängt und einen
 * Fehlerbildschirm bekommen. Ein Handyfoto ist grösser als das, was eine
 * Server Action ohne Angabe durchlässt.
 *
 * Geprüft wird deshalb die Rechnung, die dafür sorgt, dass ein solches
 * Foto klein genug ankommt — und zwar an den Zahlen echter Kameras,
 * nicht an runden Beispielwerten.
 */

describe("zielMasse", () => {
  it("lässt kleine Bilder unangetastet", () => {
    expect(zielMasse(800, 600)).toEqual({ breite: 800, hoehe: 600 });
  });

  it("rührt ein Bild genau auf der Grenze nicht an", () => {
    expect(zielMasse(ZIEL_KANTE, 1000)).toEqual({
      breite: ZIEL_KANTE,
      hoehe: 1000,
    });
  });

  it("bringt ein Handyfoto im Querformat auf die Zielkante", () => {
    /* 12 Megapixel, wie sie jedes iPhone und Android liefert. */
    expect(zielMasse(4032, 3024)).toEqual({ breite: 2000, hoehe: 1500 });
  });

  it("bringt dasselbe Foto im Hochformat auf die Zielkante", () => {
    /*
     * Der Fall vom Zählerkasten: Hochformat. Die lange Kante ist die
     * Höhe, und begrenzt werden muss sie, nicht die Breite.
     */
    expect(zielMasse(3024, 4032)).toEqual({ breite: 1500, hoehe: 2000 });
  });

  it("erhält das Seitenverhältnis auch bei krummen Massen", () => {
    const { breite, hoehe } = zielMasse(4000, 2250);
    expect(breite).toBe(2000);
    expect(hoehe).toBe(1125);
    expect(breite / hoehe).toBeCloseTo(4000 / 2250, 5);
  });

  it("lässt bei einem extremen Panorama keine Kante auf null fallen", () => {
    /*
     * 8000x3 ist absurd, kommt aber als Ausschnitt vor. Ein Canvas mit
     * Höhe 0 wirft, und dann wäre der Upload wieder kaputt — diesmal
     * für ein Bild, das keiner erwartet.
     */
    const { breite, hoehe } = zielMasse(8000, 3);
    expect(breite).toBe(2000);
    expect(hoehe).toBeGreaterThanOrEqual(1);
  });

  it("gibt bei unbrauchbaren Massen null zurück statt zu rechnen", () => {
    expect(zielMasse(0, 0)).toEqual({ breite: 0, hoehe: 0 });
    expect(zielMasse(-10, 100)).toEqual({ breite: 0, hoehe: 0 });
  });
});

describe("passtDurch", () => {
  it("liegt unter der Plattformgrenze von 4,5 MB", () => {
    /*
     * Der Kern des Ganzen: Die eigene Grenze muss kleiner sein als die,
     * an der die Anfrage ohne eigenen Code abbricht. Sonst sieht der
     * Benutzer wieder einen Absturz statt einer Meldung.
     */
    expect(UPLOAD_MAX_BYTES).toBeLessThan(4.5 * 1024 * 1024);
  });

  it("lässt ein verkleinertes Foto durch", () => {
    /* 2000 px Kante bei Qualität 82 landet erfahrungsgemäss um 400 KB. */
    expect(passtDurch(400 * 1024)).toBe(true);
  });

  it("weist ein unverkleinertes Handyfoto ab", () => {
    expect(passtDurch(5 * 1024 * 1024)).toBe(false);
  });

  it("lässt genau die Grenze noch durch", () => {
    expect(passtDurch(UPLOAD_MAX_BYTES)).toBe(true);
    expect(passtDurch(UPLOAD_MAX_BYTES + 1)).toBe(false);
  });

  it("hätte die 1-MB-Grenze von früher gerissen", () => {
    /*
     * Dokumentiert den Fehler selbst: Mit der Voreinstellung einer
     * Server Action wäre jedes dieser Fotos abgestürzt.
     */
    const handyfotos = [1.8, 2.4, 3.1, 4.6].map((m) => m * 1024 * 1024);
    for (const groesse of handyfotos) {
      expect(groesse).toBeGreaterThan(1024 * 1024);
    }
  });
});

describe("mb", () => {
  it("schreibt Megabyte mit Komma, wie es im Deutschen gehört", () => {
    expect(mb(4 * 1024 * 1024)).toBe("4,0");
    expect(mb(4.63 * 1024 * 1024)).toBe("4,6");
  });
});
