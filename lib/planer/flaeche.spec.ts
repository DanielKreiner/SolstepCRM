import { describe, expect, it } from "vitest";
import {
  abstandZumRand,
  azimutAusTraufe,
  azimutVon,
  type Dachflaeche,
  dachflaeche,
  falllinie,
  FANG_STANDARD,
  fange,
  grundflaeche,
  imInnenbereich,
  kanteVerschieben,
  punktEinfuegen,
  punktInPolygon,
  schneidetSichSelbst,
  schwerpunkt,
  planlaengeFuerDach,
  setzeKantenlaenge,
  wahreKantenlaenge,
  umfang,
  umlaufGegenUhrzeiger,
  verkuerzt,
  versatzNachInnen,
} from "./flaeche";
import type { Meter } from "./geo";

/** Rechteck 10 × 7 m, Umlauf gegen den Uhrzeigersinn. */
const RECHTECK: Meter[] = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 7 },
  { x: 0, y: 7 },
];

/** L-Form: der Fall, an dem naive Geometrie scheitert. */
const L_FORM: Meter[] = [
  { x: 0, y: 0 },
  { x: 12, y: 0 },
  { x: 12, y: 5 },
  { x: 5, y: 5 },
  { x: 5, y: 11 },
  { x: 0, y: 11 },
];

function dach(teil: Partial<Dachflaeche> = {}): Dachflaeche {
  return {
    id: "f1",
    name: "Fläche 1",
    punkte: RECHTECK,
    neigung: 30,
    azimut: 180,
    traufe: 0,
    randabstand: 0.3,
    hindernisse: [],
    ...teil,
  };
}

describe("Grundgrössen", () => {
  it("misst Fläche und Umfang", () => {
    expect(grundflaeche(RECHTECK)).toBeCloseTo(70, 9);
    expect(umfang(RECHTECK)).toBeCloseTo(34, 9);
    // L-Form: 12×5 plus 5×6 = 60 + 30.
    expect(grundflaeche(L_FORM)).toBeCloseTo(90, 9);
  });

  it("unterscheidet Grundfläche und wahre Dachfläche", () => {
    /*
     * Der Kern von Briefing 1.2: 70 m² Schatten sind bei 45° gut 99 m²
     * Dach. Wer hier die Grundfläche nimmt, verkauft ein Drittel zu
     * wenig Module.
     */
    expect(dachflaeche(RECHTECK, 0)).toBeCloseTo(70, 9);
    expect(dachflaeche(RECHTECK, 30)).toBeCloseTo(70 / Math.cos(Math.PI / 6), 6);
    expect(dachflaeche(RECHTECK, 45)).toBeCloseTo(98.9949, 3);
  });

  it("erkennt den Umlaufsinn und findet den Schwerpunkt", () => {
    expect(umlaufGegenUhrzeiger(RECHTECK)).toBe(true);
    expect(umlaufGegenUhrzeiger(RECHTECK.slice().reverse())).toBe(false);

    const s = schwerpunkt(RECHTECK);
    expect(s.x).toBeCloseTo(5, 9);
    expect(s.y).toBeCloseTo(3.5, 9);

    /*
     * Bei der L-Form liegt er nicht in der Mitte des Umgriffs. Sollwert
     * unabhängig hergeleitet, indem die Form in zwei Rechtecke zerlegt
     * wird — nicht aus der Ausgabe abgeschrieben:
     *   A (0,0)–(12,5):  60 m², Schwerpunkt (6; 2,5)
     *   B (0,5)–(5,11):  30 m², Schwerpunkt (2,5; 8)
     *   x = (60·6 + 30·2,5) / 90 = 4,8333
     *   y = (60·2,5 + 30·8) / 90 = 4,3333
     */
    const sl = schwerpunkt(L_FORM);
    expect(sl.x).toBeCloseTo((60 * 6 + 30 * 2.5) / 90, 6);
    expect(sl.y).toBeCloseTo((60 * 2.5 + 30 * 8) / 90, 6);
  });

  it("verkürzt in der Draufsicht — Abnahmetest 5", () => {
    // Modul 1,762 m in Falllinienrichtung, Dach 45°.
    expect(verkuerzt(1.762, 45)).toBeCloseTo(1.246, 3);
    expect(verkuerzt(1.762, 0)).toBeCloseTo(1.762, 9);
    // Die wahre Fläche bleibt davon unberührt — sie hängt an der Neigung,
    // nicht an der Darstellung.
    expect(dachflaeche(RECHTECK, 30)).not.toBeCloseTo(dachflaeche(RECHTECK, 45), 3);
  });
});

