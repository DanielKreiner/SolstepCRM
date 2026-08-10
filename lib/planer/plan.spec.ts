import { describe, expect, it } from "vitest";
import {
  azimutAusTraufe,
  grundflaeche,
  punktInPolygon,
  schneidetSichSelbst,
} from "./flaeche";
import {
  type AssistentEingabe,
  dachformFlaechen,
  leererPlan,
  naechsteId,
  planLesen,
  PLAN_VERSION,
} from "./plan";

const BASIS: AssistentEingabe = {
  form: "sattel",
  breite: 12,
  tiefe: 8,
  mitte: { x: 0, y: 0 },
  drehung: 0,
  neigung: 30,
};

describe("Plandokument", () => {
  it("startet leer und in der richtigen Fassung", () => {
    const p = leererPlan();
    expect(p.version).toBe(PLAN_VERSION);
    expect(p.flaechen).toEqual([]);
  });

  it("fängt kaputte Dokumente ab, statt sie durchzureichen", () => {
    // Genau der Fall, für den die Prüfung da ist: halb geschriebene
    // Geometrie aus einem abgebrochenen Speichern.
    expect(planLesen({ version: 1, flaechen: [{ id: "f1" }] }).flaechen).toEqual([]);
    expect(planLesen(null).flaechen).toEqual([]);
    expect(planLesen("kaputt").flaechen).toEqual([]);
    expect(planLesen({ version: 1, flaechen: [{ id: "f1", punkte: [{ x: 0, y: 0 }] }] }).flaechen)
      .toEqual([]);
  });

  it("nimmt ein gültiges Dokument an und füllt Vorgaben", () => {
    const p = planLesen({
      version: 1,
      flaechen: [
        {
          id: "f1",
          punkte: [
            { x: 0, y: 0 },
            { x: 5, y: 0 },
            { x: 5, y: 4 },
          ],
        },
      ],
    });
    expect(p.flaechen).toHaveLength(1);
    expect(p.flaechen[0]!.neigung).toBe(30);
    expect(p.flaechen[0]!.randabstand).toBe(0.3);
    expect(p.flaechen[0]!.hindernisse).toEqual([]);
  });

  it("vergibt Kennungen ohne Zufall", () => {
    expect(naechsteId([], "f")).toBe("f1");
    expect(naechsteId(["f1", "f2"], "f")).toBe("f3");
    expect(naechsteId(["f2"], "f")).toBe("f1");
  });
});

describe("Dachform-Assistent", () => {
  it("Pultdach: eine Fläche, volle Grundfläche", () => {
    const f = dachformFlaechen({ ...BASIS, form: "pult" }, []);
    expect(f).toHaveLength(1);
    expect(grundflaeche(f[0]!.punkte)).toBeCloseTo(96, 6);
    expect(f[0]!.traufe).toBe(0);
  });

  it("Satteldach: zwei Flächen mit gegenläufigem Azimut", () => {
    const f = dachformFlaechen({ ...BASIS, form: "sattel" }, []);
    expect(f).toHaveLength(2);
    // Zusammen wieder die volle Grundfläche, je Hälfte die Hälfte.
    expect(grundflaeche(f[0]!.punkte)).toBeCloseTo(48, 6);
    expect(grundflaeche(f[1]!.punkte)).toBeCloseTo(48, 6);
    // Gegenläufig: 180° auseinander.
    const d = Math.abs(f[0]!.azimut - f[1]!.azimut);
    expect(Math.min(d, 360 - d)).toBeCloseTo(180, 6);
    expect(f[0]!.azimut).toBe(180); // Traufe unten → bergab nach Süden
    expect(f[1]!.azimut).toBe(0);
  });

  it("Walmdach: zwei Trapeze, zwei Dreiecke — Abnahmetest 3", () => {
    const f = dachformFlaechen({ ...BASIS, form: "walm" }, []);
    expect(f).toHaveLength(4);
    expect(f.filter((x) => x.punkte.length === 4)).toHaveLength(2);
    expect(f.filter((x) => x.punkte.length === 3)).toHaveLength(2);

    // Die vier Teile decken den Grundriss lückenlos und ohne Überlappung.
    const summe = f.reduce((s, x) => s + grundflaeche(x.punkte), 0);
    expect(summe).toBeCloseTo(12 * 8, 6);

    // Alle vier Himmelsrichtungen genau einmal.
    expect(new Set(f.map((x) => x.azimut))).toEqual(new Set([0, 90, 180, 270]));
    for (const x of f) expect(schneidetSichSelbst(x.punkte)).toBe(false);
  });

  it("Walmdach wird zum Zeltdach, wenn kein First übrig bleibt", () => {
    // Quadratischer Baukörper: der First hätte die Länge null.
    const f = dachformFlaechen({ ...BASIS, form: "walm", breite: 8, tiefe: 8 }, []);
    expect(f).toHaveLength(4);
    expect(f.every((x) => x.punkte.length === 3)).toBe(true);
  });

  it("Zeltdach: vier Dreiecke, zusammen der ganze Grundriss", () => {
    const f = dachformFlaechen({ ...BASIS, form: "zelt" }, []);
    expect(f).toHaveLength(4);
    expect(f.every((x) => x.punkte.length === 3)).toBe(true);
    expect(f.reduce((s, x) => s + grundflaeche(x.punkte), 0)).toBeCloseTo(96, 6);
    expect(new Set(f.map((x) => x.azimut))).toEqual(new Set([0, 90, 180, 270]));
  });

  it("Flachdach: keine Neigung, keine Traufe, grösserer Randabstand", () => {
    const f = dachformFlaechen({ ...BASIS, form: "flach" }, []);
    expect(f).toHaveLength(1);
    expect(f[0]!.neigung).toBe(0);
    expect(f[0]!.traufe).toBeNull();
    expect(azimutAusTraufe(f[0]!)).toBeNull();
    // 1,00 m Windlast-Randzone statt 0,30 m (Briefing 4.4).
    expect(f[0]!.randabstand).toBe(1);
  });

  it("dreht das ganze Dach mit", () => {
    const gerade = dachformFlaechen({ ...BASIS, form: "sattel" }, []);
    const gedreht = dachformFlaechen({ ...BASIS, form: "sattel", drehung: 30 }, []);

    // Flächeninhalt bleibt — Drehen ist längentreu.
    expect(grundflaeche(gedreht[0]!.punkte)).toBeCloseTo(grundflaeche(gerade[0]!.punkte), 6);
    // Der Azimut wandert um genau denselben Betrag.
    expect(gedreht[0]!.azimut).toBe((gerade[0]!.azimut - 30 + 360) % 360);
  });

  it("setzt das Dach an die gewünschte Stelle", () => {
    const f = dachformFlaechen({ ...BASIS, form: "flach", mitte: { x: 20, y: -10 } }, []);
    expect(punktInPolygon({ x: 20, y: -10 }, f[0]!.punkte)).toBe(true);
    expect(punktInPolygon({ x: 0, y: 0 }, f[0]!.punkte)).toBe(false);
  });

  it("vergibt fortlaufende Kennungen neben bestehenden Flächen", () => {
    const erste = dachformFlaechen({ ...BASIS, form: "pult" }, []);
    const zweite = dachformFlaechen({ ...BASIS, form: "pult" }, erste);
    expect(erste[0]!.id).toBe("f1");
    expect(zweite[0]!.id).toBe("f2");
    expect(zweite[0]!.name).not.toBe(erste[0]!.name);
  });
});
