import { describe, expect, it } from "vitest";
import {
  darfStarten,
  darfStoppen,
  pruefeSpanne,
  ueberlappt,
} from "@/lib/zeiten/regeln";

const T = (hhmm: string) => `2026-08-05T${hhmm}:00.000Z`;

describe("darfStarten", () => {
  it("lässt starten, wenn nichts läuft", () => {
    expect(darfStarten(null).ok).toBe(true);
  });

  it("weist den zweiten Start ab", () => {
    const p = darfStarten(T("07:00"));
    expect(p.ok).toBe(false);
    expect(p.ok === false && p.grund).toMatch(/läuft schon/);
  });
});

describe("darfStoppen", () => {
  it("stoppt eine normale Schicht ohne Rückfrage", () => {
    expect(darfStoppen(T("07:00"), T("16:00")).ok).toBe(true);
  });

  it("fragt beim Doppeltipp nach, statt 0:00 zu speichern", () => {
    const p = darfStoppen(T("18:02"), T("18:02"));
    expect(p.ok).toBe(false);
    expect(p.ok === false && "rueckfrage" in p).toBe(false);
  });

  it("fragt unter fünf Minuten nach", () => {
    const p = darfStoppen(T("18:02"), T("18:05"));
    expect(p.ok).toBe(false);
    expect(p.ok === false && "rueckfrage" in p && p.rueckfrage).toBe(true);
  });

  it("kann nichts stoppen, was nicht läuft", () => {
    expect(darfStoppen(null, T("12:00")).ok).toBe(false);
  });
});

describe("ueberlappt", () => {
  const bestehend = [{ von: T("08:00"), bis: T("12:00") }];

  it("findet die Überschneidung", () => {
    expect(ueberlappt({ von: T("11:00"), bis: T("13:00") }, bestehend)).toBeTruthy();
  });

  it("lässt Berührung an der Kante durch", () => {
    expect(ueberlappt({ von: T("12:00"), bis: T("14:00") }, bestehend)).toBeNull();
  });

  it("behandelt eine offene Zeit als bis auf Weiteres", () => {
    const offen = [{ von: T("08:00"), bis: null }];
    expect(ueberlappt({ von: T("20:00"), bis: T("21:00") }, offen)).toBeTruthy();
  });
});

describe("pruefeSpanne", () => {
  const basis = { jetzt: T("18:00"), inZukunftErlaubt: false };

  it("nimmt eine saubere Spanne an", () => {
    expect(pruefeSpanne({ ...basis, von: T("08:00"), bis: T("16:30") }).ok).toBe(true);
  });

  it("weist verdrehte Zeiten ab", () => {
    expect(pruefeSpanne({ ...basis, von: T("16:00"), bis: T("08:00") }).ok).toBe(false);
  });

  it("weist die Zukunft ab, wenn sie nicht erlaubt ist", () => {
    const p = pruefeSpanne({ ...basis, von: T("19:00"), bis: T("20:00") });
    expect(p.ok).toBe(false);
    expect(p.ok === false && p.grund).toMatch(/Zukunft/);
  });

  it("erlaubt dem Büro die geplante Nacherfassung", () => {
    expect(
      pruefeSpanne({
        ...basis,
        inZukunftErlaubt: true,
        von: T("19:00"),
        bis: T("20:00"),
      }).ok,
    ).toBe(true);
  });

  it("blockt die Überschneidung und nennt sie", () => {
    const p = pruefeSpanne({ ...basis, von: T("11:00"), bis: T("13:00") }, [
      { von: T("08:00"), bis: T("12:00") },
    ]);
    expect(p.ok).toBe(false);
    expect(p.ok === false && p.grund).toMatch(/Überschneidet/);
  });
});