describe("Lage von Punkten", () => {
  it("erkennt innen und aussen, auch konkav", () => {
    expect(punktInPolygon({ x: 5, y: 3 }, RECHTECK)).toBe(true);
    expect(punktInPolygon({ x: 11, y: 3 }, RECHTECK)).toBe(false);

    /*
     * Der eigentliche Test: die Innenecke der L-Form. Ein Punkt im
     * ausgesparten Viertel liegt AUSSERHALB, obwohl er im Umgriff des
     * Polygons steckt — Abnahmetest 4.
     */
    expect(punktInPolygon({ x: 9, y: 9 }, L_FORM)).toBe(false);
    expect(punktInPolygon({ x: 2, y: 9 }, L_FORM)).toBe(true);
    expect(punktInPolygon({ x: 9, y: 2 }, L_FORM)).toBe(true);
  });

  it("misst den Abstand zum Rand", () => {
    expect(abstandZumRand({ x: 5, y: 3.5 }, RECHTECK)).toBeCloseTo(3.5, 9);
    expect(abstandZumRand({ x: 0.4, y: 3.5 }, RECHTECK)).toBeCloseTo(0.4, 9);
    // Auch von aussen gemessen — die Funktion kennt kein Vorzeichen.
    expect(abstandZumRand({ x: -1, y: 3.5 }, RECHTECK)).toBeCloseTo(1, 9);
  });

  it("hält Randabstand und Hindernisse frei", () => {
    const f = dach({
      randabstand: 0.5,
      hindernisse: [
        {
          id: "h1",
          art: "rechteck",
          name: "Kamin",
          punkte: [
            { x: 4, y: 3 },
            { x: 5, y: 3 },
            { x: 5, y: 4 },
            { x: 4, y: 4 },
          ],
          abstand: 0.3,
        },
      ],
    });

    expect(imInnenbereich({ x: 2, y: 2 }, f)).toBe(true);
    // Zu nah am Dachrand.
    expect(imInnenbereich({ x: 0.2, y: 3 }, f)).toBe(false);
    // Im Kamin.
    expect(imInnenbereich({ x: 4.5, y: 3.5 }, f)).toBe(false);
    // Im Sperrsaum um den Kamin — 0,2 m entfernt bei 0,3 m Saum.
    expect(imInnenbereich({ x: 3.8, y: 3.5 }, f)).toBe(false);
    // Knapp ausserhalb des Saums.
    expect(imInnenbereich({ x: 3.6, y: 3.5 }, f)).toBe(true);
  });
});

describe("Gültigkeit", () => {
  it("erkennt einen überschlagenen Umriss", () => {
    expect(schneidetSichSelbst(RECHTECK)).toBe(false);
    expect(schneidetSichSelbst(L_FORM)).toBe(false);
    // Vertauschte Ecken ergeben eine Acht — kein Dach.
    const acht: Meter[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 0, y: 7 },
      { x: 10, y: 7 },
    ];
    expect(schneidetSichSelbst(acht)).toBe(true);
  });

  it("hält ein Dreieck für gültig", () => {
    expect(schneidetSichSelbst([{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 2, y: 4 }])).toBe(false);
  });
});

