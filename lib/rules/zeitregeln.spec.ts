import { describe, expect, it } from "vitest";
import {
  STANDARD_ZEITREGELN,
  ausJson,
  aufschlagMinuten,
  pausenabzug,
  runde,
  zuschlaege,
  type Zeitregeln,
} from "./zeitregeln";

const regeln: Zeitregeln = { ...STANDARD_ZEITREGELN };

describe("runde", () => {
  it("lässt ohne Rundung alles stehen", () => {
    expect(runde(487, { ...regeln, rundungMin: 0 })).toBe(487);
  });

  it("rundet kaufmännisch, nicht abwärts", () => {
    const r = { ...regeln, rundungMin: 15 };
    // 7 Minuten fallen weg, 8 Minuten werden aufgerundet — sonst geht die
    // Rundung systematisch zulasten des Mitarbeiters.
    expect(runde(7, r)).toBe(0);
    expect(runde(8, r)).toBe(15);
    expect(runde(487, r)).toBe(matheRunde(487, 15));
  });

  it("wird nie negativ", () => {
    expect(runde(-30, { ...regeln, rundungMin: 15 })).toBe(0);
  });
});

function matheRunde(n: number, schritt: number): number {
  return Math.round(n / schritt) * schritt;
}

describe("pausenabzug", () => {
  it("zieht unter der Schwelle nichts ab", () => {
    expect(pausenabzug(300, 0, regeln)).toEqual({ nettoMin: 300, abzugMin: 0 });
  });

  it("zieht ab der Schwelle die volle Pause ab", () => {
    expect(pausenabzug(480, 0, regeln)).toEqual({ nettoMin: 450, abzugMin: 30 });
  });

  it("rechnet eine selbst gebuchte Pause an", () => {
    // Wer 30 Minuten ausgestempelt hat, zahlt sie nicht ein zweites Mal.
    expect(pausenabzug(480, 30, regeln)).toEqual({ nettoMin: 480, abzugMin: 0 });
    expect(pausenabzug(480, 10, regeln)).toEqual({ nettoMin: 460, abzugMin: 20 });
  });

  it("läuft bei absurder Einstellung nicht ins Minus", () => {
    const wild = { ...regeln, pauseAbMin: 1, pauseAbzugMin: 600 };
    expect(pausenabzug(60, 0, wild)).toEqual({ nettoMin: 0, abzugMin: 60 });
  });

  it("ist abschaltbar", () => {
    const aus = { ...regeln, pauseAbMin: 0 };
    expect(pausenabzug(600, 0, aus)).toEqual({ nettoMin: 600, abzugMin: 0 });
  });
});

/*
 * Für die Zuschläge wird ein einfacher Kalender gestellt: der Test soll die
 * Regel prüfen, nicht die Zeitzonenbibliothek. Minute 0 ist Montag 00:00.
 */
function kalender(feiertage: number[] = []) {
  return (ms: number) => {
    const minuten = Math.floor(ms / 60000);
    const tagNr = Math.floor(minuten / 1440);
    return {
      // Tag 0 ist Montag -> Wochentag 1; Sonntag ist 0.
      wochentag: (tagNr + 1) % 7,
      minuteDesTages: minuten % 1440,
      istFeiertag: feiertage.includes(tagNr),
    };
  };
}

const MIN = 60_000;

describe("zuschlaege", () => {
  it("erkennt einen gewöhnlichen Arbeitstag ohne Zuschlag", () => {
    // Montag 07:00 bis 16:00
    const bloecke = zuschlaege(7 * 60 * MIN, 16 * 60 * MIN, regeln, kalender());
    expect(bloecke).toEqual([{ art: "normal", minuten: 540, prozent: 0 }]);
  });

  it("teilt einen langen Tag in normal, abend und nacht", () => {
    // Montag 16:00 bis 23:00 -> 2 h normal, 4 h abend, 1 h nacht
    const bloecke = zuschlaege(16 * 60 * MIN, 23 * 60 * MIN, regeln, kalender());
    expect(bloecke).toEqual([
      { art: "normal", minuten: 120, prozent: 0 },
      { art: "abend", minuten: 240, prozent: 25 },
      { art: "nacht", minuten: 60, prozent: 50 },
    ]);
  });

  it("rechnet über Mitternacht hinweg richtig", () => {
    // Montag 21:00 bis Dienstag 07:00
    const bloecke = zuschlaege(21 * 60 * MIN, 31 * 60 * MIN, regeln, kalender());
    // 21–22 abend, 22–06 nacht, 06–07 normal
    expect(bloecke).toEqual([
      { art: "normal", minuten: 60, prozent: 0 },
      { art: "abend", minuten: 60, prozent: 25 },
      { art: "nacht", minuten: 480, prozent: 50 },
    ]);
  });

  it("lässt den Tagestyp die Uhrzeit schlagen", () => {
    /*
     * Sonntagabend ist Sonntag, nicht Sonntag plus Abend. Ein Betrieb
     * rechnet das nicht doppelt ab.
     */
    const sonntag = 6 * 1440; // Tag 6 = Sonntag
    const bloecke = zuschlaege(
      (sonntag + 19 * 60) * MIN,
      (sonntag + 23 * 60) * MIN,
      regeln,
      kalender(),
    );
    expect(bloecke).toEqual([{ art: "sonntag", minuten: 240, prozent: 100 }]);
  });

  it("lässt den Feiertag den Sonntag schlagen", () => {
    const sonntag = 6 * 1440;
    const bloecke = zuschlaege(
      (sonntag + 8 * 60) * MIN,
      (sonntag + 12 * 60) * MIN,
      regeln,
      kalender([6]),
    );
    expect(bloecke).toEqual([{ art: "feiertag", minuten: 240, prozent: 100 }]);
  });

  it("liefert für eine leere Spanne nichts", () => {
    expect(zuschlaege(0, 0, regeln, kalender())).toEqual([]);
  });
});

describe("aufschlagMinuten", () => {
  it("rechnet den Aufschlag in Minuten", () => {
    expect(
      aufschlagMinuten([
        { art: "normal", minuten: 480, prozent: 0 },
        { art: "nacht", minuten: 60, prozent: 50 },
        { art: "sonntag", minuten: 120, prozent: 100 },
      ]),
    ).toBe(150);
  });

  it("ist ohne Zuschläge null", () => {
    expect(aufschlagMinuten([{ art: "normal", minuten: 480, prozent: 0 }])).toBe(0);
  });
});

describe("ausJson", () => {
  it("füllt Fehlendes aus dem Standard", () => {
    expect(ausJson({})).toEqual(STANDARD_ZEITREGELN);
    expect(ausJson(null)).toEqual(STANDARD_ZEITREGELN);
  });

  it("übernimmt gültige Werte", () => {
    const r = ausJson({ rundungMin: 15, abendAb: "17:30" });
    expect(r.rundungMin).toBe(15);
    expect(r.abendAb).toBe("17:30");
  });

  it("weist Unsinn ab, statt ihn zu übernehmen", () => {
    // Eine kaputte Zeile in der Datenbank darf die Zeitrechnung nicht kippen.
    const r = ausJson({ rundungMin: -5, abendAb: "abends", pauseAbzugMin: "viel" });
    expect(r.rundungMin).toBe(STANDARD_ZEITREGELN.rundungMin);
    expect(r.abendAb).toBe(STANDARD_ZEITREGELN.abendAb);
    expect(r.pauseAbzugMin).toBe(STANDARD_ZEITREGELN.pauseAbzugMin);
  });
});
