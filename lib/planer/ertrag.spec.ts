import { describe, expect, it } from "vitest";
import {
  anlagenErtrag,
  ausrichtungsFaktor,
  cacheSchluessel,
  fallbackErtrag,
  pvgisAspekt,
  REFERENZ,
  regionAus,
  zwischenwert,
} from "./ertrag";

describe("Azimut in die PVGIS-Zählweise", () => {
  it("übersetzt die vier Himmelsrichtungen", () => {
    /*
     * Wir zählen ab Nord im Uhrzeigersinn, PVGIS ab Süd. Wer das
     * verwechselt, plant ein Süddach als Norddach — und liegt beim
     * Ertrag um 40 % daneben, ohne dass irgendetwas rot wird.
     */
    expect(pvgisAspekt(180)).toBe(0); // Süd
    expect(pvgisAspekt(90)).toBe(-90); // Ost
    expect(pvgisAspekt(270)).toBe(90); // West
    expect(pvgisAspekt(0)).toBe(180); // Nord
    expect(pvgisAspekt(360)).toBe(180);
  });

  it("bleibt im Band von −180 bis +180", () => {
    for (const a of [0, 45, 90, 135, 180, 225, 270, 315, 359, 720, -90]) {
      const p = pvgisAspekt(a);
      expect(p).toBeGreaterThan(-181);
      expect(p).toBeLessThanOrEqual(180);
    }
  });
});

describe("Ausrichtungsfaktor", () => {
  it("trifft die gemessenen Eckwerte", () => {
    // Das Optimum liegt bei Süd 45°, nicht bei 30° — knapp, aber messbar.
    expect(ausrichtungsFaktor(180, 45)).toBeCloseTo(1.0, 6);
    expect(ausrichtungsFaktor(180, 30)).toBeCloseTo(0.998, 6);
    // Flachdach: rund ein Sechstel weniger, egal wohin es zeigt.
    expect(ausrichtungsFaktor(180, 0)).toBeCloseTo(0.846, 6);
    expect(ausrichtungsFaktor(0, 0)).toBeCloseTo(0.846, 6);
    // Ost und West bei 30° liegen gleichauf.
    expect(ausrichtungsFaktor(90, 30)).toBeCloseTo(0.803, 6);
    expect(ausrichtungsFaktor(270, 30)).toBeCloseTo(0.803, 6);
    // Nord bei 45° ist die schlechteste übliche Lage eines Schrägdachs.
    expect(ausrichtungsFaktor(0, 45)).toBeCloseTo(0.426, 6);
  });

  it("deckt sich mit unabhängig abgefragten PVGIS-Werten", () => {
    /*
     * Kontrolle gegen drei Abfragen, die NICHT in die Tabelle
     * eingeflossen sind — Linz bei 30°, direkt bei PVGIS geholt:
     *
     *   Süd  1116 kWh/kWp     Ost  888 (0,796 von Süd)
     *   Nord  632 (0,566 von Süd)
     *
     * Die Tabelle mittelt Ost und West, der Kontrollwert ist reiner
     * Osten — ein Prozentpunkt Abstand ist deshalb erwartet und in
     * Ordnung. Mehr als zwei wäre ein Kalibrierfehler.
     */
    const sued = ausrichtungsFaktor(180, 30);
    expect(Math.abs(ausrichtungsFaktor(90, 30) / sued - 888 / 1116)).toBeLessThan(0.02);
    expect(Math.abs(ausrichtungsFaktor(0, 30) / sued - 632 / 1116)).toBeLessThan(0.02);
  });

  it("interpoliert zwischen den Stützstellen", () => {
    // Süd 22,5° liegt genau zwischen 15° (0,946) und 30° (0,998).
    expect(ausrichtungsFaktor(180, 22.5)).toBeCloseTo(0.972, 6);
    // Südost (Azimut 135° = 45° Abweichung) bei 30°.
    expect(ausrichtungsFaktor(135, 30)).toBeCloseTo(0.942, 6);
    // 5°-Stufen liefern eigene Werte — die Anzeige springt nicht.
    expect(ausrichtungsFaktor(180, 35)).not.toBeCloseTo(ausrichtungsFaktor(180, 30), 4);
  });

  it("fällt von Süd nach Nord monoton", () => {
    let vorher = Infinity;
    for (let abweichung = 0; abweichung <= 180; abweichung += 5) {
      const f = ausrichtungsFaktor(180 - abweichung, 35);
      expect(f).toBeLessThanOrEqual(vorher + 1e-9);
      vorher = f;
    }
  });

  it("behandelt Ost und West spiegelbildlich", () => {
    for (const versatz of [15, 45, 75, 120]) {
      expect(ausrichtungsFaktor(180 - versatz, 35)).toBeCloseTo(
        ausrichtungsFaktor(180 + versatz, 35),
        9,
      );
    }
  });
});