describe("Bearbeiten", () => {
  it("setzt eine Kante auf ein exaktes Mass — Abnahmetest 2", () => {
    const neu = setzeKantenlaenge(RECHTECK, 0, 12.4);
    expect(neu[0]).toEqual({ x: 0, y: 0 }); // erster Punkt bleibt liegen
    expect(neu[1]!.x).toBeCloseTo(12.4, 9);
    expect(neu[1]!.y).toBeCloseTo(0, 9);
    // Die übrigen Punkte rühren sich nicht.
    expect(neu[2]).toEqual(RECHTECK[2]);
    expect(neu[3]).toEqual(RECHTECK[3]);
  });

  it("lässt sich von unsinnigen Massen nicht aus der Ruhe bringen", () => {
    expect(setzeKantenlaenge(RECHTECK, 0, 0)).toEqual(RECHTECK);
    expect(setzeKantenlaenge(RECHTECK, 0, -3)).toEqual(RECHTECK);
  });

  it("fügt Punkte ein und verschiebt Kanten parallel", () => {
    const mitPunkt = punktEinfuegen(RECHTECK, 0, { x: 5, y: 0 });
    expect(mitPunkt).toHaveLength(5);
    expect(mitPunkt[1]).toEqual({ x: 5, y: 0 });
    expect(grundflaeche(mitPunkt)).toBeCloseTo(70, 9);

    const verschoben = kanteVerschieben(RECHTECK, 0, { x: 0, y: -2 });
    expect(verschoben[0]).toEqual({ x: 0, y: -2 });
    expect(verschoben[1]).toEqual({ x: 10, y: -2 });
    expect(verschoben[2]).toEqual(RECHTECK[2]);
    expect(grundflaeche(verschoben)).toBeCloseTo(90, 9);
  });
});

describe("Fangen", () => {
  const keineKanten: Array<{ a: Meter; b: Meter }> = [];

  it("zieht fast rechte Winkel gerade", () => {
    const von = { x: 0, y: 0 };
    // 2° neben der Waagrechten, bei 4° Toleranz.
    const ziel = { x: 10, y: 0.35 };
    const { punkt, hinweis } = fange(ziel, von, keineKanten);
    expect(hinweis).toBe("rechter-winkel");
    expect(punkt.y).toBeCloseTo(0, 9);
    // Die Länge bleibt erhalten, gedreht wird nur die Richtung.
    expect(punkt.x).toBeCloseTo(Math.hypot(10, 0.35), 9);
  });

  it("lässt deutlich schräge Kanten in Ruhe", () => {
    const { hinweis } = fange({ x: 10, y: 4 }, { x: 0, y: 0 }, keineKanten);
    expect(hinweis).not.toBe("rechter-winkel");
  });

  it("fängt parallel zu einer bestehenden Kante", () => {
    // Bestehende Kante mit 30°.
    const schraeg = { a: { x: 0, y: 0 }, b: { x: Math.cos(Math.PI / 6), y: Math.sin(Math.PI / 6) } };
    const von = { x: 5, y: 5 };
    // 2° daneben — und weit genug von 0/90°, damit der rechte Winkel nicht greift.
    const grad = ((30 + 2) * Math.PI) / 180;
    const ziel = { x: von.x + Math.cos(grad) * 6, y: von.y + Math.sin(grad) * 6 };

    const { punkt, hinweis } = fange(ziel, von, [schraeg]);
    expect(hinweis).toBe("parallel");
    const richtung = (Math.atan2(punkt.y - von.y, punkt.x - von.x) * 180) / Math.PI;
    expect(richtung).toBeCloseTo(30, 6);
  });

  it("rastet aufs Raster, wenn keine Winkelhilfe greift", () => {
    const { punkt, hinweis } = fange({ x: 3.123, y: 4.567 }, { x: 0, y: 0 }, keineKanten, {
      ...FANG_STANDARD,
      rechterWinkel: false,
      parallel: false,
    });
    expect(hinweis).toBe("raster");
    expect(punkt.x).toBeCloseTo(3.1, 9);
    expect(punkt.y).toBeCloseTo(4.55, 9);
  });

  it("lässt sich ganz abschalten", () => {
    const ziel = { x: 10, y: 0.1 };
    const { punkt, hinweis } = fange(ziel, { x: 0, y: 0 }, keineKanten, {
      rechterWinkel: false,
      parallel: false,
      raster: false,
      rasterMass: 0.05,
      toleranz: 4,
    });
    expect(hinweis).toBeNull();
    expect(punkt).toEqual(ziel);
  });
});

