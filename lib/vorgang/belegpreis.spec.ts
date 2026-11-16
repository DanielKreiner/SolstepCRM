import { describe, expect, it } from "vitest";
import { belegPreis, istGewaehlt, nettoAus } from "./belegpreis";
import { summen } from "./modell";

/*
 * Aus der Prüfung vor dem Verkaufstermin: Angebot und Auftragsbestätigung
 * wiesen verschiedene Beträge aus. Das Angebot rechnete mit `berechne()`,
 * alles danach mit `summen()` — und `summen()` addiert bloss
 * `menge × ep_netto`.
 *
 * Nachgerechnet an V-2026-0392: Angebot 14.521,02 netto,
 * Auftragsbestätigung 14.860,21. Die Differenz von 339,19 war genau die
 * eine optionale Position, die der Kunde nicht gewählt hatte.
 */
describe("Belegbetrag", () => {
  const rahmen = { ustSatz: 20, rabattProzent: 0, lieferungNetto: 0 };

  const fest = {
    id: "p1",
    gruppe_id: null,
    menge: "1",
    ep_netto: "14521.02",
    rabatt_prozent: null,
    optional: false,
    kunden_auswahl: "standard",
  };
  const option = {
    id: "p2",
    gruppe_id: null,
    menge: "1",
    ep_netto: "339.19",
    rabatt_prozent: null,
    optional: true,
    kunden_auswahl: "standard",
  };

  it("lässt eine nicht gewählte Option aussen vor", () => {
    expect(belegPreis([fest, option], [], rahmen).netto).toBe(14521.02);
  });

  it("zählt sie mit, sobald der Kunde sie angekreuzt hat", () => {
    const gewaehlt = { ...option, kunden_auswahl: "gewaehlt" };
    expect(belegPreis([fest, gewaehlt], [], rahmen).netto).toBe(14860.21);
  });

  it("weicht genau dort von der alten Rechnung ab, wo der Fehler sass", () => {
    // `summen()` kennt weder `optional` noch den Positionsrabatt.
    const alt = summen(
      [fest, option].map((p) => ({
        menge: Number(p.menge),
        epNetto: Number(p.ep_netto),
        ustSatz: 20,
        kalkStunden: null,
        kalkEk: null,
        istMaterial: true,
      })),
    );
    expect(alt.netto).toBe(14860.21);
    expect(belegPreis([fest, option], [], rahmen).netto).toBe(14521.02);
  });

  it("lässt den Paketpreis einer Gruppe gegen die Einzelsumme gewinnen", () => {
    const g = { id: "g1", paket_preis: "7000" };
    const teile = [
      { ...fest, id: "a", gruppe_id: "g1", ep_netto: "4000" },
      { ...fest, id: "b", gruppe_id: "g1", ep_netto: "3500" },
    ];
    expect(belegPreis(teile, [g], rahmen).netto).toBe(7000);
  });

  it("rechnet den Positionsrabatt mit", () => {
    const p = { ...fest, ep_netto: "1000", rabatt_prozent: "10" };
    expect(belegPreis([p], [], rahmen).netto).toBe(900);
  });

  it("nimmt die Lieferung in den Gesamtbetrag", () => {
    const p = { ...fest, ep_netto: "1000" };
    const preis = belegPreis([p], [], { ...rahmen, lieferungNetto: 299 });
    expect(preis.netto).toBe(1000);
    expect(preis.gesamt).toBe(1558.8); // 1200,00 + 358,80
  });

  it("wertet ein Upgrade als Wahl des Kunden", () => {
    expect(istGewaehlt("upgraded")).toBe(true);
    expect(istGewaehlt("gewaehlt")).toBe(true);
    expect(istGewaehlt("abgewaehlt")).toBe(false);
    expect(istGewaehlt("standard")).toBe(false);
    expect(istGewaehlt(null)).toBe(false);
  });
});

/*
 * Der Nettoanteil einer Teilzahlung stand vorher zweimal als
 * `brutto / 1.2` im Code. Bei einem deutschen Mandanten mit dem
 * PV-Nullsteuersatz wurden daraus aus 3.000 € Anzahlung 2.500 € netto —
 * und der Umsatzbericht wie der Buchhaltungsexport leiten die
 * Umsatzsteuer aus genau dieser Differenz ab. Es wurden also 500 €
 * Steuer gebucht, die nie in Rechnung gestellt wurden.
 */
describe("Nettoanteil einer Teilzahlung", () => {
  it("rechnet mit dem Steuersatz des Vorgangs", () => {
    expect(nettoAus(3600, 20)).toBe(3000);
    expect(nettoAus(3300, 10)).toBe(3000);
  });

  it("lässt den Betrag beim Nullsteuersatz unangetastet", () => {
    expect(nettoAus(3000, 0)).toBe(3000);
  });
});
