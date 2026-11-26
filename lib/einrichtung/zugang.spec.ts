import { beforeAll, describe, expect, it } from "vitest";

/*
 * Der Einrichtungslink ist eine Sicherheitsgrenze: Wer einen gültigen
 * Token hat, sieht die Einrichtungsliste eines Mandanten ohne jede
 * Anmeldung. Geprüft wird deshalb nicht nur, dass ein echter Token
 * aufgeht, sondern vor allem, dass die naheliegenden falschen Tokens es
 * nicht tun.
 *
 * Der wichtigste Fall ist der dritte: ein Portal-Token darf hier nie
 * durchgehen. Beide Arten stammen aus demselben Geheimnis, und ohne
 * zweckgebundene Schlüssel wäre das eine Frage von sorgfältigem Parsen
 * — also eine Zeitfrage, bis es jemand lockerer schreibt.
 */

beforeAll(() => {
  process.env.PORTAL_TOKEN_SECRET =
    process.env.PORTAL_TOKEN_SECRET ?? "x".repeat(48);
});

const FIRMA = "11111111-1111-4111-8111-111111111111";
const KUNDE = "33333333-3333-4333-8333-333333333333";

describe("Einrichtungs-Token", () => {
  it("der eigene Token geht auf und trägt den Mandanten", async () => {
    const { zugangPruefen, zugangToken } = await import("./zugang");
    const t = zugangToken(FIRMA);
    expect(zugangPruefen(t)).toMatchObject({ companyId: FIRMA });
  });

  it("zwei Tokens für denselben Mandanten sind verschieden", async () => {
    /* Sonst wäre ein zurückgezogener Link durch Neuanlegen wieder gültig. */
    const { zugangToken } = await import("./zugang");
    expect(zugangToken(FIRMA)).not.toBe(zugangToken(FIRMA));
  });

  it("eine veränderte Signatur geht nicht auf", async () => {
    const { zugangPruefen, zugangToken } = await import("./zugang");
    const t = zugangToken(FIRMA);
    const [kopf, sig] = t.split(".") as [string, string];
    const gedreht = sig.slice(0, -1) + (sig.endsWith("A") ? "B" : "A");
    expect(zugangPruefen(`${kopf}.${gedreht}`)).toBeNull();
  });

  it("ein veränderter Inhalt geht nicht auf", async () => {
    /* Der Mandant im Inhalt getauscht, Signatur gelassen. */
    const { zugangPruefen, zugangToken } = await import("./zugang");
    const t = zugangToken(FIRMA);
    const [kopf, sig] = t.split(".") as [string, string];
    const body = Buffer.from(kopf, "base64url").toString("utf8");
    const fremd = body.replace(FIRMA, "22222222-2222-4222-8222-222222222222");
    const gefaelscht = `${Buffer.from(fremd, "utf8").toString("base64url")}.${sig}`;
    expect(zugangPruefen(gefaelscht)).toBeNull();
  });

  it("ein Portal-Token geht hier nicht auf", async () => {
    const { createToken } = await import("@/lib/portal/token");
    const { zugangPruefen } = await import("./zugang");
    expect(zugangPruefen(createToken(KUNDE))).toBeNull();
  });

  it("ein Einrichtungs-Token geht im Portal nicht auf", async () => {
    /* Die Gegenrichtung, damit niemand über die Einrichtung an Kundendaten kommt. */
    const { verifyToken } = await import("@/lib/portal/token");
    const { zugangToken } = await import("./zugang");
    expect(verifyToken(zugangToken(FIRMA))).toBeNull();
  });

  it("ein abgelaufener Token geht nicht auf", async () => {
    const { zugangPruefen, zugangToken } = await import("./zugang");
    expect(zugangPruefen(zugangToken(FIRMA, -1))).toBeNull();
  });

  it("Unsinn geht nicht auf", async () => {
    const { zugangPruefen } = await import("./zugang");
    for (const t of ["", ".", "a.b.c", "abc", "a.", ".b"]) {
      expect(zugangPruefen(t)).toBeNull();
    }
  });

  it("der Hash gibt den Token nicht her und ist stabil", async () => {
    const { zugangHash, zugangToken } = await import("./zugang");
    const t = zugangToken(FIRMA);
    const h = zugangHash(t);
    expect(h).toHaveLength(64);
    expect(h).not.toContain(t.slice(0, 12));
    expect(zugangHash(t)).toBe(h);
  });

  it("Portal und Einrichtung ergeben verschiedene Hashes", async () => {
    /*
     * Zwei Tabellen, zwei Zweckschlüssel. Wären die Hashes gleich,
     * könnte ein Eintrag der einen Tabelle den der anderen treffen.
     */
    const { hashToken } = await import("@/lib/portal/token");
    const { zugangHash, zugangToken } = await import("./zugang");
    const t = zugangToken(FIRMA);
    expect(zugangHash(t)).not.toBe(hashToken(t));
  });
});