describe("Fallback", () => {
  const linz = { lat: 48.306, lon: 14.286, azimut: 180, neigung: 30, verlustProzent: 14 };

  it("kommt dem echten PVGIS-Wert nahe genug, um ihn zu vertreten", () => {
    /*
     * PVGIS sagt für Linz, Süd 30°, 14 % Verlust: 1116 kWh/kWp. Der
     * Fallback rechnet mit dem Landesmittel und kann das nicht exakt
     * treffen — aber er muss in derselben Grössenordnung landen, sonst
     * springt die Zahl vor den Augen des Kunden, sobald PVGIS wieder
     * antwortet.
     */
    const e = fallbackErtrag(linz);
    expect(e.quelle).toBe("geschaetzt");
    expect(e.spezifisch).toBeGreaterThan(1116 * 0.9);
    expect(e.spezifisch).toBeLessThan(1116 * 1.1);
  });

  it("gibt bei 35° Süd genau den Referenzwert aus", () => {
    // Dafür wurde er gemessen — hier darf nichts danebenliegen.
    expect(fallbackErtrag({ ...linz, neigung: 35 }).spezifisch).toBeCloseTo(1160, 4);
  });

  it("verrechnet abweichende Systemverluste", () => {
    // Weniger Verlust heisst mehr Ertrag, und zwar anteilig.
    const normal = fallbackErtrag({ ...linz, neigung: 35 }).spezifisch;
    const besser = fallbackErtrag({ ...linz, neigung: 35, verlustProzent: 10 });
    expect(besser.spezifisch).toBeCloseTo(normal * (90 / 86), 4);
    expect(besser.spezifisch).toBeGreaterThan(normal);
  });

  it("verteilt den Jahresertrag auf zwölf Monate, die sich zum Ganzen summieren", () => {
    const e = fallbackErtrag(linz);
    expect(e.monate).toHaveLength(12);
    const summe = e.monate.reduce((s, m) => s + m, 0);
    expect(summe).toBeCloseTo(e.spezifisch, 4);
    // Juli trägt gut das Dreifache des Dezembers — das entscheidet
    // später, ob ein Speicher im Winter überhaupt etwas ausrichtet.
    expect(e.monate[6]!).toBeGreaterThan(e.monate[11]! * 3);
  });

  it("nimmt für Deutschland den niedrigeren Referenzwert", () => {
    // Nördlich von 48,8° liegt der Referenzwert tiefer.
    expect(regionAus(48.306)).toBe("AT");
    expect(regionAus(52.5)).toBe("DE");
    const berlin = fallbackErtrag({ ...linz, lat: 52.5, neigung: 35 }, "DE");
    expect(berlin.spezifisch).toBeCloseTo(1040, 4);
    expect(berlin.spezifisch).toBeLessThan(fallbackErtrag({ ...linz, neigung: 35 }).spezifisch);
  });
});

