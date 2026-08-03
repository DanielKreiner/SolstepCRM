import { describe, expect, it } from "vitest";
import {
  anzahlung,
  darfTerminieren,
  gateFortschritt,
  naechsterGateStatus,
  offenePflichtGates,
  phaseIndex,
  summen,
  tageInPhase,
  wechselErlaubt,
  type Gate,
  type Position,
} from "./modell";

describe("wechselErlaubt", () => {
  it("lässt genau einen Schritt vorwärts", () => {
    expect(wechselErlaubt("anfrage", "aufnahme")).toBe(true);
    expect(wechselErlaubt("beauftragt", "montage")).toBe(true);
  });

  it("lässt keine Sprünge vorwärts", () => {
    /*
     * Ein Vorgang, der von der Anfrage direkt in die Montage springt, hat
     * kein Angebot, keine Gates und keinen Auftragswert — und die
     * Terminierung prüft dann Gates, die es nicht gibt.
     */
    expect(wechselErlaubt("anfrage", "montage")).toBe(false);
    expect(wechselErlaubt("aufnahme", "beauftragt")).toBe(false);
  });

  it("lässt beliebig zurück — das ist eine Korrektur", () => {
    expect(wechselErlaubt("montage", "aufnahme")).toBe(true);
    expect(wechselErlaubt("abschluss", "anfrage")).toBe(true);
  });

  it("lässt verloren aus jeder Phase ausser dem Abschluss", () => {
    expect(wechselErlaubt("anfrage", "verloren")).toBe(true);
    expect(wechselErlaubt("beauftragt", "verloren")).toBe(true);
    // Was abgeschlossen und bezahlt ist, geht nicht mehr verloren.
    expect(wechselErlaubt("abschluss", "verloren")).toBe(false);
  });

  it("nimmt einen verlorenen Vorgang in den Vertrieb zurück", () => {
    expect(wechselErlaubt("verloren", "angebot")).toBe(true);
    expect(wechselErlaubt("verloren", "anfrage")).toBe(true);
    // Aber nicht mitten in die Ausführung.
    expect(wechselErlaubt("verloren", "montage")).toBe(false);
  });

  it("erlaubt keinen Wechsel auf sich selbst", () => {
    expect(wechselErlaubt("angebot", "angebot")).toBe(false);
  });
});

describe("phaseIndex", () => {
  it("kennt verloren nicht als Stufe", () => {
    expect(phaseIndex("anfrage")).toBe(0);
    expect(phaseIndex("abschluss")).toBe(5);
    expect(phaseIndex("verloren")).toBe(-1);
  });
});

/* ---------------------------------------------------------------- GATES */

const g = (key: string, status: Gate["status"], blocking: boolean): Gate => ({
  key,
  label: key,
  status,
  blocking,
});

describe("Gates", () => {
  it("hält die Terminierung an offenen Pflicht-Gates auf", () => {
    const gates = [
      g("anzahlung", "erledigt", true),
      g("material", "offen", true),
      g("foerderung", "offen", false),
    ];
    expect(darfTerminieren(gates)).toBe(false);
    expect(offenePflichtGates(gates).map((x) => x.key)).toEqual(["material"]);
  });

  it("lässt optionale Gates offen stehen", () => {
    /*
     * Die Förderzusage kommt in der Praxis oft erst nach der Montage. Ein
     * Betrieb, der darauf wartet, verliert eine Saison.
     */
    const gates = [
      g("anzahlung", "erledigt", true),
      g("material", "nicht_noetig", true),
      g("foerderung", "laeuft", false),
    ];
    expect(darfTerminieren(gates)).toBe(true);
  });

  it("wertet nicht nötig wie erledigt", () => {
    expect(darfTerminieren([g("geruest", "nicht_noetig", true)])).toBe(true);
  });

  it("lässt einen Vorgang ohne Gates durch", () => {
    expect(darfTerminieren([])).toBe(true);
  });

  it("zählt den Fortschritt für die Karte", () => {
    expect(
      gateFortschritt([
        g("a", "erledigt", true),
        g("b", "nicht_noetig", false),
        g("c", "offen", true),
        g("d", "laeuft", false),
      ]),
    ).toBe("2/4");
    expect(gateFortschritt([])).toBe("");
  });

  it("klickt im Kreis durch die Zustände", () => {
    expect(naechsterGateStatus("offen")).toBe("laeuft");
    expect(naechsterGateStatus("laeuft")).toBe("erledigt");
    expect(naechsterGateStatus("erledigt")).toBe("nicht_noetig");
    expect(naechsterGateStatus("nicht_noetig")).toBe("offen");
  });
});

