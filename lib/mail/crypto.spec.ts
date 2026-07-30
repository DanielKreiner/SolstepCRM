import { randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { ausBytea, entschluesseln, verschluesseln } from "./crypto";

describe("Postfach-Zugangsdaten", () => {
  beforeAll(() => {
    process.env.MAIL_CRED_KEY ??= randomBytes(32).toString("hex");
  });

  it("kommt unverändert zurück", () => {
    const geheim = "app-passwort-mit-Ümläuten-und-§§";
    expect(entschluesseln(verschluesseln(geheim))).toBe(geheim);
  });

  it("erzeugt bei gleichem Klartext unterschiedliche Pakete", () => {
    // Sonst verrät die Datenbank, welche zwei Konten dasselbe Passwort haben.
    const a = verschluesseln("gleiches passwort");
    const b = verschluesseln("gleiches passwort");
    expect(a.equals(b)).toBe(false);
  });

  it("erkennt eine Veränderung am Chiffrat", () => {
    const paket = verschluesseln("nicht anfassen");
    // Ein Byte im Datenteil kippen.
    paket[paket.length - 1] = paket[paket.length - 1]! ^ 0xff;
    expect(() => entschluesseln(paket)).toThrow();
  });

  it("erkennt ein vertauschtes Tag", () => {
    const paket = verschluesseln("nicht anfassen");
    paket[13] = paket[13]! ^ 0xff;
    expect(() => entschluesseln(paket)).toThrow();
  });

  it("weist zu kurze Pakete ab", () => {
    expect(() => entschluesseln(Buffer.alloc(10))).toThrow("zu kurz");
  });

  it("liest den Hexstring, den PostgREST für bytea liefert", () => {
    const paket = verschluesseln("über PostgREST");
    const alsHex = `\\x${paket.toString("hex")}`;
    const zurueck = ausBytea(alsHex);
    expect(zurueck).not.toBeNull();
    expect(entschluesseln(zurueck!)).toBe("über PostgREST");
  });

  it("verlangt einen Schlüssel der richtigen Länge", () => {
    const alt = process.env.MAIL_CRED_KEY;
    process.env.MAIL_CRED_KEY = "zu-kurz";
    expect(() => verschluesseln("x")).toThrow("32 Byte");
    process.env.MAIL_CRED_KEY = alt;
  });
});