describe("Summe über die Anlage", () => {
  it("rechnet ein Ost-West-Dach mit beiden Azimuten (Abnahmetest 12)", () => {
    /*
     * Ein gemittelter Azimut wäre hier grob falsch: Ost und West
     * mitteln sich rechnerisch zu Süd, und der Ertrag käme 12 % zu hoch
     * heraus. Jede Gruppe bringt deshalb ihren eigenen spezifischen
     * Ertrag mit.
     */
    const ost = REFERENZ.AT * ausrichtungsFaktor(90, 30);
    const west = REFERENZ.AT * ausrichtungsFaktor(270, 30);
    const a = anlagenErtrag([
      { kwp: 5, spezifisch: ost },
      { kwp: 5, spezifisch: west },
    ]);

    expect(a.kwp).toBe(10);
    expect(a.jahresertragKwh).toBeCloseTo(5 * ost + 5 * west, 6);
    expect(a.spezifischMittel).toBeCloseTo((ost + west) / 2, 6);

    // Zum Vergleich: mit gemitteltem Azimut käme deutlich mehr heraus.
    const falsch = REFERENZ.AT * ausrichtungsFaktor(180, 30);
    expect(a.spezifischMittel).toBeLessThan(falsch);
  });

  it("gewichtet nach Gruppengrösse, nicht nach Anzahl", () => {
    const a = anlagenErtrag([
      { kwp: 9, spezifisch: 1000 },
      { kwp: 1, spezifisch: 500 },
    ]);
    expect(a.jahresertragKwh).toBe(9500);
    expect(a.spezifischMittel).toBeCloseTo(950, 6);
  });

  it("kommt mit einer leeren Anlage klar", () => {
    const a = anlagenErtrag([]);
    expect(a.kwp).toBe(0);
    expect(a.jahresertragKwh).toBe(0);
    expect(a.spezifischMittel).toBe(0);
    expect(a.monateKwh).toHaveLength(12);
  });

  it("summiert die Monatswerte zum Jahresertrag", () => {
    const a = anlagenErtrag([
      { kwp: 8, spezifisch: 1100 },
      { kwp: 4, spezifisch: 900 },
    ]);
    const summe = a.monateKwh.reduce((s, m) => s + m, 0);
    expect(summe).toBeCloseTo(a.jahresertragKwh, 4);
  });
});

describe("Zwischenwert beim Ziehen", () => {
  it("skaliert den letzten Wert über das Verhältnis der Faktoren", () => {
    /*
     * Während der 800 ms bis zur nächsten PVGIS-Anfrage bleibt die
     * Anzeige nicht stehen. Sie rechnet aus dem letzten Wert hoch — und
     * die KPI-Leiste kennzeichnet das mit einem „~".
     */
    const letzte = { spezifisch: 1150, monate: Array(12).fill(1150 / 12), quelle: "pvgis" as const };
    const z = zwischenwert(letzte, { azimut: 180, neigung: 30 }, { azimut: 180, neigung: 60 });

    const erwartet = 1150 * (ausrichtungsFaktor(180, 60) / ausrichtungsFaktor(180, 30));
    expect(z.spezifisch).toBeCloseTo(erwartet, 6);
    // 60° ist steiler als das Optimum — der Wert muss sinken.
    expect(z.spezifisch).toBeLessThan(1150);
    // Die Herkunft bleibt erhalten — es ist immer noch der PVGIS-Wert,
    // nur umgerechnet.
    expect(z.quelle).toBe("pvgis");
  });

  it("lässt die Monatswerte mitwandern", () => {
    const letzte = { spezifisch: 1000, monate: Array(12).fill(1000 / 12), quelle: "pvgis" as const };
    const z = zwischenwert(letzte, { azimut: 180, neigung: 30 }, { azimut: 90, neigung: 30 });
    const summe = z.monate.reduce((s, m) => s + m, 0);
    expect(summe).toBeCloseTo(z.spezifisch, 4);
  });
});

describe("Cache-Schlüssel", () => {
  it("fasst nahe Standorte zusammen", () => {
    /*
     * Vier Nachkommastellen sind rund elf Meter. Zwei Punkte auf
     * demselben Dach müssen denselben Schlüssel ergeben — sonst fragt
     * jede Flächenkorrektur PVGIS erneut.
     */
    const a = cacheSchluessel({ lat: 48.30604, lon: 14.28583, azimut: 180, neigung: 30, verlustProzent: 14 });
    const b = cacheSchluessel({ lat: 48.30601, lon: 14.28581, azimut: 180, neigung: 30, verlustProzent: 14 });
    expect(a).toBe(b);
  });

  it("trennt, was sich wirklich unterscheidet", () => {
    const basis = { lat: 48.306, lon: 14.286, azimut: 180, neigung: 30, verlustProzent: 14 };
    const s = cacheSchluessel(basis);
    expect(cacheSchluessel({ ...basis, neigung: 35 })).not.toBe(s);
    expect(cacheSchluessel({ ...basis, azimut: 170 })).not.toBe(s);
    expect(cacheSchluessel({ ...basis, verlustProzent: 12 })).not.toBe(s);
    expect(cacheSchluessel({ ...basis, lat: 48.4 })).not.toBe(s);
  });
});