/* --------------------------------------------------------------- SUMMEN */

const p = (
  menge: number,
  ep: number,
  ek: number | null,
  std: number | null,
  material = true,
): Position => ({
  menge,
  epNetto: ep,
  ustSatz: 20,
  kalkEk: ek,
  kalkStunden: std,
  istMaterial: material,
});

describe("summen", () => {
  it("rechnet ein Angebot durch", () => {
    const s = summen([
      p(22, 168, 118, 0.28),
      p(1, 2980, 2140, 3),
      p(42, 68, 42, 1, false),
    ]);

    expect(s.netto).toBe(22 * 168 + 2980 + 42 * 68);
    expect(s.ust).toBe(Math.round(s.netto * 0.2 * 100) / 100);
    expect(s.brutto).toBe(Math.round((s.netto * 1.2 + Number.EPSILON) * 100) / 100);
  });

  it("trennt Material von Leistung", () => {
    /*
     * Die Materialliste ist eine Bestellung. Montagestunden bestellt
     * niemand beim Grosshändler.
     */
    const s = summen([p(10, 100, 60, 0), p(5, 80, 50, 1, false)]);
    expect(s.ek).toBe(10 * 60 + 5 * 50);
    expect(s.materialEk).toBe(10 * 60);
  });

  it("summiert die kalkulierten Stunden", () => {
    const s = summen([p(22, 168, 118, 0.28), p(42, 68, 42, 1, false)]);
    expect(s.stunden).toBe(Math.round((22 * 0.28 + 42) * 100) / 100);
  });

  it("rechnet die Marge auf den Nettoumsatz", () => {
    const s = summen([p(1, 1000, 600, 0)]);
    expect(s.marge).toBe(40);
  });

  it("kommt ohne Positionen auf null und nicht auf NaN", () => {
    const s = summen([]);
    expect(s).toMatchObject({ netto: 0, ust: 0, brutto: 0, marge: 0 });
  });

  it("rundet auf Positionsebene, nicht am Ende", () => {
    // 3 × 0,105 sind 0,32 bei Positionsrundung, nicht 0,315.
    const s = summen([p(3, 0.105, null, null)]);
    expect(s.netto).toBe(0.32);
  });

  it("verliert bei fehlender Kalkulation keinen Betrag", () => {
    const s = summen([p(2, 500, null, null)]);
    expect(s.netto).toBe(1000);
    expect(s.ek).toBe(0);
    expect(s.stunden).toBe(0);
  });
});

describe("anzahlung", () => {
  it("teilt brutto und lässt keinen Cent liegen", () => {
    const { anzahlungBrutto, schlussBrutto } = anzahlung(24000, 30);
    expect(anzahlungBrutto).toBe(7200);
    expect(anzahlungBrutto + schlussBrutto).toBe(24000);
  });

  it("geht auch bei krummen Beträgen genau auf", () => {
    /*
     * Der Kunde überweist einen Bruttobetrag, und die Schlussrechnung
     * muss ihn genau so wieder abziehen — sonst bleibt ein Cent stehen,
     * den jemand suchen muss.
     */
    const { anzahlungBrutto, schlussBrutto } = anzahlung(24567.89, 33);
    expect(Math.round((anzahlungBrutto + schlussBrutto) * 100) / 100).toBe(24567.89);
  });

  it("kommt mit 0 und 100 Prozent zurecht", () => {
    expect(anzahlung(1000, 0)).toEqual({ anzahlungBrutto: 0, schlussBrutto: 1000 });
    expect(anzahlung(1000, 100)).toEqual({ anzahlungBrutto: 1000, schlussBrutto: 0 });
  });
});

describe("tageInPhase", () => {
  it("zählt angefangene Tage", () => {
    const jetzt = new Date("2026-08-10T12:00:00Z");
    expect(tageInPhase("2026-08-03T12:00:00Z", jetzt)).toBe(7);
    expect(tageInPhase("2026-08-10T11:00:00Z", jetzt)).toBe(0);
  });

  it("wird bei einem Datum in der Zukunft nicht negativ", () => {
    const jetzt = new Date("2026-08-10T12:00:00Z");
    expect(tageInPhase("2026-09-01T00:00:00Z", jetzt)).toBe(0);
  });
});
