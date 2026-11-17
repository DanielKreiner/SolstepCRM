import { describe, expect, it } from "vitest";
import { inKlartext } from "./fehlertext";

/*
 * Die Mitteilung an die Geschäftsführung trug den rohen Wortlaut des
 * Anbieters. Im Demobestand stand dort drei Zeilen lang:
 *
 *   Resend 422: {"message":"Invalid `to` field. Please use our testing
 *   email address instead of domains like `example.com`. See our
 *   documentation for more information.","name":"validation_error", …
 *
 * Das ist keine Auskunft, sondern eine Zumutung. Wer es liest, weiss
 * nicht, ob er etwas tun muss, und im Kundentermin sieht es aus wie ein
 * Absturz.
 */
describe("inKlartext", () => {
  it("macht aus der abgelehnten Adresse eine Aufforderung", () => {
    const roh =
      'Resend 422: {"message":"Invalid `to` field. Please use our testing email address instead of domains like `example.com`. See our documentation for more information.","name":"validation_error","statusCode":422}';
    expect(inKlartext(roh)).toBe(
      "Die Empfängeradresse wurde abgelehnt. Bitte die Mailadresse beim Kunden prüfen.",
    );
  });

  it("erkennt ein Postfach, das die Anmeldung verweigert", () => {
    expect(inKlartext("Zugangsdaten sind nicht entschlüsselbar")).toContain(
      "neu verbinden",
    );
    expect(inKlartext("535 5.7.8 Authentication failed")).toContain(
      "neu verbinden",
    );
  });

  it("sagt bei einem Netzproblem, dass es von selbst weitergeht", () => {
    expect(inKlartext("getaddrinfo ENOTFOUND smtp.example.at")).toContain(
      "automatisch wiederholt",
    );
  });

  it("kürzt unbekannte Meldungen, statt einen Absatz Fremdtext zu zeigen", () => {
    const lang = `Unbekannter Anbieterfehler ${"x".repeat(300)}`;
    const kurz = inKlartext(lang);
    expect(kurz.length).toBeLessThanOrEqual(120);
    expect(kurz.endsWith("…")).toBe(true);
  });

  it("lässt eine kurze, verständliche Meldung unangetastet", () => {
    expect(inKlartext("Postfach voll")).toBe("Postfach voll");
  });
});