describe("Falllinie und Azimut", () => {
  it("rechnet Kompassrichtungen, nicht Mathematikwinkel", () => {
    expect(azimutVon({ x: 0, y: 1 })).toBeCloseTo(0, 9); // Nord
    expect(azimutVon({ x: 1, y: 0 })).toBeCloseTo(90, 9); // Ost
    expect(azimutVon({ x: 0, y: -1 })).toBeCloseTo(180, 9); // Süd
    expect(azimutVon({ x: -1, y: 0 })).toBeCloseTo(270, 9); // West
  });

  it("zeigt von der Traufe weg — bergab", () => {
    /*
     * Traufe ist Kante 0, die untere Kante des Rechtecks (y = 0). Die
     * Fläche liegt darüber, bergab zeigt also nach Süden.
     */
    const f = dach({ traufe: 0 });
    const richtung = falllinie(f)!;
    expect(richtung.x).toBeCloseTo(0, 9);
    expect(richtung.y).toBeCloseTo(-1, 9);
    expect(azimutAusTraufe(f)).toBe(180);
  });

  it("dreht mit, wenn die Traufe eine andere Kante ist", () => {
    // Kante 2 ist die obere Kante — bergab nach Norden.
    expect(azimutAusTraufe(dach({ traufe: 2 }))).toBe(0);
    // Kante 1 ist rechts — bergab nach Osten.
    expect(azimutAusTraufe(dach({ traufe: 1 }))).toBe(90);
    // Kante 3 ist links — bergab nach Westen.
    expect(azimutAusTraufe(dach({ traufe: 3 }))).toBe(270);
  });

  it("hat beim Flachdach keine Falllinie", () => {
    expect(falllinie(dach({ traufe: null }))).toBeNull();
    expect(azimutAusTraufe(dach({ traufe: null }))).toBeNull();
  });
});

describe("Randabstandslinie", () => {
  it("rückt beim Rechteck sauber nach innen", () => {
    const innen = versatzNachInnen(RECHTECK, 0.5);
    expect(innen[0]!.x).toBeCloseTo(0.5, 6);
    expect(innen[0]!.y).toBeCloseTo(0.5, 6);
    expect(innen[2]!.x).toBeCloseTo(9.5, 6);
    expect(innen[2]!.y).toBeCloseTo(6.5, 6);
    expect(grundflaeche(innen)).toBeCloseTo(9 * 6, 6);
  });

  it("rückt bei negativem Abstand nach aussen — der Saum um ein Hindernis", () => {
    /*
     * Ein Kamin sperrt die Fläche RINGS HERUM, nicht in sich. Der Saum
     * ist deshalb ein Versatz nach aussen. Vorher gab die Funktion bei
     * d <= 0 den Umriss unverändert zurück: die Sperrzone wurde exakt
     * auf die Kaminkante gezeichnet und war damit unsichtbar.
     */
    const kamin: Meter[] = [
      { x: 4, y: 3 },
      { x: 5, y: 3 },
      { x: 5, y: 4 },
      { x: 4, y: 4 },
    ];
    const saum = versatzNachInnen(kamin, -0.3);
    // 1 × 1 m plus 0,3 m ringsum ergibt 1,6 × 1,6 m.
    expect(grundflaeche(saum)).toBeCloseTo(1.6 * 1.6, 6);
    for (const p of kamin) expect(punktInPolygon(p, saum)).toBe(true);
  });

  it("dreht sich bei umgekehrtem Umlauf nicht nach aussen", () => {
    const innen = versatzNachInnen(RECHTECK.slice().reverse(), 0.5);
    expect(grundflaeche(innen)).toBeCloseTo(54, 6);
    // Alle Punkte müssen im Original liegen — sonst ging es nach aussen.
    for (const p of innen) expect(punktInPolygon(p, RECHTECK)).toBe(true);
  });
});

