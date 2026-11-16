import { describe, expect, it } from "vitest";
import {
  istVollBezahlt,
  offenerBetrag,
  restbetrag,
  statusNachZahlung,
  stornoPruefen,
  zahlungBuchen,
  zahlungsanteil,
} from "./zahlung";

/*
 * Der Fall, der das Modul ausgelöst hat: Schlussrechnung 12.427,20
 * brutto, der Kunde zahlt 10.000. Vorher blieb der Beleg auf
 * "versendet", und "Offen gesamt" zeigte weiter 12.427,20.
 */
const SOLL = 12_427.2;

describe("Restbetrag", () => {
  it("nennt bei einer Teilzahlung den Rest und nicht den Gesamtbetrag", () => {
    expect(restbetrag(SOLL, 10_000)).toBe(2427.2);
  });

  it("ist bei Vollzahlung null, auch bei Rundungsresten aus Gleitkomma", () => {
    expect(restbetrag(SOLL, SOLL)).toBe(0);
    expect(restbetrag(0.1 + 0.2, 0.3)).toBe(0);
  });

  it("wird nie negativ", () => {
    expect(restbetrag(100, 150)).toBe(0);
  });

  it("ist bei einem Beleg über null Euro bezahlt", () => {
    expect(restbetrag(0, 0)).toBe(0);
    expect(istVollBezahlt(0, 0)).toBe(true);
  });
});

describe("Status aus Betrag und Zahlung", () => {
  it("bleibt bei einer Teilzahlung versendet", () => {
    expect(statusNachZahlung(SOLL, 10_000)).toBe("versendet");
  });

  it("wechselt erst bei vollem Betrag auf bezahlt", () => {
    expect(statusNachZahlung(SOLL, SOLL)).toBe("bezahlt");
    /* Ein Cent zu wenig ist nicht bezahlt. */
    expect(statusNachZahlung(SOLL, SOLL - 0.01)).toBe("versendet");
  });
});

describe("Zahlung buchen", () => {
  it("verbucht eine Teilzahlung und lässt den Beleg offen", () => {
    const b = zahlungBuchen({ soll: SOLL, bisher: 0, betrag: 10_000 });
    expect(b.ok).toBe(true);
    if (!b.ok) return;
    expect(b.bezahlt).toBe(10_000);
    expect(b.rest).toBe(2427.2);
    expect(b.vollstaendig).toBe(false);
  });

  it("schliesst den Beleg bei Vollzahlung", () => {
    const b = zahlungBuchen({ soll: SOLL, bisher: 0, betrag: SOLL });
    expect(b.ok).toBe(true);
    if (!b.ok) return;
    expect(b.rest).toBe(0);
    expect(b.vollstaendig).toBe(true);
  });

  it("addiert mehrere Teilzahlungen hintereinander ohne Cent-Verlust", () => {
    /* 4.142,40 x 3 = 12.427,20 — drei Raten auf den Cent. */
    let bezahlt = 0;
    for (let i = 0; i < 3; i++) {
      const b = zahlungBuchen({ soll: SOLL, bisher: bezahlt, betrag: 4142.4 });
      expect(b.ok).toBe(true);
      if (!b.ok) return;
      bezahlt = b.bezahlt;
      expect(b.vollstaendig).toBe(i === 2);
    }
    expect(bezahlt).toBe(SOLL);
  });

  it("weist eine Überzahlung ab und nennt den offenen Betrag", () => {
    const b = zahlungBuchen({ soll: SOLL, bisher: 10_000, betrag: 3000 });
    expect(b.ok).toBe(false);
    if (b.ok) return;
    expect(b.fehler).toBe("ueberzahlung");
    expect(b.offen).toBe(2427.2);
  });

  it("lässt einen halben Cent Toleranz durch, statt einen Rest stehen zu lassen", () => {
    const b = zahlungBuchen({ soll: 100, bisher: 0, betrag: 100.004 });
    expect(b.ok).toBe(true);
    if (!b.ok) return;
    expect(b.vollstaendig).toBe(true);
  });

  it("weist einen Nullbetrag ab", () => {
    const b = zahlungBuchen({ soll: SOLL, bisher: 0, betrag: 0 });
    expect(b.ok).toBe(false);
    if (b.ok) return;
    expect(b.fehler).toBe("kein_betrag");
  });

  it("bucht nichts auf einen schon bezahlten Beleg", () => {
    const b = zahlungBuchen({ soll: SOLL, bisher: SOLL, betrag: 10 });
    expect(b.ok).toBe(false);
    if (b.ok) return;
    expect(b.fehler).toBe("nichts_offen");
    expect(b.offen).toBe(0);
  });

  it("bucht nichts auf einen Beleg über null Euro", () => {
    const b = zahlungBuchen({ soll: 0, bisher: 0, betrag: 50 });
    expect(b.ok).toBe(false);
    if (b.ok) return;
    expect(b.fehler).toBe("nichts_offen");
  });
});

