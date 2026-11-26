import { describe, expect, it } from "vitest";
import { endungAus, pfadName, pruefeUnterlage } from "./unterlagen";

/*
 * Die Fälle hier sind nicht erfunden, sondern die, an denen so ein Upload
 * im Betrieb scheitert: ein CSV ohne Content-Type, ein Excel-Export mit
 * Leerzeichen und Umlauten im Namen, eine gescannte Lieferantenrechnung
 * mit acht Megabyte.
 */

describe("pruefeUnterlage", () => {
  it("nimmt ein CSV, auch wenn der Browser keinen Typ schickt", () => {
    /*
     * Der wichtigste Fall. Ein Kundenstamm-Export aus einem alten
     * Windows-Programm kommt oft als application/octet-stream herein.
     * Würde nur der Content-Type zählen, wäre genau die Datei
     * abgewiesen, um die es bei der Einrichtung geht.
     */
    expect(pruefeUnterlage("application/octet-stream", 4000, "kunden.csv")).toEqual({
      ok: true,
      endung: "csv",
    });
    expect(pruefeUnterlage("", 4000, "kunden.CSV")).toEqual({ ok: true, endung: "csv" });
  });

  it("nimmt Excel, PDF und Bilder", () => {
    expect(
      pruefeUnterlage(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        9000,
        "lager.xlsx",
      ).ok,
    ).toBe(true);
    expect(pruefeUnterlage("application/pdf", 9000, "rechnung.pdf").ok).toBe(true);
    expect(pruefeUnterlage("image/jpeg", 9000, "befund.jpg").ok).toBe(true);
  });

  it("nimmt einen Content-Type mit Zeichensatz", () => {
    /* Manche Browser schicken "text/csv; charset=utf-8". */
    expect(pruefeUnterlage("text/csv; charset=utf-8", 100, "x.csv").ok).toBe(true);
  });

  it("weist ausführbare und unbekannte Formate ab", () => {
    const e = pruefeUnterlage("application/x-msdownload", 100, "setup.exe");
    expect(e.ok).toBe(false);
    /* Und auch dann, wenn der Typ harmlos behauptet wird. */
    expect(pruefeUnterlage("text/csv", 100, "setup.exe").ok).toBe(true);
    expect(pruefeUnterlage("application/octet-stream", 100, "setup.exe").ok).toBe(false);
  });

  it("weist eine leere Datei ab", () => {
    expect(pruefeUnterlage("application/pdf", 0, "leer.pdf").ok).toBe(false);
  });

  it("lässt eine gescannte Rechnung mit acht Megabyte durch", () => {
    /*
     * Der Grund, warum dieser Upload direkt in den Speicher geht und
     * nicht durch eine Server Action: die nimmt nur rund vier Megabyte.
     */
    expect(pruefeUnterlage("application/pdf", 8 * 1024 * 1024, "lieferant.pdf").ok).toBe(true);
  });

  it("weist über 25 MB ab und sagt die Grenze", () => {
    const e = pruefeUnterlage("application/pdf", 26 * 1024 * 1024, "gross.pdf");
    expect(e.ok).toBe(false);
    if (!e.ok) expect(e.grund).toContain("25 MB");
  });

  it("nimmt genau 25 MB noch an", () => {
    expect(pruefeUnterlage("application/pdf", 25 * 1024 * 1024, "grenze.pdf").ok).toBe(true);
  });
});

describe("endungAus", () => {
  it("liest die Endung klein geschrieben", () => {
    expect(endungAus("Kundenstamm.CSV")).toBe("csv");
    expect(endungAus("archiv.tar.gz")).toBe("gz");
  });

  it("gibt leer zurück, wenn keine da ist", () => {
    expect(endungAus("Kundenstamm")).toBe("");
  });
});

describe("pfadName", () => {
  it("entschärft Umlaute und Leerzeichen", () => {
    expect(pfadName("Offene Rechnungen Jänner.xlsx", "xlsx")).toBe(
      "offene-rechnungen-jaenner.xlsx",
    );
  });

  it("behält nie einen leeren Stamm", () => {
    expect(pfadName("...", "pdf")).toBe("datei.pdf");
  });

  it("kürzt sehr lange Namen", () => {
    const lang = "a".repeat(200) + ".pdf";
    expect(pfadName(lang, "pdf").length).toBeLessThanOrEqual(64 + 4);
  });
});