describe("Wahre Kantenlängen auf dem geneigten Dach", () => {
  /*
   * Der Punkt, an dem sich der Planer sonst selbst belügt: Gezeichnet
   * wird auf dem Luftbild, also in der Draufsicht. Was dort 8 m misst,
   * sind auf einem 30°-Dach 9,24 m — und genau die misst der Monteur
   * oben nach. Die Fläche wurde von Anfang an richtig gerechnet, die
   * Kantenpillen zeigten aber die Draufsicht.
   */
  const traufeParallel = { x: 1, y: 0 };
  const fall = { x: 0, y: 1 };

  it("lässt eine traufparallele Kante unverändert", () => {
    const a = { x: 0, y: 0 };
    const b = { x: 12, y: 0 };
    expect(wahreKantenlaenge(a, b, fall, 30)).toBeCloseTo(12, 6);
    expect(wahreKantenlaenge(a, b, fall, 45)).toBeCloseTo(12, 6);
  });

  it("streckt eine Kante in Falllinienrichtung", () => {
    const a = { x: 0, y: 0 };
    const b = { x: 0, y: 8 };
    // 8 / cos(30°) = 9,2376
    expect(wahreKantenlaenge(a, b, fall, 30)).toBeCloseTo(9.2376, 3);
    // 8 / cos(45°) = 11,3137
    expect(wahreKantenlaenge(a, b, fall, 45)).toBeCloseTo(11.3137, 3);
  });

  it("streckt eine schräge Kante nur anteilig", () => {
    /*
     * Eine Kante, die 6 m quer und 8 m längs läuft: in der Draufsicht
     * 10 m. Auf 30° wird nur der Längsanteil gestreckt —
     * sqrt(6² + (8/cos30°)²) = sqrt(36 + 85,33) = 11,015 m.
     */
    const a = { x: 0, y: 0 };
    const b = { x: 6, y: 8 };
    expect(wahreKantenlaenge(a, b, fall, 30)).toBeCloseTo(11.0151, 3);
  });

  it("gibt ohne Traufe und bei Flachdach die Draufsicht zurück", () => {
    const a = { x: 0, y: 0 };
    const b = { x: 0, y: 8 };
    // Kein Gefälle bekannt → keine Streckung.
    expect(wahreKantenlaenge(a, b, null, 30)).toBeCloseTo(8, 6);
    expect(wahreKantenlaenge(a, b, fall, 0)).toBeCloseTo(8, 6);
    void traufeParallel;
  });

  it("rechnet eine eingetippte Dachlänge in den Grundriss zurück", () => {
    /*
     * Wer „9,24" an eine Sparrenkante schreibt, meint das Dach. Der
     * Grundriss muss dann 8,00 m werden — sonst wächst die Fläche bei
     * jeder Eingabe um den Neigungsfaktor.
     */
    const a = { x: 0, y: 0 };
    const b = { x: 0, y: 8 };
    const plan = planlaengeFuerDach(a, b, fall, 30, 9.2376);
    expect(plan).toBeCloseTo(8, 3);

    // Und die Gegenprobe: der neue Grundriss ergibt wieder 9,24 m.
    const gestreckt = setzeKantenlaenge([a, b, { x: 5, y: 8 }], 0, plan);
    expect(wahreKantenlaenge(gestreckt[0]!, gestreckt[1]!, fall, 30)).toBeCloseTo(9.2376, 3);
  });

  it("lässt eine traufparallele Eingabe unverändert durch", () => {
    const a = { x: 0, y: 0 };
    const b = { x: 12, y: 0 };
    expect(planlaengeFuerDach(a, b, fall, 30, 14)).toBeCloseTo(14, 6);
  });
});