describe("Offener Posten", () => {
  it("ist bei einem stornierten Beleg null, auch wenn etwas offen war", () => {
    expect(
      offenerBetrag({ betragBrutto: SOLL, bezahltBetrag: 0, status: "storniert" }),
    ).toBe(0);
  });

  it("zählt einen Entwurf mit — gestellt, nur nicht abgeschickt", () => {
    expect(
      offenerBetrag({ betragBrutto: SOLL, bezahltBetrag: 0, status: "entwurf" }),
    ).toBe(SOLL);
  });

  it("ist bei einer Teilzahlung der Rest", () => {
    expect(
      offenerBetrag({ betragBrutto: SOLL, bezahltBetrag: 10_000, status: "versendet" }),
    ).toBe(2427.2);
  });

  it("verträgt einen Beleg ohne Betrag", () => {
    expect(
      offenerBetrag({ betragBrutto: null, bezahltBetrag: 0, status: "versendet" }),
    ).toBe(0);
  });
});

describe("Zahlungsanteil", () => {
  it("ist der bezahlte Anteil des Bruttobetrags", () => {
    expect(
      zahlungsanteil({ betragBrutto: 1000, bezahltBetrag: 250, status: "versendet" }),
    ).toBe(0.25);
  });

  it("bleibt zwischen null und eins", () => {
    expect(
      zahlungsanteil({ betragBrutto: 1000, bezahltBetrag: 5000, status: "bezahlt" }),
    ).toBe(1);
    expect(
      zahlungsanteil({ betragBrutto: null, bezahltBetrag: 0, status: "versendet" }),
    ).toBe(0);
  });

  it("gilt bei einem bezahlten Beleg über null Euro als voll", () => {
    expect(
      zahlungsanteil({ betragBrutto: 0, bezahltBetrag: 0, status: "bezahlt" }),
    ).toBe(1);
  });
});

describe("Storno prüfen", () => {
  const grund = "Falscher Kunde, Beleg geht an die Hausverwaltung.";

  it("lässt eine versendete Rechnung mit Grund zu", () => {
    expect(
      stornoPruefen({ typ: "schlussrechnung", status: "versendet", grund }),
    ).toEqual({ ok: true });
  });

  it("lässt auch eine bezahlte Rechnung zu — die Rückzahlung bucht die Buchhaltung", () => {
    expect(
      stornoPruefen({ typ: "anzahlungsrechnung", status: "bezahlt", grund }),
    ).toEqual({ ok: true });
  });

  it("verweigert ein zweites Storno", () => {
    const p = stornoPruefen({ typ: "schlussrechnung", status: "storniert", grund });
    expect(p).toEqual({ ok: false, fehler: "schon_storniert" });
  });

  it("verweigert den Entwurf — der wird verworfen", () => {
    expect(stornoPruefen({ typ: "schlussrechnung", status: "entwurf", grund })).toEqual({
      ok: false,
      fehler: "entwurf",
    });
  });

  it("verweigert ein Storno ohne Grund", () => {
    expect(
      stornoPruefen({ typ: "schlussrechnung", status: "versendet", grund: "   " }),
    ).toEqual({ ok: false, fehler: "kein_grund" });
  });

  it("verweigert Belege, die keine Rechnung sind", () => {
    expect(stornoPruefen({ typ: "angebot", status: "versendet", grund })).toEqual({
      ok: false,
      fehler: "keine_rechnung",
    });
    expect(stornoPruefen({ typ: "materialliste", status: "entwurf", grund })).toEqual({
      ok: false,
      fehler: "keine_rechnung",
    });
  });
});
